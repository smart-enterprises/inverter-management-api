import rateLimit from "express-rate-limit";
import { handleRateLimitError } from "./errorHandler.js";

const keyGenerator = (req) => req.user?.id || req.headers["x-forwarded-for"] || req.ip;

export const notificationRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: {
        success: false,
        message: "Too many notification requests. Please try again later.",
    },
    requestWasSuccessful: (_req, res) => res.statusCode < 400,
    handler: handleRateLimitError,
});
