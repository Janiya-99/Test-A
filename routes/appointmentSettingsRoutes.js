const express = require("express");
const router = express.Router();
const {
  getAppointmentSettings,
  updateAppointmentSettings,
} = require("../controllers/appointmentSettingsController");

// Get settings
router.get("/", getAppointmentSettings);

// Update settings
router.put("/", updateAppointmentSettings);

module.exports = router;
