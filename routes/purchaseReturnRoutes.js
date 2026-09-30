const express = require("express");
const router = express.Router();

const {
  createPurchaseReturn,
  getProcessReturns,
  getPurchaseById,
  updatePurchaseReturn,
  processPurchaseReturn,
  unprocessPurchaseReturn,
  deletePurchaseReturn,
  checkReturnSerial,
  getUnresolvedReturns,
} = require("../controllers/purchaseReturnController");

router.post("/", createPurchaseReturn);
router.post("/process", processPurchaseReturn);
router.post("/unprocess", unprocessPurchaseReturn);
router.post("/check-serials", checkReturnSerial);
router.get("/unresolved/:supplierId/:branchId", getUnresolvedReturns);
router.get("/:Branch_idBranch", getProcessReturns);
router.get("/single/:idPurchase_Return", getPurchaseById);
router.put("/:idPurchase_Return", updatePurchaseReturn);
router.delete("/:idPurchase_Return", deletePurchaseReturn);

module.exports = router;
