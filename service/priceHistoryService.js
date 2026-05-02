import ProductPriceHistory from "../models/productPriceHistory.js";
import { generateUniquePriceHistoryId } from "../utils/generatorIds.js";
import logger from "../utils/logger.js";

export const createPriceHistory = async ({
    product_id,
    old_price,
    new_price,
    changed_by,
    change_reason,
    isCostUpdate = false
}) => {

    if (!product_id || new_price === undefined || !changed_by) {
        throw new Error("Invalid price history payload");
    }

    const priceHistoryId = await generateUniquePriceHistoryId();

    const history = await ProductPriceHistory.create({
        price_history_id: priceHistoryId,
        product_id,
        old_price,
        new_price,
        changed_by,
        change_reason,
        is_cost_update: isCostUpdate
    });

    logger.info(`📝 PriceHistory Logged → Product:${product_id}, Old Price:${old_price}, New Price:${new_price}, Changed By:${changed_by}`);

    return history;
};