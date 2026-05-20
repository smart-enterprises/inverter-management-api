// controllers/analyticsController.js
import asyncHandler from "express-async-handler";

import analyticsService from "../service/analyticsService.js";
import { buildResponse } from "../utils/responseUtils.js";

const analyticsController = {

    summary: asyncHandler(async (req, res) => {
        const data = await analyticsService.getSummary({
            from: req.query.from,
            to: req.query.to,
            dealer_id: req.query.dealer_id,
            salesman_id: req.query.salesman_id,
        });

        buildResponse({
            res,
            message: "Dashboard summary fetched successfully.",
            data,
        });
    }),

    salesTrend: asyncHandler(async (req, res) => {
        const data = await analyticsService.getSalesTrend({
            from: req.query.from,
            to: req.query.to,
            interval: req.query.interval,
            dealer_id: req.query.dealer_id,
            salesman_id: req.query.salesman_id,
        });

        buildResponse({
            res,
            message: "Sales trend fetched successfully.",
            data,
        });
    }),

    topProducts: asyncHandler(async (req, res) => {
        const data = await analyticsService.getTopProducts({
            from: req.query.from,
            to: req.query.to,
            limit: req.query.limit,
            metric: req.query.metric,
            dealer_id: req.query.dealer_id,
            salesman_id: req.query.salesman_id,
        });

        buildResponse({
            res,
            message: "Top products fetched successfully.",
            data,
        });
    }),

    topDealers: asyncHandler(async (req, res) => {
        const data = await analyticsService.getTopDealers({
            from: req.query.from,
            to: req.query.to,
            limit: req.query.limit,
            salesman_id: req.query.salesman_id,
        });

        buildResponse({
            res,
            message: "Top dealers fetched successfully.",
            data,
        });
    }),

    topBrands: asyncHandler(async (req, res) => {
        const data = await analyticsService.getTopBrands({
            from: req.query.from,
            to: req.query.to,
            limit: req.query.limit,
            metric: req.query.metric,
            dealer_id: req.query.dealer_id,
            salesman_id: req.query.salesman_id,
        });

        buildResponse({
            res,
            message: "Top brands fetched successfully.",
            data,
        });
    }),

    topSalesmen: asyncHandler(async (req, res) => {
        const data = await analyticsService.getTopSalesmen({
            from: req.query.from,
            to: req.query.to,
            limit: req.query.limit,
            dealer_id: req.query.dealer_id,
        });

        buildResponse({
            res,
            message: "Top salesmen fetched successfully.",
            data,
        });
    }),

    salesmanAchievement: asyncHandler(async (req, res) => {
        const data = await analyticsService.getSalesmanAchievement({
            from: req.query.from,
            to: req.query.to,
            dealer_id: req.query.dealer_id,
        });

        buildResponse({
            res,
            message: "Salesman achievement fetched successfully.",
            data,
        });
    }),

};

export default analyticsController;
