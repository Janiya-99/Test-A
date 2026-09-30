const express = require("express");
const router = express.Router();
const {
  createQuotation,
  getNextQuotationId,
  getAllQuotations,
  getQuotationById,
  quotationDelete,
  getQuotationByCustomerId,
  updateQuotation,
  checkQuotation,
  selectManualQuotationOption,
} = require("../controllers/quotationController");

router.post("/", createQuotation);
router.get("/get-quotation-id/:Branch_idBranch", getNextQuotationId);
router.get("/check-quotation/:quotation_id/:Branch_idBranch", checkQuotation);
router.get("/customer/:Customer_idCustomer", getQuotationByCustomerId); // Move before generic /:Branch_idBranch
router.get("/single/:idQuotation", getQuotationById);
router.get("/:Branch_idBranch", getAllQuotations); // Now this comes after more specific routes
router.post("/delete/:idQuotation", quotationDelete);
router.put("/:idQuotation", updateQuotation);
router.post("/:id/select-manual", selectManualQuotationOption);

module.exports = router;
