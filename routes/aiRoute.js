const express = require("express");
const router = express.Router();
const {
  generateSupplierDetails,
  generateCustomerDetails,
  generateProductDetails,
  generateProductDescription,
} = require("../controllers/AIController");

router.post("/generate-supplier", generateSupplierDetails);
router.post("/generate-customer", generateCustomerDetails);
router.post("/generate-product", generateProductDetails);
router.post("/generate-product-description", generateProductDescription);

module.exports = router;
