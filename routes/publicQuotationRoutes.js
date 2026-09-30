const express = require("express");
const router = express.Router();
const {
  getPublicQuotation,
  selectPublicQuotationOption,
} = require("../controllers/quotationController");

router.get("/:id", getPublicQuotation);
router.post("/:id/select", selectPublicQuotationOption);

module.exports = router;
