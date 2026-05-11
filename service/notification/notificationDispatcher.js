import { getMessaging } from "../../config/firebaseConfig.js";
import logger from "../../utils/logger.js";
import {
    FIREBASE_INVALID_TOKEN_CODES,
    FIREBASE_RETRYABLE_ERROR_CODES,
} from "../../utils/notificationConstants.js";
import { deviceTokenService } from "./deviceTokenService.js";

const FCM_MAX_TOKENS_PER_BATCH = 500;

const chunk = (items, size) => {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

const buildMessage = ({ tokens, payload }) => ({
    tokens,
    notification: {
        title: payload.title,
        body: payload.body,
    },
    data: payload.data || {},
    android: {
        priority: "high",
        notification: {
            sound: "default",
            channelId: "orders",
        },
    },
    apns: {
        payload: {
            aps: {
                sound: "default",
                contentAvailable: true,
            },
        },
    },
    webpush: {
        notification: {
            title: payload.title,
            body: payload.body,
            icon: "/icons/notification-icon.png",
        },
    },
});

const sendBatch = async ({ tokens, payload }) => {
    const messaging = getMessaging();
    return messaging.sendEachForMulticast(buildMessage({ tokens, payload }));
};

export const notificationDispatcher = {
    sendMulticast: async ({ recipients = [], payload, retry = true }) => {
        const recipientByToken = new Map(recipients.map((recipient) => [recipient.token, recipient]));
        const results = [];
        const invalidTokens = [];

        for (const tokenBatch of chunk([...recipientByToken.keys()], FCM_MAX_TOKENS_PER_BATCH)) {
            const response = await sendBatch({ tokens: tokenBatch, payload });
            const retryTokens = [];

            response.responses.forEach((item, index) => {
                const token = tokenBatch[index];
                const recipient = recipientByToken.get(token);
                const errorCode = item.error?.code || null;

                if (item.success) {
                    results.push({ employee_id: recipient?.employee_id, token, status: "sent" });
                    return;
                }

                if (FIREBASE_INVALID_TOKEN_CODES.has(errorCode)) {
                    invalidTokens.push(token);
                    results.push({
                        employee_id: recipient?.employee_id,
                        token,
                        status: "invalid_token",
                        error_code: errorCode,
                        error_message: item.error?.message,
                    });
                    return;
                }

                if (retry && FIREBASE_RETRYABLE_ERROR_CODES.has(errorCode)) {
                    retryTokens.push(token);
                    return;
                }

                results.push({
                    employee_id: recipient?.employee_id,
                    token,
                    status: "failed",
                    error_code: errorCode,
                    error_message: item.error?.message,
                });
            });

            if (retryTokens.length) {
                try {
                    const retryResponse = await sendBatch({ tokens: retryTokens, payload });

                    retryResponse.responses.forEach((item, index) => {
                        const token = retryTokens[index];
                        const recipient = recipientByToken.get(token);
                        const errorCode = item.error?.code || null;

                        if (item.success) {
                            results.push({ employee_id: recipient?.employee_id, token, status: "sent" });
                        } else if (FIREBASE_INVALID_TOKEN_CODES.has(errorCode)) {
                            invalidTokens.push(token);
                            results.push({
                                employee_id: recipient?.employee_id,
                                token,
                                status: "invalid_token",
                                error_code: errorCode,
                                error_message: item.error?.message,
                            });
                        } else {
                            results.push({
                                employee_id: recipient?.employee_id,
                                token,
                                status: "failed",
                                error_code: errorCode,
                                error_message: item.error?.message,
                            });
                        }
                    });
                } catch (error) {
                    logger.error("[NotificationDispatcher] Retry batch failed", { error: error.message });
                    retryTokens.forEach((token) => {
                        const recipient = recipientByToken.get(token);
                        results.push({
                            employee_id: recipient?.employee_id,
                            token,
                            status: "failed",
                            error_code: error.code || "retry_failed",
                            error_message: error.message,
                        });
                    });
                }
            }
        }

        if (invalidTokens.length) {
            await deviceTokenService.removeBulkInvalidTokens(invalidTokens);
        }

        return {
            total_tokens: recipients.length,
            success_count: results.filter((result) => result.status === "sent").length,
            failure_count: results.filter((result) => result.status === "failed").length,
            invalid_token_count: results.filter((result) => result.status === "invalid_token").length,
            invalid_tokens_removed: invalidTokens.length,
            recipient_results: results,
        };
    },
};
