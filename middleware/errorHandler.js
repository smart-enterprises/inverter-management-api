import {
    CustomException
} from '../middleware/CustomError.js';
import { ENVIRONMENT } from '../utils/constants.js';
import logger from '../utils/logger.js';

const sendErrorResponse = (error, req, res) => {
    const timestamp = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
    });


    const response = {
        success: false,
        name: error.name || 'Error',
        message: error.message || 'Internal Server Error',
        statusCode: error.statusCode || 500,
        errorCode: error.code || null,
        errors: error.errors || null,
        timestamp,
    };

    if (ENVIRONMENT === 'development' && error.stack) {
        response.stack = error.stack;
    }

    logger.error(`${response.name}: ${response.message}`, {
        method: req.method,
        url: req.originalUrl,
        statusCode: response.statusCode,
        ip: req.ip,
        errorCode: response.errorCode,
        stack: error.stack,
    });

    res.status(response.statusCode).json(response);
};

export const handleRateLimitError = (req, res, next, options) => {
    const timestamp = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata'
    });

    let retryAfter = 3600;
    if (options && options.standardHeaders) {
        retryAfter = res.getHeader('Retry-After') || 3600;
    }

    logger.warn('Rate limit exceeded', { ip: req.ip, url: req.originalUrl });

    res.status(429).json({
        success: false,
        statusCode: 429,
        errorCode: 'ERR_RATE_LIMIT',
        message: 'Too many requests. Please try again later.',
        retryAfter,
        timestamp,
    });
};

export const globalErrorHandler = (err, req, res, next) => {
    let error = err;

    if (!(error instanceof CustomException)) {
        const message = error.message || 'Internal Server Error';
        const statusCode = error.statusCode || 500;

        const convertedError = new CustomException(message, statusCode, null, error.code);
        convertedError.stack = error.stack;

        error = convertedError;
    }

    sendErrorResponse(error, req, res);
};