const express = require("express");
const router = express.Router();
const {
  getPublicAppointmentDetails,
  createPublicAppointment,
} = require("../controllers/publicAppointmentController");

// Get public appointment details by token
router.get("/:token/details", getPublicAppointmentDetails);

// Create an appointment using the token
router.post("/:token", createPublicAppointment);

module.exports = router;
