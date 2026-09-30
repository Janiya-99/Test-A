const express = require("express");
const router = express.Router();
const approvalMiddleware = require("../middlewares/approvalMiddleware");
const upload = require("./../utils/multerConfig");

const {
  createGrn,
  getGrns,
  getGrnById,
  updateGrn,
  processGrn,
  checkSerial,
  deleteGrn,
  getBatches,
  getBatchDetails,
  returnBatchItem,
  getPurchaseReturns,
  getPurchaseReturnDetails,
  getExpiringBatchesAction,
  getItemBatchesForSaleAction,
  importExcelGrns,
  getNextGrnNoAction,
  checkGrnNoAction,
  getPendingBalanceGrnsAction,
} = require("../controllers/grnController");

router.get("/pending-balance/:supplierId/:branchId", getPendingBalanceGrnsAction);
router.get("/next-no/:Branch_idBranch", getNextGrnNoAction);
router.get("/check-no/:Branch_idBranch", checkGrnNoAction);
router.get("/check-no/:grn_no/:Branch_idBranch", checkGrnNoAction);
router.post("/", upload.single("Grn_File"), createGrn);
router.post("/import-excel", importExcelGrns);
router.post("/process", approvalMiddleware.preventModificationIfPending("grn", "req.body.idGRN"), processGrn);
router.post("/check-serials", checkSerial);
router.get("/batches/:userId/:branchId", getBatches);
router.get("/batch-details/:userId/:branchId", getBatchDetails);
router.get("/expiring-batches/:branchId", getExpiringBatchesAction);
router.get("/item-batches/:itemId/:branchId/:variationId?", getItemBatchesForSaleAction);

router.post("/return-batch-item", returnBatchItem);
router.get("/returns/:branchId", getPurchaseReturns);
router.get("/return-details/:id", getPurchaseReturnDetails);
router.get("/:Branch_idBranch", getGrns);
router.get("/single/:idGRN", getGrnById);
router.put("/:idGRN", upload.single("Grn_File"), approvalMiddleware.preventModificationIfPending("grn", "req.params.idGRN"), updateGrn);
router.delete("/:idGRN", approvalMiddleware.preventModificationIfPending("grn", "req.params.idGRN"), deleteGrn);

module.exports = router;
