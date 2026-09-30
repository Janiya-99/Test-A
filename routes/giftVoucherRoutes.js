const express = require("express");
const router = express.Router();
const controller = require("../controllers/giftVoucherController");

// Settings
router.get("/settings/:branchId", controller.getSettings);
router.post("/settings/:branchId", controller.saveSettings);

// Issuance
router.post("/issue", controller.issueVoucher);
router.post("/batch-generate", controller.batchGenerate);

// Invoicing gift vouchers (customers purchasing vouchers)
router.post("/invoice-vouchers", controller.invoiceVouchers);

// Redemption & Verification
router.get("/verify/:code", controller.verifyVoucher);
router.post("/claim", controller.claimVoucher);
router.post("/void/:id", controller.voidVoucher);

// Directory & Dashboard
router.get("/list/:branchId", controller.getList);
router.get("/dashboard/:branchId", controller.getDashboard);
router.get("/view/:id", controller.getVoucher);

// Quick modal picker — returns ACTIVE vouchers for POS / AddInvoice overlay
router.get("/unlinked/:branchId", controller.getUnlinkedVouchers);

module.exports = router;
