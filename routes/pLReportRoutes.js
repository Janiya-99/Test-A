const express = require("express");
const router = express.Router();
const { getPLReport } = require("../controllers/pLReportController");

router.get("/:from/:to/:Branch_idBranch", getPLReport);

module.exports = router;
