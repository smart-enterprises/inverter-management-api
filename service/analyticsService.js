// service/analyticsService.js
//
// Read-only aggregations for dashboard charts and KPIs.
// All pipelines start with a $match on indexed fields (created_at, dealer_id,
// salesman_id, status) so they stay fast as the collection grows.

import asyncHandler from "express-async-handler";

import Order from "../models/order.js";
import OrderDetails from "../models/orderDetails.js";

import { BadRequestException, ForbiddenException } from "../middleware/CustomError.js";
import { getAuthenticatedEmployeeContext } from "../utils/validationUtils.js";
import { DEFAULT_SALESMAN_TARGET_QTY, ORDER_STATUSES, ROLES } from "../utils/constants.js";

const MAX_LIMIT = 100;
const DEFAULT_TOP_N = 10;

// Analytics access is restricted to these three roles only.
// Sales team / dealers / accounts / production / packing / delivery / supervisor
// don't see analytics — frontend hides the page, backend returns 403.
const ANALYTICS_ALLOWED_ROLES = new Set([
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.MANAGER,
]);

const parseDate = (value, label) => {
    if (!value) throw new BadRequestException(`${label} is required (ISO date).`);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`${label} is not a valid date.`);
    }
    return d;
};

const parseLimit = (value, fallback = DEFAULT_TOP_N) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, MAX_LIMIT);
};

// Build a $match stage scoped to the caller's role.
// - Admin-tier roles see everything (optionally filtered by dealer_id / salesman_id).
// - Salesmen are forced to their own salesman_id.
// - Dealers are forced to their own dealer_id.
// - Other roles are forbidden from analytics.
const buildScopedMatch = ({ from, to, dealer_id, salesman_id }) => {
    const { employeeRole } = getAuthenticatedEmployeeContext();

    if (!ANALYTICS_ALLOWED_ROLES.has(employeeRole)) {
        throw new ForbiddenException("Analytics is not available for your role.");
    }

    const match = {
        created_at: { $gte: from, $lte: to },
    };

    // Admin-tier may optionally narrow by dealer or salesman.
    if (dealer_id) match.dealer_id = String(dealer_id);
    if (salesman_id) match.salesman_id = String(salesman_id);

    return match;
};

const analyticsService = {

    // KPI summary + status distribution for the dashboard header.
    //
    // Revenue is reported in three honest meanings (the schema's `order_total_price`
    // is "remaining to bill", which shrinks on both delivery AND cancellation and is
    // misleading as a sales KPI):
    //   - revenue_booked    = SUM(qty_ordered           × unit_product_price)
    //   - revenue_cancelled = SUM(total_cancelled_qty   × unit_product_price)
    //   - revenue_delivered = SUM(qty_delivered         × unit_product_price)
    //
    // Booked = total sales originally agreed.
    // Cancelled = portion that fell off.
    // Delivered = revenue actually realized (shipped).
    // Net pipeline = booked - cancelled - delivered = still to ship.
    getSummary: asyncHandler(async ({ from, to, dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const match = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });

        // 1. Order-level aggregation (counts, status, payment).
        const [orderAgg = {}] = await Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    orders_total: { $sum: 1 },
                    revenue_paid: { $sum: "$amount_paid" },
                    revenue_due: { $sum: "$amount_due" },
                    orders_delivered: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.DELIVERED] }, 1, 0] },
                    },
                    orders_completed: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.COMPLETED] }, 1, 0] },
                    },
                    orders_cancelled: {
                        $sum: { $cond: [{ $eq: ["$status", ORDER_STATUSES.CANCELLED] }, 1, 0] },
                    },
                    statuses: { $push: "$status" },
                    order_numbers: { $push: "$order_number" },
                },
            },
        ]);

        // 2. Detail-level aggregation (the three revenue meanings).
        const orderNumbers = orderAgg.order_numbers || [];
        let revenue_booked = 0;
        let revenue_cancelled = 0;
        let revenue_delivered = 0;

        if (orderNumbers.length > 0) {
            const [revAgg = {}] = await OrderDetails.aggregate([
                {
                    $match: {
                        order_number: { $in: orderNumbers },
                        is_free: { $ne: true },
                    },
                },
                {
                    $group: {
                        _id: null,
                        revenue_booked: {
                            $sum: { $multiply: ["$qty_ordered", "$unit_product_price"] },
                        },
                        revenue_cancelled: {
                            $sum: { $multiply: [{ $ifNull: ["$total_cancelled_qty", 0] }, "$unit_product_price"] },
                        },
                        revenue_delivered: {
                            $sum: { $multiply: [{ $ifNull: ["$qty_delivered", 0] }, "$unit_product_price"] },
                        },
                    },
                },
            ]);
            revenue_booked = revAgg.revenue_booked || 0;
            revenue_cancelled = revAgg.revenue_cancelled || 0;
            revenue_delivered = revAgg.revenue_delivered || 0;
        }

        const revenue_pending = Math.max(0, revenue_booked - revenue_cancelled - revenue_delivered);

        const status_distribution = Object.values(ORDER_STATUSES)
            .reduce((acc, s) => { acc[s] = 0; return acc; }, {});

        for (const s of orderAgg.statuses || []) {
            if (status_distribution[s] !== undefined) status_distribution[s] += 1;
        }

        return {
            range: { from: fromDate, to: toDate },
            orders_total: orderAgg.orders_total || 0,
            orders_delivered: orderAgg.orders_delivered || 0,
            orders_completed: orderAgg.orders_completed || 0,
            orders_cancelled: orderAgg.orders_cancelled || 0,
            revenue_booked,
            revenue_cancelled,
            revenue_delivered,
            revenue_pending,
            revenue_paid: orderAgg.revenue_paid || 0,
            revenue_due: orderAgg.revenue_due || 0,
            status_distribution,
        };
    }),

    // Time-series for the main line chart.
    getSalesTrend: asyncHandler(async ({ from, to, interval = "day", dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const formatByInterval = {
            day: "%Y-%m-%d",
            week: "%G-W%V",
            month: "%Y-%m",
        };
        const fmt = formatByInterval[interval];
        if (!fmt) {
            throw new BadRequestException("interval must be one of: day, week, month.");
        }

        const match = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });

        // Per-bucket series with three honest revenue meanings (mirrors /summary):
        //   revenue   = booked    = SUM(qty_ordered          × unit_product_price)
        //   delivered = delivered = SUM(qty_delivered        × unit_product_price)
        //   cancelled = cancelled = SUM(total_cancelled_qty  × unit_product_price)
        //   paid      = from Order.amount_paid (payments collected)
        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    revenue_booked: {
                        $reduce: {
                            input: "$details",
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    {
                                        $cond: [
                                            { $ne: ["$$this.is_free", true] },
                                            { $multiply: [
                                                { $ifNull: ["$$this.qty_ordered", 0] },
                                                { $ifNull: ["$$this.unit_product_price", 0] },
                                            ]},
                                            0,
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                    revenue_delivered: {
                        $reduce: {
                            input: "$details",
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    { $multiply: [
                                        { $ifNull: ["$$this.qty_delivered", 0] },
                                        { $ifNull: ["$$this.unit_product_price", 0] },
                                    ]},
                                ],
                            },
                        },
                    },
                    revenue_cancelled: {
                        $reduce: {
                            input: "$details",
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    { $multiply: [
                                        { $ifNull: ["$$this.total_cancelled_qty", 0] },
                                        { $ifNull: ["$$this.unit_product_price", 0] },
                                    ]},
                                ],
                            },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: fmt, date: "$created_at", timezone: "Asia/Kolkata" } },
                    orders: { $sum: 1 },
                    revenue: { $sum: "$revenue_booked" },
                    delivered: { $sum: "$revenue_delivered" },
                    cancelled: { $sum: "$revenue_cancelled" },
                    paid: { $sum: "$amount_paid" },
                },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: "$_id", orders: 1, revenue: 1, delivered: 1, cancelled: 1, paid: 1 } },
        ]);

        return { interval, series: rows };
    }),

    // Top-N products by quantity sold or revenue.
    getTopProducts: asyncHandler(async ({ from, to, limit, metric = "revenue", dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        if (!["revenue", "qty"].includes(metric)) {
            throw new BadRequestException("metric must be 'revenue' or 'qty'.");
        }

        const cap = parseLimit(limit);

        // Scope by parent Order via $lookup so role-based filtering still applies.
        const orderMatch = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });

        // Pre-filter orders first (uses indexes), then join their details.
        const scopedOrderNumbers = await Order.find(orderMatch).distinct("order_number");

        if (scopedOrderNumbers.length === 0) {
            return { metric, items: [] };
        }

        const sortField = metric === "qty" ? "qty_sold" : "revenue";

        // qty_sold  = SUM(qty_ordered)                        — booked units
        // revenue   = SUM(qty_ordered × unit_product_price)   — booked revenue
        const rows = await OrderDetails.aggregate([
            { $match: { order_number: { $in: scopedOrderNumbers }, is_free: { $ne: true } } },
            {
                $group: {
                    _id: "$product_id",
                    product_name: { $first: "$product_name" },
                    product_brand: { $first: "$product_brand" },
                    product_model: { $first: "$product_model" },
                    qty_sold: { $sum: "$qty_ordered" },
                    revenue: { $sum: { $multiply: ["$qty_ordered", "$unit_product_price"] } },
                },
            },
            { $sort: { [sortField]: -1 } },
            { $limit: cap },
            {
                $project: {
                    _id: 0,
                    product_id: "$_id",
                    product_name: 1,
                    product_brand: 1,
                    product_model: 1,
                    qty_sold: 1,
                    revenue: 1,
                },
            },
        ]);

        return { metric, items: rows };
    }),

    // Top-N dealers by total revenue (with paid / due / orders breakdown).
    getTopDealers: asyncHandler(async ({ from, to, limit, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const cap = parseLimit(limit);

        // Reuse the scoped match builder. Dealers can't call this (they only see themselves).
        const match = buildScopedMatch({ from: fromDate, to: toDate, salesman_id });

        // revenue = booked revenue = SUM over orders of SUM(qty_ordered × unit_product_price)
        // paid / due come from Order (payment-related, unchanged semantics)
        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    order_revenue_booked: {
                        $reduce: {
                            input: "$details",
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    {
                                        $cond: [
                                            { $ne: ["$$this.is_free", true] },
                                            { $multiply: [
                                                { $ifNull: ["$$this.qty_ordered", 0] },
                                                { $ifNull: ["$$this.unit_product_price", 0] },
                                            ]},
                                            0,
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: "$dealer_id",
                    orders_count: { $sum: 1 },
                    revenue: { $sum: "$order_revenue_booked" },
                    paid: { $sum: "$amount_paid" },
                    due: { $sum: "$amount_due" },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: cap },
            {
                $lookup: {
                    from: "employees",
                    localField: "_id",
                    foreignField: "employee_id",
                    as: "dealer",
                },
            },
            { $unwind: { path: "$dealer", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    dealer_id: "$_id",
                    dealer_name: "$dealer.employee_name",
                    shop_name: "$dealer.shop_name",
                    district: "$dealer.district",
                    orders_count: 1,
                    revenue: 1,
                    paid: 1,
                    due: 1,
                },
            },
        ]);

        return { items: rows };
    }),

    // Top-N brands by quantity or revenue.
    getTopBrands: asyncHandler(async ({ from, to, limit, metric = "qty", dealer_id, salesman_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }
        if (!["revenue", "qty"].includes(metric)) {
            throw new BadRequestException("metric must be 'revenue' or 'qty'.");
        }

        const cap = parseLimit(limit);
        const orderMatch = buildScopedMatch({
            from: fromDate, to: toDate, dealer_id, salesman_id,
        });

        const scopedOrderNumbers = await Order.find(orderMatch).distinct("order_number");
        if (scopedOrderNumbers.length === 0) {
            return { metric, items: [] };
        }

        const sortField = metric === "revenue" ? "revenue" : "qty_sold";

        // qty_sold = SUM(qty_ordered)                        — booked units per brand
        // revenue  = SUM(qty_ordered × unit_product_price)   — booked revenue per brand
        const rows = await OrderDetails.aggregate([
            {
                $match: {
                    order_number: { $in: scopedOrderNumbers },
                    is_free: { $ne: true },
                },
            },
            {
                $group: {
                    _id: "$product_brand",
                    qty_sold: { $sum: "$qty_ordered" },
                    revenue: { $sum: { $multiply: ["$qty_ordered", "$unit_product_price"] } },
                    orders: { $addToSet: "$order_number" },
                },
            },
            {
                $project: {
                    _id: 0,
                    product_brand: "$_id",
                    qty_sold: 1,
                    revenue: 1,
                    orders_count: { $size: "$orders" },
                },
            },
            { $sort: { [sortField]: -1 } },
            { $limit: cap },
        ]);

        return { metric, items: rows };
    }),

    // Top-N salesmen by revenue (orders + paid + due breakdown).
    getTopSalesmen: asyncHandler(async ({ from, to, limit, dealer_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const cap = parseLimit(limit);
        const match = buildScopedMatch({ from: fromDate, to: toDate, dealer_id });

        // revenue = booked revenue per salesman (same definition as top-dealers).
        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            {
                $addFields: {
                    order_revenue_booked: {
                        $reduce: {
                            input: "$details",
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    {
                                        $cond: [
                                            { $ne: ["$$this.is_free", true] },
                                            { $multiply: [
                                                { $ifNull: ["$$this.qty_ordered", 0] },
                                                { $ifNull: ["$$this.unit_product_price", 0] },
                                            ]},
                                            0,
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: "$salesman_id",
                    orders_count: { $sum: 1 },
                    revenue: { $sum: "$order_revenue_booked" },
                    paid: { $sum: "$amount_paid" },
                    due: { $sum: "$amount_due" },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: cap },
            {
                $lookup: {
                    from: "employees",
                    localField: "_id",
                    foreignField: "employee_id",
                    as: "salesman",
                },
            },
            { $unwind: { path: "$salesman", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    salesman_id: "$_id",
                    salesman_name: "$salesman.employee_name",
                    district: "$salesman.district",
                    orders_count: 1,
                    revenue: 1,
                    paid: 1,
                    due: 1,
                },
            },
        ]);

        return { items: rows };
    }),

    // Salesman target vs achievement (items sold).
    // Target = (per-salesman target if/when set) || DEFAULT_SALESMAN_TARGET_QTY.
    // Achieved = SUM(orderDetails.qty_ordered) across all the salesman's orders in range.
    //   Example: an order with line items [12, 18, 2] contributes 32 to this number.
    getSalesmanAchievement: asyncHandler(async ({ from, to, dealer_id }) => {
        const fromDate = parseDate(from, "from");
        const toDate = parseDate(to, "to");

        if (fromDate > toDate) {
            throw new BadRequestException("'from' must be earlier than 'to'.");
        }

        const match = buildScopedMatch({ from: fromDate, to: toDate, dealer_id });

        const rows = await Order.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: "orderdetails",
                    localField: "order_number",
                    foreignField: "order_number",
                    as: "details",
                },
            },
            { $unwind: { path: "$details", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: "$salesman_id",
                    achieved_qty: { $sum: { $ifNull: ["$details.qty_ordered", 0] } },
                    orders_set: { $addToSet: "$order_number" },
                    revenue: { $sum: { $ifNull: ["$details.total_price", 0] } },
                },
            },
            {
                $lookup: {
                    from: "employees",
                    localField: "_id",
                    foreignField: "employee_id",
                    as: "salesman",
                },
            },
            { $unwind: { path: "$salesman", preserveNullAndEmptyArrays: true } },
            { $sort: { achieved_qty: -1 } },
            {
                $project: {
                    _id: 0,
                    salesman_id: "$_id",
                    salesman_name: "$salesman.employee_name",
                    achieved_qty: 1,
                    orders_count: { $size: "$orders_set" },
                    revenue: 1,
                },
            },
        ]);

        const target_qty = DEFAULT_SALESMAN_TARGET_QTY;

        const items = rows.map((r) => ({
            salesman_id: r.salesman_id,
            salesman_name: r.salesman_name || "—",
            target_qty,
            achieved_qty: r.achieved_qty || 0,
            achievement_pct: target_qty > 0
                ? Number(((r.achieved_qty / target_qty) * 100).toFixed(1))
                : 0,
            orders_count: r.orders_count || 0,
            revenue: r.revenue || 0,
        }));

        return {
            default_target_qty: target_qty,
            items,
        };
    }),

};

export default analyticsService;
