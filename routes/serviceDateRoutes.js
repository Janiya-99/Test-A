const express = require("express");
const router = express.Router();
const {
  getServiceDates,
  updateServiceById,
} = require("../controllers/serviceDateController");

router.get("/:fromDate/:toDate", getServiceDates);
router.put("/:ID", updateServiceById);

module.exports = router;
