import dotenv from 'dotenv';
dotenv.config();

export const STATUS_CODES = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
};

export const PATH_ROUTES = {
    BASIC_ROUTE: '/api/v1',

    get EMPLOYEE_ROUTE() {
        return `${this.BASIC_ROUTE}/employees`;
    },
    get AUTH_ROUTE() {
        return `${this.BASIC_ROUTE}/auth`;
    },
    get ORDER_ROUTE() {
        return `${this.BASIC_ROUTE}/order-details`;
    },
    get PRODUCT_ROUTE() {
        return `${this.BASIC_ROUTE}/product-details`;
    },
    get LOCATION_ROUTE() {
        return `${this.BASIC_ROUTE}/locations`;
    },
    get COMPANY_ROUTE() {
        return `${this.BASIC_ROUTE}/company-address`;
    },
    get INVOICE_ROUTE() {
        return `${this.BASIC_ROUTE}/invoice-details`;
    },
    get BULK_IMPORT_ROUTE() {
        return `${this.BASIC_ROUTE}/upload-excel`;
    },
    get NOTIFICATION_ROUTE() {
        return `${this.BASIC_ROUTE}/notifications`;
    },
};

export const {
    PORT,
    APPLICATION_NAME,
    APPLICATION_URL,
    ENVIRONMENT,
    MONGO_URL,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    SUPER_ADMIN,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_EMAIL,
    SUPER_ADMIN_PASSWORD,
    ENCRYPTION_SECRET_KEY,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION,
    S3_BUCKET_NAME,
    ALLOWED_ORIGINS,
    LOG_LEVEL,
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_PATH,
    ENABLE_STOCK_RETURNS = false
} = process.env;

export const ROLES = {
    SUPER_ADMIN: 'ROLE_SUPER_ADMIN',
    ADMIN: 'ROLE_ADMIN',
    SUPERVISOR: 'ROLE_SUPERVISOR',
    MANAGER: 'ROLE_MANAGER',
    SALESMAN: 'ROLE_SALESMAN',
    PRODUCTION: 'ROLE_PRODUCTION',
    PACKING: 'ROLE_PACKING',
    ACCOUNTS: 'ROLE_ACCOUNTS',
    DELIVERY: 'ROLE_DELIVERY',
    DEALER: 'ROLE_DEALER'
};

export const PRODUCT_CATEGORIES = {
    INVERTER: 'INVERTER',
    BATTERY: 'BATTERY',
    // SOLAR_PANEL: 'SOLAR_PANEL',
    // CHARGE_CONTROLLER: 'CHARGE_CONTROLLER',
    // ACCESSORIES: 'ACCESSORIES'
};

export const APPROVAL_GRANTED_ROLES = {
    SUPER_ADMIN: ROLES.SUPER_ADMIN,
    ADMIN: ROLES.ADMIN,
};

export const ADMIN_PRIVILEGED_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.MANAGER
];

export const STOCK_MANAGEMENT_ROLES = [
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.PACKING,
    ROLES.PRODUCTION,
    ROLES.SALESMAN
];

export const ORDER_CREATOR_ROLES = {
    SUPER_ADMIN: ROLES.SUPER_ADMIN,
    ADMIN: ROLES.ADMIN,
    SALESMAN: ROLES.SALESMAN,
    MANAGER: ROLES.MANAGER,
};

export const STOCK_ACTIONS = {
    STOCK_ADD: 'ADD',
    STOCK_RETURN: 'RETURN',
    STOCK_SALE: 'SALE',
};

export const STOCK_TYPES = {
    STOCK_PACKED: 'PACKED',
    STOCK_UNPACKED: 'UNPACKED',
    STOCK_PRODUCTION: 'PRODUCTION'
};

export const PRODUCT_REQUIRED_FIELDS = ["brand", "model", "product_type", "product_name"];
export const PRODUCT_UPDATABLE_FIELDS = [...PRODUCT_REQUIRED_FIELDS, "status"];

export const ORDER_REQUIRED_FIELDS = ["dealer_id", "priority", "order_details"];
export const ORDER_DETAILS_REQUIRED_FIELDS = ["product_id", "product_brand", "product_name", "product_model", "product_type", "qty_ordered", "delivery_date",];

export const DEALER_DISCOUNT_REQUIRED_FIELDS = ["brand_name", "model_name", "dealer_id", "discount_value", "is_percentage"];

export const STATUS = ["active", "inactive", "discontinued"];

export const ORDER_STATUSES = {
    PENDING: "PENDING",
    CONFIRMED: "CONFIRMED",
    PRODUCTION: "PRODUCTION",
    PACKED: "PACKED",
    INVOICE: "INVOICE",
    SHIPPED: "SHIPPED",
    DELIVERED: "DELIVERED",
    COMPLETED: "COMPLETED",

    CANCELLED: "CANCELLED",
    REJECTED: "REJECTED"
};

export const PAYMENT_STATUSES = {
    DUE: "DUE",
    PARTIAL: "PARTIAL",
    PAID: "PAID",
    FAILED: "FAILED",
    REFUNDED: "REFUNDED"
};

export const ALLOWED_TRANSITIONS = {
    [ORDER_STATUSES.PENDING]: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.REJECTED],
    [ORDER_STATUSES.CONFIRMED]: [ORDER_STATUSES.PRODUCTION, ORDER_STATUSES.PACKED],
    [ORDER_STATUSES.PRODUCTION]: [ORDER_STATUSES.PACKED],
    [ORDER_STATUSES.PACKED]: [ORDER_STATUSES.INVOICE],
    [ORDER_STATUSES.INVOICE]: [ORDER_STATUSES.SHIPPED],
    [ORDER_STATUSES.SHIPPED]: [ORDER_STATUSES.DELIVERED],
    [ORDER_STATUSES.DELIVERED]: [],

    [ORDER_STATUSES.CANCELLED]: [],
    [ORDER_STATUSES.REJECTED]: []
};

export const CANCELLABLE_STATUSES = new Set([
    ORDER_STATUSES.PENDING,
    ORDER_STATUSES.CONFIRMED,
    ORDER_STATUSES.PRODUCTION,
    ORDER_STATUSES.PACKED
]);

export const getISTDate = () => {
    const now = new Date();
    const istOffset = 330;
    return new Date(now.getTime() + istOffset * 60 * 1000);
};

export const STATUSES_REQUIRING_DETAIL_VALIDATION = [
    ORDER_STATUSES.INVOICE,
    ORDER_STATUSES.SHIPPED,
    ORDER_STATUSES.DELIVERED
];

export const IMMUTABLE_ORDER_STATUSES = [
    ORDER_STATUSES.DELIVERED,
    ORDER_STATUSES.CANCELLED
];

export const EMPLOYEE_ACCESS_SCOPE = {
    ALL: 'ALL',
    ASSIGNED_ONLY: 'ASSIGNED_ONLY',
};