// service/order/orderStatus.js

import { ORDER_STATUSES } from "../../utils/constants.js";
import { normalizeStatus } from "../../utils/orderStatusUtils.js";

const ORDER_STATUS_PRIORITY = [
    ORDER_STATUSES.REJECTED,
    ORDER_STATUSES.PENDING,
    // ORDER_STATUSES.CANCELLED intentionally excluded
    ORDER_STATUSES.PRODUCTION,
    ORDER_STATUSES.PACKED,
    ORDER_STATUSES.INVOICE,
    ORDER_STATUSES.SHIPPED
];

// Exclude unwanted statuses (e.g., CANCELLED, REJECTED)
const EXCLUDED_STATUSES = new Set([
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.REJECTED
]);

const filterActiveDetails = (details = []) =>
    details.filter(
        ({ status }) => status && !EXCLUDED_STATUSES.has(status)
    );

// Check if all items belong to allowed statuses
const areAllInStatuses = (items = [], allowed = []) =>
    items.length > 0 &&
    items.every(({ status }) => allowed.includes(status));

export const deriveOrderStatusFromDetails = (details = []) => {
    if (!Array.isArray(details) || details.length === 0) {
        return ORDER_STATUSES.PENDING;
    }

    // Fast path: single order detail
    if (details.length === 1) {
        if (!details[0] || !details[0].status) {
            return ORDER_STATUSES.PENDING;
        }
        return details[0].status;
    }

    const activeDetails = filterActiveDetails(details);

    // Build status set while ignoring CANCELLED
    const statusSet = new Set(
        activeDetails.map(({ status }) => status)
    );

    // 1. Priority resolution
    for (const status of ORDER_STATUS_PRIORITY) {
        if (statusSet.has(status)) {
            return status;
        }
    }

    // 2. All Delivered / Completed(ignore CANCELLED and REJECTED)
    if (areAllInStatuses(activeDetails, [
        ORDER_STATUSES.DELIVERED,
        ORDER_STATUSES.COMPLETED
    ])) {
        return ORDER_STATUSES.COMPLETED;
    }

    // 3. All Cancelled
    if (details.every(
        ({ status }) => status === ORDER_STATUSES.CANCELLED
    )) {
        return ORDER_STATUSES.CANCELLED;
    }

    // 4. All Rejected
    if (details.every(
        ({ status }) => status === ORDER_STATUSES.REJECTED
    )) {
        return ORDER_STATUSES.REJECTED;
    }

    return ORDER_STATUSES.CONFIRMED;
};

// Check if all active items are delivered
export const allDetailsDelivered = (details = []) => {
    if (!Array.isArray(details) || details.length === 0) {
        return false;
    }

    const activeDetails = filterActiveDetails(details);

    return areAllInStatuses(activeDetails, [
        ORDER_STATUSES.DELIVERED,
        ORDER_STATUSES.COMPLETED
    ]);
};

// Allowed status transitions
const ORDER_STATUS_TRANSITIONS = {
    PENDING: ["PENDING", "CONFIRMED"],
    CONFIRMED: ["PENDING", "CONFIRMED"],
    PRODUCTION: ["CONFIRMED", "PRODUCTION"],
    PACKED: ["PRODUCTION", "PACKED"],
    INVOICE: ["PACKED", "INVOICE"],
    SHIPPED: ["INVOICE", "SHIPPED"],
    DELIVERED: ["SHIPPED", "DELIVERED"],
    COMPLETED: ["DELIVERED"]
};

// Validate if order can move to target status
export const canMoveOrderToTargetStatus = (
    details = [],
    targetStatus
) => {

    const allowedStatuses = ORDER_STATUS_TRANSITIONS[targetStatus];

    if (!Array.isArray(details) || !Array.isArray(allowedStatuses)) {
        return false;
    }

    return details.every(({ status }) =>
        allowedStatuses.includes(status)
    );
};

export const resolveOrderDetailStatus = ({
    qtyOrdered = 0,
    qtyCancelled = 0,
    qtyDelivered = 0,
    packedQty = 0,
    hasProduction = false,
    hasUnpacked = false,
    currentStatus
}) => {
    const isInProduction = hasProduction || hasUnpacked;
    const isPacked = packedQty > 0 && !isInProduction;

    if (qtyOrdered > 0 && qtyCancelled > 0 && qtyOrdered === qtyCancelled) return ORDER_STATUSES.CANCELLED;

    if (qtyDelivered > 0 && qtyOrdered > 0 && qtyDelivered >= qtyOrdered) return ORDER_STATUSES.DELIVERED;

    if (currentStatus === ORDER_STATUSES.CONFIRMED) {
        if (hasProduction || hasUnpacked) return ORDER_STATUSES.PRODUCTION;
        if (packedQty > 0) return ORDER_STATUSES.PACKED;
        return ORDER_STATUSES.CONFIRMED;
    }

    if (isInProduction) return ORDER_STATUSES.PRODUCTION;

    if (isPacked) return ORDER_STATUSES.PACKED;

    return currentStatus;
};

export const resolveManualOrderStatus = ({ normalized, stock }) => {
    if (normalized === ORDER_STATUSES.CONFIRMED) {
        if (stock.PRODUCTION > 0 || stock.UNPACKED > 0)
            return ORDER_STATUSES.PRODUCTION;

        if (stock.PACKED > 0)
            return ORDER_STATUSES.PACKED;

        return ORDER_STATUSES.CONFIRMED;
    }

    return normalized;
};

export const normalizeIncomingStatus = (dto, orderDetail) => {
    if (!dto.status) return null;

    const normalized = normalizeStatus(dto.status);

    if (normalized === ORDER_STATUSES.CANCELLED) {
        dto.cancel_qty = orderDetail.qty_ordered - orderDetail.qty_delivered - orderDetail.total_cancelled_qty;
    }

    return normalized;
};

export const NOTIFIABLE_TARGET_STATUSES = new Set([
    ORDER_STATUSES.CONFIRMED,
    ORDER_STATUSES.PRODUCTION,
    ORDER_STATUSES.PACKED,
]);