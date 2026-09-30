const express = require("express");
const router = express.Router();
const configureController = require("../controllers/configureController");

// CREATE Field
router.post("/fields", configureController.createField);

// CREATE Option
router.post("/fields/:field_id/options", configureController.createOption);

// GET Fields by Project (includes options & members)
router.get("/fields/:project_id", configureController.getFieldsByProject);

// UPDATE Field
router.patch("/fields/:field_id/update", configureController.updateField);

// Soft Delete Field
router.patch(
  "/fields/:field_id/deactivate",
  configureController.softDeleteField
);

// Soft Delete Option
router.patch(
  "/options/:option_id/deactivate",
  configureController.softDeleteOption
);

// DELETE All Options by Field
router.delete(
  "/fields/:field_id/options",
  configureController.deleteOptionsByField);

router.post("/fields/:project_id/order", configureController.updateFieldOrder);




module.exports = router;
