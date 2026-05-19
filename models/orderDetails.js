import mongoose from "mongoose";
import { BadRequestException } from "../middleware/CustomError.js";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const orderDetailsSchema = new mongoose.Schema({
    order_details_number: {
        type: String,
        required: [true, "🚨 Order Details ID is required!"],
        unique: true,
    },
    order_number: {
        type: String,
        required: [true, "🚨 Order ID is required!"],
    },
    product_id: {
        type: String,
        required: [true, "🆔 Product ID is required!"],
    },
    product_brand: {
        type: String,
        required: [true, "🚨 Brand is required!"],
    },
    product_name: {
        type: String,
        required: [true, "🚨 Product Name is required."],
    },
    product_model: {
        type: String,
        required: [true, "📧 Model is required."],
    },
    product_type: {
        type: String,
        required: [true, "📱 Product Type is required."],
    },
    product_category: {
        type: String,
    },
    qty_ordered: {
        type: Number,
        required: [true, "🔢 Quantity Ordered is required."],
        min: [0, "Quantity must be at least 0."],
    },
    qty_delivered: {
        type: Number,
        default: 0,
        min: [0, "Quantity Delivered cannot be negative."],
    },
    delivery_date: {
        type: Date,
        required: [true, "📅 Delivery date is required."],
    },
    delivery_notes: {
        type: [String],
        default: [],
    },

    notes: {
        type: String,
        default: "",
    },
    unit_product_price: {
        type: Number,
        required: [true, "💰 Product unit price is required."],
        min: [0, "Price must be a positive number."],
    },
    total_product_price: {
        type: Number,
        required: [true, "💰 Total product price is required."],
        min: [0, "Price must be a positive number."],
    },
    is_free: {
        type: Boolean,
        default: false,
    },
    dealer_discount: {
        type: Number,
        required: [true, "💰 Dealer discount is required."],
        min: [0, "Price must be a positive number."],
    },
    total_dealer_discount: {
        type: Number,
        required: [true, "💰 Total dealer discount is required."],
        min: [0, "Price must be a positive number."],
    },
    total_price: {
        type: Number,
        required: [true, "💰 Total price is required."],
        min: [0, "Price must be a positive number."],
    },
    stock_usage: {
        PACKED: { type: Number, default: 0 },
        UNPACKED: { type: Number, default: 0 },
        PRODUCTION: { type: Number, default: 0 }
    },
    stock_flags: {
        PACKED: { type: Number, default: 0 },
        UNPACKED: { type: Number, default: 0 },
        PRODUCTION: { type: Number, default: 0 },
        hasUnpacked: { type: Boolean, default: false },
        hasProduction: { type: Boolean, default: false }
    },
    status: {
        type: String,
        default: "PENDING",
    },

    cancellation_history: [{
        cancelled_qty: { type: Number, required: true },
        cancelled_by: { type: String, required: true },
        cancelled_by_role: { type: String, required: true },
        cancelled_at: { type: Date, default: Date.now },
        reason: { type: String }
    }],
    total_cancelled_qty: { type: Number, default: 0 },
}, {
    timestamps: {
        createdAt: "created_at",
        updatedAt: "updated_at",
    },
});

orderDetailsSchema.index({ order_number: 1 });
orderDetailsSchema.index({ product_id: 1 });
orderDetailsSchema.index({ status: 1 });
orderDetailsSchema.index({ order_number: 1, status: 1 });

orderDetailsSchema.pre("save", function (next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

orderDetailsSchema.pre("findOneAndUpdate", function (next) {
    this._update.updated_at = getISTDate();
    next();
});

// change to service function
// orderDetailsSchema.methods.markDelivered = async function(deliveredQty) {

//     if (deliveredQty <= 0)
//         throw new BadRequestException("Delivered qty must be > 0");

//     if (this.qty_delivered + deliveredQty > this.qty_ordered)
//         throw new BadRequestException("Delivered exceeds ordered");

//     this.qty_delivered += deliveredQty;

//     this.status =
//         this.qty_delivered === this.qty_ordered ?
//         "DELIVERED" :
//         "DISPATCHED";

//     this.delivery_date = getISTDate();
//     await this.save();

//     return this;
// };

const OrderDetailsModel = mongoose.model("OrderDetails", orderDetailsSchema);

export default class OrderDetails extends OrderDetailsModel {
    constructor(detailsData) {
        super(detailsData);
    }

    async markDelivered(deliveredQty) {
        if (deliveredQty <= 0) {
            throw new BadRequestException("Delivered quantity must be greater than 0.");
        }
        if (deliveredQty > this.qty_ordered) {
            throw new BadRequestException("Delivered quantity cannot exceed ordered quantity.");
        }

        this.qty_delivered = deliveredQty;
        this.status = deliveredQty === this.qty_ordered ? "DELIVERED" : "DISPATCHED";
        await this.save();
        return this;
    }

    async cancel() {
        if (this.status === "DELIVERED") {
            throw new BadRequestException("Cannot cancel an already delivered product.");
        }
        this.status = "CANCELLED";
        await this.save();
        return this;
    }

    static async findByOrderNumber(orderNumber) {
        return await this.findAll({ order_number: orderNumber });
    }

    static async findByOrderDetailsNumber(orderDetailsNumber) {
        return await this.findOne({ order_details_number: orderDetailsNumber });
    }

}