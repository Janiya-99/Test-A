const express = require("express");
const router = express.Router();

const upload = require("./../utils/multerConfig");
const {
  getBranchAddress,
  createBranch,
  changeBranchLogo,
  getAccountDetails,
  updateBranch,
  getBranchPaymentDetails,
  updatePaymentDetails,
  getBranchRuleDetails,
  updateRuleDetails,
  getUserPrivilages,
  updatePrivilagesDetails,
  getAllBranches,
  updateBranchStatus,
  deleteBranch,
  transferMainBranch,
  updateValuationMethod,
  updateProfitLossByPaidAmount,
  updateGeminiApiKey,
  updateLoyaltyStatus,
  updateGiftVoucherStatus,
  updateStockManagementMode,
  updateRouteManagementStatus,
  getSmsSettings,
  saveSmsSettings,
  getSmsPortalInfo,
  syncBranchCatalog,
  getBranchStockSummary,
} = require("../controllers/branchController");


// New routes for branch management
router.post("/update-valuation-method/:Branch_idBranch", updateValuationMethod);
router.post("/update-profit-loss-by-paid-amount/:Branch_idBranch", updateProfitLossByPaidAmount);
router.post("/update-gemini-key/:Branch_idBranch", updateGeminiApiKey);
router.post("/update-loyalty-status/:Branch_idBranch", updateLoyaltyStatus);
router.post("/update-gift-voucher-status/:Branch_idBranch", updateGiftVoucherStatus);
router.post("/update-stock-management-mode/:Branch_idBranch", updateStockManagementMode);
router.post("/update-route-management-status/:Branch_idBranch", updateRouteManagementStatus);
router.get("/sms-settings/:branch_id", getSmsSettings);
router.post("/sms-settings/:branch_id", saveSmsSettings);
router.get("/sms-portal-info/:branch_id", getSmsPortalInfo);


router.get("/list/:Company_idCompany", getAllBranches);
router.patch("/:idBranch/status", updateBranchStatus);
router.delete("/:idBranch", deleteBranch);
router.get("/get-address/:Branch_idBranch", getBranchAddress);

// Existing routes
router.post("/", createBranch);
router.get("/get-account-details/:Branch_idBranch", getAccountDetails);
router.get("/user-privilages/:Branch_idBranch", getUserPrivilages);
router.post("/update-privilage-details/:idUser", updatePrivilagesDetails);
router.get("/:Branch_idBranch", getBranchAddress);
router.put("/:idBranch", updateBranch);
router.post("/change-logo", upload.single("img"), changeBranchLogo);
router.get("/get-payment-details/:Branch_idBranch", getBranchPaymentDetails);
router.post("/update-payment-details/:Branch_idBranch", updatePaymentDetails);
router.get("/get-rule-details/:Branch_idBranch", getBranchRuleDetails);
router.post(
  "/update-rule-details/:Branch_idBranch",
  upload.fields([
    { name: "headerImg", maxCount: 1 },
    { name: "footerImg", maxCount: 1 },
  ]),
  updateRuleDetails,
);

// Transfer main branch designation
router.post("/:idBranch/set-main", transferMainBranch);

// Stock & Catalog Management routes
router.post("/:idBranch/sync-catalog", syncBranchCatalog);
router.get("/:idBranch/stock-summary", getBranchStockSummary);

module.exports = router;

