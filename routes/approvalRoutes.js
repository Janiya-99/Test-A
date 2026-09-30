const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approvalController');
const { verifyToken } = require('../middlewares/authMiddleware'); // Check if verifyToken is the right middleware in the app

// Add middleware if the ERP uses it, commonly authMiddleware.verifyToken
// But let's check what it uses first. Usually it's just exported from authMiddleware.

// GET /api/approvals/pending
router.get('/pending', verifyToken, approvalController.getPendingRequests);

// POST /api/approvals/request/:id/reverse (keeping legacy route for reverse if used elsewhere)
router.post('/request/:id/reverse', verifyToken, approvalController.reverseApprovalRequest);
router.post('/:id/reverse', verifyToken, approvalController.reverseApprovalRequest);

// POST /api/approvals/request/:id/:action (action = approve/reject)
router.post('/request/:id/:action', verifyToken, approvalController.handleApprovalAction);

// GET /api/approvals/audit/:request_id
router.get('/audit/:request_id', verifyToken, approvalController.getAuditLogs);

module.exports = router;
