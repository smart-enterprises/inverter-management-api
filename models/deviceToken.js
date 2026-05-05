// deviceToken.js
import mongoose from "mongoose";

const deviceTokenSchema = new mongoose.Schema(
    {
        employee_id: {
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
            enum: ["android", "ios", "web"],
            default: "android",
        },
        is_active: {
            type: Boolean,
            default: true,
        },
        last_used_at: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

deviceTokenSchema.index({ employee_id: 1, token: 1 }, { unique: true });

const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema);
export default DeviceToken;