// models/notification.js
import mongoose from "mongoose";

function getISTDate() {
    const date = new Date();
    return new Date(date.getTime() + 330 * 60000);
}

export const NOTIFICATION_TYPES = Object.freeze({
    ORDER_CREATED_PENDING: "ORDER_CREATED_PENDING",
    ORDER_CREATED_PRODUCTION: "ORDER_CREATED_PRODUCTION",
    ORDER_CREATED_PACKED: "ORDER_CREATED_PACKED",
    ORDER_CONFIRMED: "ORDER_CONFIRMED",
    ORDER_STATUS_PRODUCTION: "ORDER_STATUS_PRODUCTION",
    ORDER_STATUS_PACKED: "ORDER_STATUS_PACKED",
});

export const NOTIFICATION_ROLES = Object.freeze({
    SUPER_ADMIN: "ROLE_SUPER_ADMIN",
    ADMIN: "ROLE_ADMIN",
    MANAGER: "ROLE_MANAGER",
    PRODUCTION: "ROLE_PRODUCTION",
    PACKING: "ROLE_PACKING",
    ACCOUNTS: "ROLE_ACCOUNTS",
    DELIVERY: "ROLE_DELIVERY",
    SALESMAN: "ROLE_SALESMAN",
});

export const NOTIFICATION_TARGET_ROLES = Object.freeze({
    [NOTIFICATION_TYPES.ORDER_CREATED_PENDING]: [
        NOTIFICATION_ROLES.SUPER_ADMIN,
        NOTIFICATION_ROLES.ADMIN,
        NOTIFICATION_ROLES.MANAGER,
        // The salesman who created the order is added at runtime via targetEmployeeIds
    ],
    [NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION]: [
        NOTIFICATION_ROLES.SUPER_ADMIN,
        NOTIFICATION_ROLES.ADMIN,
        NOTIFICATION_ROLES.MANAGER,
        NOTIFICATION_ROLES.PRODUCTION,
        NOTIFICATION_ROLES.PACKING,
    ],
    [NOTIFICATION_TYPES.ORDER_CREATED_PACKED]: [
        NOTIFICATION_ROLES.SUPER_ADMIN,
        NOTIFICATION_ROLES.ADMIN,
        NOTIFICATION_ROLES.MANAGER,
        NOTIFICATION_ROLES.PACKING,
        NOTIFICATION_ROLES.ACCOUNTS,
    ],
    [NOTIFICATION_TYPES.ORDER_CONFIRMED]: [
        NOTIFICATION_ROLES.SUPER_ADMIN,
        NOTIFICATION_ROLES.ADMIN,
        NOTIFICATION_ROLES.MANAGER,
        // The salesman who created the order is added at runtime via targetEmployeeIds
    ],
    [NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION]: [
        NOTIFICATION_ROLES.SUPER_ADMIN,
        NOTIFICATION_ROLES.ADMIN,
        NOTIFICATION_ROLES.MANAGER,
        NOTIFICATION_ROLES.PRODUCTION,
        NOTIFICATION_ROLES.PACKING,
    ],
    [NOTIFICATION_TYPES.ORDER_STATUS_PACKED]: [
        NOTIFICATION_ROLES.SUPER_ADMIN,
        NOTIFICATION_ROLES.ADMIN,
        NOTIFICATION_ROLES.MANAGER,
        NOTIFICATION_ROLES.PRODUCTION,
        NOTIFICATION_ROLES.PACKING,
        NOTIFICATION_ROLES.ACCOUNTS,
    ],
});

const notificationSchema = new mongoose.Schema(
    {
        notification_id: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: Object.values(NOTIFICATION_TYPES),
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        payload: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        target_roles: {
            type: [String],
            default: [],
        },
        target_employee_ids: {
            type: [String],
            default: [],
        },
        excluded_employee_ids: {
            type: [String],
            default: [],
        },
        read_by: [
            {
                employee_id: { type: String, required: true },
                read_at: { type: Date, default: getISTDate },
            },
        ],
        created_by: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

notificationSchema.index({ created_at: -1 });
notificationSchema.index({ target_roles: 1 });
notificationSchema.index({ target_employee_ids: 1 });
notificationSchema.index({ excluded_employee_ids: 1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;