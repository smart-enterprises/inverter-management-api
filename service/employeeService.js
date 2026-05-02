// employeeService.js

import asyncHandler from "express-async-handler";
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import jwt from 'jsonwebtoken';

import employeeSchema from '../models/employees.js';
import { generateUniqueDealerDiscountId, generateUniqueEmployeeId } from '../utils/generatorIds.js';
import logger from '../utils/logger.js';
import { CurrentRequestContext } from "../utils/CurrentRequestContext.js";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException
} from '../middleware/CustomError.js';

import { getAuthenticatedEmployeeContext, validateDealerDiscountRequiredFields, validateEmployeeData } from '../utils/validationUtils.js';
import { mapEmployeeRequestToEntity, mapEmployeeEntityToResponse, mapDealerDiscountEntityToResponse } from '../utils/modelMapper.js';
import { hashPassword, generateToken, revealPassword, validatePassword } from '../utils/employeeAuth.js';
import {
    APPROVAL_GRANTED_ROLES,
    JWT_EXPIRES_IN,
    SUPER_ADMIN,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    ROLES,
    getISTDate
} from '../utils/constants.js';
import { tokenBlacklistService } from "./tokenBlacklistService.js";
import Brand from "../models/brand.js";
import DealerDiscount from "../models/dealerDiscount.js";
import Product from "../models/product.js";
import { fetchProductWithStocks } from "./productService.js";

const checkExistingEmployee = async (email, phone, excludeId = null) => {
    const query = excludeId ? { _id: { $ne: excludeId } } : {};

    const [existingEmail, existingPhone] = await Promise.all([
        employeeSchema.findOne({ ...query, employee_email: email }),
        employeeSchema.findOne({ ...query, employee_phone: phone })
    ]);

    const errors = [];
    if (existingEmail) errors.push("📧 Email already exists.");
    if (existingPhone) errors.push("📱 Phone number already exists.");

    if (errors.length > 0) {
        throw new ConflictException(errors.join(" "));
    }
};

const findActiveEmployee = async (employeeId, includePassword = false) => {
    const query = employeeSchema.findOne({ employee_id: employeeId, status: 'active' });
    if (includePassword) query.select('+password');

    const employee = await query;
    if (!employee) {
        logger.warn(`No active employee for ID: ${employeeId}`);
        throw new BadRequestException('');
    }

    return employee;
};

async function verifyCurrentPassword(employee, currentPassword) {
    try {
        const decryptedPassword = await revealPassword(employee.password);
        if (currentPassword !== decryptedPassword) {
            logger.warn(`Invalid current password for: ${employee.employee_email}`);
            throw new UnauthorizedException('Invalid credentials');
        }
    } catch (error) {
        logger.error(`Password decryption failed for ID: ${employee.employee_email}`, error);
        throw new BadRequestException('Password decryption error');
    }
}

async function updateEmployeePassword(employee, newPassword, updatedBy, role, reason) {
    const hashedPassword = await hashPassword(newPassword);
    employee.password = hashedPassword;

    const timeStamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    employee.log_note = `${employee.log_note || ''} | Password reset by: ${updatedBy}, Role: ${role}, Reason: ${reason}, Date: ${timeStamp}`;

    await employee.save();
}

async function checkIfDiscountExists(
    brandName,
    modelName,
    dealerId,
    productIds = [],
    excludeDiscountId = null
) {
    const normalizedIncoming = [...new Set(productIds.map(String))]
        .sort()
        .join(",");

    const query = {
        dealer_id: dealerId,
        brand_name: brandName,
        model_name: modelName
    };

    if (excludeDiscountId) {
        query.dealer_discount_id = { $ne: excludeDiscountId };
    }

    const existingDiscounts = await DealerDiscount
        .find(query)
        .select("product_ids")
        .lean();

    for (const discount of existingDiscounts) {
        const existingProducts = Array.isArray(discount.product_ids) ? [...new Set(discount.product_ids.map(String))]
            .sort()
            .join(",") :
            "";

        if (existingProducts === normalizedIncoming) {
            throw new BadRequestException(
                `A discount already exists for brand ${brandName}, model ${modelName} with the same product combination.`
            );
        }
    }
};

export const transformEmployeeRecords = async (employees, includePassword) => {
    if (!includePassword) {
        return employees.map(mapEmployeeEntityToResponse);
    }

    return Promise.all(
        employees.map(async (emp) => {
            if (!emp.password) {
                return mapEmployeeEntityToResponse(emp, null);
            }

            const decrypted = await revealPassword(emp.password);

            return mapEmployeeEntityToResponse(emp, decrypted);
        })
    );
};

const employeeService = {
    defaultSuperAdminSetup: asyncHandler(async () => {
        if (!SUPER_ADMIN || !SUPER_ADMIN_PHONE || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
            throw new BadRequestException("Missing required SUPER_ADMIN environment variables.");
        }

        const existingAdmin = await employeeSchema.findOne({ employee_email: SUPER_ADMIN_EMAIL });
        if (existingAdmin) {
            if (!existingAdmin.employee_id || existingAdmin.employee_id.trim() === '') {
                const employeeId = await generateUniqueEmployeeId();
                existingAdmin.employee_id = employeeId;

                await existingAdmin.save();
                logger.info("✅ Super Admin ID was missing and has been updated.");
            } else {
                logger.info("⚠️ Super Admin already exists");
            }
            return;
        }

        const employeeId = await generateUniqueEmployeeId();

        const hashedPassword = await hashPassword(SUPER_ADMIN_PASSWORD);

        const superAdmin = new employeeSchema({
            employee_id: employeeId,
            employee_name: SUPER_ADMIN,
            employee_email: SUPER_ADMIN_EMAIL,
            employee_phone: SUPER_ADMIN_PHONE,
            password: hashedPassword,
            role: ROLES.SUPER_ADMIN,
            status: 'active',
            created_by: 'APPLICATION',
        });

        await superAdmin.save();

        logger.info("✅ Default Super Admin created successfully.");
    }),

    createEmployee: asyncHandler(async (employeeRequest, createdByEmployeeId) => {
        if (!createdByEmployeeId) {
            throw new ForbiddenException('You are not authorized to create an employee.');
        }

        validateEmployeeData(employeeRequest);
        await checkExistingEmployee(employeeRequest.employee_email, employeeRequest.employee_phone);

        const employeeId = await generateUniqueEmployeeId();
        logger.info(`Generated Employee ID: ${employeeId}`);

        const hashedPassword = await hashPassword(employeeRequest.password);

        const employeeData = mapEmployeeRequestToEntity(employeeRequest, employeeId);
        employeeData.password = hashedPassword;

        if (typeof employeeData.role === 'string' &&
            employeeData.role.toLowerCase() === ROLES.DEALER.toLowerCase() &&
            Array.isArray(employeeData.brand) &&
            employeeData.brand.length > 0
        ) {
            const brands = employeeData.brand.map(b => b.toUpperCase());

            const filter = {
                $or: [
                    { brand_name: { $in: brands } },
                    { brand_id: { $in: brands } }
                ],
                status: 'active'
            };
            const productBrands = await Brand.find(filter).sort({ created_at: -1 });

            const foundBrands = productBrands.map(b => b.brand_name.toUpperCase());
            const missingBrands = brands.filter(b => !foundBrands.includes(b));

            if (missingBrands.length > 0) {
                logger.info(`Invalid brand(s) for dealer: ${missingBrands.join(', ')}`);
            }
            employeeData.brand = productBrands.map(b => b.brand_name);
        }

        logger.info(`Created Employee ID: ${createdByEmployeeId}`);
        employeeData.created_by = createdByEmployeeId;

        const newEmployee = new employeeSchema(employeeData);
        await newEmployee.save();

        logger.info(`Employee created: ${employeeId}`);
        return mapEmployeeEntityToResponse(newEmployee);
    }),

    loginEmployee: asyncHandler(async (loginRequest) => {
        const { employee_email, password } = loginRequest;

        if (!employee_email || !password) {
            throw new BadRequestException('Email and password are required');
        }

        if (!validator.isEmail(employee_email)) {
            throw new BadRequestException('Please provide a valid email address');
        }

        const employee = await employeeSchema.findOne({
            employee_email: employee_email,
            status: 'active'
        }).select('+password');

        if (!employee) {
            logger.warn(`Failed login attempt for email: ${employee_email}`);
            throw new UnauthorizedException('Invalid credentials');
        }

        let decryptedPassword;
        try {
            decryptedPassword = await revealPassword(employee.password);
        } catch (error) {
            logger.error(`Password decryption failed for ID: ${employee.employee_email}`, error);
            throw new BadRequestException("Password decryption error");
        }

        if (password !== decryptedPassword) {
            logger.warn(`Invalid password attempt for: ${employee.employee_email}`);
            throw new UnauthorizedException("Invalid credentials");
        }

        const token = generateToken(employee.employee_id, employee.role, employee.status);
        logger.info(`Employee logged in: ${employee.employee_id}`);

        return {
            employee: mapEmployeeEntityToResponse(employee),
            access_token: token,
            expiresIn: JWT_EXPIRES_IN
        };
    }),

    getEmployeeById: asyncHandler(async (employeeId) => {
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }
        logger.info(`Employee ${employeeId}`);

        const employee = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!employee) {
            throw new NotFoundException('Employee not found');
        }

        return mapEmployeeEntityToResponse(employee);
    }),

    getAllEmployeeByRole: asyncHandler(async (employeeRole) => {
        if (!employeeRole) {
            throw new BadRequestException("Employee role is required");
        }

        logger.info(`Fetching employees with role: ${employeeRole}`);

        const employees = await employeeSchema.find({
            role: employeeRole,
            status: "active",
        });

        if (!employees || employees.length === 0) {
            throw new NotFoundException("No employees found for this role");
        }

        return employees.map(mapEmployeeEntityToResponse);
    }),

    getProfile: asyncHandler(async () => {
        const employeeId = CurrentRequestContext.getEmployeeId();

        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        const employee = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!employee) {
            throw new NotFoundException('Employee not found');
        }

        return mapEmployeeEntityToResponse(employee);
    }),

    updateEmployee: asyncHandler(async (employeeId, updateData) => {
        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        validateEmployeeData(updateData, true);

        const existingEmployee = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!existingEmployee) {
            throw new NotFoundException('Employee not found');
        }

        if (updateData.employee_email || updateData.employee_phone) {
            await checkExistingEmployee(
                updateData.employee_email || existingEmployee.employee_email,
                updateData.employee_phone || existingEmployee.employee_phone,
                existingEmployee._id
            );
        }

        const mappedData = mapEmployeeRequestToEntity(updateData, employeeId, true);

        const isDealer =
            typeof existingEmployee.role === "string" &&
            existingEmployee.role.toLowerCase() === ROLES.DEALER.toLowerCase();

        if (isDealer) {
            const existingBrands = Array.isArray(existingEmployee.brand) ?
                existingEmployee.brand.map((b) => b.toUpperCase()) : [];

            const newBrands =
                Array.isArray(mappedData.brand) && mappedData.brand.length > 0 ?
                    mappedData.brand.map((b) => b.toUpperCase()) : [];

            let updatedBrands = [...existingBrands];
            if (Array.isArray(updateData.remove_brands) && updateData.remove_brands.length > 0) {
                const removeBrands = updateData.remove_brands.map((b) => b.toUpperCase());
                updatedBrands = existingBrands.filter((b) => !removeBrands.includes(b));
            }

            const combinedBrands = [...new Set([...updatedBrands, ...newBrands])];

            const brandFilter = {
                $or: [
                    { brand_name: { $in: combinedBrands } },
                    { brand_id: { $in: combinedBrands } },
                ],
                status: "active",
            };

            const productBrands = await Brand.find(brandFilter).sort({ created_at: -1 });
            const validBrandNames = productBrands.map((b) => b.brand_name.toUpperCase());

            const invalidBrands = combinedBrands.filter(
                (b) => !validBrandNames.includes(b)
            );

            if (invalidBrands.length > 0) {
                logger.warn(`Invalid brand(s) ignored for dealer ${employeeId}: ${invalidBrands.join(", ")}`);
            }

            mappedData.brand = validBrandNames;
        }

        const isSalesman =
            typeof existingEmployee.role === 'string' &&
            existingEmployee.role.toLowerCase() === ROLES.SALESMAN.toLowerCase();

        if (isSalesman) {
            const normalizeDealers = (arr = []) =>
                Array.isArray(arr)
                    ? arr
                        .filter((item) => typeof item === "string" && item.trim())
                        .map((item) => item.trim())
                    : [];

            const existingDealers = normalizeDealers(existingEmployee.dealers);
            const incomingDealers = normalizeDealers(mappedData.dealers);
            const removeDealers = normalizeDealers(updateData.remove_dealers);

            let updatedDealers = [...existingDealers];
            if (removeDealers.length > 0) {
                updatedDealers = existingDealers.filter((d) => !removeDealers.includes(d));
            }

            const mergedDealers = Array.from(
                new Set([...updatedDealers, ...incomingDealers])
            );

            mappedData.dealers = mergedDealers;
        }

        mappedData.updated_at = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

        const updatedEmployee = await employeeSchema.findOneAndUpdate({ employee_id: employeeId },
            mappedData, { new: true, runValidators: true }
        );

        logger.info(`Employee updated: ${employeeId}`);
        return mapEmployeeEntityToResponse(updatedEmployee);
    }),

    resetPassword: asyncHandler(async (updateData) => {
        const employeeId = CurrentRequestContext.getEmployeeId();

        if (!employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        logger.info(`Password reset (self) initiated by Employee ID: ${employeeId}`);

        const employee = await findActiveEmployee(employeeId, true);
        await verifyCurrentPassword(employee, updateData.current_password);
        validatePassword(updateData.password);

        await updateEmployeePassword(employee, updateData.password, employee.employee_name, employee.role, 'update password for own');

        logger.info(`Password reset (self) successful for Employee ID: ${employee.employee_id}`);
        return mapEmployeeEntityToResponse(employee);
    }),

    resetPasswordById: asyncHandler(async (employeeId, updateData) => {
        const requesterId = CurrentRequestContext.getEmployeeId();

        if (!requesterId || !employeeId) {
            throw new BadRequestException('Employee ID is required');
        }

        logger.info(`Password reset (admin) initiated by Employee ID: ${requesterId} for target ID: ${employeeId}`);

        const targetEmployee = await findActiveEmployee(employeeId, true);
        validatePassword(updateData.password);

        const requestingEmployee = await findActiveEmployee(requesterId);
        await updateEmployeePassword(targetEmployee, updateData.password, requestingEmployee.employee_name, requestingEmployee.role, `admin reset password`);

        logger.info(`Password reset (admin) successful for Employee ID: ${targetEmployee.employee_id}`);
        return mapEmployeeEntityToResponse(targetEmployee);
    }),

    deleteEmployee: asyncHandler(async (updateData) => {
        const { employeeId, reason } = updateData;

        if (!employeeId) {
            throw new BadRequestException('Employee ID is required for deletion');
        }

        const requestedById = CurrentRequestContext.getEmployeeId();
        logger.info(`Employee ${employeeId}`);

        logger.info(`Delete request initiated by Employee ID: ${requestedById} for target ID: ${employeeId}`);

        const requestingEmployee = await employeeSchema.findOne({
            employee_id: requestedById,
            status: 'active'
        });

        if (!requestingEmployee) {
            throw new NotFoundException('Requesting employee not found or inactive');
        }

        if (!Object.values(APPROVAL_GRANTED_ROLES).includes(requestingEmployee.role.toUpperCase())) {
            throw new ForbiddenException('Unauthorized: You do not have permission to delete employees');
        }

        const employeeToDelete = await employeeSchema.findOne({
            employee_id: employeeId,
            status: 'active'
        });

        if (!employeeToDelete) {
            throw new NotFoundException('Target employee not found or already deleted');
        }

        const deletionLog = `${employeeToDelete.log_note || ''} | Deletion by: ${requestingEmployee.employee_name}, Role: ${requestingEmployee.role}, Reason: ${reason}, Date: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
        employeeToDelete.status = 'deleted';
        employeeToDelete.log_note = deletionLog;

        await employeeToDelete.save();

        return mapEmployeeEntityToResponse(employeeToDelete);
    }),

    createDealerDiscount: asyncHandler(async (discountData) => {
        const { employeeId } = getAuthenticatedEmployeeContext();

        validateDealerDiscountRequiredFields(discountData);

        const brandName = discountData.brand_name.toUpperCase();
        const modelName = discountData.model_name.toUpperCase();

        // Remove duplicates from product_ids
        const productIds = Array.isArray(discountData.product_ids) ? [...new Set(discountData.product_ids)] : [];

        const [dealer, brandRecord] = await Promise.all([
            employeeSchema.findOne({
                employee_id: discountData.dealer_id,
                role: ROLES.DEALER
            }).lean(),

            Brand.findOne({
                brand_name: brandName
            }).lean()
        ]);

        if (!dealer) {
            throw new BadRequestException(
                `Invalid dealer ID: ${discountData.dealer_id}. Dealer not found or role mismatch.`
            );
        }

        if (!brandRecord) {
            throw new BadRequestException(`Brand ${brandName} not found.`);
        }

        const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());
        const brandStatus = brandRecord.status.toLowerCase();

        if (brandStatus === "discontinued") {
            throw new BadRequestException(
                `Cannot create discount. Brand ${brandName} is discontinued.`
            );
        }

        if (!brandModels.includes(modelName)) {
            throw new BadRequestException(
                `Model ${modelName} is not associated with brand ${brandName}.`
            );
        }

        // Validate Product IDs(Graceful Filtering)
        let products = [];
        let validProductIds = [];

        if (productIds.length > 0) {

            products = await Product.find({
                product_id: { $in: productIds },
                brand: brandName,
                model: modelName
            }).lean();

            validProductIds = products.map(p => p.product_id);
        }

        // Prevent duplicate product combinations
        await checkIfDiscountExists(
            brandName,
            modelName,
            dealer.employee_id,
            validProductIds
        );

        // Discount Value Validation
        let discountValue = null;

        if (discountData.discount_value != null) {
            const parsedValue = Number(discountData.discount_value);

            if (isNaN(parsedValue) || parsedValue < 0) {
                throw new BadRequestException(
                    "Discount value must be a positive number."
                );
            }

            discountValue = Math.round(parsedValue * 100) / 100;
        }

        const isPercentage = Boolean(discountData.is_percentage);

        if (isPercentage && discountValue > 100) {
            throw new BadRequestException(
                "Percentage discount value cannot exceed 100%."
            );
        }

        const description =
            typeof discountData.description === "string" ?
                discountData.description.trim() :
                "";

        // Create Discount
        const dealerDiscountId = await generateUniqueDealerDiscountId();

        const dealerDiscount = await DealerDiscount.create({
            dealer_discount_id: dealerDiscountId,
            brand_name: brandName,
            model_name: modelName,
            dealer_id: dealer.employee_id,
            product_ids: validProductIds,
            discount_value: discountValue,
            is_percentage: isPercentage,
            description,
            created_by: employeeId
        });

        // Response Mapping
        const response = mapDealerDiscountEntityToResponse(dealerDiscount);

        // Build enriched product responses with stocks
        const productResponses = await Promise.all(
            products.map(product => fetchProductWithStocks(product))
        );

        response.products = productResponses;

        return response;
    }),

    updateDealerDiscount: asyncHandler(async (discountData) => {
        const { employeeId } = getAuthenticatedEmployeeContext();

        const {
            dealer_discount_id,
            discount_value,
            brand_name,
            model_name,
            is_percentage,
            description,
            product_ids
        } = discountData;

        if (!dealer_discount_id) {
            throw new BadRequestException("Dealer Discount ID is required.");
        }

        const existingDiscount = await DealerDiscount.findOne({
            dealer_discount_id,
            status: "active"
        }).lean();

        if (!existingDiscount) {
            throw new NotFoundException(
                `Dealer Discount with ID ${dealer_discount_id} not found.`
            );
        }

        // Resolve Brand & Model
        const brandName = brand_name ?
            brand_name.toUpperCase() :
            existingDiscount.brand_name.toUpperCase();

        const modelName = model_name ?
            model_name.toUpperCase() :
            existingDiscount.model_name.toUpperCase();

        const brandRecord = await Brand.findOne({ brand_name: brandName }).lean();

        if (!brandRecord) {
            throw new BadRequestException(`Brand ${brandName} not found.`);
        }

        const brandModels = brandRecord.brand_models.map(m => m.toUpperCase());

        if (!brandModels.includes(modelName)) {
            throw new BadRequestException(
                `Model ${modelName} is not associated with brand ${brandName}.`
            );
        }

        // Validate Product IDs(Graceful filtering)
        let validProductIds = existingDiscount.product_ids || [];
        let products = [];

        if (Array.isArray(product_ids)) {

            const uniqueProductIds = [...new Set(product_ids)];

            products = await Product.find({
                product_id: { $in: uniqueProductIds },
                brand: brandName,
                model: modelName
            }).lean();

            validProductIds = products.map(p => p.product_id);
        }

        // Prevent duplicate combinations
        await checkIfDiscountExists(
            brandName,
            modelName,
            existingDiscount.dealer_id,
            validProductIds,
            dealer_discount_id
        );

        // Discount value validation
        let updatedDiscountValue = existingDiscount.discount_value;

        if (discount_value !== undefined) {

            const parsedValue = Number(discount_value);

            if (isNaN(parsedValue) || parsedValue < 0) {
                throw new BadRequestException(
                    "Discount value must be a positive number."
                );
            }

            updatedDiscountValue = Math.round(parsedValue * 100) / 100;
        }

        let updatedIsPercentage = existingDiscount.is_percentage;

        if (typeof is_percentage === "boolean") {
            updatedIsPercentage = is_percentage;
        }

        if (updatedIsPercentage && updatedDiscountValue > 100) {
            throw new BadRequestException(
                "Percentage discount value cannot exceed 100%."
            );
        }

        const updatedDescription =
            typeof description === "string" && description.trim() ?
                description.trim() :
                existingDiscount.description;

        // Update Discount
        const updatedDiscount = await DealerDiscount.findOneAndUpdate({ dealer_discount_id }, {
            $set: {
                brand_name: brandName,
                model_name: modelName,
                product_ids: validProductIds,
                discount_value: updatedDiscountValue,
                is_percentage: updatedIsPercentage,
                description: updatedDescription,
                updated_at: getISTDate(),
                updated_by: employeeId
            }
        }, { new: true });

        const response = mapDealerDiscountEntityToResponse(updatedDiscount);

        const productResponses = await Promise.all(
            products.map(p => fetchProductWithStocks(p))
        );

        response.products = productResponses;

        return response;
    }),

    getDealerDiscounts: asyncHandler(async (payload = {}, pagination = {}) => {

        // Ensure authenticated request
        getAuthenticatedEmployeeContext();

        const { dealer_id, product_id, brand_name, model_name } = payload;

        const page = Number(pagination.page) || 1;
        const limit = Number(pagination.limit) || 10;
        const skip = (page - 1) * limit;

        const filters = { status: "active" };

        let resolvedBrandName = null;
        let resolvedModelName = null;


        // PRODUCT VALIDATION
        if (product_id) {
            const product = await Product
                .findOne({ product_id, status: "active" })
                .select("product_id brand model")
                .lean();

            if (!product) {
                throw new BadRequestException(`Product ${product_id} not found.`);
            }

            resolvedBrandName = product && product.brand ?
                product.brand.toUpperCase() :
                undefined;

            resolvedModelName = product && product.model ?
                product.model.toUpperCase() :
                undefined;

            filters.product_ids = { $in: [product_id] };
        }

        // BRAND + MODEL VALIDATION
        if (brand_name) {

            const brandUpper = brand_name.toUpperCase();

            const brand = await Brand
                .findOne({ brand_name: brandUpper })
                .select("brand_name brand_models")
                .lean();

            if (!brand) {
                throw new BadRequestException(`Brand ${brandUpper} not found.`);
            }

            resolvedBrandName = brand.brand_name;

            filters.brand_name = resolvedBrandName;

            if (model_name) {

                const modelUpper = model_name.toUpperCase();

                const validModels = (brand.brand_models || []).map(m => m.toUpperCase());

                if (!validModels.includes(modelUpper)) {
                    throw new BadRequestException(
                        `Model ${modelUpper} is not associated with brand ${brandUpper}.`
                    );
                }

                resolvedModelName = modelUpper;
                filters.model_name = resolvedModelName;
            }
        }

        // DEALER VALIDATION
        if (dealer_id) {

            const dealer = await employeeSchema
                .findOne({ employee_id: dealer_id, role: ROLES.DEALER })
                .select("employee_id brand")
                .lean();

            if (!dealer) {
                throw new BadRequestException(`Dealer ${dealer_id} not found.`);
            }

            const dealerBrands = (dealer.brand || []).map(b => b.toUpperCase());

            filters.dealer_id = dealer.employee_id;

            if (dealerBrands.length) {
                filters.brand_name = resolvedBrandName && dealerBrands.includes(resolvedBrandName) ?
                    resolvedBrandName : { $in: dealerBrands };
            }
        }

        // FETCH DEALER DISCOUNTS (PAGINATED)
        const [discounts, total] = await Promise.all([
            DealerDiscount
                .find(filters)
                .sort({ created_at: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),

            DealerDiscount.countDocuments(filters)
        ]);

        // EXTRACT UNIQUE PRODUCT IDS
        const uniqueProductIds = [
            ...new Set(
                discounts.flatMap(discount => discount.product_ids || [])
            )
        ];

        // FETCH PRODUCTS IN BULK
        let productMap = new Map();

        if (uniqueProductIds.length > 0) {

            const products = await Product
                .find({
                    product_id: { $in: uniqueProductIds },
                    status: "active"
                })
                .lean();

            const productsWithStocks = await Promise.all(
                products.map(fetchProductWithStocks)
            );

            productMap = new Map(
                productsWithStocks.map(p => [p.product_id, p])
            );
        }

        // BUILD RESPONSE
        const responseData = discounts.map(discount => {

            const mappedDiscount = mapDealerDiscountEntityToResponse(discount);

            const productList = (discount.product_ids || [])
                .map(id => productMap.get(id))
                .filter(Boolean);

            return {
                ...mappedDiscount,
                products: productList
            };
        });

        return {
            data: responseData,
            pagination: {
                page,
                limit,
                total
            }
        };

    }),

    logout: asyncHandler(async (token) => {
        const decoded = jwt.decode(token);

        if (!decoded || !decoded.exp) {
            throw new UnauthorizedException('Invalid token');
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const ttl = decoded.exp - currentTime;

        if (ttl > 0) {
            tokenBlacklistService.blacklistToken(token, ttl);
        }
    }),

    createAccountLimiter: rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 50,
        message: {
            success: false,
            message: 'Too many account creation attempts. Please try again later.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    }),

    loginLimiter: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 25,
        message: {
            success: false,
            message: 'Too many login attempts. Please try again later.',
        },
        standardHeaders: true,
        legacyHeaders: false,
    })
};

export { employeeService };