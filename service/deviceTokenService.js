// deviceTokenService.js
import DeviceToken from "../models/deviceToken.js";
import { subscribeToTopic, unsubscribeFromTopic } from "../utils/fcmUtils.js";
import Employee from "../models/employees.js";
import logger from "../utils/logger.js";

export const registerToken = async (employeeId, token, platform = "web", role) => {
    try {
        await DeviceToken.findOneAndUpdate(
            { token },
            {
                $set: {
                    employee_id: employeeId,
                    role,
                    platform,
                    is_active: true,
                    last_used_at: getISTDate(),
                },
            },
            { upsert: true, new: true }
        );

        if (role) {
            const topic = roleToTopic(role);
            await subscribeToTopic([token], topic);
            logger.info(`[DeviceToken] Token subscribed to topic '${topic}' for ${employeeId}`);
        }

        logger.info(`[DeviceToken] Registered token for employee ${employeeId} (${platform})`);
        return doc;
    } catch (err) {
        logger.error("[DeviceToken] registerToken failed:", err.message);
        throw err;
    }
};

export const deregisterToken = async (token, role = null) => {
    try {
        const doc = await DeviceToken.findOneAndUpdate(
            { token },
            { $set: { is_active: false } }
        );

        if (doc && role) {
            await unsubscribeFromTopic([token], roleToTopic(role));
        }

        logger.info("[DeviceToken] Token deregistered");
        return doc;
    } catch (error) {
        logger.error("[DeviceToken] DeregisterToken failed:", error.message);
        throw error;
    }
};

export const getTokensForEmployee = async (employeeId) => {
    const docs = await DeviceToken.find({ employee_id: employeeId, is_active: true })
        .select("token platform")
        .lean();
    return docs.map((d) => d.token);
};

export const getTokensForEmployees = async (employeeIds) => {
    if (!employeeIds.length) return [];

    try {
        const docs = await DeviceToken.find({
            employee_id: { $in: employeeIds },
            is_active: true,
        })
            .select("token platform")
            .lean();
        return [...new Set(docs.map((d) => d.token))];
    } catch (err) {
        logger.error("[DeviceToken] getTokensForEmployees failed:", err.message);
        return [];
    }
};

export const getTokensForRoles = async (roles) => {
    if (!roles.length) return [];

    const employees = await Employee.find({ role: { $in: roles } })
        .select("employee_id")
        .lean();

    const employeeIds = employees.map((e) => e.employee_id);
    return getTokensForEmployees(employeeIds);
};

export const deactivateInvalidTokens = async (tokens = []) => {
    if (!tokens.length) return;
    try {
        const result = await DeviceToken.updateMany(
            { token: { $in: tokens } },
            { $set: { is_active: false } }
        );
        logger.info(`[DeviceToken] Deactivated ${result.modifiedCount} invalid token(s)`);
    } catch (err) {
        logger.error("[DeviceToken] deactivateInvalidTokens failed:", err.message);
    }
};

export const roleToTopic = (role) =>
    role.toLowerCase().replace(/[^a-z0-9\-_.~%]/g, "_");