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
                "New Order Created",
                `Order #${order_number} was placed by ${salesman_name} for ${dealer_name}. Awaiting confirmation.`,
                {
                    order_number,
                    status: "PENDING",
                    next_step: "CONFIRMED",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION]: payload(
                NOTIFICATION_TYPES.ORDER_CREATED_PRODUCTION,
                "Order Sent to Production",
                `Order #${order_number} requires production. Please proceed with the production process.`,
                {
                    order_number,
                    status: "PRODUCTION",
                    next_step: "PRODUCTION_COMPLETED",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_PACKED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_PACKED,
                "Packing Completed",
                `Order #${order_number} has been packed successfully and is ready for invoicing.`,
                {
                    order_number,
                    status: "PACKED",
                    next_step: "INVOICE",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_CONFIRMED]: payload(
                NOTIFICATION_TYPES.ORDER_CONFIRMED,
                "Order Confirmed",
                `Order #${order_number} has been confirmed by ${triggered_by_name}.`,
                {
                    order_number,
                    status: "CONFIRMED",
                    next_step: "PRODUCTION / PACKED",
                    triggered_by_name,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION,
                "Production Started",
                `Production has started for Order #${order_number}.`,
                {
                    order_number,
                    status: "PRODUCTION",
                    next_step: "PRODUCTION_COMPLETED",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION_COMPLETED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_PRODUCTION_COMPLETED,
                "Production Completed",
                `Production has been completed for Order #${order_number}. Packing is required.`,
                {
                    order_number,
                    status: "PRODUCTION_COMPLETED",
                    next_step: "PACKING",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_PACKED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_PACKED,
                "Packing Completed",
                `Order #${order_number} has been packed and is ready for invoicing.`,
                {
                    order_number,
                    status: "PACKED",
                    next_step: "INVOICE",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_INVOICE]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_INVOICE,
                "Invoice Generated",
                `Invoice for Order #${order_number} has been generated successfully.`,
                {
                    order_number,
                    status: "INVOICE",
                    next_step: "SHIPPED",
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_SHIPPED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_SHIPPED,
                "Order Shipped",
                `Order #${order_number} has been shipped to ${dealer_name}.`,
                {
                    order_number,
                    status: "SHIPPED",
                    next_step: "DELIVERED",
                    dealer_name,
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_DELIVERED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_DELIVERED,
                "Order Delivered",
                `Order #${order_number} has been delivered to ${dealer_name}.`,
                {
                    order_number,
                    status: "DELIVERED",
                    next_step: "COMPLETED",
                    dealer_name,
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_COMPLETED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_COMPLETED,
                "Order Completed",
                `Order #${order_number} has been completed successfully.`,
                {
                    order_number,
                    status: "COMPLETED",
                    dealer_name,
                    priority,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_CANCELLED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_CANCELLED,
                "Order Cancelled",
                `Order #${order_number} has been cancelled by ${triggered_by_name}.`,
                {
                    order_number,
                    status: "CANCELLED",
                    triggered_by_name,
                }
            ),

            [NOTIFICATION_TYPES.ORDER_STATUS_REJECTED]: payload(
                NOTIFICATION_TYPES.ORDER_STATUS_REJECTED,
                "Order Rejected",
                `Order #${order_number} has been rejected by ${triggered_by_name}.`,
                {
                    order_number,
                    status: "REJECTED",
                    triggered_by_name,
                }
            ),
        };

        if (!payloads[type]) {
            throw new Error(`[PayloadBuilder] Unknown notification type: ${type}`);
        }

        return payloads[type];
    },
};

export const buildNotificationPayload = notificationPayloadBuilder.build;
