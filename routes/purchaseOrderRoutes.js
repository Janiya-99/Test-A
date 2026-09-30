const express = require("express");
const router = express.Router();

const {
  createPurchaseOrder,
  getPurchaseOrders,
  getPurchaseOrderById,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getNextPurchaseOrderNumber,
  getPurchaseOrderRules,
  updatePurchaseOrderRules,
  getPOSettings,
  updatePOSettings,
} = require("../controllers/purchaseOrderController");

router.post("/", createPurchaseOrder);
router.get("/next-number/:Branch_idBranch", getNextPurchaseOrderNumber);
router.get("/rules/:Branch_idBranch", getPurchaseOrderRules);
router.put("/rules/:Branch_idBranch", updatePurchaseOrderRules);
router.get("/settings/:Branch_idBranch", getPOSettings);
router.put("/settings/:Branch_idBranch", updatePOSettings);
router.get("/:Branch_idBranch", getPurchaseOrders);
router.get("/single/:id", getPurchaseOrderById);
router.put("/:id", updatePurchaseOrder);
router.delete("/:id", deletePurchaseOrder);

module.exports = router;

