// utils/fcmUtils.js
import { getFirebaseMessaging } from "../config/firebaseConfig.js";
import logger from "./logger.js";

const BATCH_SIZE = 500;

const INVALID_TOKEN_CODES = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
    "messaging/mismatched-credential",
]);

export const sendToToken = async (token, notification, data = {}) => {
    const message = {
        token,
        notification: {
            title: notification.title,
            body: notification.body,
        },
        data: stringifyData(data),
        android: {
            priority: "high",
            notification: {
                sound: "default",
                channelId: "order_notifications",
                clickAction: "FLUTTER_NOTIFICATION_CLICK",
            },
        },
        apns: {
            payload: {
                aps: {
                    sound: "default",
                    badge: 1,
                    contentAvailable: true,
                },
            },
        },
        webpush: {
            notification: {
                icon: "/logo192.png",
                badge: "/logo192.png",
                requireInteraction: false,
                vibrate: [200, 100, 200],
            },
            fcmOptions: {
                link: data.order_number ? `/orders/${data.order_number}` : "/",
            },
        },
    };

    try {
        const messageId = await getFirebaseMessaging().send(message);
        logger.info(`[FCM] sendToToken → messageId: ${messageId}`);
        return messageId;
    } catch (err) {
        logger.warn(
            `[FCM] sendToToken failed for token ...${token.slice(-8)}: ${err.message}`
        );
        return null;
    }
};

export const sendToMultipleTokens = async (tokens, notification, data = {}) => {
    if (!tokens.length) {
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const chunks = chunkArray(tokens, BATCH_SIZE);
    const stringData = stringifyData(data);

    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];

    for (const chunk of chunks) {
        const message = {
            tokens: chunk,
            notification: {
                title: notification.title,
                body: notification.body,
            },
            data: stringData,
            android: {
                priority: "high",
                notification: {
                    sound: "default",
                    channelId: "order_notifications",
                    clickAction: "FLUTTER_NOTIFICATION_CLICK",
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                        badge: 1,
                        contentAvailable: true,
                    },
                },
            },
            webpush: {
                notification: {
                    icon: "/logo192.png",
                    badge: "/logo192.png",
                    requireInteraction: false,
                    vibrate: [200, 100, 200],
                },
                fcmOptions: {
                    link: data.order_number ? `/orders/${data.order_number}` : "/",
                },
            },
        };

        try {
            const response = await getFirebaseMessaging().sendEachForMulticast(message);
            successCount += response.successCount;
            failureCount += response.failureCount;

            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errCode = resp.error?.code ?? "";
                    logger.warn(
                        `[FCM] Delivery failed — token index ${idx} | ` +
                        `code: ${errCode} | message: ${resp.error?.message ?? "unknown"}`
                    );
                    if (INVALID_TOKEN_CODES.has(errCode)) {
                        invalidTokens.push(chunk[idx]);
                    }
                }
            });
        } catch (err) {
            failureCount += chunk.length;
            logger.error("[FCM] sendEachForMulticast batch error:", err.message);
        }
    }

    return { successCount, failureCount, invalidTokens };
};

export const sendToTopic = async (topic, notification, data = {}) => {
    const message = {
        topic,
        notification: {
            title: notification.title,
            body: notification.body,
        },
        data: stringifyData(data),
        android: {
            priority: "high",
            notification: {
                sound: "default",
                channelId: "order_notifications",
            },
        },
        apns: {
            payload: {
                aps: { sound: "default", badge: 1 },
            },
        },
    };

    try {
        const messageId = await getFirebaseMessaging().send(message);
        logger.info(`[FCM] sendToTopic('${topic}') → messageId: ${messageId}`);
        return messageId;
    } catch (err) {
        logger.error(`[FCM] sendToTopic('${topic}') failed:`, err.message);
        return null;
    }
};

export const subscribeToTopic = async (tokens, topic) => {
    if (!tokens.length) return;
    try {
        const response = await getFirebaseMessaging().subscribeToTopic(tokens, topic);
        logger.info(
            `[FCM] subscribeToTopic('${topic}') → ` +
            `success: ${response.successCount} | fail: ${response.failureCount}`
        );
    } catch (err) {
        logger.error(`[FCM] subscribeToTopic('${topic}') failed:`, err.message);
    }
};

export const unsubscribeFromTopic = async (tokens, topic) => {
    if (!tokens.length) return;
    try {
        const response = await getFirebaseMessaging().unsubscribeFromTopic(tokens, topic);
        logger.info(
            `[FCM] unsubscribeFromTopic('${topic}') → ` +
            `success: ${response.successCount} | fail: ${response.failureCount}`
        );
    } catch (err) {
        logger.error(`[FCM] unsubscribeFromTopic('${topic}') failed:`, err.message);
    }
};

const stringifyData = (data = {}) =>
    Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
            k,
            typeof v === "string" ? v : JSON.stringify(v),
        ])
    );

const chunkArray = (arr, size) => {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
};