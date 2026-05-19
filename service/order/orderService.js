// service/orderService.js
import asyncHandler from "express-async-handler";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import logger from "../../utils/logger.js";
import Employee from "../../models/employees.js";
import Order from "../../models/order.js";
import OrderDetails from "../../models/orderDetails.js";
import DealerDiscount from "../../models/dealerDiscount.js";

import { generateUniqueOrderDetailsId, generateUniqueOrderId } from "../../utils/generatorIds.js";
import { BadRequestException, ForbiddenException } from "../../middleware/CustomError.js";
import { getAuthenticatedEmployeeContext, isValidTransition, normalizePrice, round, sanitizeInput } from "../../utils/validationUtils.js";

import { getISTDate, ROLES, STOCK_TYPES, ORDER_STATUSES, CANCELLABLE_STATUSES, ADMIN_PRIVILEGED_ROLES, STATUSES_REQUIRING_DETAIL_VALIDATION, IMMUTABLE_ORDER_STATUSES } from "../../utils/constants.js";
import { mapOrderDetailEntityToResponse, transformOrderToResponse } from "../../utils/modelMapper.js";
import { productService } from "../productService.js";
import Product from "../../models/product.js";
import { assertCancellable, assertRejectAllowed, assertTransitionAllowed, isValidStatus, normalizeStatus } from "../../utils/orderStatusUtils.js";
import invoiceService from "../invoiceService.js";
import { allDetailsDelivered, canMoveOrderToTargetStatus, deriveOrderStatusFromDetails, resolveOrderDetailStatus } from "./orderStatus.js";
import { validateOrderCreator, validateOrderDTO } from "./orderValidation.js";
import { persistStockReturns, returnStockForDetail } from "./orderStock.js";
import { buildDateRange, fetchDealerAndOrderDetails } from "./orderHelpers.js";
import { notificationService } from "../notification/notificationService.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const orderService = {
    createOrder: asyncHandler(async (dto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        logger.info("[CREATE_ORDER]", {
            employeeId,
            employeeRole,
            timestamp: new Date().toISOString()
        });

        validateOrderCreator(employeeId, employeeRole, dto);

        const dealer = await validateOrderDTO(dto);
        const orderNumber = await generateUniqueOrderId();

        const order = new Order({
            order_number: orderNumber,
            dealer_id: sanitizeInput(dealer.employee_id),
            created_by: employeeId,
            salesman_id: sanitizeInput(dto.salesman_id),
            priority: sanitizeInput(dto.priority || "LOW"),
            order_note: sanitizeInput(dto.order_note || ""),
        });

        const productIds = dto.order_details.map(d => d.product_id);
        const { productMap, productStockMap } = await productService.getProductsByIds(productIds);

        let totalOrderAmount = 0;
        let totalOrderDiscount = 0;
        let hasPendingProduction = false;

        const orderDetailsPayload = [];

        for (const detail of dto.order_details) {
            const product = productMap.get(detail.product_id);
            if (!product) throw new BadRequestException(`Product not found: ${detail.product_id}`);

            const stockDoc = productStockMap.get(detail.product_id);
            const qtyOrdered = Number(detail.qty_ordered);

            logger.info(`📦 Stocks for ${detail.product_id}, ${stockDoc}`);

            const isProductScheme = Boolean(detail.is_product_scheme);
            logger.info(`📦 Product: ${product.product_id} | is_product_scheme: ${detail.is_product_scheme} | Parsed: ${isProductScheme}`);

            // 🔋 Battery identification using product_category
            const isBattery =
                typeof product.product_category === "string" &&
                product.product_category.toLowerCase().includes("battery");

            let productionRequired = 0;
            let packedUsed = 0;
            let unpackedUsed = 0;

            if (isBattery) {
                packedUsed = qtyOrdered;
                // ✅ Battery Logic: always treat as packed, skip production
                logger.info(`🔋 Battery product detected: ${product.product_id} | Qty: ${qtyOrdered} → Direct PACKED`);
            } else {
                // ✅ Existing stock allocation logic for non-battery products
                const result = await productService.checkAndReserveStock(
                    product,
                    stockDoc,
                    qtyOrdered,
                    employeeId,
                    employeeRole,
                    orderNumber
                );

                productionRequired = result.productionRequired;
                packedUsed = result.packedUsed;
                unpackedUsed = result.unpackedUsed;
            }

            if (productionRequired > 0 || unpackedUsed > 0) {
                hasPendingProduction = true;
            }

            const stockUsage = {
                PACKED: packedUsed || 0,
                UNPACKED: unpackedUsed || 0,
                PRODUCTION: productionRequired || 0
            };
            const stockFlags = {
                ...stockUsage,
                hasUnpacked: unpackedUsed > 0,
                hasProduction: productionRequired > 0
            };

            const unitPrice = normalizePrice(product.price) || 0;
            let unitDiscount = 0;
            let discountNotes = [];

            // Do NOT apply any discount for scheme/free products
            const isDiscountAllowed = !isProductScheme;

            // Manual Discount or Dealer Discount
            if (
                isDiscountAllowed &&
                detail.discount_price &&
                Number(detail.discount_price) > 0
            ) {
                unitDiscount = Number(detail.discount_price);
                discountNotes.push(`Manual Discount Applied: ${unitDiscount}`);
            } else if (
                isDiscountAllowed &&
                detail.dealer_discount_id
            ) {
                const dealerDiscount = await DealerDiscount.findOne({
                    dealer_discount_id: sanitizeInput(detail.dealer_discount_id),
                    dealer_id: dealer.employee_id,
                    brand_name: product.brand,
                    model_name: product.model,
                    status: "active"
                }).lean();

                if (dealerDiscount) {
                    const eligibleProducts =
                        Array.isArray(dealerDiscount.product_ids) ?
                            dealerDiscount.product_ids : [];

                    const isEligible = eligibleProducts.includes(product.product_id);

                    if (isEligible) {
                        if (dealerDiscount.is_percentage) {
                            unitDiscount =
                                (unitPrice * dealerDiscount.discount_value) / 100;

                            discountNotes.push(
                                `Dealer Discount (${dealerDiscount.discount_value}%) → ${unitDiscount.toFixed(2)}`
                            );
                        } else {
                            unitDiscount = dealerDiscount.discount_value;

                            discountNotes.push(
                                `Dealer Discount (Fixed) → ${unitDiscount.toFixed(2)}`
                            );
                        }
                    }
                }
            }

            if (!Number.isFinite(unitDiscount) || unitDiscount < 0) { unitDiscount = 0; }
            if (unitDiscount > unitPrice) { unitDiscount = unitPrice; }

            // Pricing Calculations
            const totalProductPrice = unitPrice * qtyOrdered;
            const totalDiscount = unitDiscount * qtyOrdered;
            const totalPrice = totalProductPrice - totalDiscount;

            // Order Level Totals
            if (!isProductScheme) {
                totalOrderAmount += totalPrice;
                totalOrderDiscount += totalDiscount;
            }

            const notes = [
                productionRequired > 0 && `Production Required: ${productionRequired}`,
                unpackedUsed > 0 && `Unpacked Used: ${unpackedUsed}`,
                isBattery && `Battery Product: Direct PACKED allocation`,
                ...discountNotes
            ].filter(Boolean).join(" | ");

            const detailStatus =
                employeeRole === ROLES.SALESMAN
                    ? ORDER_STATUSES.PENDING
                    : isBattery
                        ? ORDER_STATUSES.PACKED
                        : productionRequired > 0 || unpackedUsed > 0
                            ? ORDER_STATUSES.PRODUCTION
                            : ORDER_STATUSES.PACKED;

            orderDetailsPayload.push({
                order_details_number: await generateUniqueOrderDetailsId(),
                order_number: orderNumber,

                product_id: product.product_id,
                product_brand: product.brand,
                product_name: product.product_name,
                product_model: product.model,
                product_type: product.product_type,
                product_category: product.product_category,

                qty_ordered: qtyOrdered,
                delivery_date: new Date(detail.delivery_date),

                notes,

                stock_usage: stockUsage,
                stock_flags: stockFlags,
                status: detailStatus,

                unit_product_price: round(unitPrice),
                total_product_price: round(totalProductPrice),

                dealer_discount: round(unitDiscount),
                total_dealer_discount: round(totalDiscount),

                total_price: round(totalPrice),

                is_free: isProductScheme
            });
        }

        order.status =
            employeeRole === ROLES.SALESMAN ?
                ORDER_STATUSES.PENDING :
                hasPendingProduction ?
                    ORDER_STATUSES.PRODUCTION :
                    ORDER_STATUSES.PACKED;

        order.sales_target_updated = false;
        order.order_total_price = round(totalOrderAmount);
        order.order_total_discount = round(totalOrderDiscount);

        if (dto.delivery_date != null) {
            const parsedDate = new Date(dto.delivery_date);
            if (Number.isNaN(parsedDate.getTime()))
                throw new BadRequestException("Invalid delivery_date format");
            order.promised_delivery_date = parsedDate;
        } else if (orderDetailsPayload.length > 0) {
            order.promised_delivery_date = orderDetailsPayload
                .map((d) => new Date(d.delivery_date))
                .filter((d) => !Number.isNaN(d.getTime()))
                .reduce((latest, current) => (current > latest ? current : latest));
        }

        if (Number(dto.amount_paid) > 0) {
            await order.addPayment(
                Number(dto.amount_paid),
                sanitizeInput(dto.payment_method || "CASH")
            );
        }

        await order.save();
        const orderDetailsList = await OrderDetails.insertMany(orderDetailsPayload);

        logger.info(`✅ Order created — #${orderNumber} | Items: ${orderDetailsList.length}`);

        const salesman = await Employee.findOne({
            employee_id: order.salesman_id || employeeId,
            status: "active",
        }).lean();

        notificationService.sendOrderCreatedAsync({
            order,
            dealer,
            salesman,
            triggeredBy: employeeId,
        });

        return transformOrderToResponse(order, dealer, orderDetailsList);
    }),

    getByOrderId: asyncHandler(async (orderNumber) => {
        if (!orderNumber) {
            throw new BadRequestException("Order number is required.");
        }

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        const [dealer, orderDetails] = await Promise.all([
            Employee.findOne({
                employee_id: order.dealer_id,
                role: ROLES.DEALER
            }),
            OrderDetails.find({ order_number: orderNumber })
        ]);

        return transformOrderToResponse(order, dealer, orderDetails);
    }),

    getAllOrders: asyncHandler(async ({
        page = 1,
        limit = 10,
        status,
        priority,
        search,
        dealer,
        startDate,
        endDate,
        deliveryStartDate,
        deliveryEndDate,
    }) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const numericPage = Math.max(1, Number(page));
        const numericLimit = Math.max(1, Number(limit));
        const skip = (numericPage - 1) * numericLimit;

        const filter = {};

        switch (employeeRole) {
            case ROLES.SALESMAN:
                filter.salesman_id = employeeId;
                break;
            default:
                break;
        }

        if (status && Object.values(ORDER_STATUSES).includes(status))
            filter.status = status;

        if (priority) filter.priority = priority;
        if (dealer) filter.dealer_id = dealer;

        if (search && search.trim() !== "") {
            const searchRegex = new RegExp(search.trim(), "i");

            const matchedDealers = await Employee.find({
                $or: [
                    { employee_name: searchRegex },
                    { shop_name: searchRegex },
                ],
            })
                .select("employee_id")
                .lean();

            const dealerIds = matchedDealers.map((d) => d.employee_id);

            filter.$or = [
                { order_number: searchRegex },
                { dealer_id: searchRegex },
                ...(dealerIds.length ? [{ dealer_id: { $in: dealerIds } }] : []),
            ];
        }

        // created date filter
        const createdRange = buildDateRange(startDate, endDate);
        if (createdRange) {
            filter.created_at = createdRange;
        }

        // delivery date filter
        const deliveryRange = buildDateRange(deliveryStartDate, deliveryEndDate);
        if (deliveryRange) {
            filter.promised_delivery_date = deliveryRange;

            const matchingDetails = await OrderDetails.find({
                delivery_date: deliveryRange,
            })
                .select("order_number")
                .lean();

            if (matchingDetails.length) {
                const orderNumbersFromDetails = [
                    ...new Set(matchingDetails.map(d => d.order_number)),
                ];

                if (filter.order_number) {
                    filter.order_number = {
                        $in: [
                            ...new Set([
                                ...(filter.order_number.$in || []),
                                ...orderNumbersFromDetails,
                            ]),
                        ],
                    };
                } else {
                    filter.order_number = { $in: orderNumbersFromDetails };
                }
            }
        }

        logger.info("📦 Order Filter:", filter);

        const [orders, total] = await Promise.all([
            Order.find(filter)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(numericLimit)
                .lean(),

            Order.countDocuments(filter)
        ]);

        if (!orders.length)
            return { orders: [], total: 0, page: numericPage, limit: numericLimit };

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        const transformedOrders = orders.map(order =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number] || []
            )
        );

        transformedOrders.sort((a, b) => {
            const isTerminal = (s) =>
                s === ORDER_STATUSES.REJECTED || s === ORDER_STATUSES.CANCELLED;
            if (isTerminal(a.status) && !isTerminal(b.status)) return 1;
            if (!isTerminal(a.status) && isTerminal(b.status)) return -1;
            return 0;
        });

        return {
            orders: transformedOrders,
            total,
            page: numericPage,
            limit: numericLimit
        };
    }),

    getByOrderStatus: asyncHandler(async (orderStatus) => {
        if (!orderStatus || !Object.values(ORDER_STATUSES).includes(orderStatus)) {
            throw new BadRequestException(`Invalid order status: ${orderStatus}`);
        }

        const orders = await Order.findByOrderStatus(orderStatus);

        if (!orders.length) {
            return [];
        }

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map(order =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number] || []
            )
        );
    }),

    getOrdersByDateFilter: asyncHandler(async (query) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const { year, month, start_date, end_date } = query;

        let startDate;
        let endDate;

        if (year && month) {
            const base = `${year}-${String(month).padStart(2, "0")}-01`;
            startDate = dayjs(base).startOf("month").toDate();
            endDate = dayjs(base).endOf("month").toDate();
        } else if (start_date && end_date) {
            if (!dayjs(start_date).isValid() || !dayjs(end_date).isValid())
                throw new BadRequestException(
                    "Invalid start_date or end_date. Expected format: YYYY-MM-DD"
                );
            startDate = dayjs(start_date).startOf("day").toDate();
            endDate = dayjs(end_date).endOf("day").toDate();
        } else {
            const nowIST = dayjs().tz("Asia/Kolkata");
            startDate = nowIST.startOf("month").toDate();
            endDate = nowIST.endOf("month").toDate();
        }

        const filter = { created_at: { $gte: startDate, $lte: endDate } };

        if (!ADMIN_PRIVILEGED_ROLES.includes(employeeRole))
            filter.created_by = employeeId;

        const orders = await Order.find(filter).sort({ created_at: -1 });

        if (!orders.length) return [];

        const { dealerMap, detailsMap } = await fetchDealerAndOrderDetails(orders);

        return orders.map((order) =>
            transformOrderToResponse(
                order,
                dealerMap[order.dealer_id],
                detailsMap[order.order_number] || []
            )
        );
    }),

    updateOrderDetailStatus: asyncHandler(async (orderDetailsId, updateDto) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const nowIST = () => getISTDate();
        const toNumber = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

        logger.info("[OrderDetail][DTO][Incoming]", {
            dtoKeys: Object.keys(updateDto),
            dtoValues: updateDto,
        });

        const orderDetail = await OrderDetails.findOne({ order_details_number: orderDetailsId });
        if (!orderDetail) {
            throw new BadRequestException(`No order detail found for ID: ${orderDetailsId}`);
        }

        const [order, product] = await Promise.all([
            Order.findByOrderNumber(orderDetail.order_number),
            Product.findOne({ product_id: orderDetail.product_id })
        ]);

        if (!order)
            throw new BadRequestException(`No order found for: ${orderDetail.order_number}`);

        if (!product)
            throw new BadRequestException(`No product found for ID: ${orderDetail.product_id}`);

        if (orderDetail.status === ORDER_STATUSES.CANCELLED)
            throw new BadRequestException(
                `Order Detail ${orderDetail.order_details_number} is already CANCELLED`
            );

        if (order.status === ORDER_STATUSES.CANCELLED)
            throw new BadRequestException(
                `Parent Order ${order.order_number} is CANCELLED`
            );

        let {
            PACKED: packedQty = 0,
            UNPACKED: unpackedQty = 0,
            PRODUCTION: productionQty = 0
        } = orderDetail.stock_flags || {};

        let returns = [];

        const appendNote = (note) => {
            orderDetail.notes = [orderDetail.notes, note]
                .filter(Boolean)
                .join(" | ");
        };

        /*🔹 Helper Functions */
        const assertAdminAccess = (role) => {
            const normalized = (role || "").toUpperCase();
            if (!ADMIN_PRIVILEGED_ROLES.includes(normalized)) {
                throw new ForbiddenException(
                    `Access denied. Role (${normalized}) is not allowed.`
                );
            }
        };

        // Stock consumption helper
        const consumeStockForCancellation = ({
            qty,
            packedQty = 0,
            unpackedQty = 0,
            productionQty = 0
        }) => {
            let remaining = qty;

            const consume = (available, shouldReturn = false) => {
                if (remaining <= 0 || available <= 0) {
                    return { used: 0, left: available };
                }

                const used = Math.min(available, remaining);
                remaining -= used;

                return {
                    used,
                    left: available - used,
                    returned: shouldReturn ? used : 0
                };
            };

            // Priority: PRODUCTION → UNPACKED → PACKED
            const production = consume(productionQty, false);
            const unpacked = consume(unpackedQty, true);
            const packed = consume(packedQty, true);

            return {
                updatedStock: {
                    PACKED: packed.left,
                    UNPACKED: unpacked.left,
                    PRODUCTION: production.left
                },
                returns: [
                    {
                        qty: unpacked.returned || 0,
                        type: STOCK_TYPES.STOCK_UNPACKED
                    },
                    {
                        qty: packed.returned || 0,
                        type: STOCK_TYPES.STOCK_PACKED
                    }
                ].filter(r => r.qty > 0)
            };
        };

        const recalculatePricing = (detail) => {
            const {
                qty_ordered = 0,
                qty_delivered = 0,
                total_cancelled_qty = 0,
                unit_product_price = 0,
                dealer_discount = 0
            } = detail;

            const balanceQty = Math.max(
                0,
                qty_ordered - qty_delivered - total_cancelled_qty
            );

            const unitPrice = Number(unit_product_price) || 0;
            const unitDiscount = Number(dealer_discount) || 0;

            const totalProductPrice = unitPrice * balanceQty;
            const totalDiscount = unitDiscount * balanceQty;
            const totalPrice = totalProductPrice - totalDiscount;

            detail.total_product_price = round(totalProductPrice);
            detail.total_dealer_discount = round(totalDiscount);
            detail.total_price = round(totalPrice);
        };

        const resolveManualStatus = ({
            normalized,
            packedQty,
            unpackedQty,
            productionQty
        }) => {
            if (normalized === ORDER_STATUSES.CONFIRMED) {
                if (productionQty > 0 || unpackedQty > 0)
                    return ORDER_STATUSES.PRODUCTION;

                if (packedQty > 0)
                    return ORDER_STATUSES.PACKED;

                return ORDER_STATUSES.CONFIRMED;
            }

            return normalized;
        };

        // 4️⃣ Production → Unpacked → Packed Transitions
        if (updateDto.has_production_completed && productionQty > 0) {
            unpackedQty += productionQty;
            productionQty = 0;
        }

        if (updateDto.has_unPacked_completed && unpackedQty > 0) {
            packedQty += unpackedQty;
            unpackedQty = 0;
        }

        // Normalize Status(Pre - processing)
        let normalizedStatus = null;

        if (updateDto.status) {
            normalizedStatus = normalizeStatus(updateDto.status);

            if (normalizedStatus === ORDER_STATUSES.CANCELLED) {
                updateDto.cancel_qty = orderDetail.qty_ordered - orderDetail.qty_delivered - orderDetail.total_cancelled_qty;
            }
        }

        // 5️⃣ Cancellation Flow
        if (updateDto.cancel_qty !== undefined) {
            let cancelQty = toNumber(updateDto.cancel_qty);

            if (cancelQty <= 0) {
                throw new BadRequestException("Cancel quantity must be greater than 0.");
            }

            const remainingCancelableQty = orderDetail.qty_ordered - orderDetail.qty_delivered - orderDetail.total_cancelled_qty;

            if (cancelQty > remainingCancelableQty) {
                cancelQty = remainingCancelableQty;
            }

            assertAdminAccess(employeeRole);

            // 🔥 FIXED: No variable shadowing
            const stockResult = consumeStockForCancellation({
                qty: cancelQty,
                packedQty,
                unpackedQty,
                productionQty
            });

            const {
                updatedStock: {
                    PACKED: updatedPackedQty,
                    UNPACKED: updatedUnpackedQty,
                    PRODUCTION: updatedProductionQty
                },
                returns: calculatedReturns = []
            } = stockResult;

            // Apply updated values
            packedQty = updatedPackedQty;
            unpackedQty = updatedUnpackedQty;
            productionQty = updatedProductionQty;
            returns = calculatedReturns;

            orderDetail.total_cancelled_qty += cancelQty;

            recalculatePricing(orderDetail);

            orderDetail.cancellation_history.push({
                cancelled_qty: cancelQty,
                cancelled_by: employeeId,
                cancelled_by_role: employeeRole,
                cancelled_at: nowIST(),
                reason: updateDto.reason_for_cancellation || "Not provided"
            });

            appendNote(`Cancelled ${cancelQty} unit(s)`);
        }

        // 6️⃣ Delivery Update (Clean & Unified)
        const isMarkAsDelivered = updateDto.status === ORDER_STATUSES.DELIVERED;
        const hasDeliveredQty = updateDto.delivered_qty !== undefined;
        const hasDeliveredDate = updateDto.delivered_date !== undefined;

        if (isMarkAsDelivered || hasDeliveredQty || hasDeliveredDate) {

            const remainingDeliverableQty = orderDetail.qty_ordered - orderDetail.qty_delivered - orderDetail.total_cancelled_qty;

            let deliveredQty = 0;
            let deliveredAt = null;

            if (isMarkAsDelivered) {
                deliveredQty = remainingDeliverableQty;
            } else if (hasDeliveredQty) {

                deliveredQty = toNumber(updateDto.delivered_qty);

                if (deliveredQty <= 0) {
                    throw new BadRequestException("Invalid delivered quantity.");
                }

                if (deliveredQty > remainingDeliverableQty) {
                    throw new BadRequestException("Delivered quantity exceeds remaining quantity.");
                }
            }

            if (hasDeliveredDate) {
                deliveredAt = updateDto.delivered_date ?
                    new Date(updateDto.delivered_date) :
                    nowIST();

                if (updateDto.delivery_note?.trim()) {
                    const note = updateDto.delivery_note.trim();
                    const previousDeliveryDate = orderDetail.delivery_date;

                    const employee = await Employee.findOne({
                        employee_id: employeeId,
                        role: employeeRole
                    });

                    const formattedNote =
                        employee
                            ? `Employee: ${employee?.employee_name || "N/A"} | Role: ${employee?.role || "N/A"} | Note: ${note || "—"} | Date: ${previousDeliveryDate || "—"} → ${deliveredAt || "—"}`
                            : note;

                    orderDetail.delivery_notes.push(formattedNote);
                }

            }

            if (deliveredQty > 0) {
                orderDetail.qty_delivered += deliveredQty;
                if (!deliveredAt) deliveredAt = nowIST();
                appendNote(`Delivered ${deliveredQty} unit(s) on ${deliveredAt.toISOString()}`);
            }

            if (deliveredAt) {
                orderDetail.delivery_date = deliveredAt;
            }
        }

        logger.info("[OrderDetail][Returns]", returns);

        if (returns.length > 0) {
            await persistStockReturns({
                product,
                returns,
                employeeId,
                role: employeeRole,
                orderNumber: order.order_number,
                orderDetailsNumber: orderDetail.order_details_number
            });
        }

        orderDetail.stock_flags = {
            PACKED: packedQty,
            UNPACKED: unpackedQty,
            PRODUCTION: productionQty,
            hasUnpacked: unpackedQty > 0,
            hasProduction: productionQty > 0
        };

        const previousStatus = orderDetail.status;

        if (normalizedStatus) {
            if (!isValidStatus(normalizedStatus)) {
                throw new BadRequestException(
                    `Invalid order detail status: ${normalizedStatus}`
                );
            }

            const resolvedStatus = resolveManualStatus({
                normalized: normalizedStatus,
                packedQty,
                unpackedQty,
                productionQty
            });

            orderDetail.status = resolvedStatus;

            if (normalizedStatus === ORDER_STATUSES.INVOICE) {
                await invoiceService.generateOrUpdateInvoiceByOrderDetail(
                    orderDetail,
                    toNumber(updateDto.invoice_qty)
                );
            }
        } else if (previousStatus !== ORDER_STATUSES.PENDING) {
            orderDetail.status = resolveOrderDetailStatus({
                qtyOrdered: orderDetail.qty_ordered,
                qtyCancelled: orderDetail.total_cancelled_qty,
                qtyDelivered: orderDetail.qty_delivered,
                packedQty,
                hasProduction: productionQty > 0,
                hasUnpacked: unpackedQty > 0,
                currentStatus: previousStatus
            });
        }

        await orderDetail.save();

        const refreshedDetails = await OrderDetails.find({
            order_number: order.order_number
        });

        order.order_total_price = refreshedDetails
            .filter(d => !d.is_free)
            .reduce((sum, d) => sum + toNumber(d.total_price), 0);

        order.order_total_discount = refreshedDetails
            .filter(d => !d.is_free)
            .reduce((sum, d) => sum + toNumber(d.total_dealer_discount), 0);

        order.status = allDetailsDelivered(refreshedDetails)
            ? ORDER_STATUSES.COMPLETED
            : deriveOrderStatusFromDetails(refreshedDetails);

        await order.save();

        logger.info("[OrderDetail][Status Transition]", {
            orderDetailsNo: orderDetail.order_details_number,
            from: previousStatus,
            to: orderDetail.status,
        });

        return mapOrderDetailEntityToResponse(orderDetail);
    }),

    updateMultipleOrderDetailsStatus: asyncHandler(async (orderNumber, updates) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!updates || typeof updates !== "object") throw new BadRequestException("Invalid request body.");

        const {
            order_number,
            priority,
            order_note,
            status,
            amount_paid,
            payment_method,
            order_details = []
        } = updates;

        if (order_number !== orderNumber) throw new BadRequestException(`Order number mismatch: path(${orderNumber}) ≠ body(${order_number}).`);

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) throw new BadRequestException(`No order found for: ${orderNumber}`);

        const prevOrderStatus = order.status;

        if (priority && priority !== order.priority) order.priority = priority;

        if (order_note && order_note.trim()) {
            order.order_note = [order.order_note, order_note.trim()]
                .filter(Boolean)
                .join(" | ");
        }

        if (Array.isArray(order_details) && order_details.length) {
            await orderService.updateOrderDetailsBatch(order_details);
        }

        let updatedDetails = await OrderDetails.find({ order_number: orderNumber });

        if (status) {
            await orderService.applyOrderStatusChange({
                order,
                updatedDetails,
                status,
                employeeId,
                employeeRole,
                orderNumber
            });

            if (!order_details.length) {
                const next = normalizeStatus(status);
                for (const detail of updatedDetails) {
                    await orderService.updateOrderDetailStatus(
                        detail.order_details_number,
                        { status: next }
                    );
                }

                updatedDetails = await OrderDetails.find({ order_number: orderNumber });
            }

        } else {
            let derived = deriveOrderStatusFromDetails(updatedDetails);

            if (!canMoveOrderToTargetStatus(updatedDetails, derived)) {
                derived = order.status;
            }

            order.status = derived;
        }

        if (allDetailsDelivered(updatedDetails)) {
            order.status = ORDER_STATUSES.COMPLETED;
        }

        // payment update
        if (typeof amount_paid !== "undefined" && ![ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(order.status)) {
            await order.addPayment(Number(amount_paid) || 0, payment_method || "CASH");
        }

        await order.save();

        // Handle order status notifications
        const newOrderStatus = order.status;

        // // Trigger notification when explicitly setting status
        // if (status === ORDER_STATUSES.CONFIRMED) {
        //     fireNotification(
        //         notifyOrderConfirmed({
        //             order,
        //             confirmedBy: employeeId,
        //             createdBy: order.created_by,
        //         })
        //     );
        // }

        // // Trigger notification only if status actually changed
        // if (prevOrderStatus !== newOrderStatus) {
        //     switch (newOrderStatus) {
        //         case ORDER_STATUSES.CONFIRMED:
        //             fireNotification(
        //                 notifyOrderConfirmed({
        //                     order,
        //                     confirmedBy: employeeId,
        //                     createdBy: order.created_by,
        //                 })
        //             );
        //             break;

        //         case ORDER_STATUSES.PRODUCTION:
        //         case ORDER_STATUSES.PACKED:
        //             fireNotification(
        //                 notifyOrderStatusChanged({
        //                     order,
        //                     newStatus: newOrderStatus,
        //                     changedBy: employeeId,
        //                     createdBy: order.created_by,
        //                 })
        //             );
        //             break;

        //         default:
        //             break;
        //     }
        // }

        return transformOrderToResponse(order, null, updatedDetails);
    }),

    updateOrderDetailsBatch: async (orderDetails = []) => {
        if (!orderDetails.length) return;

        const ids = orderDetails.map(d => d.order_details_number);

        const existing = await OrderDetails.find({
            order_details_number: { $in: ids }
        });

        const detailMap = new Map(
            existing.map(d => [d.order_details_number, d])
        );

        for (const dto of orderDetails) {
            if (!detailMap.has(dto.order_details_number)) continue;

            await orderService.updateOrderDetailStatus(
                dto.order_details_number,
                dto
            );
        }
    },

    applyOrderStatusChange: asyncHandler(async ({
        order,
        updatedDetails,
        status,
        employeeId,
        employeeRole,
        orderNumber
    }) => {
        const next = normalizeStatus(status);
        const prev = order.status;

        if (!isValidStatus(next))
            throw new BadRequestException(`Invalid order status: ${next}`);

        if (prev === next) return;

        if (IMMUTABLE_ORDER_STATUSES.includes(prev)) {
            throw new BadRequestException(`Order ${order.order_number} is already '${prev}' and cannot be updated.`);
        }

        if (next === ORDER_STATUSES.REJECTED) {
            assertRejectAllowed(prev);
            order.status = next;
            return;
        }

        if (next === ORDER_STATUSES.CANCELLED) {
            assertCancellable(prev);
            await orderService.cancelOrderAndReturnStock({
                order,
                updatedDetails,
                employeeId,
                employeeRole,
                orderNumber
            });
            return;
        }

        if (next === ORDER_STATUSES.CONFIRMED) {
            const detailStatuses = new Set(updatedDetails.map(d => d.status));

            order.status =
                detailStatuses.has(ORDER_STATUSES.PRODUCTION) ?
                    ORDER_STATUSES.PRODUCTION :
                    detailStatuses.has(ORDER_STATUSES.PACKED) ?
                        ORDER_STATUSES.PACKED :
                        ORDER_STATUSES.CONFIRMED;

            return;
        }

        if (STATUSES_REQUIRING_DETAIL_VALIDATION.includes(next) &&
            !canMoveOrderToTargetStatus(updatedDetails, next)) {

            throw new BadRequestException(`Order cannot move to '${next}' because one or more details are not ready.`);
        }

        assertTransitionAllowed(prev, next);
        order.status = next;
    }),

    cancelOrderAndReturnStock: asyncHandler(async ({
        order,
        updatedDetails,
        employeeId,
        employeeRole,
        orderNumber
    }) => {
        for (const detail of updatedDetails) {
            await returnStockForDetail({ d: detail, employeeId, employeeRole, orderNumber });
            detail.status = ORDER_STATUSES.CANCELLED;
            await detail.save();
        }

        order.order_total_discount = 0;
        order.order_total_price = 0;
        order.status = ORDER_STATUSES.CANCELLED;

        await order.save();
    }),

    updateOrderStatus: asyncHandler(async (orderNumber, newStatus) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!newStatus || typeof newStatus !== "string") throw new BadRequestException("Invalid newStatus provided.");

        const normalized = newStatus.toUpperCase();
        if (!Object.values(ORDER_STATUSES).includes(normalized)) throw new BadRequestException(`Invalid order status: ${normalized}.`);

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) throw new BadRequestException(`No order found for: ${orderNumber}`);

        const prev = order.status;

        if ([ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(prev)) {
            throw new BadRequestException(`Order ${orderNumber} is already '${prev}' and cannot be updated.`);
        }

        if (prev === normalized) {
            throw new BadRequestException(`Order already in status '${prev}'.`);
        }

        if (normalized === ORDER_STATUSES.REJECTED && prev !== ORDER_STATUSES.PENDING) {
            throw new BadRequestException("REJECTED is allowed only from PENDING.");
        }

        if (normalized === ORDER_STATUSES.CANCELLED && !CANCELLABLE_STATUSES.has(prev)) {
            throw new BadRequestException(`Cannot cancel order at '${prev}'. Cancellation allowed only before INVOICE.`);
        }

        if (!isValidTransition(previous, normalized)) {
            throw new BadRequestException(`Invalid status transition: ${previous} → ${normalized}`);
        }

        const details = await OrderDetails.find({ order_number: orderNumber });

        if ([ORDER_STATUSES.INVOICE, ORDER_STATUSES.SHIPPED, ORDER_STATUSES.DELIVERED].includes(normalized)) {
            if (!canMoveOrderToTargetStatus(updatedOrderDetails, normalized)) {
                throw new BadRequestException(`Order cannot move to '${normalized}' because one or more details are not ready for that stage.`);
            }
        }

        if (normalized === ORDER_STATUSES.CONFIRMED) {
            if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(employeeRole)) {
                throw new ForbiddenException(`You are not authorized to set status to '${normalized}'.`);
            }
        }

        if ([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(normalized)) {
            for (const d of details) {
                await returnStockForDetail({ d, employeeId, employeeRole, orderNumber });
                d.status = normalized;
                await d.save();
            }
            order.order_total_price = 0;
            order.order_total_discount = 0;
        }

        order.status = allDetailsDelivered(details) ? ORDER_STATUSES.COMPLETED : normalized;

        await order.save();

        logger.info(`🔄 Order Status Updated — order_number: ${orderNumber} | ${prev} → ${order.status}`);

        // // Notifications 
        // if (prev !== order.status) {
        //     if (order.status === ORDER_STATUSES.CONFIRMED) {
        //         fireNotification(
        //             notifyOrderConfirmed({
        //                 order,
        //                 confirmedBy: employeeId,
        //                 createdBy: order.created_by,
        //             })
        //         );
        //     } else if (
        //         order.status === ORDER_STATUSES.PRODUCTION ||
        //         order.status === ORDER_STATUSES.PACKED
        //     ) {
        //         fireNotification(
        //             notifyOrderStatusChanged({
        //                 order,
        //                 newStatus: order.status,
        //                 changedBy: employeeId,
        //                 createdBy: order.created_by,
        //             })
        //         );
        //     }
        // }

        const dealer = await Employee.findOne({ employee_id: order.dealer_id, role: ROLES.DEALER });
        const refreshedDetails = await OrderDetails.find({ order_number: orderNumber });

        return transformOrderToResponse(order, dealer, refreshedDetails);
    }),

    updateOrderAndDetails: asyncHandler(async (orderNumber, payload) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        if (!payload || typeof payload !== "object") {
            throw new BadRequestException("Invalid request body");
        }

        console.info("[updateOrderAndDetails][DTO][Incoming]", {
            orderNumber,
            requestedBy: {
                employeeRole
            },
            dtoKeys: Object.keys(payload),
            dtoValues: payload
        });

        const {
            order_number,
            priority,
            order_note,
            status,
            delivery_date,
            delivery_note,
            amount_paid,
            payment_method,
            order_details = []
        } = payload;

        if (order_number && order_number !== orderNumber) {
            throw new BadRequestException(`Order number mismatch: path(${orderNumber}) ≠ body(${order_number})`);
        }

        const order = await Order.findByOrderNumber(orderNumber);
        if (!order) {
            throw new BadRequestException(`No order found for: ${orderNumber}`);
        }

        // 🚫 Prevent update if order already CANCELLED
        if (order.status === ORDER_STATUSES.CANCELLED) {
            throw new BadRequestException(
                `Order ${order.order_number} is already CANCELLED and cannot be modified.`
            );
        }

        const prevOrderStatus = order.status;

        // Fetch employee (optional)
        let employee = null;
        if (employeeId && employeeRole) {
            employee = await Employee.findOne({
                employee_id: employeeId,
                role: employeeRole
            });
        }

        // Update priority
        if (priority && priority !== order.priority) {
            order.priority = priority;
        }

        // Append order note
        if (order_note && order_note.trim()) {
            order.order_note = [order.order_note, order_note.trim()]
                .filter(Boolean)
                .join(" | ");
        }

        // Update order details (batch)
        if (order_details.length) {
            await orderService.updateOrderDetailsBatch(order_details);
        }

        // Fetch updated details
        let updatedDetails = await OrderDetails.find({ order_number: orderNumber });

        // status handling
        if (status) {
            const normalizedStatus = normalizeStatus(status);

            // Cascade status to all order details (sequential to avoid races on parent Order.save())
            for (const detail of updatedDetails) {
                await orderService.updateOrderDetailStatus(
                    detail.order_details_number, { status: normalizedStatus }
                );
            }

            // Re-fetch after cascading update
            updatedDetails = await OrderDetails.find({ order_number: orderNumber });

            await orderService.applyOrderStatusChange({
                order,
                updatedDetails,
                status: normalizedStatus,
                employeeId,
                employeeRole,
                orderNumber
            });
        } else {
            // Auto-derive order status from details
            let derivedStatus = deriveOrderStatusFromDetails(updatedDetails);

            if (!canMoveOrderToTargetStatus(updatedDetails, derivedStatus)) {
                derivedStatus = order.status;
            }

            order.status = derivedStatus;
        }

        if (allDetailsDelivered(updatedDetails)) {
            order.status = ORDER_STATUSES.COMPLETED;
        }

        if (
            typeof amount_paid !== "undefined" &&
            ![ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED].includes(order.status)
        ) {
            await order.addPayment(
                Number(amount_paid) || 0,
                payment_method || "CASH"
            );
        }

        // DELIVERY DATE LOGIC
        let finalDeliveryDate;
        let finalDeliveryNote;

        if (delivery_date != null) {
            const parsedDate = new Date(delivery_date);

            if (Number.isNaN(parsedDate.getTime())) {
                throw new BadRequestException("Invalid delivery_date format.");
            }

            finalDeliveryDate = parsedDate;

            if (delivery_note && delivery_note?.trim()) {
                finalDeliveryNote = delivery_note.trim();
                const previousDeliveryDate = order.promised_delivery_date;

                if (employee) {
                    finalDeliveryNote = `Employee: ${employee?.employee_name || "N/A"} | Role: ${employee?.role || "N/A"} | Note: ${finalDeliveryNote || "—"} | Date: ${previousDeliveryDate || "—"} → ${finalDeliveryDate || "—"}`;
                }
            }
        } else {
            if (!updatedDetails || updatedDetails.length === 0) {
                throw new BadRequestException("No order details found to calculate delivery date.");
            }

            // Get the maximum (latest) delivery_date
            const deliveryDates = updatedDetails
                .map(detail => detail.delivery_date)
                .filter(date => date instanceof Date && !Number.isNaN(date.getTime()));

            if (deliveryDates.length === 0) {
                throw new BadRequestException("No valid delivery dates found in order details.");
            }

            finalDeliveryDate = new Date(
                Math.max(...deliveryDates.map(date => date.getTime()))
            );
        }

        // Apply delivery updates
        order.promised_delivery_date = finalDeliveryDate;

        if (finalDeliveryNote) {
            order.delivery_note = [order.delivery_note, finalDeliveryNote]
                .filter(Boolean)
                .join(" | ");
        }

        await order.save();

        // Check if any order detail has production completed
        const hasProductionCompleted = order_details?.some(
            (detail) => detail?.has_production_completed === true
        );

        const isOrderConfirmed = prevOrderStatus !== ORDER_STATUSES.CONFIRMED && status === ORDER_STATUSES.CONFIRMED;

        if (prevOrderStatus !== order.status || hasProductionCompleted || isOrderConfirmed) {
            const dealer = await Employee.findOne({
                employee_id: order.dealer_id,
                role: ROLES.DEALER,
            }).lean();

            if (isOrderConfirmed) {
                notificationService.sendOrderConfirmedAsync({
                    order,
                    previousStatus: prevOrderStatus,
                    triggeredBy: employeeId,
                    triggeredByName: employee?.employee_name,
                    dealer,
                });
            }

            if (prevOrderStatus !== order.status) {
                notificationService.sendOrderStatusChangedAsync({
                    order,
                    previousStatus: prevOrderStatus,
                    triggeredBy: employeeId,
                    triggeredByName: employee?.employee_name,
                    dealer,
                });
            }

            if (hasProductionCompleted) {
                notificationService.sendProductionCompletedAsync({
                    order,
                    triggeredBy: employeeId,
                    triggeredByName: employee?.employee_name,
                    dealer,
                });
            }
        }

        return transformOrderToResponse(order, null, updatedDetails);
    }),

};

export { orderService };
