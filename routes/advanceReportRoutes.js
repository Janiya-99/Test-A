const express = require("express");
const router = express.Router();
const advanceReportController = require("../controllers/advanceReportController");
// const authMiddleware = require("../middlewares/authMiddleware"); // Assuming auth is needed

router.get("/columns", advanceReportController.getColumns);
router.post("/generate", advanceReportController.generateAdvancedReport);
router.post("/save", advanceReportController.saveConfiguration);
router.get("/saved", advanceReportController.getSavedConfigurations);
router.delete("/saved/:id", advanceReportController.deleteConfiguration);

module.exports = router;
