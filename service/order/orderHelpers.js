import Employee from "../../models/employees.js";
import OrderDetails from "../../models/orderDetails.js";
import { ORDER_STATUSES, ROLES } from "../../utils/constants.js";

export const fetchDealerAndOrderDetails = async (orders = []) => {
    if (!Array.isArray(orders) || orders.length === 0) {
        return { dealerMap: {}, detailsMap: {} };
    }

    const dealerIds = [...new Set(orders.map(o => o.dealer_id))];
    const orderNumbers = orders.map(o => o.order_number);

    const [dealers, orderDetails] = await Promise.all([
        Employee.find({
            employee_id: { $in: dealerIds },
            role: ROLES.DEALER
        }).lean(),

        OrderDetails.find({
            order_number: { $in: orderNumbers }
        }).lean()
    ]);

    const dealerMap = dealers.reduce((map, dealer) => {
        map[dealer.employee_id] = dealer;
        return map;
    }, {});

    const detailsMap = orderDetails.reduce((map, detail) => {
        if (!map[detail.order_number]) {
            map[detail.order_number] = [];
        }
        map[detail.order_number].push(detail);
        return map;
    }, {});

    return { dealerMap, detailsMap };
};

export const toNumberSafe = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const appendOrderNote = (orderDetail, note) => {
    orderDetail.notes = [orderDetail.notes, note].filter(Boolean).join(" | ");
};

export const recalculateOrderDetailPricing = (detail) => {
    const unitPrice = toNumberSafe(detail.unit_product_price);
    const unitDiscount = toNumberSafe(detail.dealer_discount);

    detail.total_product_price = unitPrice * detail.qty_ordered;
    detail.total_dealer_discount = unitDiscount * detail.qty_ordered;
    detail.total_price = detail.total_product_price - detail.total_dealer_discount;
};

export const buildDateRange = (startDate, endDate) => {
    if (!startDate && !endDate) return undefined;

    const range = {};

    if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        range.$gte = start;
    }

    if (endDate || startDate) {
        const end = new Date(endDate || startDate);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
    }

    return range;
};

// Fire notification as non-blocking operation
export const fireNotification = (promise) => {
    promise.catch((err) =>
        logger.error("[Notification] Non-fatal error:", err.message)
    );
};

// Returns true when the status transition should emit a notification.
export const shouldNotifyStatusChange = (prevStatus, nextStatus) => {
    if (nextStatus === ORDER_STATUSES.CONFIRMED) return true;
    if (nextStatus === ORDER_STATUSES.PRODUCTION) return true;
    if (nextStatus === ORDER_STATUSES.PACKED) return true;
    return false;
};