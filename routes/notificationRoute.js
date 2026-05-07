// routes/notificationRoute.js
import express from "express";
import rateLimit from "express-rate-limit";
import { verifyToken } from "../middleware/verifyToken.js";
import firebaseNotificationController from "../controllers/firebaseNotificationController.js";

const router = express.Router();

const unreadCountLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many unread count requests." },
});

const listLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many notification list requests." },
});

const tokenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many token registration requests." },
});

const markReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many mark-read requests." },
});

const cacheShort = (req, res, next) => {
    res.set("Cache-Control", "private, max-age=10");
    next();
};

const cacheMedium = (req, res, next) => {
    res.set("Cache-Control", "private, max-age=5");
    next();
};

const noCache = (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
};

router.use(verifyToken);

router.post(
    "/register-token",
    tokenLimiter,
    noCache,
    firebaseNotificationController.registerToken
);

router.put(
    "/deregister-token",
    tokenLimiter,
    noCache,
    firebaseNotificationController.deregisterToken
);

router.get(
    "/unread-count",
    unreadCountLimiter,
    cacheShort,
    firebaseNotificationController.getUnreadCount
);

router.put(
    "/mark-all-read",
    markReadLimiter,
    noCache,
    firebaseNotificationController.markAllAsRead
);

router.get(
    "/",
    listLimiter,
    cacheMedium,
    firebaseNotificationController.getAll
);

router.put(
    "/:notificationId/read",
    markReadLimiter,
    noCache,
    firebaseNotificationController.markAsRead
);

export default router;