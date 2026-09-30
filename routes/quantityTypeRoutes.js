const express = require("express");
const router = express.Router();
const { getQuantityTypes } = require("../controllers/quantityTypeController");

router.get("/", getQuantityTypes);

module.exports = router;
