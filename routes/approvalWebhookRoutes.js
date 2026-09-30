const express = require('express');
const router = express.Router();
const approvalWebhookController = require('../controllers/approvalWebhookController');

// Webhooks don't use standard JWT auth; they use HMAC signature
router.post('/approval-callback', approvalWebhookController.handleApprovalCallback);

module.exports = router;
