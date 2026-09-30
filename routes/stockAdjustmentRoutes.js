const express = require("express");
const router = express.Router();
const {
  createStockAdjustment,
  getStockAdjustments,
  getStockAdjustmentById
} = require("../controllers/stockAdjustmentController");

// POST /api/stock-adjustments
router.post("/", createStockAdjustment);

// GET /api/stock-adjustments/branch/:branchId
router.get("/branch/:branchId", getStockAdjustments);

// GET /api/stock-adjustments/:id
router.get("/:id", getStockAdjustmentById);

module.exports = router;
