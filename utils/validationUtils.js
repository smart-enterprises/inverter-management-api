// validationUtils.js

import validator from 'validator';

import { BadRequestException, ValidationException, ForbiddenException } from '../middleware/CustomError.js';
import { ADMIN_PRIVILEGED_ROLES, STOCK_ACTIONS, STOCK_TYPES, ROLES, PRODUCT_REQUIRED_FIELDS, DEALER_DISCOUNT_REQUIRED_FIELDS, ALLOWED_TRANSITIONS, STOCK_MANAGEMENT_ROLES, EMPLOYEE_ACCESS_SCOPE, } from './constants.js';
import { validatePassword } from './employeeAuth.js';
import { CurrentRequestContext } from '../utils/CurrentRequestContext.js';

export const sanitizeInput = (input) =>
    typeof input === 'string' ? validator.escape(input.trim()) : input;

export const sanitizeInputBody = (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                if (key === "photo") {
                    continue;
                }
                req.body[key] = sanitizeInput(req.body[key]);
            }
        }
    }
    next();
};

export const validateEmployeeData = (data, isUpdate = false) => {
    const errors = [];
    const { employee_name, employee_email, password, employee_phone, role } = data;

    if (!isUpdate || employee_name !== undefined) {
        if (!employee_name || employee_name.trim().length < 2)
            errors.push({ field: 'employee_name', message: 'Name must be at least 2 characters' });
        if (employee_name && employee_name.length > 500)
            errors.push({ field: 'employee_name', message: 'Name cannot exceed 500 characters' });
    }

    if (!isUpdate || employee_email !== undefined) {
        if (!employee_email)
            errors.push({ field: 'employee_email', message: 'Email is required' });
        else if (!validator.isEmail(employee_email))
            errors.push({ field: 'employee_email', message: 'Invalid email address' });
    }

    if (!isUpdate && password !== undefined) {
        if (!password) {
            errors.push({ field: 'password', message: 'Password is required' });
        } else {
            try {
                validatePassword(password);
            } catch (err) {
                errors.push({ field: 'password', message: err.message });
            }
        }
    }

    if (!isUpdate || employee_phone !== undefined) {
        if (!employee_phone)
            errors.push({ field: 'employee_phone', message: 'Phone number is required' });
        else if (!validator.isMobilePhone(employee_phone))
            errors.push({ field: 'employee_phone', message: 'Invalid phone number' });
    }

    if (!isUpdate || role !== undefined) {
        if (!role)
            errors.push({ field: 'role', message: 'Role is required' });
        else if (!Object.values(ROLES).includes(role.toUpperCase()))
            errors.push({ field: 'role', message: `Allowed roles: ${Object.values(ROLES).join(', ')}` });
    }

    if (errors.length > 0) {
        const message = formatValidationMessage(errors);
        throw new ValidationException(message, errors);
    }
};

export const validateMainRoleAccess = () => {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const rawRole = CurrentRequestContext.getRole();
    const role = (rawRole || "").toUpperCase();

    if (!employee_id || !role || !ADMIN_PRIVILEGED_ROLES.includes(role)) {
        throw new ForbiddenException(
            `Access denied. Your role (${role}) does not have permission to perform this action.`
        );
    }
    return { employee_id, role };
};

export const validateStockManagementRoleAccess = () => {
    const employee_id = CurrentRequestContext.getEmployeeId();
    const rawRole = CurrentRequestContext.getRole();
    const role = (rawRole || "").toUpperCase();

    if (!employee_id || !role || !STOCK_MANAGEMENT_ROLES.includes(role)) {
        throw new ForbiddenException(
            `Access denied. Your role (${role}) does not have permission to perform this action.`
        );
    }
    return { employee_id, role };
};

export const getAuthenticatedEmployeeContext = () => {
    const employeeId = CurrentRequestContext.getEmployeeId();
    const employee_role = CurrentRequestContext.getRole();
    const employeeRole = (employee_role || "").toUpperCase();

    if (!employeeId || !employeeRole || !Object.values(ROLES).includes(employeeRole)) {
        throw new ForbiddenException(`Access denied: only users with roles ${Object.values(ROLES).join(", ")} are authorized.`);
    }

    return { employeeId, employeeRole };
};

export const validateStockActionType = (action) => {
    const type = typeof action === "string" ? action.toUpperCase() : null;
    if (!Object.values(STOCK_ACTIONS).includes(type)) {
        throw new BadRequestException(`Invalid stock action: ${action}. Allowed: ${Object.values(STOCK_ACTIONS).join(', ')}`);
    }
    return type;
};

export const validateStockType = (stockType) => {
    const type = typeof stockType === "string" ? stockType.trim().toUpperCase() : null;
    if (!Object.values(STOCK_TYPES).includes(type)) {
        throw new BadRequestException(`Invalid stock_type: ${stockType}. Allowed: ${Object.values(STOCK_TYPES).join(", ")}`);
    }
    return type;
};

export const validateProductRequiredFields = (dto) => {
    for (const field of PRODUCT_REQUIRED_FIELDS) {
        if (!dto[field]) throw new BadRequestException(`${field} is required`);
    }
};

export const validateDealerDiscountRequiredFields = (dto) => {
    for (const field of DEALER_DISCOUNT_REQUIRED_FIELDS) {
        if (dto[field] === null || dto[field] === undefined) throw new BadRequestException(`${field} is required`);
    }
};

export const isValidTransition = (from, to) => {
    if (from === to) return false;
    const allowed = ALLOWED_TRANSITIONS[from] || [];
    return allowed.includes(to);
};

export const isRoleAllowedForApproval = (role) => {
    return ADMIN_PRIVILEGED_ROLES.includes((role || "").toUpperCase());
};

export function normalizePrice(value) {
    if (value === undefined || value === null) return undefined;

    const num = Number(value);

    if (!Number.isFinite(num) || num < 0) return undefined;

    return Math.round(num * 100) / 100;
}

export const toSafeNumber = (value) => Number(value) || 0;

export const round = (num) => Math.round(num);

export const safeTrim = (val) => (typeof val === "string" ? val.trim() : "");

export const normalizeUpper = (val) => safeTrim(val).toUpperCase();
export const normalizeLower = (val) => safeTrim(val).toLowerCase();

export const shouldValidate = (field) => !isUpdate || field !== undefined;

export const formatValidationMessage = (errors) => {
    if (!errors || errors.length === 0) return "Validation failed";

    const formattedErrors = errors
        .map(e => `${e.field} - ${e.message}`)
        .join(", ");

    return `Validation failed -> ${formattedErrors}`;
};

export const normalizeProductType = (value) => {
    if (!value) return undefined;

    const cleaned = value
        .replace(/\+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (cleaned.toLowerCase() === "all") return undefined;

    return cleaned;
};

export const parseEmployeeQueryParams = (query) => {
    const isAllValue = (value) =>
        typeof value === "string" && value.toLowerCase() === "all";

    const toBoolean = (value) =>
        String(value).toLowerCase() === "true";

    const parseSalesmanIds = (value) => {
        if (!value) return [];

        if (Array.isArray(value)) {
            return value;
        }

        return String(value)
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
    };

    return {
        role: !isAllValue(query.role) ? query.role : null,
        status: !isAllValue(query.status) ? query.status : null,
        search: query.search?.trim(),

        includeDealers: toBoolean(query.includeDealers),
        includePassword: toBoolean(query.includePassword),

        accessScope:
            query.scope?.toUpperCase() === EMPLOYEE_ACCESS_SCOPE.ALL
                ? EMPLOYEE_ACCESS_SCOPE.ALL
                : EMPLOYEE_ACCESS_SCOPE.ASSIGNED_ONLY,

        salesmanIds: parseSalesmanIds(query.salesmanIds),
    };
};

export const buildEmployeeQueryFilter = (query, employeeRole) => {
    const {
        role: requestedRole,
        status,
        search,
        includeDealers,
        accessScope,
        salesmansIds,
    } = query;

    const filter = {};

    filter.status = status || { $ne: "deleted" };

    const restrictedRoles = new Set();

    if (!includeDealers) {
        restrictedRoles.add(ROLES.DEALER);
    }

    if (employeeRole === ROLES.MANAGER) {
        restrictedRoles.add(ROLES.SUPER_ADMIN);
        restrictedRoles.add(ROLES.ADMIN);
    }

    if (requestedRole) {
        if (restrictedRoles.has(requestedRole)) {
            filter.role = { $in: [] };
        } else {
            filter.role = requestedRole;
        }
    } else if (restrictedRoles.size > 0) {
        filter.role = { $nin: Array.from(restrictedRoles) };
    }

    if (search) {
        const trimmedSearch = String(search).trim();
        const regex = new RegExp(trimmedSearch, "i");
        const isNumeric = !Number.isNaN(Number(trimmedSearch));

        const searchConditions = [
            { employee_id: regex },
            { employee_name: regex },
            { employee_email: regex },
            { role: regex },
            { status: regex },
            { shop_name: regex },
            { district: regex },
            { town: regex },
            { brand: regex }
        ];

        if (isNumeric) {
            searchConditions.push({
                employee_phone: Number(trimmedSearch)
            });
        }

        filter.$or = searchConditions;
    }

    return filter;
};

export function normalizeSalesmanIds(raw) {
    if (!raw) return [];
    const ids = Array.isArray(raw) ? raw : [raw];
    return ids
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
}

export function extractUniqueDealerIds(salesmanRecords) {
    const seen = new Set();
    for (const record of salesmanRecords) {
        for (const dealerId of record.dealers ?? []) {
            if (typeof dealerId === "string" && dealerId.trim()) {
                seen.add(dealerId.trim());
            }
        }
    }
    return [...seen];
}

export const buildEmployeeProjectionConfig = (includePassword, employeeRole) => {
    const allowedRoles = [
        ROLES.SUPER_ADMIN,
        ROLES.ADMIN,
        ROLES.MANAGER
    ];

    const canViewPassword = allowedRoles.includes(employeeRole);

    const shouldIncludePassword = canViewPassword && includePassword;

    return {
        select: shouldIncludePassword ? "" : "-password",
        includePassword: shouldIncludePassword
    };
};