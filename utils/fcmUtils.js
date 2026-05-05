// fcmUtils.js
import { getFirebaseMessaging } from "../config/firebaseConfig.js";
import logger from "./logger.js";

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
            notification: { sound: "default" },
        },
        apns: {
            payload: {
                aps: { sound: "default", badge: 1 },
            },
        },
    };

    try {
        const messageId = await getFirebaseMessaging().send(message);
        return messageId;
    } catch (err) {
        logger.warn(`[FCM] sendToToken failed for token ...${token.slice(-8)}: ${err.message}`);
        return null;
    }
};

export const sendToMultipleTokens = async (tokens, notification, data = {}) => {
    if (!tokens.length) return { successCount: 0, failureCount: 0, invalidTokens: [] };

    const BATCH_SIZE = 500;
    const chunks = chunkArray(tokens, BATCH_SIZE);

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
            data: stringifyData(data),
            android: {
                priority: "high",
                notification: { sound: "default" },
            },
            apns: {
                payload: {
                    aps: { sound: "default", badge: 1 },
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
                    if (
                        errCode === "messaging/registration-token-not-registered" ||
                        errCode === "messaging/invalid-registration-token"
                    ) {
                        invalidTokens.push(chunk[idx]);
                    }
                    logger.warn(`[FCM] Delivery failed for token index ${idx}: ${errCode}`);
                }
            });
        } catch (err) {
            failureCount += chunk.length;
            logger.error(`[FCM] sendEachForMulticast batch error:`, err.message);
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
    };

    try {
        const messageId = await getFirebaseMessaging().send(message);
        logger.info(`[FCM] Topic message sent to '${topic}': ${messageId}`);
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
        logger.info(`[FCM] subscribeToTopic '${topic}' → success: ${response.successCount}, fail: ${response.failureCount}`);
    } catch (err) {
        logger.error(`[FCM] subscribeToTopic failed:`, err.message);
    }
};

export const unsubscribeFromTopic = async (tokens, topic) => {
    if (!tokens.length) return;
    try {
        const response = await getFirebaseMessaging().unsubscribeFromTopic(tokens, topic);
        logger.info(`[FCM] unsubscribeFromTopic '${topic}' → success: ${response.successCount}`);
    } catch (err) {
        logger.error(`[FCM] unsubscribeFromTopic failed:`, err.message);
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