// routes/userPasswordRoutes.js
console.log("userPasswordRoutes loaded"); // Add this at the top
const express = require("express");
const router = express.Router();
const userPasswordController = require("../controllers/userPasswordController");

// Check email and login
router.get("/check-email-login/:email", userPasswordController.checkEmailLogin);

// Update password
router.post("/update-password", userPasswordController.updatePassword);

// Create user and map to company
router.post("/create-user", userPasswordController.createUserAndMap);

// Map existing user to company
router.post("/map-user-to-company", userPasswordController.mapUserToCompany);

module.exports = router;
