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
    ENVIRONMENT,
} from "../utils/constants.js";

let firebaseApp = null;

export const initializeFirebase = () => {
    if (firebaseApp) {
        logger.info("[Firebase] Already initialized — skipping.");
        return firebaseApp;
    }

    try {
        let credential;

        if (FIREBASE_SERVICE_ACCOUNT_PATH) {
            const serviceAccount = JSON.parse(
                readFileSync(resolve(FIREBASE_SERVICE_ACCOUNT_PATH), "utf8")
            );
            credential = admin.credential.cert(serviceAccount);
            logger.info("[Firebase] Initialized via service account file.");
        } else if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
            credential = admin.credential.cert({
                projectId: FIREBASE_PROJECT_ID,
                clientEmail: FIREBASE_CLIENT_EMAIL,
                privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            });
            logger.info("[Firebase] Initialized via environment variables.");
        } else {
            throw new Error(
                "Firebase credentials missing. Provide FIREBASE_SERVICE_ACCOUNT_PATH " +
                "or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY."
            );
        }

        firebaseApp = admin.initializeApp({ credential });
        logger.info(`[Firebase] App initialized for project: ${FIREBASE_PROJECT_ID || "from-file"}`);
        return firebaseApp;

    } catch (error) {
        logger.error("[Firebase] Initialization failed:", { error: error.message });
        if (ENVIRONMENT === "production") process.exit(1);
        return null;
    }
};

export const getMessaging = () => {
    if (!admin.apps.length) {
        throw new Error("[Firebase] Not initialized. Call initializeFirebase() first.");
    }
    return admin.messaging();
};

export default { initializeFirebase, getMessaging };