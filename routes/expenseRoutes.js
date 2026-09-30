const express = require("express");
const router = express.Router();
const {
  createExpenses,
  getExpenses,
  deleteExpenses,
  getDateExpenses,
} = require("../controllers/expenceController");

router.post("/", createExpenses);
router.get("/:branch_id", getExpenses);
// router.get("/:date", getDateExpenses);


// Delete a expense
router.delete("/:ex_id", deleteExpenses);

module.exports = router;
