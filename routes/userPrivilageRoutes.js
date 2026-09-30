// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const {
  getActiveUsers,
  updateUserPrivileges,
  getUserPrivileges,
} = require("../controllers/userPrivilageController");

router.get("/:branchId", getActiveUsers);
router.put("/:id", updateUserPrivileges);
router.get("/user/:userId", getUserPrivileges);

module.exports = router;
