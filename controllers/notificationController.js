// controllers/notificationController.js
import asyncHandler from "express-async-handler";
import { getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import {
    registerSSEClient,
    removeSSEClient,
    getNotificationsForEmployee,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    getConnectedClientCount,
} from "../service/notificationService.js";
import { setupSSEHeaders, sendHeartbeat } from "../middleware/sseMiddleware.js";
import logger from "../utils/logger.js";

const notificationController = {
    // GET /notifications/stream
    stream: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        setupSSEHeaders(req, res);
        registerSSEClient(employeeId, employeeRole, res);

        // Send initial "connected" event with unread count
        const unreadCount = await getUnreadCount(employeeId, employeeRole);

        res.write(`event: connected\n`);
        res.write(
            `data: ${JSON.stringify({
                message: "SSE connection established",
                unread_count: unreadCount,
                timestamp: new Date().toISOString(),
            })}\n\n`
        );

        // Heartbeat every 25 s to keep proxy/browser connections alive
        const heartbeatInterval = setInterval(() => sendHeartbeat(res), 25_000);

        // Cleanup on client disconnect
        req.on("close", () => {
            clearInterval(heartbeatInterval);
            removeSSEClient(employeeId);
        });

        req.on("error", (err) => {
            logger.error(`[SSE] Connection error for ${employeeId}:`, err.message);
            clearInterval(heartbeatInterval);
            removeSSEClient(employeeId);
        });
    }),

    // GET /notifications
    getAll: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;

        const result = await getNotificationsForEmployee(
            employeeId,
            employeeRole,
            page,
            limit
        );

        return res.status(200).json({
            success: true,
            data: result,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    // GET /notifications/unread-count
    getUnreadCount: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const count = await getUnreadCount(employeeId, employeeRole);

        return res.status(200).json({
            success: true,
            data: { count },
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    // PUT /notifications/:notificationId/read
    markAsRead: asyncHandler(async (req, res) => {
        const { employeeId } = getAuthenticatedEmployeeContext();
        const { notificationId } = req.params;

        await markAsRead(notificationId, employeeId);

        return res.status(200).json({
            success: true,
            message: "Notification marked as read",
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    // PUT /notifications/mark-all-read
    markAllAsRead: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();
        const count = await markAllAsRead(employeeId, employeeRole);

        return res.status(200).json({
            success: true,
            message: `${count} notifications marked as read`,
            timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        });
    }),

    // GET /notifications/health - (admin only - debug endpoint)
    health: asyncHandler(async (req, res) => {
        return res.status(200).json({
            success: true,
            data: { connected_clients: getConnectedClientCount() },
        });
    }),
};

export default notificationController;