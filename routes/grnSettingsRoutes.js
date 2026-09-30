const express = require("express");
const router = express.Router();
const grnSettingsController = require("../controllers/grnSettingsController");

router.get("/get/:branchId/:supplierId", grnSettingsController.getGrnSettings);
router.put("/save/:branchId/:supplierId", grnSettingsController.saveGrnSettings);

module.exports = router;
