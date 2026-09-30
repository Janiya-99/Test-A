const express = require("express");
const router = express.Router();
const controller = require("../controllers/rolePrivilageController");

router.post("/role-privilages", controller.saveRolePrivilages);

module.exports = router;