const express = require("express");
const router = express.Router();
const {
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
} = require("../controllers/customerLoyaltyController");

// 1. Loyalty Settings
router.get("/settings/:branchId", getSettings);
router.post("/settings/:branchId", updateSettings);

// 2. Single Customer Loyalty Profile & Transactions
router.get("/customer/:customerId", getCustomerProfile);
router.post("/customer/:customerId/adjust", adjustPoints);

// 3. Loyalty Redemption (In-checkout verification)
router.get("/eligibility/:customerId", checkEligibility);
router.post("/redemption/request-otp", requestOTP);
router.post("/redemption/resend-otp", resendOTP);
router.post("/redemption/verify-otp", verifyOTP);

// 4. Company Loyalty Dashboard
router.get("/dashboard/:branchId", getDashboard);

// 5. Paginated Customer Directory
router.get("/customers/:branchId", getCustomers);

module.exports = router;

