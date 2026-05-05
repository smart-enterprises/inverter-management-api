// deviceToken.js
import mongoose from "mongoose";
import { getISTDate } from "../utils/constants.js";

const deviceTokenSchema = new mongoose.Schema(
    {
        employee_id: {
            type: String,
            required: true,
            index: true,
        },
        role: {
            type: String,
            required: true,
            index: true,
        },
        token: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        platform: {
            type: String,
            enum: ["web", "android", "ios"],
            default: "web",
        },
        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
        last_used_at: {
            type: Date,
            default: getISTDate(),
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

deviceTokenSchema.index({ employee_id: 1, is_active: 1 });
deviceTokenSchema.index({ role: 1, is_active: 1 });
deviceTokenSchema.index({ token: 1, is_active: 1 });

const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema);
export default DeviceToken;