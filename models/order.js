import mongoose from "mongoose";
import { BadRequestException } from "../middleware/CustomError.js";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../utils/constants.js";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const orderSchema = new mongoose.Schema({
    order_number: {
        type: String,
        required: [true, "🚨 Order Number is required!"],
        unique: true,
    },
    dealer_id: {
        type: String,
        required: [true, "🚨 Dealer ID is required!"],
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required!"],
    },
    salesman_id: {
        type: String,
        required: [true, "🚨 Salesman ID is required!"],
    },
    priority: {
        type: String,
        default: "LOW", // LOW, MEDIUM, HIGH
    },
    order_note: {
        type: String,
        default: "",
    },
    status: {
        type: String,
        default: ORDER_STATUSES.PENDING, // PENDING, CONFIRMED, PRODUCTION, PACKED, INVOICE, SHIPPED, DELIVERED, CANCELLED, REJECTED
    },

    promised_delivery_date: {
        type: Date
    },
    delivery_note: {
        type: String,
        default: "",
    },

    order_total_price: {
        type: Number,
        required: [true, "💰 Order total price is required."],
        min: [0, "Price must be a positive number."],
    },
    order_total_discount: {
        type: Number,
        required: [true, "💰 Order total discount amount is required."],
        min: [0, "Price must be a positive number."],
    },

    payment_status: {
        type: String,
        default: PAYMENT_STATUSES.DUE, // DUE, PARTIAL, PAID, FAILED, REFUNDED
    },
    payment_type: {
        type: String,
        default: "CASH", // CASH, ONLINE, CHEQUE, etc.
    },
    payment_notes: {
        type: [String],
        default: [],
    },
    amount_paid: {
        type: Number,
        default: 0,
        min: [0, "Amount paid cannot be negative."],
    },
    amount_due: {
        type: Number,
        default() {
            return this.order_total_price;
        },
        min: [0, "Amount due cannot be negative."],
    },
    last_payment_date: {
        type: Date,
    },

    sales_target_updated: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
});

orderSchema.index({ dealer_id: 1, created_at: -1 });
orderSchema.index({ salesman_id: 1, created_at: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ created_at: -1 });

orderSchema.pre("save", function (next) {
    const now = getISTDate();
    this.updated_at = now;

    if (this.amount_paid === 0) {
        this.payment_status = PAYMENT_STATUSES.DUE;
    } else if (this.amount_paid < this.order_total_price) {
        this.payment_status = PAYMENT_STATUSES.PARTIAL;
    } else {
        this.payment_status = PAYMENT_STATUSES.PAID;
    }

    this.amount_due = Math.max(this.order_total_price - this.amount_paid, 0);
    next();
});

orderSchema.pre('findOneAndUpdate', function (next) {
    this._update.updated_at = getISTDate();
    next();
});

orderSchema.methods.addPayment = async function (amount, method = "CASH") {
    if (amount <= 0) {
        throw new BadRequestException("Payment amount must be greater than zero.");
    }

    const payableAmount = Number(this.order_total_price);
    const remainingAmount = payableAmount - Number(this.amount_paid || 0);

    if (amount > remainingAmount) {
        throw new BadRequestException(`Payment exceeds outstanding amount. Remaining payable: ${remainingAmount}`);
    }

    this.amount_paid += amount;
    this.payment_type = method;
    this.last_payment_date = getISTDate();

    this.payment_notes.push(`💰 ${amount} received via ${method} on ${this.last_payment_date.toLocaleString()}`);

    return this;
};

const OrderModel = mongoose.model("Order", orderSchema);

export default class Order extends OrderModel {
    constructor(orderData) {
        super(orderData);
    }

    async markSalesTargetUpdated() {
        this.sales_target_updated = true;
        await this.save();
        return this;
    }

    static async findByOrderNumber(orderNumber) {
        return await this.findOne({ order_number: orderNumber });
    }

    static async findByOrderStatus(status) {
        if (!Object.values(ORDER_STATUSES).includes(status)) {
            throw new BadRequestException(`Invalid order status: ${status}`);
        }

        return await this.find({ status });
    }

}