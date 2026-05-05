// controllers/firebaseNotification.controller.js
import asyncHandler from "express-async-handler";
import { getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import {
    getNotificationsForEmployee,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
} from "../service/firebaseNotificationService.js";
import {
    registerToken,
    deregisterToken,
} from "../service/deviceTokenService.js";
import { BadRequestException } from "../middleware/CustomError.js";
import logger from "../utils/logger.js";

const nowIST = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

const firebaseNotificationController = {
    registerToken: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const { token, platform } = req.body;

        if (!token || typeof token !== "string") {
            throw new BadRequestException("FCM token is required");
        }

        await registerToken(employeeId, token, platform ?? "android", employeeRole);

        logger.info(`[FCM] Token registered for employee ${employeeId}`);

        return res.status(200).json({
            success: true,
            message: "FCM token registered successfully",
            timestamp: nowIST(),
        });
    }),

    deregisterToken: asyncHandler(async (req, res) => {
        const { employeeRole } = getAuthenticatedEmployeeContext();
        const { token } = req.body;

        if (!token || typeof token !== "string") {
            throw new BadRequestException("FCM token is required");
        }

        await deregisterToken(token, employeeRole);

        return res.status(200).json({
            success: true,
            message: "FCM token removed successfully",
            timestamp: nowIST(),
        });
    }),

    getAll: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

        const result = await getNotificationsForEmployee(employeeId, employeeRole, page, limit);

        return res.status(200).json({
            success: true,
            data: result,
            timestamp: nowIST(),
        });
    }),

    getUnreadCount: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const count = await getUnreadCount(employeeId, employeeRole);

        return res.status(200).json({
            success: true,
            data: { count },
            timestamp: nowIST(),
        });
    }),

    markAsRead: asyncHandler(async (req, res) => {
        const { employeeId } = getAuthenticatedEmployeeContext();
        const { notificationId } = req.params;

        if (!notificationId) {
            throw new BadRequestException("notificationId param is required");
        }

        await markAsRead(notificationId, employeeId);

        return res.status(200).json({
            success: true,
            message: "Notification marked as read",
            timestamp: nowIST(),
        });
    }),

    markAllAsRead: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const count = await markAllAsRead(employeeId, employeeRole);

        return res.status(200).json({
            success: true,
            message: `${count} notification(s) marked as read`,
            timestamp: nowIST(),
        });
    }),
};

export default firebaseNotificationController;