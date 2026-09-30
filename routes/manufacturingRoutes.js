const express = require("express");
const router = express.Router();
const manufacturingController = require("../controllers/manufacturingController");

router.post("/", manufacturingController.createManufacturingJob);
router.get("/branch/:branch_id", manufacturingController.getManufacturingJobs);
router.get("/rules/:branch_id", manufacturingController.getManufacturingRules);
router.put("/rules/:branch_id", manufacturingController.updateManufacturingRules);
router.get("/:id", manufacturingController.getJobDetails);
router.put("/:id", manufacturingController.updateManufacturingJob);
router.delete("/:id", manufacturingController.deleteManufacturingJob);

router.post("/templates", manufacturingController.createTemplate);
router.get("/templates/branch/:branch_id", manufacturingController.getTemplates);
router.get("/templates/:id", manufacturingController.getTemplateDetails);
router.delete("/templates/:id", manufacturingController.deleteTemplate);

module.exports = router;
