// routes/analyticsRoute.js
import express from "express";

import analyticsController from "../controllers/analyticsController.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

router.use(verifyToken);

router.get("/summary", analyticsController.summary);
router.get("/sales-trend", analyticsController.salesTrend);
router.get("/top-products", analyticsController.topProducts);
router.get("/top-dealers", analyticsController.topDealers);
router.get("/top-brands", analyticsController.topBrands);
router.get("/top-salesmen", analyticsController.topSalesmen);
router.get("/salesman-achievement", analyticsController.salesmanAchievement);

export default router;
