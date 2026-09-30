const customerLoyaltyService = require("../services/customerLoyaltyService");

/**
 * Customer Loyalty Controller
 */

// 1. Get Loyalty Settings for a branch
const getSettings = async (req, res) => {
  try {
    const { branchId } = req.params;
    const settings = await customerLoyaltyService.getLoyaltySettings(branchId);
    res.status(200).json({ success: true, settings });
  } catch (error) {
    console.error("[CustomerLoyaltyController] getSettings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loyalty settings",
      error: error.message,
    });
  }
};

// 2. Save / update Loyalty Settings for a branch
const updateSettings = async (req, res) => {
  try {
    const { branchId } = req.params;
    const settingsData = req.body;
    const result = await customerLoyaltyService.saveLoyaltySettings(branchId, settingsData);
    res.status(200).json({
      success: true,
      message: "Loyalty settings saved successfully",
      settings: result.settings,
    });
  } catch (error) {
    console.error("[CustomerLoyaltyController] updateSettings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save loyalty settings",
      error: error.message,
    });
  }
};

// 3. Get single customer's loyalty profile & transaction ledger
const getCustomerProfile = async (req, res) => {
  try {
    const { customerId } = req.params;
    const branchId = req.query.branchId || null;
    const profile = await customerLoyaltyService.getCustomerLoyaltyProfile(customerId, branchId);
    res.status(200).json({ success: true, ...profile });
  } catch (error) {
    console.error("[CustomerLoyaltyController] getCustomerProfile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer loyalty profile",
      error: error.message,
    });
  }
};

// 4. Manual points adjustment (credit/debit)
const adjustPoints = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { branchId, points, type, note } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || null;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }

    const result = await customerLoyaltyService.adjustCustomerPoints({
      customerId: parseInt(customerId, 10),
      branchId: parseInt(branchId, 10),
      points,
      type,
      note,
      userId,
    });

    res.status(200).json({
      success: true,
      message: `Successfully ${type === "MANUAL_ADD" ? "added" : "deducted"} ${points} points`,
      ...result,
    });
  } catch (error) {
    console.error("[CustomerLoyaltyController] adjustPoints error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to adjust customer points",
    });
  }
};

// 5. Company-wide loyalty dashboard metrics & charts data
const getDashboard = async (req, res) => {
  try {
    const { branchId } = req.params;
    const dashboardData = await customerLoyaltyService.getCompanyLoyaltyDashboard(branchId);
    res.status(200).json({ success: true, ...dashboardData });
  } catch (error) {
    console.error("[CustomerLoyaltyController] getDashboard error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch loyalty dashboard data",
      error: error.message,
    });
  }
};

// 6. Paginated customer loyalty list for company
const getCustomers = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { page, limit, search, tier } = req.query;

    const listData = await customerLoyaltyService.getCompanyCustomersLoyaltyList(branchId, {
      page,
      limit,
      search,
      tier,
    });

    res.status(200).json({ success: true, ...listData });
  } catch (error) {
    console.error("[CustomerLoyaltyController] getCustomers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer loyalty directory",
      error: error.message,
    });
  }
};

// 7. Check redemption eligibility for customer & bill
const checkEligibility = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { branchId, billAmount } = req.query;
    if (!branchId) {
      return res.status(400).json({ success: false, message: "Branch ID is required" });
    }
    const result = await customerLoyaltyService.checkRedemptionEligibility({
      customerId: parseInt(customerId, 10),
      branchId: parseInt(branchId, 10),
      billAmount: parseFloat(billAmount) || 0,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("[CustomerLoyaltyController] checkEligibility error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to check redemption eligibility",
    });
  }
};

// 8. Request OTP for points redemption
const requestOTP = async (req, res) => {
  try {
    const { customerId, branchId, pointsToRedeem, channel, billAmount } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || null;
    if (!customerId || !branchId || !pointsToRedeem) {
      return res.status(400).json({
        success: false,
        message: "Customer ID, branch ID, and points to redeem are required",
      });
    }
    const result = await customerLoyaltyService.requestRedemptionOTP({
      customerId: parseInt(customerId, 10),
      branchId: parseInt(branchId, 10),
      pointsToRedeem: parseFloat(pointsToRedeem),
      channel: channel || "SMS",
      billAmount: parseFloat(billAmount) || 0,
      userId,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("[CustomerLoyaltyController] requestOTP error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to send verification code",
    });
  }
};

// 9. Resend OTP for points redemption
const resendOTP = async (req, res) => {
  try {
    const { redemptionToken } = req.body;
    const userId = req.user?.id || req.user?.userId || req.body.userId || null;
    if (!redemptionToken) {
      return res.status(400).json({
        success: false,
        message: "Redemption token is required",
      });
    }
    const result = await customerLoyaltyService.resendRedemptionOTP({
      redemptionToken,
      userId,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("[CustomerLoyaltyController] resendOTP error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to resend verification code",
    });
  }
};

// 10. Verify OTP for points redemption
const verifyOTP = async (req, res) => {
  try {
    const { redemptionToken, otpCode } = req.body;
    if (!redemptionToken || !otpCode) {
      return res.status(400).json({
        success: false,
        message: "Redemption token and OTP code are required",
      });
    }
    const result = await customerLoyaltyService.verifyRedemptionOTP({
      redemptionToken,
      otpCode,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error("[CustomerLoyaltyController] verifyOTP error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to verify code",
    });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  getCustomerProfile,
  adjustPoints,
  getDashboard,
  getCustomers,
  checkEligibility,
  requestOTP,
  resendOTP,
  verifyOTP,
};

