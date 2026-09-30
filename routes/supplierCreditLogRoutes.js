const express = require("express");
const router = express.Router();
const {
  getSupplierLog,
  getGrnPayments,
  createSupplierLog,
  addManualCredit,
  deleteSupplierCreditLog,
} = require("../controllers/supplierCreditLogController");

router.get("/grn/:idGRN", getGrnPayments);
router.get("/:Supplier_idSupplier", getSupplierLog);
router.post("/manual", addManualCredit);
router.post("/", createSupplierLog);
router.delete("/:idSupplier_Log", deleteSupplierCreditLog);

module.exports = router;
