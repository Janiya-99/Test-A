const express = require("express");
const router = express.Router();
const { getPublicPurchaseOrderDetails } = require("../controllers/publicPurchaseOrderController");

router.get("/single/:token", getPublicPurchaseOrderDetails);

module.exports = router;
