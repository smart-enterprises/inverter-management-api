import { body, validationResult } from "express-validator";
import {
    DEVICE_PLATFORMS,
    NOTIFICATION_ROLES,
    NOTIFICATION_TYPES,
} from "../utils/notificationConstants.js";
import { ValidationException } from "../middleware/CustomError.js";

export const validateRequest = (req, _res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();

    throw new ValidationException(
        "Validation failed",
        result.array().map((error) => ({
            field: error.path,
            message: error.msg,
        }))
    );
};

export const registerDeviceTokenValidation = [
    body("token").isString().trim().notEmpty().withMessage("FCM token is required."),
    body("platform")
        .optional()
        .isIn(Object.values(DEVICE_PLATFORMS))
        .withMessage(`platform must be one of: ${Object.values(DEVICE_PLATFORMS).join(", ")}`),
    body("device_id").optional({ nullable: true }).isString().trim(),
    body("app_version").optional({ nullable: true }).isString().trim(),
    validateRequest,
];

export const refreshDeviceTokenValidation = [
    body("new_token").isString().trim().notEmpty().withMessage("new_token is required."),
    body("old_token").optional({ nullable: true }).isString().trim(),
    body("platform")
        .optional()
        .isIn(Object.values(DEVICE_PLATFORMS))
        .withMessage(`platform must be one of: ${Object.values(DEVICE_PLATFORMS).join(", ")}`),
    body("device_id").optional({ nullable: true }).isString().trim(),
    body("app_version").optional({ nullable: true }).isString().trim(),
    validateRequest,
];

export const removeDeviceTokenValidation = [
    body("token").isString().trim().notEmpty().withMessage("FCM token is required."),
    validateRequest,
];

export const sendNotificationValidation = [
    body("notificationType")
        .isIn(Object.values(NOTIFICATION_TYPES))
        .withMessage(`notificationType must be one of: ${Object.values(NOTIFICATION_TYPES).join(", ")}`),
    body("targetRoles").optional().isArray().withMessage("targetRoles must be an array."),
    body("targetRoles.*")
        .optional()
        .isIn(Object.values(NOTIFICATION_ROLES))
        .withMessage("Invalid notification role."),
    body("targetEmployeeIds").optional().isArray().withMessage("targetEmployeeIds must be an array."),
    body("targetEmployeeIds.*")
        .optional()
        .isString()
        .trim()
        .notEmpty()
        .withMessage("targetEmployeeIds cannot contain empty values."),
    body("excludeEmployeeIds").optional().isArray().withMessage("excludeEmployeeIds must be an array."),
    body("context").optional().isObject().withMessage("context must be an object."),
    body("metadata").optional().isObject().withMessage("metadata must be an object."),
    validateRequest,
];
