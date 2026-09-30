const express = require("express");
const router = express.Router();
const estimateController = require("../controllers/estimateController");

// Estimates CRUD
router.post("/", estimateController.createEstimate);
router.get("/branch/:branch_id", estimateController.getEstimates);
router.get("/:id", estimateController.getEstimateById);
router.put("/:id", estimateController.updateEstimate);
router.put("/status/:id", estimateController.updateEstimateStatus);
router.delete("/:id", estimateController.deleteEstimate);

// Settings (includes custom_fields_config)
router.get("/settings/:branch_id", estimateController.getSettings);
router.put("/settings/:branch_id", estimateController.updateSettings);

// Insurance companies list
router.get("/insurance-companies/:branch_id", estimateController.getInsuranceCompanies);
router.post("/insurance-companies/:branch_id", estimateController.addInsuranceCompany);
router.delete("/insurance-companies/:id", estimateController.deleteInsuranceCompany);

module.exports = router;
