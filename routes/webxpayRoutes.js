const express = require("express");
const router = express.Router();
const { generateWebxpayParams } = require("../controllers/webxpayController");

router.post("/webxpay/payment-params", generateWebxpayParams);

module.exports = router;
