const express = require("express");
const router = express.Router();
const {
  getAllAppointments,
  getAppointmentsByDateRange,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getCustomersForAppointment,
  getSuppliersForAppointment,
  getHolidays,
} = require("../controllers/appointmentController");

// Get holidays for calendar
router.get("/holidays", getHolidays);

// const auth = require("../middlewares/auth");

// All routes require authentication
// router.use(auth);

// Get customers for appointments
router.get("/customers", getCustomersForAppointment);

// Get suppliers for appointments
router.get("/suppliers", getSuppliersForAppointment);

// Get all appointments for the branch
router.get("/", getAllAppointments);

// Get appointments by date range (query params: start, end)
router.get("/range", getAppointmentsByDateRange);

// Get single appointment by ID
router.get("/:id", getAppointmentById);

// Create new appointment
router.post("/", createAppointment);

// Update appointment
router.put("/:id", updateAppointment);

// Delete appointment
router.delete("/:id", deleteAppointment);

module.exports = router;
