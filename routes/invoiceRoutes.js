const express = require("express");
const router = express.Router();
const approvalMiddleware = require("../middlewares/approvalMiddleware");
const {
  createInvoice,
  getAllInvoices,
  getNextInvoiceId,
  getInvoiceById,
  getAllSerials,
  checkInvoice,
  getInvoiceforEdit,
  updateInvoice,
  deleteInvoice,
  getInvoiceForPrint,
  getInstallmentInvoicesByCustomer,
  importExcelInvoices,
  searchSerial,
  getInvoiceHistory,
  getCODInvoices,
  updateCODDeadline,
} = require("../controllers/invoiceController");

router.post("/", createInvoice);
router.post("/import-excel", importExcelInvoices);
router.get("/get-invoice-id/:Branch_idBranch", getNextInvoiceId);
router.get("/get-invoice-item-serials/:Item_idItem", getAllSerials);
router.get("/check-invoice/:invoice_id/:Branch_idBranch", checkInvoice);
router.get("/search-serial/:serialNo/:Branch_idBranch", searchSerial);
router.get("/:idInvoice/history", getInvoiceHistory);
router.get("/cod/list/:Branch_idBranch", getCODInvoices);
router.put("/cod/update-deadline", updateCODDeadline);
router.get("/:Branch_idBranch", getAllInvoices);

router.get("/single/:idInvoice", getInvoiceById);
router.get("/edit/:idInvoice", getInvoiceforEdit);
router.put("/update/:idInvoice", approvalMiddleware.preventModificationIfPending("invoice", "idInvoice", "idInvoice"), updateInvoice);

router.post("/delete/:idInvoice", approvalMiddleware.preventModificationIfPending("invoice", "idInvoice", "idInvoice"), deleteInvoice);
router.get("/print/:invoiceId", getInvoiceForPrint);
router.get(
  "/customer-installments/:customerId/:Branch_idBranch",
  getInstallmentInvoicesByCustomer,
);
module.exports = router;
