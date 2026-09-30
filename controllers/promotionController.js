const promotionDBService = require("../services/promotionDBService");

const formatDateSL = (dateVal) => {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    return dateVal.split('T')[0];
  }
  if (dateVal instanceof Date) {
    const year = dateVal.getFullYear();
    const month = String(dateVal.getMonth() + 1).padStart(2, '0');
    const day = String(dateVal.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return dateVal;
};

const formatRuleDates = (rule) => {
  if (!rule) return rule;
  return {
    ...rule,
    start_date: formatDateSL(rule.start_date),
    end_date: formatDateSL(rule.end_date),
  };
};

const createRule = async (req, res) => {
  try {
    const {
      name,
      trigger_product_id,
      min_qty,
      reward_product_id,
      reward_qty,
      is_active,
      Branch_idBranch,
      promo_type,
      discount_value,
      discount_type,
      start_date,
      end_date,
      start_time,
      end_time,
      days_of_week,
      is_whole_store
    } = req.body;

    const isWholeStoreNum = is_whole_store ? 1 : 0;

    if (!name || (!isWholeStoreNum && !trigger_product_id) || !min_qty || !Branch_idBranch || !promo_type) {
      return res.status(400).json({ success: false, message: "Required fields are missing" });
    }

    if (promo_type === 'buy_x_get_y' && (!reward_product_id || !reward_qty)) {
      return res.status(400).json({ success: false, message: "Reward product and quantity are required for 'Buy X Get Y' promotions" });
    }

    if (promo_type === 'buy_x_get_discount' && discount_value === undefined) {
      return res.status(400).json({ success: false, message: "Discount value is required for 'Buy X Get Discount' promotions" });
    }

    const result = await promotionDBService.insertPromotionRule(
      name,
      isWholeStoreNum ? null : trigger_product_id,
      parseInt(min_qty),
      reward_product_id ? parseInt(reward_product_id) : null,
      reward_qty ? parseInt(reward_qty) : null,
      is_active !== undefined ? parseInt(is_active) : 1,
      parseInt(Branch_idBranch),
      promo_type,
      discount_value ? parseFloat(discount_value) : 0,
      discount_type || 'percentage',
      start_date,
      end_date,
      start_time,
      end_time,
      days_of_week,
      isWholeStoreNum
    );

    res.status(201).json({
      success: true,
      message: "Promotion rule created successfully",
      ruleId: result.insertId,
    });
  } catch (error) {
    console.error("Error creating promotion rule:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getRules = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    if (!Branch_idBranch) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }

    const rules = await promotionDBService.fetchPromotionRules(parseInt(Branch_idBranch));
    const formattedRules = (rules || []).map(formatRuleDates);
    res.status(200).json({ success: true, data: formattedRules });
  } catch (error) {
    console.error("Error fetching promotion rules:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getActiveRules = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    if (!Branch_idBranch) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }

    const rules = await promotionDBService.fetchActivePromotionRules(parseInt(Branch_idBranch));
    const formattedRules = (rules || []).map(formatRuleDates);
    res.status(200).json({ success: true, data: formattedRules });
  } catch (error) {
    console.error("Error fetching active promotion rules:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getRule = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await promotionDBService.fetchPromotionRule(parseInt(id));
    if (rule.length === 0) {
      return res.status(404).json({ success: false, message: "Promotion rule not found" });
    }
    res.status(200).json({ success: true, data: formatRuleDates(rule[0]) });
  } catch (error) {
    console.error("Error fetching promotion rule:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const updateRule = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      trigger_product_id,
      min_qty,
      reward_product_id,
      reward_qty,
      is_active,
      promo_type,
      discount_value,
      discount_type,
      start_date,
      end_date,
      start_time,
      end_time,
      days_of_week,
      is_whole_store
    } = req.body;

    const isWholeStoreNum = is_whole_store ? 1 : 0;

    if (!name || (!isWholeStoreNum && !trigger_product_id) || !min_qty || !promo_type) {
      return res.status(400).json({ success: false, message: "Required fields are missing" });
    }

    if (promo_type === 'buy_x_get_y' && (!reward_product_id || !reward_qty)) {
      return res.status(400).json({ success: false, message: "Reward product and quantity are required for 'Buy X Get Y' promotions" });
    }

    await promotionDBService.updatePromotionRule(
      parseInt(id),
      name,
      isWholeStoreNum ? null : trigger_product_id,
      parseInt(min_qty),
      reward_product_id ? parseInt(reward_product_id) : null,
      reward_qty ? parseInt(reward_qty) : null,
      is_active !== undefined ? parseInt(is_active) : 1,
      promo_type,
      discount_value ? parseFloat(discount_value) : 0,
      discount_type || 'percentage',
      start_date,
      end_date,
      start_time,
      end_time,
      days_of_week,
      isWholeStoreNum
    );

    res.status(200).json({ success: true, message: "Promotion rule updated successfully" });
  } catch (error) {
    console.error("Error updating promotion rule:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const deleteRule = async (req, res) => {
  try {
    const { id } = req.params;
    await promotionDBService.deletePromotionRule(parseInt(id));
    res.status(200).json({ success: true, message: "Promotion rule deleted successfully" });
  } catch (error) {
    console.error("Error deleting promotion rule:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  createRule,
  getRules,
  getActiveRules,
  getRule,
  updateRule,
  deleteRule,
};
