// middleware/sseMiddleware.js

// Set up the headers for the SSE connection.
export const setupSSEHeaders = (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");   // Disable Nginx buffering
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (res.flushHeaders) res.flushHeaders();
};

// Send a heartbeat to keep the connection alive.
export const sendHeartbeat = (res) => {
    try {
        res.write(": heartbeat\n\n");
    } catch (_) {
        // Connection already closed - heartbeat interval will be cleared by the "close" / "error" event handlers.
    }
};