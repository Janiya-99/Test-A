const express = require("express");
const router = express.Router();
const serviceJobController = require("../controllers/serviceJobController");

// Service Job Routes
router.post("/", serviceJobController.createServiceJob);
router.post("/from-estimate/:estimate_id", serviceJobController.convertEstimateToServiceJob);
router.get("/report/data", serviceJobController.getServiceJobReport);
router.get("/branch/:branch_id", serviceJobController.getServiceJobs);
router.get("/:id", serviceJobController.getServiceJobById);
router.put("/:id", serviceJobController.updateServiceJob);
router.put("/status/:id", serviceJobController.updateServiceJobStatus);
router.delete("/:id", serviceJobController.deleteServiceJob);

// Settings Routes
router.get("/settings/:branch_id", serviceJobController.getSettings);
router.put("/settings/:branch_id", serviceJobController.updateSettings);
router.get("/settings/prefix/:branch_id", serviceJobController.getPrefixSettings);

module.exports = router;
