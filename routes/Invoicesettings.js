const express = require("express");
const router = express.Router();
const headerController = require("../controllers/Invoicesettings");
const path = require("path");
const fs = require("fs");

// Header routes
router.get("/header/get", headerController.getHeader);
router.put("/header/save", headerController.saveHeader);

// Footer routes
router.get("/footer/get", headerController.getFooter);
router.put("/footer/save", headerController.saveFooter);

// Table settings routes
router.get("/table-settings/get", headerController.getTableSettings);
router.put("/table-settings/save", headerController.saveTableSettings);

// Main settings routes (template, logo, theme color, etc.)
router.get("/main-settings/get", headerController.getMainSettings);
router.put("/main-settings/save", headerController.saveMainSettings);

// ✅ Route to serve uploaded logo image files
router.get("/uploads/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, "../uploads", filename);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// Invoice Data Preview Route
router.get("/invoice-data/:branchId", headerController.getInvoiceData);

module.exports = router;
