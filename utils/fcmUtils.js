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

const buildMulticastMessage = ({ tokens, notification, data, orderNumber }) => ({
    tokens,
    notification: {
        title: notification.title,
        body: notification.body,
    },
    data,
    android: {
        priority: "high",
        notification: {
            sound: "default",
            channelId: "order_notifications",
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            defaultSound: true,
            defaultVibrateTimings: true,
        },
    },
    apns: {
        headers: {
            "apns-priority": "10",
        },
        payload: {
            aps: {
                sound: "default",
                badge: 1,
                contentAvailable: true,
                mutableContent: true,
            },
        },
    },
    webpush: {
        headers: {
            Urgency: "high",
        },
        notification: {
            icon: "/logo192.png",
            badge: "/logo192.png",
            requireInteraction: false,
            vibrate: [200, 100, 200],
        },
        fcmOptions: {
            link: orderNumber ? `/orders/${orderNumber}` : "/",
        },
    },
});

export const sendToToken = async (token, notification, data = {}) => {
    const stringData = stringifyData(data);
    const orderNumber = data.order_number;

    const message = {
        token,
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
                link: orderNumber ? `/orders/${orderNumber}` : "/",
            },
        },
    };

    try {
        const messageId = await getFirebaseMessaging().send(message);
        logger.info(`[FCM] sendToToken success | messageId: ${messageId}`);
        return messageId;
    } catch (err) {
        logger.warn(
            `[FCM] sendToToken failed | token: ...${token.slice(-8)} | error: ${err.message}`
        );
        return null;
    }
};

export const sendToMultipleTokens = async (tokens, notification, data = {}) => {
    if (!Array.isArray(tokens) || !tokens.length) {
        logger.warn("[FCM] sendToMultipleTokens called with empty tokens array");
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const chunks = chunkArray(tokens, BATCH_SIZE);
    const stringData = stringifyData(data);
    const orderNumber = data.order_number;

    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];

    for (const chunk of chunks) {
        const message = buildMulticastMessage({
            tokens: chunk,
            notification,
            data: stringData,
            orderNumber,
        });

        try {
            const response = await getFirebaseMessaging().sendEachForMulticast(message);
            successCount += response.successCount;
            failureCount += response.failureCount;

            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errCode = resp.error?.code ?? "";
                    const errMsg = resp.error?.message ?? "unknown";

                    logger.warn(
                        `[FCM] Token delivery failed | index=${idx} | code=${errCode} | msg=${errMsg}`
                    );

                    if (INVALID_TOKEN_CODES.has(errCode)) {
                        logger.info(`[FCM] Marking token index ${idx} as invalid for cleanup`);
                        invalidTokens.push(chunk[idx]);
                    }
                }
            });
        } catch (err) {
            failureCount += chunk.length;
            logger.error(
                `[FCM] Batch sendEachForMulticast error | chunk size=${chunk.length} | error: ${err.message}`
            );
        }
    }

    logger.info(
        `[FCM] sendToMultipleTokens complete | total=${tokens.length} | ✅ ${successCount} | ❌ ${failureCount} | invalid=${invalidTokens.length}`
    );

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
        logger.info(`[FCM] sendToTopic('${topic}') | messageId: ${messageId}`);
        return messageId;
    } catch (err) {
        logger.error(`[FCM] sendToTopic('${topic}') failed | error: ${err.message}`);
        return null;
    }
};

export const subscribeToTopic = async (tokens, topic) => {
    if (!tokens.length) return;
    try {
        const response = await getFirebaseMessaging().subscribeToTopic(tokens, topic);
        logger.info(
            `[FCM] subscribeToTopic('${topic}') | success=${response.successCount} | fail=${response.failureCount}`
        );
    } catch (err) {
        logger.error(`[FCM] subscribeToTopic('${topic}') failed | error: ${err.message}`);
    }
};

export const unsubscribeFromTopic = async (tokens, topic) => {
    if (!tokens.length) return;
    try {
        const response = await getFirebaseMessaging().unsubscribeFromTopic(tokens, topic);
        logger.info(
            `[FCM] unsubscribeFromTopic('${topic}') | success=${response.successCount} | fail=${response.failureCount}`
        );
    } catch (err) {
        logger.error(`[FCM] unsubscribeFromTopic('${topic}') failed | error: ${err.message}`);
    }
};