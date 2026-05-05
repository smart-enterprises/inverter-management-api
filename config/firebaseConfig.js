// config/firebaseConfig.js
import admin from "firebase-admin";
import { readFileSync } from "fs";
import { resolve } from "path";
import logger from "../utils/logger.js";
import {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_PATH,
} from "../utils/constants.js";

let firebaseApp = null;

const resolveCredential = () => {
    if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
        logger.info("[Firebase] Using env-var credentials");
        return admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        });
    }

    if (FIREBASE_SERVICE_ACCOUNT_PATH) {
        logger.info("[Firebase] Using service-account file credentials");
        const serviceAccount = JSON.parse(
            readFileSync(resolve(FIREBASE_SERVICE_ACCOUNT_PATH), "utf8")
        );
        return admin.credential.cert(serviceAccount);
    }

    logger.warn("[Firebase] Falling back to Application Default Credentials");
    return admin.credential.applicationDefault();
};

export const initializeFirebase = () => {
    if (admin.apps.length > 0) {
        firebaseApp = admin.apps[0];
        logger.info("[Firebase] Admin SDK already initialised — reusing existing app");
        return firebaseApp;
    }

    try {
        firebaseApp = admin.initializeApp({ credential: resolveCredential() });
        logger.info("[Firebase] Admin SDK initialised successfully");
        return firebaseApp;
    } catch (err) {
        logger.error("[Firebase] Failed to initialise Admin SDK:", err.message);
        throw err;
    }
};

export const getFirebaseMessaging = () => {
    if (!firebaseApp) {
        throw new Error(
            "[Firebase] App not initialised. Call initializeFirebase() before using messaging."
        );
    }
    return admin.messaging(firebaseApp);
};

export default admin;