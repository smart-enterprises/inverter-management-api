// modelMapper.js

import logger from './logger.js';
import { sanitizeInput, toSafeNumber } from './validationUtils.js';

const EMPLOYEE_INPUT_FIELDS = [
    'employee_name', 'employee_email', 'employee_phone', 'role',
    'shop_name', 'district', 'town', 'brand', 'dealers', 'address', 'photo'
];

const EMPLOYEE_RESPONSE_FIELDS = [
    'employee_id', 'employee_name', 'employee_email', 'employee_phone',
    'role', 'status', 'created_by', 'shop_name', 'photo',
    'district', 'town', 'brand', 'address', 'dealers', 'created_at', 'updated_at', 'log_note'
];

const PRODUCT_RESPONSE_FIELDS = [
    'product_id', 'product_name', 'model', 'product_type', 'product_category',
    'available_stock', 'price', 'cost', 'status', 'created_by', 'brand',
    'created_at', 'updated_at', 'log_note'
];

const PRODUCT_BRAND_RESPONSE_FIELDS = [
    'brand_id', 'brand_name', 'brand_models', 'deleted_brand_models', 'description',
    'status', 'created_by', 'created_at', 'updated_at'
];

const STOCK_RESPONSE_FIELDS = [
    'stock_id', 'product_id', 'stock', 'packed_stock', 'unpacked_stock',
    'created_by', 'created_at', 'updated_at'
];

const STOCK_HISTORY_RESPONSE_FIELDS = [
    'stock_history_id', 'product_id', 'order_number', 'action', 'stock_type',
    'quantity', 'previous_stock', 'new_stock', 'notes', 'created_by',
    'created_at', 'updated_at'
];

const PRICE_HISTORY_RESPONSE_FIELDS = [
    'price_history_id', 'product_id', 'old_price', 'new_price', 'changed_by',
    'change_reason', 'is_cost_update', 'changed_at', 'created_at'
];

const ORDER_RESPONSE_FIELDS = [
    'order_number', 'dealer_id', 'priority', 'order_note', 'payment_notes', 'status', 'salesman_id',
    'delivery_date', 'promised_delivery_date', 'delivery_note', 'created_by', 'order_total_price',
    'order_total_discount', 'payment_status', 'payment_type', 'amount_paid',
    'amount_due', 'last_payment_date', 'sales_target_updated', 'created_at', 'updated_at'
];

const ORDER_DETAILS_RESPONSE_FIELDS = [
    'order_number', 'order_details_number', 'product_id', 'product_brand', 'product_name',
    'product_model', 'product_type', 'product_category', 'total_qty_ordered', 'qty_ordered', 'qty_delivered',
    'delivery_date', 'delivery_notes', 'notes', 'unit_product_price', 'total_product_price',
    'is_free', 'dealer_discount', 'stock_usage', 'stock_flags', 'total_dealer_discount',
    'total_price', 'status', 'total_cancelled_qty', 'cancellation_history', 'created_at',
    'updated_at'
];

const DEALER_DISCOUNT_RESPONSE_FIELDS = [
    'dealer_discount_id', 'brand_name', 'model_name', 'dealer_id',
    'product_ids', 'discount_value', 'is_percentage', 'description',
    'status', 'created_by', 'created_at', 'updated_at'
];

export const mapEmployeeRequestToEntity = (data, employeeId = null, isUpdate = false) => {
    const entity = {};

    if (employeeId) entity.employee_id = employeeId;
    if (!isUpdate) entity.status = "active";

    EMPLOYEE_INPUT_FIELDS.forEach((field) => {
        if (data[field] !== undefined) {
            if (field === "photo") {
                logger.info("Employee photo field received", { photo: data[field] });
                entity[field] = data[field];
            } else {
                entity[field] = sanitizeInput(data[field]);
            }
        }
    });

    return entity;
};

export const mapEmployeeEntityToResponse = (entity, password = null) => {
    const response = {};

    EMPLOYEE_RESPONSE_FIELDS.forEach(field => {
        if (entity[field] !== undefined) {
            response[field] = entity[field];
        }
    });

    if (password !== null) {
        response.password = password;
    }

    return response;
};

export const mapProductEntityToResponse = (product, stocks = [], priceHistories = [], stockHistories = []) => {
    const response = {};

    PRODUCT_RESPONSE_FIELDS.forEach(field => {
        if (product[field] !== undefined) {
            response[field] = product[field];
        }
    });

    response.stocks = Array.isArray(stocks) ? stocks : [];
    response.stock_history = Array.isArray(stockHistories) ? stockHistories : [];
    response.price_history = Array.isArray(priceHistories) ? priceHistories : [];

    return response;
};

export const mapStockEntityToResponse = (stock) => {
    const response = {};

    STOCK_RESPONSE_FIELDS.forEach(field => {
        if (stock[field] !== undefined) {
            response[field] = stock[field];
        }
    });

    return response;
};

export const mapPriceHistoryEntityToResponse = (priceHistory) => {
    const response = {};

    PRICE_HISTORY_RESPONSE_FIELDS.forEach(field => {
        if (priceHistory[field] !== undefined) {
            response[field] = priceHistory[field];
        }
    });

    return response;
};

export const mapStockHistoryEntityToResponse = (stockHistory) => {
    const response = {};

    STOCK_HISTORY_RESPONSE_FIELDS.forEach(field => {
        if (stockHistory[field] !== undefined) {
            response[field] = stockHistory[field];
        }
    });

    return response;
};

export const mapOrderEntityToResponse = (order) => {
    if (!order) return null;

    const orderData = {};
    ORDER_RESPONSE_FIELDS.forEach((field) => {
        if (order[field] !== undefined) {
            orderData[field] = order[field];
        }
    });

    return orderData;
};

export const mapDealerEntityToResponse = (dealer) => {
    if (!dealer) return null;

    const dealerData = {};
    EMPLOYEE_RESPONSE_FIELDS.forEach((field) => {
        if (dealer[field] !== undefined) {
            dealerData[field] = dealer[field];
        }
    });

    return dealerData;
};

export const mapOrderDetailEntityToResponse = (detail) => {
    if (!detail || typeof detail !== 'object') return null;

    const orderDetailData = {};
    ORDER_DETAILS_RESPONSE_FIELDS.forEach((field) => {
        if (detail[field] !== undefined) {

            switch (field) {
                case 'qty_ordered':
                    orderDetailData['total_qty_ordered'] = toSafeNumber(detail.qty_ordered);
                    orderDetailData[field] = toSafeNumber(detail.qty_ordered) - toSafeNumber(detail.qty_delivered) - toSafeNumber(detail.total_cancelled_qty);
                    break;
                default:
                    orderDetailData[field] = detail[field];
                    break;
            }
        }
    });

    return orderDetailData;
};

export const mapOrderDetailsListToResponse = (details = []) => {
    return details.map(mapOrderDetailEntityToResponse);
};

export const transformOrderToResponse = (order, dealer, orderDetailsList = []) => {
    if (!order) return { order: null };

    const orderData = mapOrderEntityToResponse(order);
    orderData.dealer = mapDealerEntityToResponse(dealer);
    orderData.order_details = mapOrderDetailsListToResponse(orderDetailsList);

    return { order: orderData };
};

export const mapProductBrandEntityToResponse = (brand) => {
    const response = {};

    PRODUCT_BRAND_RESPONSE_FIELDS.forEach(field => {
        if (brand[field] !== undefined) {
            response[field] = brand[field];
        }
    });

    return response;
};

export const mapDealerDiscountEntityToResponse = (discount) => {
    const response = {};
    DEALER_DISCOUNT_RESPONSE_FIELDS.forEach(field => {
        if (discount[field] !== undefined) {
            response[field] = discount[field];
        }
    });

    return response;
};

export const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
};