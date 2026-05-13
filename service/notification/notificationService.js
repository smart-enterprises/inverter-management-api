import logger from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import { ORDER_STATUSES } from "../../utils/constants.js";
import {
    NOTIFICATION_TYPES,
    ORDER_NOTIFICATION_TYPE_BY_STATUS,
} from "../../utils/notificationConstants.js";
import { notificationPayloadBuilder } from "./notificationPayloadBuilder.js";
import { notificationRecipientResolver } from "./notificationRecipientResolver.js";
import { notificationDispatcher } from "./notificationDispatcher.js";
import { notificationLogger } from "./notificationLogger.js";
import { deviceTokenService } from "./deviceTokenService.js";

const emptyDispatchResult = {
    total_tokens: 0,
    success_count: 0,
    failure_count: 0,
    invalid_token_count: 0,
    invalid_tokens_removed: 0,
    recipient_results: [],
};

const fireAndForget = (promise, label) => {
    Promise.resolve(promise).catch((error) => {
        logger.error(`[NotificationService] ${label} failed`, {
            error: error.message,
            stack: error.stack,
        });
    });
};

export const notificationService = {
    registerDeviceToken: (payload) => deviceTokenService.registerOrUpdateToken(payload),

    refreshDeviceToken: (payload) => deviceTokenService.refreshToken(payload),

    removeDeviceToken: (token) => deviceTokenService.deactivateToken(token),

    removeAllDeviceTokens: (employeeId) => deviceTokenService.deactivateAllTokensForEmployee(employeeId),

    listMyDeviceTokens: (employeeId) => deviceTokenService.listEmployeeTokens(employeeId),

    send: async ({
        notificationType,
        context = {},
        targetRoles,
        targetEmployeeIds = [],
        excludeEmployeeIds = [],
        triggeredBy = "SYSTEM",
        metadata = {},
    }) => {
        const notificationId = `NOTIF_${uuidv4().split("-")[0].toUpperCase()}`;
        const payload = notificationPayloadBuilder.build(notificationType, context);
        payload.data = {
            ...payload.data,
            notification_id: notificationId,
            title: payload.title,
            body: payload.body,
        };
        const resolved = await notificationRecipientResolver.resolve({
            notificationType,
            targetRoles,
            targetEmployeeIds,
            excludeEmployeeIds,
        });

        const dispatchResult = resolved.recipients.length
            ? await notificationDispatcher.sendMulticast({ recipients: resolved.recipients, payload })
            : emptyDispatchResult;

        const log = await notificationLogger.write({
            notificationType,
            payload,
            context,
            triggeredBy,
            targetRoles: resolved.roles,
            targetEmployeeIds: resolved.employeeIds,
            dispatchResult,
            metadata,
        });

        return {
            notification_log_id: log.notification_log_id,
            status: log.status,
            target_roles: resolved.roles,
            target_employee_ids: resolved.employeeIds,
            ...dispatchResult,
        };
    },

    sendOrderCreated: async ({ order, dealer, salesman, triggeredBy }) => {
        const notificationType =
            order.status === ORDER_STATUSES.PENDING
                ? NOTIFICATION_TYPES.ORDER_CREATED_PENDING
                : order.status === ORDER_STATUSES.PRODUCTION
                    ? NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION
                    : NOTIFICATION_TYPES.ORDER_CREATED_PACKED;

        return notificationService.send({
            notificationType,
            context: {
                order_number: order.order_number,
                dealer_name: dealer?.shop_name || dealer?.employee_name,
                salesman_name: salesman?.employee_name || order.salesman_id || order.created_by,
                priority: order.priority,
                order_status: order.status,
            },
            targetEmployeeIds: [order.salesman_id, order.created_by],
            excludeEmployeeIds: [triggeredBy],
            triggeredBy,
            metadata: { source: "order_created" },
        });
    },

    sendOrderStatusChanged: async ({ order, previousStatus, triggeredBy, triggeredByName, dealer }) => {
        const notificationType = ORDER_NOTIFICATION_TYPE_BY_STATUS[order.status];
        if (!notificationType) return null;

        return notificationService.send({
            notificationType,
            context: {
                order_number: order.order_number,
                dealer_name: dealer?.shop_name || dealer?.employee_name,
                priority: order.priority,
                order_status: order.status,
                triggered_by_name: triggeredByName || triggeredBy,
            },
            targetEmployeeIds: [order.salesman_id, order.created_by],
            excludeEmployeeIds: [triggeredBy],
            triggeredBy,
            metadata: {
                source: "order_status_changed",
                previous_status: previousStatus,
                new_status: order.status,
            },
        });
    },

    sendProductionCompleted: async ({
        order,
        triggeredBy,
        triggeredByName,
        dealer,
    }) => {
        return notificationService.send({
            notificationType: NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION_COMPLETED,
            context: {
                order_number: order.order_number,
                dealer_name: dealer?.shop_name || dealer?.employee_name,
                priority: order.priority,
                order_status: order.status,
                triggered_by_name: triggeredByName || triggeredBy,
            },
            targetEmployeeIds: [order.salesman_id, order.created_by],
            excludeEmployeeIds: [triggeredBy],
            triggeredBy,
            metadata: {
                source: "production_completed",
                order_status: order.status,
            },
        });
    },

    sendOrderCreatedAsync: (payload) => fireAndForget(
        notificationService.sendOrderCreated(payload),
        "Order created notification"
    ),

    sendOrderStatusChangedAsync: (payload) => fireAndForget(
        notificationService.sendOrderStatusChanged(payload),
        "Order status notification"
    ),

    sendProductionCompletedAsync: (payload) => fireAndForget(
        notificationService.sendProductionCompleted(payload),
        "Production completed notification"
    ),
};
