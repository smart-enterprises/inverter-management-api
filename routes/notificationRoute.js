// routes/notificationRoute.js
import express from "express";
import { verifyToken } from "../middleware/verifyToken.js";
import notificationController from "../controllers/notificationController.js";

const router = express.Router();

// SSE stream
router.get("/stream", verifyToken, notificationController.stream);

// REST endpoints
router.use(verifyToken);

router.get("/", notificationController.getAll);
router.get("/unread-count", notificationController.getUnreadCount);
router.get("/health", notificationController.health);

// admin and superadmin only
router.put("/mark-all-read", notificationController.markAllAsRead);
router.put("/:notificationId/read", notificationController.markAsRead);

export default router;