const express = require("express");
const router = express.Router();
const { getCustomerCreditSummary, getCustomerInvoices, getCustomerInvoiceDetails, getAllCustomerInvoiceDetails , getPaymentLogs } = require("../controllers/creditController");


router.get("/summary/:Branch_idBranch", getCustomerCreditSummary);
router.get("/credit/:customerId", getCustomerInvoices);
router.get("/invoices/:customerId", getCustomerInvoiceDetails);
router.get("/invoices", getAllCustomerInvoiceDetails);
router.get('/payment', getPaymentLogs);

module.exports = router;