const express = require("express");
const router = express.Router();
const chequeController = require("../controllers/chequeController");

router.get("/all", chequeController.getAllCheques);
router.put("/status/:source/:id", chequeController.updateChequeStatus);

module.exports = router;
