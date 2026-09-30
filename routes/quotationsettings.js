const express = require("express");
const router = express.Router();
const QuotationSettingsController = require("../controllers/Quotationsettings");

// Header settings
router.get("/get-header", QuotationSettingsController.getHeader);
router.post("/save-header", QuotationSettingsController.saveHeader);

// Footer settings
router.get("/get-footer", QuotationSettingsController.getFooter);
router.post("/save-footer", QuotationSettingsController.saveFooter);

// Table settings
router.get("/get-table-settings", QuotationSettingsController.getTableSettings);
router.post("/save-table-settings", QuotationSettingsController.saveTableSettings);

// Main settings
router.get("/get-main-settings", QuotationSettingsController.getMainSettings);
router.post("/save-main-settings", QuotationSettingsController.saveMainSettings);

module.exports = router;
