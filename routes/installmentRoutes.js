const express = require("express");
const router = express.Router();
const {
  getInstallmentsByDates,
  processInstallment,
  getInstallmentsByInvoice,
  sendInstallmentReminder,
} = require("../controllers/installmentController");

router.get(
  "/get-installments-by-date-and-customer/:date_type/:from_date/:to_date/:current_date/:Branch_idBranch/:customer",
  getInstallmentsByDates,
);

router.put("/:idInstallment_Payment", processInstallment);
router.get("/invoice/:invoiceId", getInstallmentsByInvoice);
router.post("/send-reminder/:idInstallment_Payment", sendInstallmentReminder);

module.exports = router;
