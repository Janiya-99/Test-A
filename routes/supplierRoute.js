const express = require("express");
const router = express.Router();
const approvalMiddleware = require("../middlewares/approvalMiddleware");
// Importing controller functions for handling supplier operations
const {
  createSupplier,
  getSupplier,
  getSupplierById,
  updateSupplierById,
  deleteSupplierById,
  updateSupplierStatus,
  getSupplierCreditBalance,
  getActiveSupplier,
  importExcelSuppliers,
  getSupplierLowStockItems,
  getSupplierItemIds,
  getSupplierProducts,
} = require("../controllers/supplierController");

router.post("/", createSupplier); // Route for creating a new supplier
router.post("/import-excel", importExcelSuppliers); // Route for importing suppliers from Excel
router.get("/:Branch_idBranch", getSupplier); // Route for getting suppliers by branch ID
router.get("/active/:Branch_idBranch", getActiveSupplier); // Route for getting suppliers by branch ID
router.get("/single/:idSupplier", getSupplierById); // Route for getting a single supplier by ID
router.get("/:idSupplier/products/:Branch_idBranch", getSupplierProducts); // Route for getting products by supplier & branch
router.put("/:idSupplier", approvalMiddleware.preventModificationIfPending("supplier", "req.params.idSupplier"), updateSupplierById); // Route for updating a supplier by ID
router.delete("/:idSupplier", approvalMiddleware.preventModificationIfPending("supplier", "req.params.idSupplier"), deleteSupplierById); // Route for deleting a supplier by ID
router.post("/status/:idSupplier", updateSupplierStatus);
router.get("/:idSupplier/credit-balance", getSupplierCreditBalance);
router.get("/low-stock/:idSupplier", getSupplierLowStockItems);
router.get("/:idSupplier/item-ids", getSupplierItemIds); // Route for fetching item IDs ever received from a supplier

module.exports = router;
