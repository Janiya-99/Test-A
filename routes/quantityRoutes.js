const express = require("express");
const router = express.Router();
const quantityTypeController = require("../controllers/quantityController");

// Routes
router.post("/", quantityTypeController.createQuantityType);
router.get("/:Branch_idBranch", quantityTypeController.getQuantityTypes);
router.put("/:id", quantityTypeController.updateQuantityType);
router.delete("/:id", quantityTypeController.deleteQuantityType);

module.exports = router;
