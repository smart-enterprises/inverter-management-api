// service/notificationService.js
import { v4 as uuidv4 } from "uuid";
import Notification, {
    NOTIFICATION_TYPES,
    NOTIFICATION_TARGET_ROLES,
} from "../models/notification.js";
import logger from "../utils/logger.js";
import { ORDER_STATUSES } from "../utils/constants.js";

const sseClients = new Map();

export const registerSSEClient = (employeeId, role, res) => {
    const existing = sseClients.get(employeeId);
    if (existing) {
        try { existing.res.end(); } catch (_) { /* already closed */ }
    }
    sseClients.set(employeeId, { res, role, connectedAt: new Date() });
    logger.info(
        `[SSE] Client connected: ${employeeId} (${role}) | Total: ${sseClients.size}`
    );
};

export const removeSSEClient = (employeeId) => {
    sseClients.delete(employeeId);
    logger.info(
        `[SSE] Client disconnected: ${employeeId} | Total: ${sseClients.size}`
    );
};

export const getConnectedClientCount = () => sseClients.size;

const writeSSEEvent = (res, eventName, data) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const sendToClient = (employeeId, eventName, data) => {
    const client = sseClients.get(employeeId);
    if (!client) return false;
    try {
        writeSSEEvent(client.res, eventName, data);
        return true;
    } catch (err) {
        logger.error(`[SSE] Failed to send to ${employeeId}:`, err.message);
        removeSSEClient(employeeId);
        return false;
    }
};

/**
 * Broadcasts an SSE event to all clients whose role is in targetRoles
 * OR whose employeeId is in targetEmployeeIds.
 *
 * @param {string[]} targetRoles
 * @param {string[]} targetEmployeeIds - individual employee IDs (e.g. order creator)
 * @param {string}   eventName
 * @param {object}   data
 * @returns {number} number of clients reached
 */
const broadcastToTargets = (targetRoles, targetEmployeeIds, excludedEmployeeIds, eventName, data) => {
    let reached = 0;
    const deadList = [];

    const roleSet = new Set(targetRoles);
    const employeeSet = new Set(targetEmployeeIds);
    const excludedEmployeeSet = new Set(excludedEmployeeIds);

    for (const [employeeId, client] of sseClients.entries()) {
        if (excludedEmployeeSet.has(employeeId)) continue;

        const shouldReceive = roleSet.has(client.role) || employeeSet.has(employeeId);
        if (!shouldReceive) continue;

        try {
            writeSSEEvent(client.res, eventName, data);
            reached++;
        } catch (err) {
            logger.error(`[SSE] Dead client detected: ${employeeId}`);
            deadList.push(employeeId);
        }
    }

    deadList.forEach(removeSSEClient);

    return reached;
};

// Build + persists a Notification document and returns { notification, ssePayload }
const createNotificationRecord = async ({
    type,
    title,
    message,
    payload,
    createdBy,
    targetEmployeeIds = [],
    excludedEmployeeIds = [],
}) => {
    const notificationId = `NOTIF-${uuidv4().split("-")[0].toUpperCase()}`;
    const targetRoles = NOTIFICATION_TARGET_ROLES[type] ?? [];

    const notification = await Notification.create({
        notification_id: notificationId,
        type,
        title,
        message,
        payload,
        target_roles: targetRoles,
        target_employee_ids: targetEmployeeIds,
        excluded_employee_ids: excludedEmployeeIds,
        created_by: createdBy,
    });

    const ssePayload = {
        notification_id: notification.notification_id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        payload: notification.payload,
        created_at: notification.created_at,
    };

    return { notification, ssePayload, targetRoles, targetEmployeeIds, excludedEmployeeIds };
};

const resolveDealerDisplay = (dealer) => {
    const name = dealer?.employee_name ?? "Unknown Dealer";
    const shopPart = dealer?.shop_name ? ` (${dealer.shop_name})` : "";
    return { name, display: `${name}${shopPart}` };
};

const resolveOrderType = (orderStatus) => {
    if (orderStatus === ORDER_STATUSES.PRODUCTION) return NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION;
    if (orderStatus === ORDER_STATUSES.PACKED) return NOTIFICATION_TYPES.ORDER_CREATED_PACKED;
    return NOTIFICATION_TYPES.ORDER_CREATED_PENDING;
};

// Trigger when a new order is created.
export const notifyOrderCreated = async ({ order, dealer, createdBy }) => {
    try {
        const { name: dealerName, display: dealerDisplay } = resolveDealerDisplay(dealer);

        const type = resolveOrderType(order.status);

        const { notification, ssePayload, targetRoles, targetEmployeeIds, excludedEmployeeIds } =
            await createNotificationRecord({
                type,
                title: "New Order Received",
                message: `Order #${order.order_number} placed by ${dealerDisplay}`,
                payload: {
                    order_number: order.order_number,
                    dealer_id: order.dealer_id,
                    dealer_name: dealerName,
                    shop_name: dealer?.shop_name ?? "",
                    priority: order.priority,
                    order_total_price: order.order_total_price,
                    item_count: order.order_details?.length ?? 0,
                    created_at: order.created_at,
                    order_status: order.status,
                },
                createdBy,
                excludedEmployeeIds: [createdBy],
            });

        const reached = broadcastToTargets(targetRoles, targetEmployeeIds, excludedEmployeeIds, type, ssePayload);

        logger.info(
            `[Notification] ORDER_CREATED (${type}) → Order ${order.order_number} → ${reached} client(s)`
        );

        return notification;
    } catch (err) {
        logger.error("[Notification] notifyOrderCreated failed:", err);
        return null;
    }
};

// Trigger when an order is confirmed.
export const notifyOrderConfirmed = async ({ order, confirmedBy, createdBy }) => {
    try {
        const { notification, ssePayload, targetRoles, targetEmployeeIds, excludedEmployeeIds } =
            await createNotificationRecord({
                type: NOTIFICATION_TYPES.ORDER_CONFIRMED,
                title: "Order Confirmed",
                message: `Order #${order.order_number} has been confirmed`,
                payload: {
                    order_number: order.order_number,
                    priority: order.priority,
                    order_total_price: order.order_total_price,
                    confirmed_by: confirmedBy,
                    order_status: order.status,
                },
                createdBy: confirmedBy,
                targetEmployeeIds: [createdBy],
                excludedEmployeeIds: [confirmedBy],
            });

        const reached = broadcastToTargets(targetRoles, targetEmployeeIds, excludedEmployeeIds, NOTIFICATION_TYPES.ORDER_CONFIRMED, ssePayload);

        logger.info(
            `[Notification] ORDER_CONFIRMED → Order ${order.order_number} → ${reached} client(s)`
        );

        return notification;
    } catch (err) {
        logger.error("[Notification] notifyOrderConfirmed failed:", err);
        return null;
    }
};

// Trigger when order status changes to PRODUCTION or PACKED via update.
export const notifyOrderStatusChanged = async ({ order, newStatus, changedBy, createdBy }) => {
    try {
        const type =
            newStatus === ORDER_STATUSES.PACKED
                ? NOTIFICATION_TYPES.ORDER_STATUS_PACKED
                : NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION;

        const statusLabel = newStatus === ORDER_STATUSES.PACKED ? "Packed" : "In Production";

        const { notification, ssePayload, targetRoles, targetEmployeeIds, excludedEmployeeIds } =
            await createNotificationRecord({
                type,
                title: `Order ${statusLabel}`,
                message: `Order #${order.order_number} moved to ${statusLabel}`,
                payload: {
                    order_number: order.order_number,
                    priority: order.priority,
                    order_total_price: order.order_total_price,
                    new_status: newStatus,
                    changed_by: changedBy,
                    order_status: newStatus,
                },
                createdBy: changedBy,
                targetEmployeeIds: [createdBy],
                excludedEmployeeIds: [changedBy],
            });

        const reached = broadcastToTargets(targetRoles, targetEmployeeIds, excludedEmployeeIds, type, ssePayload);

        logger.info(
            `[Notification] ORDER_STATUS (${type}) → Order ${order.order_number} → ${reached} client(s)`
        );

        return notification;
    } catch (err) {
        logger.error("[Notification] notifyOrderStatusChanged failed:", err);
        return null;
    }
};

// Get notifications for an employee
export const getNotificationsForEmployee = async (
    employeeId,
    role,
    page = 1,
    limit = 20
) => {
    const skip = (page - 1) * limit;

    const filter = {
        $and: [
            {
                $or: [
                    { target_roles: role },
                    { target_roles: { $size: 0 } },
                    { target_employee_ids: employeeId },
                ],
            },
            {
                excluded_employee_ids: { $ne: employeeId },
            },
            {
                "read_by.employee_id": { $ne: employeeId },
            },
        ],
    };

    const [notifications, total] = await Promise.all([
        Notification.find(filter)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Notification.countDocuments(filter),
    ]);

    const enriched = notifications.map((n) => ({
        ...n,
        is_read: n.read_by.some((r) => r.employee_id === employeeId),
    }));

    return { notifications: enriched, total, page, limit };
};

export const getUnreadCount = async (employeeId, role) => {
    const filter = {
        $and: [
            {
                $or: [
                    { target_roles: role },
                    { target_roles: { $size: 0 } },
                    { target_employee_ids: employeeId },
                ],
            },
            {
                excluded_employee_ids: { $ne: employeeId },
            },
            {
                "read_by.employee_id": { $ne: employeeId },
            },
        ],
    };

    return Notification.countDocuments(filter);
};

export const markAsRead = async (notificationId, employeeId) => {
    return Notification.findOneAndUpdate(
        {
            notification_id: notificationId,
            "read_by.employee_id": { $ne: employeeId }, // prevent duplicate
        },
        {
            $push: {
                read_by: { employee_id: employeeId, read_at: new Date() },
            },
        },
        { new: true }
    );
};

export const markAllAsRead = async (employeeId, role) => {
    const filter = {
        $and: [
            {
                $or: [
                    { target_roles: role },
                    { target_roles: { $size: 0 } },
                    { target_employee_ids: employeeId },
                ],
            },
            {
                excluded_employee_ids: { $ne: employeeId },
            },
            {
                "read_by.employee_id": { $ne: employeeId },
            },
        ],
    };

    const unread = await Notification.find(filter, { notification_id: 1 }).lean();

    await Notification.updateMany(filter, {
        $push: {
            read_by: { employee_id: employeeId, read_at: new Date() },
        },
    });

    return unread.length;
};