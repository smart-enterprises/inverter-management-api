import asyncHandler from "../utils/asyncHandler.js";
import { buildResponse } from "../utils/responseUtils.js";
import { getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import { notificationService } from "../service/notification/notificationService.js";

const notificationController = {
    registerDeviceToken: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const token = await notificationService.registerDeviceToken({
            employee_id: employeeId,
            role: employeeRole,
            ...req.body,
        });

        buildResponse({
            res,
            status: 201,
            message: "Device token registered successfully.",
            data: {
                id: token._id,
                employee_id: token.employee_id,
                platform: token.platform,
                is_active: token.is_active,
                last_used_at: token.last_used_at,
            },
        });
    }),

    refreshDeviceToken: asyncHandler(async (req, res) => {
        const { employeeId, employeeRole } = getAuthenticatedEmployeeContext();

        const token = await notificationService.refreshDeviceToken({
            employee_id: employeeId,
            role: employeeRole,
            ...req.body,
        });

        buildResponse({
            res,
            message: "Device token refreshed successfully.",
            data: {
                id: token._id,
                employee_id: token.employee_id,
                platform: token.platform,
                is_active: token.is_active,
                last_used_at: token.last_used_at,
            },
        });
    }),

    removeDeviceToken: asyncHandler(async (req, res) => {
        const removedCount = await notificationService.removeDeviceToken(req.body.token);

        buildResponse({
            res,
            message: "Device token removed successfully.",
            data: { removed_count: removedCount },
        });
    }),

    removeAllMyDeviceTokens: asyncHandler(async (_req, res) => {
        const { employeeId } = getAuthenticatedEmployeeContext();
        const removedCount = await notificationService.removeAllDeviceTokens(employeeId);

        buildResponse({
            res,
            message: "All device tokens removed successfully.",
            data: { removed_count: removedCount },
        });
    }),

    listMyDeviceTokens: asyncHandler(async (_req, res) => {
        const { employeeId } = getAuthenticatedEmployeeContext();
        const tokens = await notificationService.listMyDeviceTokens(employeeId);

        buildResponse({
            res,
            message: "Device tokens fetched successfully.",
            data: tokens,
        });
    }),

    sendNotification: asyncHandler(async (req, res) => {
        const { employeeId } = getAuthenticatedEmployeeContext();
        const result = await notificationService.send({
            ...req.body,
            triggeredBy: employeeId,
        });

        buildResponse({
            res,
            message: "Notification processed successfully.",
            data: result,
        });
    }),
};

export default notificationController;
