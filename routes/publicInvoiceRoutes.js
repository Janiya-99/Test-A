const express = require("express");
const router = express.Router();
const { getPublicInvoiceDetails } = require("../controllers/publicInvoiceController");

router.get("/single/:token", getPublicInvoiceDetails);

module.exports = router;
