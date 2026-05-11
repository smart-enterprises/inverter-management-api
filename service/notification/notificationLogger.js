import { v4 as uuidv4 } from "uuid";
import NotificationLog from "../../models/notificationLog.js";
import { NOTIFICATION_LOG_STATUS } from "../../utils/notificationConstants.js";

const resolveLogStatus = ({ total_tokens, success_count }) => {
    if (!total_tokens) return NOTIFICATION_LOG_STATUS.SKIPPED;
    if (success_count === total_tokens) return NOTIFICATION_LOG_STATUS.SENT;
    if (success_count > 0) return NOTIFICATION_LOG_STATUS.PARTIAL;
    return NOTIFICATION_LOG_STATUS.FAILED;
};

export const notificationLogger = {
    write: async ({
        notificationType,
        payload,
        context = {},
        triggeredBy = "SYSTEM",
        targetRoles = [],
        targetEmployeeIds = [],
        dispatchResult,
        metadata = {},
    }) => NotificationLog.create({
        notification_log_id: payload.data?.notification_id || `NOTIF_LOG_${uuidv4().split("-")[0].toUpperCase()}`,
        notification_type: notificationType,
        title: payload.title,
        body: payload.body,
        order_number: context.order_number || null,
        triggered_by: triggeredBy || "SYSTEM",
        target_roles: targetRoles,
        target_employee_ids: targetEmployeeIds,
        total_tokens: dispatchResult.total_tokens,
        success_count: dispatchResult.success_count,
        failure_count: dispatchResult.failure_count,
        invalid_token_count: dispatchResult.invalid_token_count,
        status: resolveLogStatus(dispatchResult),
        recipient_results: dispatchResult.recipient_results,
        payload_snapshot: payload,
        metadata,
    }),
};
