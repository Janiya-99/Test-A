// routes/taskFieldDataRoutes.js
const express = require("express");
const router = express.Router();
const taskFieldDataController = require("../controllers/taskFieldDataController");

router.post("/task-field-data", taskFieldDataController.saveTaskFieldData);

module.exports = router;
