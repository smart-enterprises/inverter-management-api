// firebaseConfig.js
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
        return admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        });
    }

    if (FIREBASE_SERVICE_ACCOUNT_PATH) {
        const serviceAccount = JSON.parse(
            readFileSync(resolve(FIREBASE_SERVICE_ACCOUNT_PATH), "utf8")
        );
        return admin.credential.cert(serviceAccount);
    }

    return admin.credential.applicationDefault();
};

export const initializeFirebase = () => {
    if (admin.apps.length > 0) {
        firebaseApp = admin.apps[0];
        return firebaseApp;
    }

    try {
        firebaseApp = admin.initializeApp({ credential: resolveCredential() });
        logger.info("[Firebase] Admin SDK initialized successfully");
        return firebaseApp;
    } catch (err) {
        logger.error("[Firebase] Failed to initialize Admin SDK:", err.message);
        throw err;
    }
};

export const getFirebaseMessaging = () => {
    if (!firebaseApp) {
        throw new Error("[Firebase] App not initialized. Call initializeFirebase() first.");
    }
    return admin.messaging(firebaseApp);
};

export default admin;