const express = require("express");
const router = express.Router();
const { transferStock } = require("../controllers/warehouseController");

// POST /api/stock-transfers
router.post("/", transferStock);

module.exports = router;
