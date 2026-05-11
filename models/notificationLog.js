// models/NotificationLog.js
import mongoose from "mongoose";
import { NOTIFICATION_LOG_STATUS, NOTIFICATION_TYPES } from "../utils/notificationConstants.js";

function getISTDate() {
    return new Date(Date.now() + 330 * 60000);
}

const recipientResultSchema = new mongoose.Schema(
    {
        employee_id: { type: String },
        token: { type: String },
        status: {
            type: String,
            enum: ["sent", "failed", "invalid_token"],
            default: "sent",
        },
        error_code: { type: String, default: null },
        error_message: { type: String, default: null },
    },
    { _id: false }
);

const notificationLogSchema = new mongoose.Schema(
    {
        notification_log_id: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        notification_type: {
            type: String,
            enum: Object.values(NOTIFICATION_TYPES),
            required: true,
            index: true,
        },
        title: { type: String, required: true },
        body: { type: String, required: true },

        order_number: { type: String, index: true, default: null },
        triggered_by: { type: String, default: "SYSTEM" },

        target_roles: { type: [String], default: [] },
        target_employee_ids: { type: [String], default: [] },
        total_tokens: { type: Number, default: 0 },
        success_count: { type: Number, default: 0 },
        failure_count: { type: Number, default: 0 },
        invalid_token_count: { type: Number, default: 0 },
        status: {
            type: String,
            enum: Object.values(NOTIFICATION_LOG_STATUS),
            default: NOTIFICATION_LOG_STATUS.SENT,
            index: true,
        },
        recipient_results: {
            type: [recipientResultSchema],
            default: [],
        },

        payload_snapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        sent_at: { type: Date, default: getISTDate },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    }
);

notificationLogSchema.index({ notification_type: 1, sent_at: -1 });
notificationLogSchema.index({ order_number: 1, sent_at: -1 });
notificationLogSchema.index({ triggered_by: 1, sent_at: -1 });

const NotificationLog = mongoose.model("NotificationLog", notificationLogSchema);
export default NotificationLog;
