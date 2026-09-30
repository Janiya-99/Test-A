const express = require("express");
const router = express.Router();
const approvalMiddleware = require("../middlewares/approvalMiddleware");

const {
  createCustomerReturn,
  getProcessReturns,
  getCustomerReturnById,
  updateCustomerReturn,
  processCustomerReturn,
  unprocessCustomerReturn,
  checkReturnSerial,
  getCustomerInvoicesForReturn,
  getInvoiceItemsForReturn,
  getCustomerOutstandingInvoices,
  deleteCustomerReturnById,
  getSoldSerials,
  lookupBarcodeForReturn,
} = require("../controllers/customerReturnController");

router.post("/", createCustomerReturn);
router.post("/process", approvalMiddleware.preventModificationIfPending("customer_return", "req.body.idCustomer_Return"), processCustomerReturn);
router.post("/unprocess", approvalMiddleware.preventModificationIfPending("customer_return", "req.body.idCustomer_Return"), unprocessCustomerReturn);
router.post("/check-serials", checkReturnSerial);
router.get("/lookup-barcode/:barcode/:branchId", lookupBarcodeForReturn);
router.get("/sold-serials/:Item_idItem", getSoldSerials);
router.get("/invoices/:customerId/:branchId", getCustomerInvoicesForReturn);
router.get("/outstanding-invoices/:customerId/:branchId", getCustomerOutstandingInvoices);
router.get("/invoice-items/:invoiceId", getInvoiceItemsForReturn);
router.get("/:Branch_idBranch", getProcessReturns);
router.get("/single/:idCustomer_Return", getCustomerReturnById);
router.put("/:idCustomer_Return", approvalMiddleware.preventModificationIfPending("customer_return", "req.params.idCustomer_Return"), updateCustomerReturn);
router.delete("/:idCustomer_Return", approvalMiddleware.preventModificationIfPending("customer_return", "req.params.idCustomer_Return"), deleteCustomerReturnById);

module.exports = router;
