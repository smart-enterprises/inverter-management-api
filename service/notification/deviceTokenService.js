import DeviceToken from "../../models/deviceToken.js";
import logger from "../../utils/logger.js";
import { BadRequestException } from "../../middleware/CustomError.js";
import { DEVICE_PLATFORMS } from "../../utils/notificationConstants.js";

const getISTDate = () => new Date(Date.now() + 330 * 60000);

const maskToken = (token = "") =>
    token.length > 20 ? `${token.slice(0, 12)}...${token.slice(-6)}` : token;

const normalizePlatform = (platform) => {
    const value = String(platform || DEVICE_PLATFORMS.WEB).toLowerCase();
    return Object.values(DEVICE_PLATFORMS).includes(value) ? value : DEVICE_PLATFORMS.WEB;
};

export const deviceTokenService = {
    registerOrUpdateToken: async ({
        employee_id,
        role,
        token,
        platform = DEVICE_PLATFORMS.WEB,
        device_id = null,
        app_version = null,
    }) => {
        if (!employee_id || !role || !token) {
            throw new BadRequestException("employee_id, role, and token are required.");
        }

        const result = await DeviceToken.findOneAndUpdate(
            { token },
            {
                $set: {
                    employee_id,
                    role,
                    token,
                    platform: normalizePlatform(platform),
                    device_id,
                    app_version,
                    is_active: true,
                    last_used_at: getISTDate(),
                },
            },
            { upsert: true, new: true, runValidators: true }
        );

        logger.info("[DeviceToken] Token registered or refreshed", {
            employee_id,
            role,
            platform,
            token_id: result._id,
        });

        return result;
    },

    refreshToken: async ({ old_token, new_token, employee_id, role, platform, device_id, app_version }) => {
        if (!new_token) {
            throw new BadRequestException("new_token is required.");
        }

        if (old_token && old_token !== new_token) {
            await DeviceToken.updateMany(
                { token: old_token },
                { $set: { is_active: false, last_used_at: getISTDate() } }
            );
        }

        return deviceTokenService.registerOrUpdateToken({
            employee_id,
            role,
            token: new_token,
            platform,
            device_id,
            app_version,
        });
    },

    deactivateToken: async (token) => {
        if (!token) return 0;

        const result = await DeviceToken.updateMany(
            { token },
            { $set: { is_active: false, last_used_at: getISTDate() } }
        );

        logger.info("[DeviceToken] Token deactivated", { token: maskToken(token) });
        return result.modifiedCount;
    },

    deactivateAllTokensForEmployee: async (employee_id) => {
        if (!employee_id) return 0;

        const result = await DeviceToken.updateMany(
            { employee_id, is_active: true },
            { $set: { is_active: false, last_used_at: getISTDate() } }
        );

        logger.info("[DeviceToken] All tokens deactivated for employee", {
            employee_id,
            deactivated_count: result.modifiedCount,
        });

        return result.modifiedCount;
    },

    getActiveTokenRecordsByEmployeeIds: async (employeeIds = []) => {
        const ids = [...new Set(employeeIds.filter(Boolean))];
        if (!ids.length) return [];

        return DeviceToken.find({
            employee_id: { $in: ids },
            is_active: true,
        })
            .select("token employee_id role platform")
            .lean();
    },

    removeBulkInvalidTokens: async (tokens = []) => {
        const uniqueTokens = [...new Set(tokens.filter(Boolean))];
        if (!uniqueTokens.length) return 0;

        const result = await DeviceToken.deleteMany({ token: { $in: uniqueTokens } });

        if (result.deletedCount > 0) {
            logger.warn("[DeviceToken] Bulk invalid tokens removed", {
                count: result.deletedCount,
            });
        }

        return result.deletedCount;
    },

    listEmployeeTokens: async (employee_id) => {
        if (!employee_id) return [];

        return DeviceToken.find({ employee_id, is_active: true })
            .select("employee_id role platform device_id app_version last_used_at created_at")
            .sort({ last_used_at: -1 })
            .lean();
    },
};

export const registerOrUpdateToken = deviceTokenService.registerOrUpdateToken;
export const deactivateToken = deviceTokenService.deactivateToken;
export const deactivateAllTokensForEmployee = deviceTokenService.deactivateAllTokensForEmployee;
export const removeBulkInvalidTokens = deviceTokenService.removeBulkInvalidTokens;
