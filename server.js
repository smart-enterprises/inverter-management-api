import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import hpp from "hpp";
import path from 'path';
import fs from 'fs';
import mongoose from "mongoose";

import swaggerUi from 'swagger-ui-express';

import logger, { apiLogger } from "./utils/logger.js";
import { handleRateLimitError, globalErrorHandler } from "./middleware/errorHandler.js";

import employeeRoute from "./routes/employeeRoute.js";
import authRoute from "./routes/authRoute.js";
import orderRoute from "./routes/orderRoute.js";
import productRoute from "./routes/productRoute.js";
import publicRoute from "./routes/publicRoute.js";
import locationRoute from "./routes/locationRoute.js";
import companyRoute from "./routes/companyAddressRoute.js";
import invoiceRoute from "./routes/invoiceRoute.js";
import bulkImportRoute from "./routes/bulkImportRoute.js";
import notificationRoute from "./routes/notificationRoute.js";

import { PATH_ROUTES, APPLICATION_NAME, ENVIRONMENT, PORT, APPLICATION_URL, ALLOWED_ORIGINS } from "./utils/constants.js";

import { NotFoundException } from "./middleware/CustomError.js";
import { requestContextMiddleware } from "./middleware/requestContextMiddleware.js";

import { connectToDatabase, closeDatabaseConnection } from "./config/dbConfig.js";
import { employeeService } from "./service/employeeService.js";

import chalk from "chalk";

// Generates a clickable hyperlink in supported terminals
function hyperlink(text, url) {
    return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

const app = express();
const port = PORT || 3000;

app.set("trust proxy", 1);

const globalLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 250,

    // Headers
    standardHeaders: true,
    legacyHeaders: false,

    // Trust real client identity (important if behind proxy)
    keyGenerator: (req) => {
        return req.user?.id || req.headers['x-forwarded-for'] || req.ip;
    },

    // Skip internal / safe routes
    skip: (req) => {
        return req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/notifications');
    },

    // Better response (used if handler is NOT set)
    message: {
        success: false,
        message: "Too many requests, please try again after 10 minutes."
    },

    // 🔑 Critical: avoid counting server errors
    skipFailedRequests: false,
    skipSuccessfulRequests: false,

    // 🔑 Prevent counting OPTIONS (CORS preflight)
    requestWasSuccessful: (req, res) => res.statusCode < 400,

    // Error Handler
    handler: handleRateLimitError,
});

const corsOptions = {
    origin(origin, callback) {
        const allowedOrigins = ALLOWED_ORIGINS ?
            ALLOWED_ORIGINS.split(',').map(o => o.trim()) : ['http://localhost:5173'];

        allowedOrigins.push('http://localhost:3000');
        allowedOrigins.push('https://editor.swagger.io');
        allowedOrigins.push('http://localhost:1280');

        if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        logger.warn(`[CORS] Origin blocked: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept'],
    optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

app.use(helmet());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(cookieParser());
app.use(compression());
app.use(hpp());
app.use(globalLimiter);
app.use(requestContextMiddleware);

app.use((req, res, next) => {
    apiLogger.info(`Incoming ${req.method} request to ${req.originalUrl}`);
    next();
});

// -------------------------------------------------------------
// Swagger
// -------------------------------------------------------------
const swaggerFile = path.resolve("./swagger-output.json");
if (fs.existsSync(swaggerFile)) {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerFile, "utf8"));
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

const requiredEnvVars = ["MONGO_URL", "JWT_SECRET"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    logger.error("Missing required environment variables", { missingEnvVars });
    process.exit(1);
}

const startServer = async () => {
    try {
        await connectToDatabase();

        const server = app.listen(port, () => {
            employeeService.defaultSuperAdminSetup();

            const url = APPLICATION_URL || `http://localhost:${port}`;
            const clickableUrl = hyperlink(APPLICATION_NAME, url);

            logger.info(`${chalk.green("🚀 Server running:")} ${chalk.blueBright(clickableUrl)}`);
        });

        const gracefulShutdown = (signal) => {
            logger.info(`Received ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                await closeDatabaseConnection();
                process.exit(0);
            });
        };

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
        process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    } catch (error) {
        logger.error('Error starting server:', error);
        process.exit(1);
    }
};

// Routes
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: `👋 Welcome to ${APPLICATION_NAME}`,
        version: "1.0.0",
        status: "operational",
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    });
});

// Ignore favicon requests to prevent NotFoundException spam
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Health check endpoint
app.get("/health", async (req, res) => {
    const state = mongoose.connection && mongoose.connection.readyState ?
        mongoose.connection.readyState :
        0;
    const dbStatus = {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
    }[state] || "unknown";

    res.status(200).json({
        success: true,
        message: "🩺 Health check OK",
        service: APPLICATION_NAME,
        environment: ENVIRONMENT || "development",
        version: "1.0.0",
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        db: {
            status: dbStatus,
            name: mongoose.connection ? mongoose.connection.name || "unknown" : "unknown",
        },
    });
});

app.use(PATH_ROUTES.AUTH_ROUTE, authRoute);
app.use(PATH_ROUTES.LOCATION_ROUTE, locationRoute);
app.use(PATH_ROUTES.BASIC_ROUTE, publicRoute);

app.use(PATH_ROUTES.EMPLOYEE_ROUTE, employeeRoute);
app.use(PATH_ROUTES.PRODUCT_ROUTE, productRoute);
app.use(PATH_ROUTES.ORDER_ROUTE, orderRoute);

app.use(PATH_ROUTES.INVOICE_ROUTE, invoiceRoute);

app.use(PATH_ROUTES.COMPANY_ROUTE, companyRoute);

app.use(PATH_ROUTES.BULK_IMPORT_ROUTE, bulkImportRoute);

app.use(PATH_ROUTES.NOTIFICATION_ROUTE, notificationRoute);

app.use((req, res, next) => {
    next(new NotFoundException(`Endpoint '${req.method} ${req.originalUrl}' not found.`));
});

app.use(globalErrorHandler);

startServer();

process.on("unhandledRejection", reason => {
    if (reason && reason.isOperational) {
        logger.warn(`Operational rejection: ${reason.message}`);
    } else {
        logger.error("Unhandled Rejection:", reason);
        process.exit(1);
    }
});

process.on("uncaughtException", err => {
    logger.error("Uncaught Exception:", err);
    process.exit(1);
});