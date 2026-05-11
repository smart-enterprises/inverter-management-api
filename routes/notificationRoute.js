import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import { notificationRateLimiter } from "../middleware/rateLimiter.js";
import { sanitizeInputBody } from "../utils/validationUtils.js";
import notificationController from "../controllers/notificationController.js";
import {
    refreshDeviceTokenValidation,
    registerDeviceTokenValidation,
    removeDeviceTokenValidation,
    sendNotificationValidation,
} from "../validations/notificationValidation.js";

const router = express.Router();

router.use(verifyToken);
router.use(notificationRateLimiter);
router.use(sanitizeInputBody);

router.post("/devices", registerDeviceTokenValidation, notificationController.registerDeviceToken);
router.put("/devices/refresh", refreshDeviceTokenValidation, notificationController.refreshDeviceToken);
router.delete("/devices", removeDeviceTokenValidation, notificationController.removeDeviceToken);
router.delete("/devices/me", notificationController.removeAllMyDeviceTokens);
router.get("/devices/me", notificationController.listMyDeviceTokens);
router.post("/send", sendNotificationValidation, notificationController.sendNotification);

export default router;
