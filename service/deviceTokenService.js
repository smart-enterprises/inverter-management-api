// service/deviceTokenService.js
import DeviceToken from "../models/deviceToken.js";
import { subscribeToTopic, unsubscribeFromTopic } from "../utils/fcmUtils.js";
import Employee from "../models/employees.js";
import logger from "../utils/logger.js";
import { getISTDate } from "../utils/constants.js";

export const roleToTopic = (role) =>
    role.toLowerCase().replace(/[^a-z0-9\-_.~%]/g, "_");

export const registerToken = async (employeeId, token, platform = "web", role) => {
    try {
        const doc = await DeviceToken.findOneAndUpdate(
            { token },
            {
                $set: {
                    employee_id: employeeId,
                    role: role ?? "unknown",
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
            logger.info(`[DeviceToken] Subscribed to topic '${topic}' | employee: ${employeeId}`);
        }

        logger.info(`[DeviceToken] Registered | employee: ${employeeId} | platform: ${platform}`);
        return doc;
    } catch (err) {
        logger.error(`[DeviceToken] registerToken failed: ${err.message}`);
        throw err;
    }
};

export const deregisterToken = async (token, role = null) => {
    try {
        const doc = await DeviceToken.findOneAndUpdate(
            { token },
            { $set: { is_active: false } },
            { new: true }
        );

        if (doc && role) {
            await unsubscribeFromTopic([token], roleToTopic(role));
        }

        logger.info(`[DeviceToken] Deregistered token`);
        return doc;
    } catch (err) {
        logger.error(`[DeviceToken] deregisterToken failed: ${err.message}`);
        throw err;
    }
};

export const getTokensForEmployee = async (employeeId) => {
    const docs = await DeviceToken.find({ employee_id: employeeId, is_active: true })
        .select("token")
        .lean();

    return docs.map((d) => d.token);
};

export const getTokensForEmployees = async (employeeIds) => {
    if (!Array.isArray(employeeIds) || !employeeIds.length) return [];

    try {
        const docs = await DeviceToken.find({
            employee_id: { $in: employeeIds },
            is_active: true,
        })
            .select("token")
            .lean();

        const tokens = [...new Set(docs.map((d) => d.token))];
        logger.debug(`[DeviceToken] getTokensForEmployees | employees=${employeeIds.length} | tokens=${tokens.length}`);
        return tokens;
    } catch (err) {
        logger.error(`[DeviceToken] getTokensForEmployees failed: ${err.message}`);
        return [];
    }
};

export const getTokensForRoles = async (roles) => {
    if (!Array.isArray(roles) || !roles.length) return [];

    try {
        const employees = await Employee.find({ role: { $in: roles } })
            .select("employee_id")
            .lean();

        if (!employees.length) {
            logger.debug(`[DeviceToken] getTokensForRoles | roles=${JSON.stringify(roles)} | 0 employees`);
            return [];
        }

        const employeeIds = employees.map((e) => e.employee_id);
        const tokens = await getTokensForEmployees(employeeIds);

        logger.debug(`[DeviceToken] getTokensForRoles | roles=${JSON.stringify(roles)} | employees=${employees.length} | tokens=${tokens.length}`);
        return tokens;
    } catch (err) {
        logger.error(`[DeviceToken] getTokensForRoles failed: ${err.message}`);
        return [];
    }
};

export const deactivateInvalidTokens = async (tokens = []) => {
    if (!tokens.length) return;

    try {
        const result = await DeviceToken.updateMany(
            { token: { $in: tokens } },
            { $set: { is_active: false } }
        );
        logger.info(`[DeviceToken] Deactivated ${result.modifiedCount}/${tokens.length} invalid tokens`);
    } catch (err) {
        logger.error(`[DeviceToken] deactivateInvalidTokens failed: ${err.message}`);
    }
};