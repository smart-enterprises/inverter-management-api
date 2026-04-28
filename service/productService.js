// productService.js

import asyncHandler from "express-async-handler";

import Employee from "../models/employees.js";
import Product from "../models/product.js";
import Stock from "../models/stock.js";
import StockHistory from "../models/stockHistory.js";
import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";
import Brand from "../models/brand.js";

import logger from "../utils/logger.js";
import { generateUniqueBrandId, generateUniqueProductId, generateUniqueStockId, generateUniqueStockHistoryId } from "../utils/generatorIds.js";
import { BadRequestException } from "../middleware/CustomError.js";
import { sanitizeInput, validateMainRoleAccess, validateProductRequiredFields, validateStockType, validateStockActionType, getAuthenticatedEmployeeContext, normalizePrice, validateStockManagementRoleAccess, normalizeLower, normalizeUpper, normalizeProductType } from "../utils/validationUtils.js";
import { mapPriceHistoryEntityToResponse, mapProductBrandEntityToResponse, mapProductEntityToResponse, mapStockEntityToResponse, mapStockHistoryEntityToResponse } from "../utils/modelMapper.js";
import { PRODUCT_UPDATABLE_FIELDS, STOCK_TYPES, STOCK_ACTIONS, STATUS, ROLES, PRODUCT_CATEGORIES } from "../utils/constants.js";
import { createPriceHistory } from "./priceHistoryService.js";
import ProductPriceHistory from "../models/productPriceHistory.js";

export async function fetchProductWithStocks(product) {
    const [stocks, priceHistories, stockHistories] = await Promise.all([
        Stock.find({ product_id: product.product_id }).lean(),

        ProductPriceHistory.find({ product_id: product.product_id })
            .sort({ changed_at: -1 })
            .lean(),

        StockHistory.find({ product_id: product.product_id })
            .sort({ created_at: -1 })
            .lean(),
    ]);

    return mapProductEntityToResponse(
        product,
        stocks.map(mapStockEntityToResponse),
        priceHistories.map(mapPriceHistoryEntityToResponse),
        stockHistories.map(mapStockHistoryEntityToResponse)
    );
}

async function checkIfProductExists(brand, model) {
    const existingProduct = await Product.findOne({ brand: brand.toUpperCase(), model: model.toUpperCase() });

    if (existingProduct) {
        throw new BadRequestException(`Product with brand ${brand} and model ${model} already exists.`);
    }
}

async function logStockHistory({
    productId,
    orderNumber,
    action,
    stockType,
    quantity,
    previousStock,
    newStock,
    notes,
    employeeId
}) {
    if (quantity <= 0) return;

    const historyId = await generateUniqueStockHistoryId();

    await StockHistory.create({
        stock_history_id: historyId,
        product_id: productId,
        order_number: orderNumber,
        action,
        stock_type: stockType,
        quantity,
        previous_stock: previousStock,
        new_stock: newStock,
        notes,
        created_by: employeeId
    });
    logger.info(`📝 StockHistory Logged → Product:${productId}, Action:${action}, Type:${stockType}, Qty:${quantity}`);
}

export async function saveOrUpdateStockTransaction({
    product,
    quantity,
    action,
    stockType,
    employeeId,
    role,
    orderNumber = null,
    orderDetailsNumber = null,
    stockNotes = "",
    productionRequired = 0
}) {
    if (!product || !product.product_id) {
        throw new BadRequestException("Product information is required for stock transaction.");
    }

    if (quantity <= 0) {
        throw new BadRequestException("Quantity must be greater than 0 for stock transaction.");
    }

    let returnNote = "";

    if (action === STOCK_ACTIONS.STOCK_RETURN) {
        if (!orderNumber || typeof orderNumber !== "string") {
            throw new BadRequestException("Order number is required for RETURN.");
        }

        const order = await Order.findOne({ order_number: orderNumber });
        if (!order) {
            throw new BadRequestException(`No order found with number: ${orderNumber}`);
        }

        const query = { order_number: orderNumber, product_id: product.product_id };
        if (orderDetailsNumber) query.order_details_number = orderDetailsNumber;

        const orderDetails = await OrderDetails.find(query);
        if (!orderDetails || orderDetails.length === 0) throw new BadRequestException(`No order details found for product ${product.product_id} in order ${orderNumber}`);

        const detailNums = orderDetails.map(d => d.order_details_number).join(", ");
        returnNote = `RETURN: Order #${order.order_number}; Details [${detailNums}]; Returned Qty: ${quantity}`;
    }

    const productionNote = productionRequired > 0 ? ` | Production Required: ${productionRequired}` : "";

    const internalNote = `${action} ${orderNumber ? `(Order:${orderNumber})` : ""}${productionNote} -- ` +
        `Employee:${employeeId}; Role:${role}; ${returnNote}; ` +
        `Date:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

    const combinedNotes = stockNotes
        ? `${stockNotes} || ${internalNote}`
        : internalNote;

    const existingStock = await Stock.findOne({ product_id: product.product_id });

    const previousPacked = existingStock?.packed_stock ?? 0;
    const previousUnpacked = existingStock?.unpacked_stock ?? 0;

    let updatedPacked = previousPacked;
    let updatedUnpacked = previousUnpacked;

    if ([STOCK_ACTIONS.STOCK_ADD, STOCK_ACTIONS.STOCK_RETURN].includes(action)) {
        if (stockType === STOCK_TYPES.STOCK_PACKED) updatedPacked += quantity;
        if (stockType === STOCK_TYPES.STOCK_UNPACKED) updatedUnpacked += quantity;
    }

    const newTotal = updatedPacked + updatedUnpacked;

    let stockRecord;
    if (existingStock) {
        existingStock.packed_stock = updatedPacked;
        existingStock.unpacked_stock = updatedUnpacked;
        existingStock.stock = newTotal;
        existingStock.updated_at = new Date();
        await existingStock.save();

        stockRecord = existingStock;
        logger.info(`Updated Stock → Product:${product.product_id}, Total:${newTotal}`);
    } else {
        stockRecord = await Stock.create({
            stock_id: await generateUniqueStockId(),
            product_id: product.product_id,
            packed_stock: updatedPacked,
            unpacked_stock: updatedUnpacked,
            stock: newTotal,
            created_by: employeeId,
        });

        logger.info(`Created Stock → Product:${product.product_id}, Total:${newTotal}`);
    }

    const previousStockValue =
        stockType === STOCK_TYPES.STOCK_PACKED
            ? previousPacked
            : previousUnpacked;

    const newStockValue =
        stockType === STOCK_TYPES.STOCK_PACKED
            ? updatedPacked
            : updatedUnpacked;

    await logStockHistory({
        productId: product.product_id,
        orderNumber,
        action,
        stockType,
        quantity,
        previousStock: previousStockValue,
        newStock: newStockValue,
        notes: combinedNotes,
        employeeId
    });

    product.available_stock = await productService.calculateAvailableStock(product.product_id);
    await product.save();

    return stockRecord;
}

const productService = {
    createProduct: asyncHandler(async (dto) => {
        const { employee_id } = validateMainRoleAccess();
        validateProductRequiredFields(dto);

        const brandInput = sanitizeInput(dto.brand).toUpperCase();
        const modelInput = sanitizeInput(dto.model).toUpperCase();
        const productName = sanitizeInput(dto.product_name);
        const productType = sanitizeInput(dto.product_type);
        const productCategory = sanitizeInput(dto.product_category || 'INVERTER').toUpperCase();

        if (!productCategory || !PRODUCT_CATEGORIES[productCategory]) {
            throw new BadRequestException(`Invalid product category: ${productCategory}. Allowed categories: ${Object.keys(PRODUCT_CATEGORIES).join(", ")}`);
        }

        const brandRecord = await Brand
            .findOne({ brand_name: brandInput })
            .lean();

        if (!brandRecord) {
            throw new BadRequestException(
                `Brand ${dto.brand} does not exist.`
            );
        }

        const brandStatus = brandRecord.status?.toLowerCase();

        if (["inactive", "discontinued"].includes(brandStatus)) {
            throw new BadRequestException(
                `Cannot create product under brand ${dto.brand} (status: ${brandStatus}).`
            );
        }

        const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());

        if (!brandModels.includes(modelInput)) {
            throw new BadRequestException(
                `Model ${dto.model} is not associated with brand ${dto.brand}.`
            );
        }

        const existingProduct = await Product.findOne({
            brand: brandInput,
            model: modelInput,
            product_name: productName,
            product_type: productType,
            product_category: productCategory
        }).lean();

        if (existingProduct) {
            throw new BadRequestException(
                `Product already exists: ${brandInput} / ${modelInput} / ${productName} (${productType} | ${productCategory})`
            );
        }

        const productId = await generateUniqueProductId();
        const normalizedPrice = normalizePrice(dto.product_price) || 0;
        const normalizedCost = normalizePrice(dto.product_cost) || 0;

        const product = await Product.create({
            product_id: productId,
            brand: brandInput,
            model: modelInput,
            product_type: productType,
            product_category: productCategory,
            product_name: productName,
            available_stock: Number(dto.available_stock || 0),
            price: normalizedPrice,
            cost: normalizedCost,
            created_by: employee_id
        });

        // 🔹 Price History (initial record)
        await createPriceHistory({
            product_id: productId,
            old_price: 0,
            new_price: normalizedPrice,
            changed_by: employee_id,
            change_reason: "Product created",
            isCostUpdate: false
        });

        // 🔹 Cost History (initial record)
        await createPriceHistory({
            product_id: productId,
            old_price: 0,
            new_price: normalizedCost,
            changed_by: employee_id,
            change_reason: "Product created",
            isCostUpdate: true
        });

        if (Array.isArray(dto.stocks) && dto.stocks.length > 0) {
            await productService.createOrUpdateProductStock({ [productId]: dto.stocks });

            product.available_stock = await productService.calculateAvailableStock(product.product_id);
            await product.save();
        }

        return fetchProductWithStocks(product);
    }),

    updateProduct: asyncHandler(async (productId, dto) => {
        const { employee_id } = validateMainRoleAccess();

        const requestingEmployee = await Employee.findOne({ employee_id: employee_id, status: 'active' });
        if (!requestingEmployee) {
            throw new BadRequestException(`Requesting employee not found or inactive: ${employee_id}`);
        }

        const product = await Product.findOne({ product_id: productId });
        if (!product) {
            throw new BadRequestException(`No product found with ID ${productId}.`);
        }

        logger.info(`📦 Product update requested → ID:${productId} by Employee:${employee_id}`);

        const updates = {};
        for (const key of PRODUCT_UPDATABLE_FIELDS) {
            if (['brand', 'model'].includes(key)) continue;

            if (dto[key] !== undefined) {
                const sanitized = sanitizeInput(dto[key]);
                if (product[key] !== sanitized) {
                    updates[key] = sanitized;
                }
            }
        }

        // Detect Category Change
        if (dto.product_category !== undefined) {
            const normalizedCategory = sanitizeInput(dto.product_category || 'INVERTER').toUpperCase();

            if (!normalizedCategory || !PRODUCT_CATEGORIES[normalizedCategory]) {
                throw new BadRequestException(`Invalid product category: ${normalizedCategory}. Allowed categories: ${Object.keys(PRODUCT_CATEGORIES).join(", ")}`);
            }

            updates.product_category = normalizedCategory;
        }

        // Detect Price Change
        const normalizedPrice = normalizePrice(dto.product_price);
        if (normalizedPrice !== undefined) {
            if (isNaN(normalizedPrice) || normalizedPrice < 0) {
                throw new BadRequestException('Product price must be a non-negative number.');
            }
            if (normalizedPrice !== product.price) {
                updates.price = normalizedPrice;

                await createPriceHistory({
                    product_id: productId,
                    old_price: product.price,
                    new_price: normalizedPrice,
                    changed_by: employee_id,
                    change_reason:
                        sanitizeInput(dto.price_change_reason) ||
                        "Manual price update",
                    isCostUpdate: false
                });
            }
        }

        // Detect Cost Change
        const normalizedCost = normalizePrice(dto.product_cost);
        if (normalizedCost !== undefined) {
            if (isNaN(normalizedCost) || normalizedCost < 0) {
                throw new BadRequestException('Product cost must be a non-negative number.');
            }
            if (normalizedCost !== product.cost) {
                updates.cost = normalizedCost;

                await createPriceHistory({
                    product_id: productId,
                    old_price: product.cost,
                    new_price: normalizedCost,
                    changed_by: employee_id,
                    change_reason:
                        sanitizeInput(dto.cost_change_reason) ||
                        "Manual cost update",
                    isCostUpdate: true
                });
            }
        }

        if (dto.status !== undefined) {
            const normalized = sanitizeInput(dto.status).toLowerCase();
            if (!STATUS.includes(normalized)) {
                throw new BadRequestException(`Status must be one of: ${STATUS.join(', ')}`);
            }

            if (normalized !== product.status) {
                updates.status = normalized;
                const reason = sanitizeInput(dto.status_reason || '');
                const logNote = `Status changed: ${product.status} → ${normalized} by ${requestingEmployee.employee_name} | Reason: ${reason}`;
                updates.log_note = product.log_note ? `${product.log_note}\n${logNote}` : logNote;

                if (normalized === 'active') {
                    const brand = await Brand.findOne({ brand_name: product.brand });
                    if (!brand || brand.status !== 'active') {
                        throw new BadRequestException(`Cannot activate product; associated brand ${product.brand} is not active.`);
                    }
                }
            }
        }

        if (!Object.keys(updates).length) return fetchProductWithStocks(product);

        updates.available_stock = await productService.calculateAvailableStock(productId);

        const updated = await Product.findOneAndUpdate({ product_id: productId }, { $set: updates }, { new: true });
        if (!updated) throw new BadRequestException(`Failed to update product with ID ${productId}.`);

        logger.info(`🔄 Product updated → ID:${productId}`);
        return fetchProductWithStocks(updated);
    }),

    createOrUpdateProductStock: asyncHandler(async (stockMapInput) => {
        const { employee_id, role } = validateStockManagementRoleAccess();

        if (!stockMapInput || typeof stockMapInput !== 'object' || Array.isArray(stockMapInput)) {
            throw new BadRequestException("Expected a product-wise stock object.");
        }

        const result = [];

        for (const [productId, entries] of Object.entries(stockMapInput)) {
            const product = await Product.findOne({ product_id: productId, status: 'active' });
            if (!product) {
                throw new BadRequestException(`Invalid product ID or product inactive: ${productId}`);
            }

            const entryArray = Array.isArray(entries) ? entries : [entries];
            let latestStockRecord = null;

            for (const entry of entryArray) {
                const action = validateStockActionType(entry.type);
                const stockType = validateStockType(entry.stock_type);

                if (typeof entry.stock !== 'number' || entry.stock <= 0) {
                    throw new BadRequestException("Stock must be a positive number.");
                }

                latestStockRecord = await saveOrUpdateStockTransaction({
                    product,
                    quantity: entry.stock,
                    action,
                    stockType,
                    employeeId: employee_id,
                    role,
                    orderNumber: entry.order_number || null,
                    stockNotes: entry.stock_notes || ''
                });
            }

            product.available_stock = await productService.calculateAvailableStock(product.product_id);
            await product.save();

            result.push(mapProductEntityToResponse(product.toObject(), [mapStockEntityToResponse(latestStockRecord.toObject())]));
        }

        return result;
    }),

    calculateAvailableStock: asyncHandler(async (productId) => {
        try {
            const available = await Stock.getAvailableStockByProductId(productId, logger);
            logger.info(`📊 Stock Calculation → Product:${productId} | Available:${available}`);
            return available;
        } catch (error) {
            logger.error(`❌ Stock calc failed → Product:${productId} | Error:${error.message}`);
            throw error;
        }
    }),

    getAllProductsByBrands: asyncHandler(async (dto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const { brands } = dto;

        if (!Array.isArray(brands) || brands.length === 0) {
            throw new BadRequestException('At least one brand must be provided.');
        }

        const brandInputs = brands.map((b) => sanitizeInput(b).toUpperCase());
        logger.info('product by brands | request', { employeeId, employeeRole, brands: brandInputs });

        const activeBrands = await Brand.find({
            $or: [
                { brand_name: { $in: brandInputs } },
                { brand_id: { $in: brandInputs } },
            ],
            status: 'active',
        })
            .select('brand_name')
            .lean();

        if (activeBrands.length === 0) {
            throw new BadRequestException(`No active brands found for [${brandInputs.join(', ')}]`);
        }

        const validBrandNames = activeBrands.map((b) => b.brand_name.toUpperCase());
        logger.info('product by brands | activeBrands', { employeeId, employeeRole, activeBrands: validBrandNames });

        const products = await Product.find({
            brand: { $in: validBrandNames },
            status: 'active',
        })
            .sort({ created_at: -1 })
            .lean();

        if (products.length === 0) {
            throw new BadRequestException(`No products found for active brands: [${validBrandNames.join(', ')}]`);
        }

        const productIds = products.map(({ product_id }) => product_id);
        logger.info('product by brands | productsFound', { count: products.length });

        const [stocks, priceHistories, stockHistories] = await Promise.all([
            Stock.find({ product_id: { $in: productIds } }).lean(),

            ProductPriceHistory
                .find({ product_id: { $in: productIds } })
                .sort({ changed_at: -1 })
                .lean(),

            StockHistory.find({ product_id: { $in: productIds } })
                .sort({ created_at: -1 })
                .lean(),
        ]);

        const stockMap = stocks.reduce((acc, stock) => {
            const productId = stock.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapStockEntityToResponse(stock)
            );

            return acc;
        }, {});

        const priceHistoryMap = priceHistories.reduce((acc, history) => {
            const productId = history.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapPriceHistoryEntityToResponse(history)
            );

            return acc;
        }, {});

        const stockHistoryMap = stockHistories.reduce((acc, history) => {
            const productId = history.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapStockHistoryEntityToResponse(history)
            );

            return acc;
        }, {});

        return products.map(product =>
            mapProductEntityToResponse(
                product,
                stockMap[product.product_id] || [],
                priceHistoryMap[product.product_id] || [],
                stockHistoryMap[product.product_id] || [],
            )
        );
    }),

    getByProductId: asyncHandler(async (productId) => {
        const product = await Product.findOne({ product_id: productId });

        if (!product) throw new BadRequestException(`No product found with ID ${productId}`);
        return fetchProductWithStocks(product);
    }),

    getProducts: asyncHandler(async ({
        page = 1,
        limit = 10,
        search = "",
        type,
        status,
        category,
        brand,
        model
    }) => {
        const skip = (page - 1) * limit;

        // 🔹 Build filter
        const filter = {};

        if (status && status !== "all" && status !== "All" && status !== "ALL") filter.status = status;

        const normalizedType = normalizeProductType(type);
        if (normalizedType) {
            filter.product_type = {
                $regex: `^${normalizedType}$`,
                $options: "i",
            };
        }

        if (category && category !== "all" && category !== "All" && category !== "ALL") filter.product_category = category;
        if (brand && brand !== "all" && brand !== "All" && brand !== "ALL") filter.brand = brand;
        if (model && model !== "all" && model !== "All" && model !== "ALL") filter.model = model;

        if (search) {
            filter.$or = [
                { product_name: { $regex: search, $options: "i" } },
                { product_id: { $regex: search, $options: "i" } },
                { brand: { $regex: search, $options: "i" } },
                { model: { $regex: search, $options: "i" } },
                { product_type: { $regex: search, $options: "i" } },
                { product_category: { $regex: search, $options: "i" } },
            ];
        }

        // 🔹 Fetch products with pagination
        const [products, total] = await Promise.all([
            Product.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            Product.countDocuments(filter),
        ]);

        if (!products.length) {
            return {
                data: [],
                pagination: {
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                },
            };
        }

        const productIds = products.map(({ product_id }) => product_id);

        const [stocks, priceHistories, stockHistories] = await Promise.all([
            Stock.find({ product_id: { $in: productIds } }).lean(),

            ProductPriceHistory
                .find({ product_id: { $in: productIds } })
                .sort({ changed_at: -1 })
                .lean(),

            StockHistory.find({ product_id: { $in: productIds } })
                .sort({ created_at: -1 })
                .lean(),
        ]);

        logger.info("Stock histories fetched", {
            stockHistories,
        });

        const stockMap = stocks.reduce((acc, stock) => {
            const productId = stock.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapStockEntityToResponse(stock)
            );

            return acc;
        }, {});

        const priceHistoryMap = priceHistories.reduce((acc, history) => {
            const productId = history.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapPriceHistoryEntityToResponse(history)
            );

            return acc;
        }, {});

        const stockHistoryMap = stockHistories.reduce((acc, history) => {
            const productId = history.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapStockHistoryEntityToResponse(history)
            );

            return acc;
        }, {});

        const data = products.map(product =>
            mapProductEntityToResponse(
                product,
                stockMap[product.product_id] || [],
                priceHistoryMap[product.product_id] || [],
                stockHistoryMap[product.product_id] || [],
            )
        );

        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }),

    getProductsByIds: asyncHandler(async (productIds) => {
        if (!Array.isArray(productIds) || productIds.length === 0) {
            throw new BadRequestException("Product IDs must be a non-empty array.");
        }

        const [products, stocks] = await Promise.all([
            Product.find({ product_id: { $in: productIds } }),
            Stock.find({
                product_id: { $in: productIds },
                stock: { $gt: 0 }
            })
        ]);

        if (!products.length) {
            throw new BadRequestException(`No products found for IDs: ${productIds.join(", ")}`);
        }

        const productMap = new Map();
        const productStockMap = new Map();
        const productAvailableStockMap = new Map();

        products.forEach(p => {
            productMap.set(p.product_id, p);
        });

        stocks.forEach(s => {
            productStockMap.set(s.product_id, s);
            productAvailableStockMap.set(s.product_id, s.stock);
        });

        return { productMap, productStockMap, productAvailableStockMap };
    }),

    getLowStockProducts: asyncHandler(async ({ page, limit, threshold }) => {
        const skip = (page - 1) * limit;

        // 🔍 Find low-stock products
        const filter = {
            status: "active",
            available_stock: { $lte: threshold }
        };

        const [products, total] = await Promise.all([
            Product.find(filter)
                .sort({ available_stock: 1, created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            Product.countDocuments(filter)
        ]);

        if (!products.length) {
            return {
                data: [],
                pagination: {
                    page,
                    limit,
                    total,
                    pages: 0
                }
            };
        }

        const productIds = products.map(p => p.product_id);

        const [stocks, priceHistories, stockHistories] = await Promise.all([
            Stock.find({ product_id: { $in: productIds } }).lean(),

            ProductPriceHistory
                .find({ product_id: { $in: productIds } })
                .sort({ changed_at: -1 })
                .lean(),

            StockHistory.find({ product_id: { $in: productIds } })
                .sort({ created_at: -1 })
                .lean(),
        ]);

        const stockMap = stocks.reduce((acc, stock) => {
            const productId = stock.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapStockEntityToResponse(stock)
            );

            return acc;
        }, {});

        const priceHistoryMap = priceHistories.reduce((acc, history) => {
            const productId = history.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapPriceHistoryEntityToResponse(history)
            );

            return acc;
        }, {});

        const stockHistoryMap = stockHistories.reduce((acc, history) => {
            const productId = history.product_id;

            if (!acc[productId]) {
                acc[productId] = [];
            }

            acc[productId].push(
                mapStockHistoryEntityToResponse(history)
            );

            return acc;
        }, {});

        const result = products.map(product =>
            mapProductEntityToResponse(
                product,
                stockMap[product.product_id] || [],
                priceHistoryMap[product.product_id] || [],
                stockHistoryMap[product.product_id] || [],
            )
        );

        return {
            data: result,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }),

    checkAndReserveStock: asyncHandler(async (product, stockDoc, requiredQty, employeeId, role, orderNumber) => {
        if (requiredQty <= 0) throw new BadRequestException('Ordered quantity must be greater than 0.');
        if (!stockDoc) {
            return {
                availableStockUsed: 0,
                packedUsed: 0,
                unpackedUsed: 0,
                productionRequired: requiredQty
            };
        }

        let remaining = requiredQty;

        const initialPacked = stockDoc.packed_stock || 0;
        const initialUnpacked = stockDoc.unpacked_stock || 0;

        let packedUsed = 0;
        let unpackedUsed = 0;

        if (initialPacked > 0) {
            packedUsed = Math.min(initialPacked, remaining);
            stockDoc.packed_stock -= packedUsed;
            remaining -= packedUsed;
        }

        if (remaining > 0 && initialUnpacked > 0) {
            unpackedUsed = Math.min(initialUnpacked, remaining);
            stockDoc.unpacked_stock -= unpackedUsed;
            remaining -= unpackedUsed;
        }

        const productionRequired = Math.max(remaining, 0);

        stockDoc.stock = stockDoc.packed_stock + stockDoc.unpacked_stock;
        await stockDoc.save();

        const dateNow = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

        const historyEntries = [
            {
                used: packedUsed,
                type: STOCK_TYPES.STOCK_PACKED,
                prev: initialPacked,
                curr: stockDoc.packed_stock,
                label: "PACKED"
            },
            {
                used: unpackedUsed,
                type: STOCK_TYPES.STOCK_UNPACKED,
                prev: initialUnpacked,
                curr: stockDoc.unpacked_stock,
                label: "UNPACKED"
            }
        ];

        await Promise.all(
            historyEntries
                .filter(h => h.used > 0)
                .map(h => logStockHistory({
                    productId: product.product_id,
                    orderNumber,
                    action: STOCK_ACTIONS.STOCK_SALE,
                    stockType: h.type,
                    quantity: h.used,
                    previousStock: h.prev,
                    newStock: h.curr,
                    notes: `Sale ${h.label} order:${orderNumber} product:${product.product_id} qty:${h.used} date:${dateNow}`,
                    employeeId
                }))
        );

        product.available_stock = await productService.calculateAvailableStock(product.product_id);
        await product.save();

        logger.info(`Stock updated product: ${product.product_id} packed: ${packedUsed} unpacked: ${unpackedUsed} production: ${productionRequired}`);

        return {
            availableStockUsed: packedUsed + unpackedUsed,
            packedUsed,
            unpackedUsed,
            productionRequired
        };
    }),

    getAllBrands: asyncHandler(async ({ dealerId = "all", status = "all" }) => {
        let filter = {};

        if (status !== "all") {
            filter.status = status;
        }

        if (dealerId !== "all") {
            const dealer = await Employee.findOne({ employee_id: dealerId, role: ROLES.DEALER });
            if (!dealer) {
                throw new BadRequestException(`Invalid dealer ID: ${dealerId}`);
            }

            logger.info(`Dealer brands: ${JSON.stringify(dealer.brand, null, 2)}`);

            const dealerBrands = dealer.brand.map(b => b.toUpperCase());
            filter.$or = [
                { brand_name: { $in: dealerBrands } },
                { brand_id: { $in: dealerBrands } }
            ];
        }

        const productBrands = await Brand.find(filter).sort({ created_at: -1 });
        return productBrands.map(mapProductBrandEntityToResponse);
    }),

    getByBrandId: asyncHandler(async (brandId) => {
        const productBrand = await Brand.findOne({ brand_id: brandId }).lean();
        if (!productBrand) {
            throw new BadRequestException(`No product brand found with ID ${brandId}`);
        }

        return mapProductBrandEntityToResponse(productBrand);
    }),

    createProductBrands: asyncHandler(async (brandsData) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const brandDocs = [];

        for (const brand of brandsData) {
            const brand_name = brand.brand_name?.toUpperCase().trim();
            if (!brand_name) {
                throw new BadRequestException("Brand name is missing or invalid.");
            }

            const existingBrand = await Brand.findOne({ brand_name: brand_name });
            if (existingBrand) {
                throw new BadRequestException(`Brand ${brand_name} already exists.`);
            }

            const brand_models = [...new Set(
                brand.brand_models.map((model) => model.trim().toUpperCase())
            )];

            const brandDoc = new Brand({
                brand_id: await generateUniqueBrandId(),
                brand_name,
                brand_models,
                description: brand.description?.trim() || "",
                created_by: employeeId
            });

            brandDocs.push(brandDoc);
        }

        await Brand.insertMany(brandDocs);
        return brandDocs.map((brand) =>
            mapProductBrandEntityToResponse(brand)
        );
    }),

    statusChangeByBrandName: asyncHandler(async (brandName, bodyData) => {
        const {
            status,
            brand_models = [],
            brand_name = brandName,
            brand_models_update = {},
            delete_models = [],
            description = ""
        } = bodyData;

        const normalizedStatus = normalizeLower(status);
        const normalizedBrandName = normalizeUpper(brandName);
        const newBrandName = normalizeUpper(brand_name);

        if (!normalizedBrandName || typeof normalizedBrandName !== 'string' || !normalizedBrandName.trim()) {
            throw new BadRequestException("Brand name parameter is missing or invalid.");
        }

        if (normalizedStatus && !STATUS.includes(normalizedStatus)) {
            throw new BadRequestException("Status must be one of: " + STATUS.join(', '));
        }

        const brand = await Brand.findOne({ brand_name: normalizedBrandName });
        if (!brand) {
            throw new BadRequestException(`Brand ${normalizedBrandName} not found.`);
        }

        let updatedModelsSet = new Set(brand.brand_models.map(m => normalizeUpper(m)));

        if (Array.isArray(brand_models) && brand_models.length > 0) {
            brand_models.forEach(model => updatedModelsSet.add(normalizeUpper(model)));
        }

        if (brand_models_update && typeof brand_models_update === 'object') {
            for (const [oldModel, newModel] of Object.entries(brand_models_update)) {
                const oldM = normalizeUpper(oldModel);
                const newM = normalizeUpper(newModel);
                if (updatedModelsSet.has(oldM)) {
                    updatedModelsSet.delete(oldM);
                    updatedModelsSet.add(newM);

                    await Product.updateMany(
                        { brand: normalizedBrandName, model: oldM },
                        { $set: { model: newM } }
                    );
                }
            }
        }

        let deletedModelsList = brand.deleted_brand_models || [];
        if (Array.isArray(delete_models) && delete_models.length > 0) {
            for (const model of delete_models) {
                const mUpper = normalizeUpper(model);
                if (updatedModelsSet.has(mUpper)) {
                    updatedModelsSet.delete(mUpper);
                    deletedModelsList.push(mUpper);
                }
            }
        }

        const descriptionNote =
            typeof description === "string" && description.trim()
                ? description.trim()
                : brand.description || "";

        const mergedBrandModels = Array.from(updatedModelsSet);

        const updateTimestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const brandStatusChanged = brand.status.toLowerCase() !== normalizedStatus;

        let updateBrandFields = {
            brand_models: mergedBrandModels,
            deleted_brand_models: deletedModelsList,
            description: descriptionNote,
            updated_at: updateTimestamp
        };

        if (brandStatusChanged) {
            const products = await Product.find({ brand: normalizedBrandName }, { product_id: 1 }).lean();
            const productIds = products.map(p => p.product_id);

            if (['active', 'inactive'].includes(normalizedStatus)) {
                updateBrandFields.status = normalizedStatus;

                await Product.updateMany(
                    { product_id: { $in: productIds } },
                    { $set: { status: normalizedStatus, updated_at: updateTimestamp } }
                );
            } else if (normalizedStatus === 'discontinued') {
                const { productAvailableStockMap } = await productService.getProductsByIds(productIds);
                const discontinuedIds = productIds.filter(id => productAvailableStockMap.get(id) <= 0);
                if (!discontinuedIds.length) {
                    throw new BadRequestException("Cannot discontinue brand. Products still have stock.");
                }

                await Product.updateMany(
                    { product_id: { $in: discontinuedIds } },
                    { $set: { status: 'discontinued', updated_at: updateTimestamp } }
                );

                if (productIds.length === discontinuedIds.length) {
                    updateBrandFields.status = normalizedStatus;
                }
            }
        }

        if (newBrandName && newBrandName !== normalizedBrandName) {
            updateBrandFields.brand_name = newBrandName;

            await Product.updateMany(
                { brand: normalizedBrandName },
                { $set: { brand: newBrandName } }
            );
        }

        await Brand.updateOne(
            { brand_name: normalizedBrandName },
            { $set: updateBrandFields }
        );

        logger.info(`✅ Brand Updated:
            ➤ Old Brand Name: ${normalizedBrandName}
            ➤ New Brand Name: ${newBrandName || normalizedBrandName}
            ➤ Status Change: ${brand.status} → ${normalizedStatus}
            ➤ Models: [${mergedBrandModels.join(', ')}]
            ➤ Deleted Models: [${deletedModelsList.join(', ')}]
            ➤ Timestamp: ${updateTimestamp}
        `);

        const updatedBrand = await Brand.findOne({ brand_name: newBrandName || normalizedBrandName });
        return mapProductBrandEntityToResponse(updatedBrand);
    }),

    // get product types
    getProductTypes: asyncHandler(async () => {
        const types = await Product.distinct("product_type");

        const normalised = [...new Set(
            types
                .filter(Boolean)
                .map(t => t.trim().toUpperCase())
        )].sort();

        return normalised;
    }),

    // get product categories
    getProductCategories: asyncHandler(async () => {
        const categories = Object.keys(PRODUCT_CATEGORIES).sort();
        return categories;
    }),

}

export { productService };