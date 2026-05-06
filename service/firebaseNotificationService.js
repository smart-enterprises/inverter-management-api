// service/firebaseNotificationService.js
import { v4 as uuidv4 } from "uuid";
import Notification, {
    NOTIFICATION_TYPES,
    NOTIFICATION_TARGET_ROLES,
} from "../models/notification.js";
import {
    getTokensForRoles,
    getTokensForEmployees,
    deactivateInvalidTokens,
} from "./deviceTokenService.js";
import { ORDER_STATUSES } from "../utils/constants.js";
import { sendToMultipleTokens } from "../utils/fcmUtils.js";
import logger from "../utils/logger.js";

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

    logger.debug(`[FCM] createNotificationRecord | type=${type} | targetRoles=${JSON.stringify(targetRoles)}`);

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

    return { notification, targetRoles, targetEmployeeIds, excludedEmployeeIds };
};

const buildFcmData = (notification) => ({
    notification_id: notification.notification_id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    payload: JSON.stringify(notification.payload ?? {}),
    created_at: notification.created_at?.toISOString() ?? new Date().toISOString(),
});

const dispatchFcmNotification = async ({
    targetRoles,
    targetEmployeeIds,
    excludedEmployeeIds,
    notification,
}) => {
    const excludedSet = new Set((excludedEmployeeIds ?? []).map((id) => id?.toString()));

    logger.debug(
        `[FCM] dispatchFcmNotification | roles=${JSON.stringify(targetRoles)} | ` +
        `targetEmployees=${JSON.stringify(targetEmployeeIds)} | ` +
        `excluded=${JSON.stringify([...excludedSet])}`
    );

    const roleTokens = await getTokensForRoles(targetRoles);

    const filteredEmployeeIds = (targetEmployeeIds ?? [])
        .map((id) => id?.toString())
        .filter((id) => !excludedSet.has(id));

    const employeeTokens = await getTokensForEmployees(filteredEmployeeIds);
    logger.debug(
        `[FCM] Token query results | ` +
        `roleTokens=${roleTokens.length} | employeeTokens=${employeeTokens.length}`
    );

    const allTokens = [...new Set([...roleTokens, ...employeeTokens])];

    if (!allTokens.length) {
        logger.info(`[FCM] No registered tokens for notification ${notification.notification_id}`);

        logger.warn(
            `[FCM] No registered tokens for notification ${notification.notification_id}. ` +
            `Queried roles: ${JSON.stringify(targetRoles)}. ` +
            `This usually means: (1) no devices have registered tokens for these roles, ` +
            `(2) NOTIFICATION_TARGET_ROLES is missing an entry for type="${notification.type}", ` +
            `or (3) the role strings in device_tokens don't match NOTIFICATION_TARGET_ROLES values.`
        );
        return { successCount: 0, failureCount: 0 };
    }

    const fcmNotification = {
        title: notification.title,
        body: notification.message,
    };

    const { successCount, failureCount, invalidTokens } = await sendToMultipleTokens(
        allTokens,
        fcmNotification,
        buildFcmData(notification)
    );

    if (invalidTokens.length) {
        await deactivateInvalidTokens(invalidTokens);
    }

    logger.info(
        `[FCM] '${notification.type}' → ${notification.notification_id} | ` +
        `Tokens: ${allTokens.length} | ✅ ${successCount} | ❌ ${failureCount}`
    );

    return { successCount, failureCount };
};

const resolveDealerDisplay = (dealer) => {
    const name = dealer?.employee_name ?? "Unknown Dealer";
    const shopPart = dealer?.shop_name ? ` (${dealer.shop_name})` : "";
    return { name, display: `${name}${shopPart}` };
};

const resolveOrderCreatedType = (orderStatus) => {
    if (orderStatus === ORDER_STATUSES.PRODUCTION)
        return NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION;
    if (orderStatus === ORDER_STATUSES.PACKED)
        return NOTIFICATION_TYPES.ORDER_CREATED_PACKED;
    return NOTIFICATION_TYPES.ORDER_CREATED_PENDING;
};

export const notifyOrderCreated = async ({ order, dealer, createdBy }) => {
    try {
        const { name: dealerName, display: dealerDisplay } = resolveDealerDisplay(dealer);
        const type = resolveOrderCreatedType(order.status);

        const { notification, targetRoles, targetEmployeeIds, excludedEmployeeIds } =
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

        await dispatchFcmNotification({
            targetRoles,
            targetEmployeeIds,
            excludedEmployeeIds,
            notification,
        });

        return notification;
    } catch (err) {
        logger.error("[FCM] notifyOrderCreated failed:", err);
        return null;
    }
};

export const notifyOrderConfirmed = async ({ order, confirmedBy, createdBy }) => {
    try {
        const { notification, targetRoles, targetEmployeeIds, excludedEmployeeIds } =
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

        await dispatchFcmNotification({
            targetRoles,
            targetEmployeeIds,
            excludedEmployeeIds,
            notification,
        });

        return notification;
    } catch (err) {
        logger.error("[FCM] notifyOrderConfirmed failed:", err);
        return null;
    }
};

export const notifyOrderStatusChanged = async ({
    order,
    newStatus,
    changedBy,
    createdBy,
}) => {
    try {
        const type =
            newStatus === ORDER_STATUSES.PACKED
                ? NOTIFICATION_TYPES.ORDER_STATUS_PACKED
                : NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION;

        const statusLabel =
            newStatus === ORDER_STATUSES.PACKED ? "Packed" : "In Production";

        const { notification, targetRoles, targetEmployeeIds, excludedEmployeeIds } =
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

        await dispatchFcmNotification({
            targetRoles,
            targetEmployeeIds,
            excludedEmployeeIds,
            notification,
        });

        return notification;
    } catch (err) {
        logger.error("[FCM] notifyOrderStatusChanged failed:", err);
        return null;
    }
};

const buildEmployeeNotificationFilter = (employeeId, role) => ({
    $and: [
        {
            $or: [
                { target_roles: role },
                { target_roles: { $size: 0 } },
                { target_employee_ids: employeeId },
            ],
        },
        { excluded_employee_ids: { $ne: employeeId } },
    ],
});

const buildUnreadFilter = (employeeId, role) => ({
    ...buildEmployeeNotificationFilter(employeeId, role),
    $and: [
        ...(buildEmployeeNotificationFilter(employeeId, role).$and ?? []),
        { "read_by.employee_id": { $ne: employeeId } },
    ],
});

export const getNotificationsForEmployee = async (
    employeeId,
    role,
    page = 1,
    limit = 20
) => {
    const skip = (page - 1) * limit;
    const filter = buildEmployeeNotificationFilter(employeeId, role);

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
    const filter = buildUnreadFilter(employeeId, role);
    return Notification.countDocuments(filter);
};

export const markAsRead = async (notificationId, employeeId) => {
    return Notification.findOneAndUpdate(
        {
            notification_id: notificationId,
            "read_by.employee_id": { $ne: employeeId },
        },
        {
            $push: { read_by: { employee_id: employeeId, read_at: new Date() } },
        },
        { new: true }
    );
};

export const markAllAsRead = async (employeeId, role) => {
    const filter = buildUnreadFilter(employeeId, role);

    const result = await Notification.updateMany(filter, {
        $push: { read_by: { employee_id: employeeId, read_at: new Date() } },
    });

    return result.modifiedCount ?? 0;
};