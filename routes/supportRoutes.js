const express = require("express");
const router = express.Router();
const supportController = require("../controllers/supportController");

// Public/authenticated routes (require auth via verifyToken applied in server.js)

// Create ticket — supports up to 5 image attachments via multipart/form-data
router.post(
  "/create",
  supportController.upload.array("attachments", 5),
  supportController.createTicket
);

// Get tickets for a company (user-facing)
router.get("/company/:company_id", supportController.getTickets);

// Get ticket counts for sidebar (user-facing)
router.get("/counts/:company_id", supportController.getTicketCounts);

// Admin: get ALL tickets across companies (admin panel)
router.get("/all", supportController.getAllTickets);

// Admin: update ticket status
router.patch("/:id/status", supportController.updateTicketStatus);

// Get messages for a ticket (conversation thread)
router.get("/:id/messages", supportController.getTicketMessages);

// Customer reply to a ticket
router.post(
  "/:id/messages",
  supportController.upload.array("attachments", 5),
  supportController.addMessage
);

// Customer unread tickets count (for topbar badge)
router.get("/unread-count/:company_id", supportController.getUnreadCustomerCount);

module.exports = router;
