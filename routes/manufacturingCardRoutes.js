const express = require("express");
const router = express.Router();
const cardController = require("../controllers/manufacturingCardController");

// Create Manufacturing Card
router.post("/", cardController.createManufacturingCard);

// Get list of cards for a branch
router.get("/branch/:branch_id", cardController.getManufacturingCards);

// Get active card for a finished item (for auto-scaling engine in Job Cards)
router.get("/item/:item_id", cardController.getActiveCardForItem);

// Get single card by ID (with line items)
router.get("/:id", cardController.getManufacturingCardById);

// Update card
router.put("/:id", cardController.updateManufacturingCard);

// Delete / Deactivate card
router.delete("/:id", cardController.deleteManufacturingCard);

module.exports = router;
