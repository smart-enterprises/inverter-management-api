import { NOTIFICATION_TYPES } from "../../utils/notificationConstants.js";

const toFirebaseData = (data = {}) =>
    Object.fromEntries(
        Object.entries(data)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)])
    );

const payload = (type, title, body, data) => ({
    title,
    body,
    data: toFirebaseData({
        type,
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        created_at: new Date().toISOString(),
        ...data,
    }),
});

export const notificationPayloadBuilder = {
    build: (type, context = {}) => {
        const {
            order_number = "N/A",
            dealer_name = "Dealer",
            salesman_name = "Salesman",
            priority = "LOW",
            triggered_by_name = "System",
        } = context;

        const payloads = {
            [NOTIFICATION_TYPES.ORDER_CREATED_PENDING]: payload(
                NOTIFICATION_TYPES.ORDER_CREATED_PENDING,
                "New order created",
                `Order #${order_number} was placed by ${salesman_name} for ${dealer_name}. Awaiting confirmation.`,
                { order_number, status: "PENDING", priority }
            ),
            [NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION]: payload(
                NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION,
                "Order sent to production",
                `Order #${order_number} requires production. Assigned to production team.`,
                { order_number, status: "PRODUCTION", priority }
            ),
            [NOTIFICATION_TYPES.ORDER_CREATED_PACKED]: payload(
                NOTIFICATION_TYPES.ORDER_CREATED_PACKED,
                "Order ready for packing",
                `Order #${order_number} is ready for packing. Please proceed.`,
                { order_number, status: "PACKED", priority }
            ),
            [NOTIFICATION_TYPES.ORDER_CONFIRMED]: payload(
                NOTIFICATION_TYPES.ORDER_CONFIRMED,
                "Order confirmed",
                `Order #${order_number} has been confirmed by ${triggered_by_name}.`,
                { order_number, status: "CONFIRMED", triggered_by_name }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION,
                "Production started",
                `Order #${order_number} has moved to production.`,
                { order_number, status: "PRODUCTION", priority }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_PACKED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_PACKED,
                "Packing completed",
                `Order #${order_number} has been packed and is ready for invoicing.`,
                { order_number, status: "PACKED" }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_INVOICE]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_INVOICE,
                "Invoice generated",
                `Invoice for Order #${order_number} has been generated.`,
                { order_number, status: "INVOICE" }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_SHIPPED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_SHIPPED,
                "Order shipped",
                `Order #${order_number} has been shipped to ${dealer_name}.`,
                { order_number, status: "SHIPPED", dealer_name }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_DELIVERED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_DELIVERED,
                "Order delivered",
                `Order #${order_number} has been delivered to ${dealer_name}.`,
                { order_number, status: "DELIVERED", dealer_name }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_COMPLETED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_COMPLETED,
                "Order completed",
                `Order #${order_number} has been completed.`,
                { order_number, status: "COMPLETED", dealer_name }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_CANCELLED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_CANCELLED,
                "Order cancelled",
                `Order #${order_number} has been cancelled by ${triggered_by_name}.`,
                { order_number, status: "CANCELLED", triggered_by_name }
            ),
            [NOTIFICATION_TYPES.ORDER_STATUS_REJECTED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_REJECTED,
                "Order rejected",
                `Order #${order_number} has been rejected by ${triggered_by_name}.`,
                { order_number, status: "REJECTED", triggered_by_name }
            ),
        };

        if (!payloads[type]) {
            throw new Error(`[PayloadBuilder] Unknown notification type: ${type}`);
        }

        return payloads[type];
    },
};

export const buildNotificationPayload = notificationPayloadBuilder.build;
