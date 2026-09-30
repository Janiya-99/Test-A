const express = require("express");
const router = express.Router();
const {
  getAllNotifyPeople,
  createNotifyPerson,
  updateNotifyPerson,
  deleteNotifyPerson,
} = require("../controllers/appointmentNotifyPersonController");

// Get all notify people for the branch
router.get("/", getAllNotifyPeople);

// Create new notify person
router.post("/", createNotifyPerson);

// Update notify person
router.put("/:id", updateNotifyPerson);

// Delete notify person
router.delete("/:id", deleteNotifyPerson);

module.exports = router;
