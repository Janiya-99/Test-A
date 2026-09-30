const express = require("express");
const router = express.Router();
const { getLog } = require("../controllers/userLogController");
const { getLogByUser } = require("../controllers/userLogController");

router.get("/:Branch_idBranch/:from/:to", getLog);

// Example Express route
router.get('/:Branch_idBranch/:userId', getLogByUser);


module.exports = router;
