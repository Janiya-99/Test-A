const express = require("express");
const router = express.Router();
const {
  createRule,
  getRules,
  getActiveRules,
  getRule,
  updateRule,
  deleteRule,
} = require("../controllers/promotionController");

router.post("/", createRule);
router.get("/branch/:Branch_idBranch", getRules);
router.get("/active/:Branch_idBranch", getActiveRules);
router.get("/:id", getRule);
router.put("/:id", updateRule);
router.delete("/:id", deleteRule);

module.exports = router;
