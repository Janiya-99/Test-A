const express = require("express");
const router = express.Router();
const {
  getStockCardReport,
  getStockCard,
  getSerialNumbersByItem,
} = require("../controllers/stockCardController");

router.get("/report/:Branch_idBranch/:category", getStockCardReport);
router.get("/serial-numbers/:Item_idItem/:Branch_idBranch", getSerialNumbersByItem);
router.get("/:from/:to/:idItem/:Branch_idBranch", getStockCard);

module.exports = router;
