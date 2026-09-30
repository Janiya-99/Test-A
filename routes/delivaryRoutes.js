const express = require("express");
const router = express.Router();
const deliveryController = require("../controllers/deliveryControllers");
const fileUpload = require("express-fileupload");

// Apply fileUpload middleware to this specific route
router.post("/", fileUpload(), deliveryController.addDelivery);

// GET - Get deliveries with optional filters
router.get("/", deliveryController.getDeliveries);

router.put("/:id/status", deliveryController.updateDeliveryStatus);
router.put("/:id", fileUpload(), deliveryController.updateDelivery);
router.delete("/:id", deliveryController.deleteDelivery);

module.exports = router;