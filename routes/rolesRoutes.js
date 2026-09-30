const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');

// Create a new user role
router.post('/', roleController.createRole);

// Get all roles for a company
router.get('/', roleController.getRoles);

module.exports = router;