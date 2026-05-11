// models/DeviceToken.js
import mongoose from "mongoose";
import { DEVICE_PLATFORMS } from "../utils/notificationConstants.js";

function getISTDate() {
    return new Date(Date.now() + 330 * 60000);
}

const deviceTokenSchema = new mongoose.Schema(
    {
        employee_id: {
            type: String,
            required: [true, "employee_id is required"],
            index: true,
        },
        role: {
            type: String,
            required: [true, "role is required"],
            index: true,
        },
        token: {
            type: String,
            required: [true, "FCM token is required"],
            unique: true,
            index: true,
        },
        platform: {
            type: String,
            enum: Object.values(DEVICE_PLATFORMS),
            default: DEVICE_PLATFORMS.WEB,
        },
        device_id: {
            type: String,
            default: null,
            index: true,
        },
        app_version: {
            type: String,
            default: null,
        },
        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
        last_used_at: {
            type: Date,
            default: getISTDate,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

// Compound indexes for efficient queries
deviceTokenSchema.index({ employee_id: 1, is_active: 1 });
deviceTokenSchema.index({ role: 1, is_active: 1 });
deviceTokenSchema.index({ token: 1, is_active: 1 });
deviceTokenSchema.index({ employee_id: 1, device_id: 1 });

const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema);
export default DeviceToken;
