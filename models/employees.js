// employees.js
import mongoose from "mongoose";
import validator from "validator";

function getISTDate() {
    const date = new Date();
    const utcOffset = 330;
    return new Date(date.getTime() + utcOffset * 60000);
}

const employeeSchema = new mongoose.Schema({
    employee_id: {
        type: String,
        required: [true, "🚨 Employee ID is required!"],
        unique: true,
    },
    employee_name: {
        type: String,
        required: [true, "✨ Please enter your employee name."],
    },
    employee_email: {
        type: String,
        required: [true, "📧 Email address is required."],
        unique: true,
        lowercase: true,
        validate: {
            validator: validator.isEmail,
            message: "⚠️ Please enter a valid email address.",
        },
    },
    password: {
        type: String,
        required: [true, "🔒 Password is required!"],
        minlength: [8, "🔑 Password must be at least 8 characters long."],
    },
    employee_phone: {
        type: Number,
        required: [true, "📱 Phone number is required."],
        unique: true,
        minlength: [10, "📞 Phone number must be at least 10 digits."],
    },
    role: {
        type: String,
        required: [true, "👔 Role is required."],
    },
    status: {
        type: String,
        default: "active",
    },
    log_note: {
        type: String,
    },
    created_by: {
        type: String,
        required: [true, "📝 Creator ID is required."],
    },
    shop_name: {
        type: String,
    },
    photo: {
        type: String,
    },
    district: {
        type: String,
    },
    town: {
        type: String,
    },
    brand: {
        type: [String],
    },
    address: {
        type: String,
    },
    assignedTarget: {
        type: Number,
        default: 0,
    },
    targetId: {
        type: String,
    },
    dealers: {
        type: [String],
        default: [],
    },

}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
});

employeeSchema.pre('save', function (next) {
    const istNow = getISTDate();
    if (this.isNew) this.created_at = istNow;
    this.updated_at = istNow;
    next();
});

employeeSchema.pre('findOneAndUpdate', function (next) {
    this._update.updated_at = getISTDate();
    next();
});

employeeSchema.set('toJSON', { virtuals: true });

const Employee = mongoose.model("Employee", employeeSchema);
export default Employee;