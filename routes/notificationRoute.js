// routes/notificationRoute.js
import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import firebaseNotificationController from "../controllers/firebaseNotificationController.js";

const router = express.Router();

router.use(verifyToken);

router.post("/register-token", firebaseNotificationController.registerToken);

router.delete("/deregister-token", firebaseNotificationController.deregisterToken);

router.get("/", firebaseNotificationController.getAll);
router.get("/unread-count", firebaseNotificationController.getUnreadCount);

router.put("/:notificationId/read", firebaseNotificationController.markAsRead);

router.put("/mark-all-read", firebaseNotificationController.markAllAsRead);

export default router;