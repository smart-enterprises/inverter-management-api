// deviceTokenService.js
import DeviceToken from "../models/deviceToken.js";
import { subscribeToTopic, unsubscribeFromTopic } from "../utils/fcmUtils.js";
import logger from "../utils/logger.js";

export const registerToken = async (employeeId, token, platform = "android", role = null) => {
    const doc = await DeviceToken.findOneAndUpdate(
        { token },
        {
            $set: {
                employee_id: employeeId,
                platform,
                is_active: true,
                last_used_at: new Date(),
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
};

export const deregisterToken = async (token, role = null) => {
    const doc = await DeviceToken.findOneAndDelete({ token });

    if (doc && role) {
        await unsubscribeFromTopic([token], roleToTopic(role));
    }

    logger.info(`[DeviceToken] Deregistered token ...${token.slice(-8)}`);
    return doc;
};

export const getTokensForEmployee = async (employeeId) => {
    const docs = await DeviceToken.find({ employee_id: employeeId, is_active: true })
        .select("token platform")
        .lean();
    return docs.map((d) => d.token);
};

export const getTokensForEmployees = async (employeeIds) => {
    if (!employeeIds.length) return [];
    const docs = await DeviceToken.find({
        employee_id: { $in: employeeIds },
        is_active: true,
    })
        .select("token")
        .lean();
    return docs.map((d) => d.token);
};

export const deactivateInvalidTokens = async (invalidTokens) => {
    if (!invalidTokens.length) return;
    await DeviceToken.updateMany(
        { token: { $in: invalidTokens } },
        { $set: { is_active: false } }
    );
    logger.info(`[DeviceToken] Deactivated ${invalidTokens.length} invalid FCM token(s)`);
};

export const getTokensForRoles = async (roles) => {
    if (!roles.length) return [];

    const Employee = (await import("../models/employees.js")).default;
    const employees = await Employee.find({ role: { $in: roles } })
        .select("employee_id")
        .lean();

    const employeeIds = employees.map((e) => e.employee_id);
    return getTokensForEmployees(employeeIds);
};

export const roleToTopic = (role) =>
    role.toLowerCase().replace(/[^a-z0-9\-_.~%]/g, "_");