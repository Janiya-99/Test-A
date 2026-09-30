const express = require("express");
const router = express.Router();
const {
  getCustomerCreditLog,
  createCustomerLog,
  getCustomerPastpayments,
  addManualCredit,
  getInvoicePayments,
  deleteCustomerCreditLog,
} = require("../controllers/customerCreditLogController");

router.get("/:Customer_idCustomer", getCustomerCreditLog);

router.get("/branch/:Branch_idBranch", getCustomerPastpayments);

router.get("/invoice/:idInvoice", getInvoicePayments);

router.post("/manual", addManualCredit);

router.post("/", createCustomerLog);

router.delete("/:idCustomer_Credit_Log", deleteCustomerCreditLog);

module.exports = router;
