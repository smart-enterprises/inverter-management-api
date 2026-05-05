// CustomError.js
class CustomException extends Error {
    constructor(message, statusCode = 500, errors = null, code = null) {
        super(message);

        this.name = this.constructor.name; // Class name
        this.statusCode = statusCode; // HTTP status
        this.errors = errors; // Nested error details (optional)
        this.code = code; // Custom App Error Code (optional)
        this.isOperational = true; // Helps identify expected vs. unknown errors
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this, this.constructor);
    }
}

// 400 - Bad request
class BadRequestException extends CustomException {
    constructor(message = 'Bad Request', errors = null, code = 'ERR_BAD_REQUEST') {
        super(message, 400, errors, code);
    }
}

// 401 - Authentication required
class UnauthorizedException extends CustomException {
    constructor(message = 'Unauthorized – Authentication required', code = 'ERR_UNAUTHORIZED') {
        super(message, 401, null, code);
    }
}

// 401 - Token expired
class TokenExpiredException extends CustomException {
    constructor(message = 'Token has expired', code = 'ERR_TOKEN_EXPIRED') {
        super(message, 401, null, code);
    }
}

// 403 - Role or permission not allowed
class ForbiddenException extends CustomException {
    constructor(message = 'Forbidden – You do not have permission', code = 'ERR_FORBIDDEN') {
        super(message, 403, null, code);
    }
}

// 404 - Resource not found
class NotFoundException extends CustomException {
    constructor(message = 'Resource not found', code = 'ERR_NOT_FOUND') {
        super(message, 404, null, code);
    }
}

// 409 - Duplicate or conflict
class ConflictException extends CustomException {
    constructor(message = 'Conflict', code = 'ERR_CONFLICT') {
        super(message, 409, null, code);
    }
}

// 422 - Validation error
class ValidationException extends CustomException {
    constructor(message = 'Validation failed', errors = [], code = 'ERR_VALIDATION') {
        super(message, 422, errors, code);
    }
}

// 429 - Rate limiter
class RateLimitException extends CustomException {
    constructor(message = 'Too many requests, please try again later', code = 'ERR_RATE_LIMIT') {
        super(message, 429, null, code);
    }
}

// 500 - Internal server error
class InternalServerException extends CustomException {
    constructor(message = 'Internal Server Error', code = 'ERR_INTERNAL') {
        super(message, 500, null, code);
    }
}

// 502 – FCM / upstream push error
class FcmException extends CustomException {
    constructor(message = "Firebase Cloud Messaging error", code = "ERR_FCM") {
        super(message, 502, null, code);
    }
}

// 400 – invalid or expired FCM / auth token supplied by client
class TokenException extends CustomException {
    constructor(message = "Invalid or expired token", code = "ERR_TOKEN") {
        super(message, 400, null, code);
    }
}

// 503 – service unavailable
class ServiceUnavailableException extends CustomException {
    constructor(message = "Service temporarily unavailable", code = "ERR_SERVICE_UNAVAILABLE") {
        super(message, 503, null, code);
    }
}

export {
    CustomException,
    BadRequestException,
    UnauthorizedException,
    TokenExpiredException,
    ForbiddenException,
    NotFoundException,
    ConflictException,
    ValidationException,
    RateLimitException,
    InternalServerException,
    FcmException,
    TokenException,
    ServiceUnavailableException,
};