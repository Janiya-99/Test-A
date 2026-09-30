const approvalService = require('../services/approvalService');

exports.reverseApprovalRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { target_tier, comments } = req.body;
    
    // Assumes user is authenticated and req.user exists
    const actor_id = req.user?.idEmployee || req.user?.id || req.headers['actor_id'] || req.userId;
    const company_id = req.user?.company_id || req.headers['company_id'] || 1;
    const branch_id = req.user?.branch_id || req.headers['branch_id'] || 1;

    const result = await approvalService.reverseApprovalRequest({
      request_id: id,
      target_tier,
      comments,
      company_id,
      branch_id,
      actor_id
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in proxy reverseApprovalRequest:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getPendingRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const actor_id = req.user?.idEmployee || req.user?.id || req.headers['actor_id'] || req.userId;
    const company_id = req.user?.company_id || req.headers['company_id'] || 1;
    const branch_id = req.user?.branch_id || req.headers['branch_id'] || 1;
    const role_id = req.user?.RoleId || req.user?.role_id || req.headers['role_id'];
    const is_admin = req.user?.Role === 1 || req.user?.Role === 'Admin' || req.user?.Role === 'Owner' || req.headers['is_admin'] === 'true';

    const result = await approvalService.getPendingRequests({
      status,
      company_id,
      branch_id,
      actor_id,
      role_id,
      is_admin
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in proxy getPendingRequests:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.handleApprovalAction = async (req, res) => {
  try {
    const { id, action } = req.params;
    if (action && action.toLowerCase() === 'reverse') {
      return exports.reverseApprovalRequest(req, res);
    }
    const { comments } = req.body;
    const actor_id = req.user?.idEmployee || req.user?.id || req.headers['actor_id'] || req.userId;
    const company_id = req.user?.company_id || req.headers['company_id'] || 1;
    const branch_id = req.user?.branch_id || req.headers['branch_id'] || 1;

    const result = await approvalService.handleApprovalAction({
      request_id: id,
      action,
      comments,
      company_id,
      branch_id,
      actor_id
    });

    res.status(200).json(result);
  } catch (error) {
    console.error(`Error in proxy handleApprovalAction (${action}):`, error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const { request_id } = req.params;
    const actor_id = req.user?.idEmployee || req.user?.id || req.headers['actor_id'] || req.userId;
    const company_id = req.user?.company_id || req.headers['company_id'] || 1;
    const branch_id = req.user?.branch_id || req.headers['branch_id'] || 1;

    const result = await approvalService.getAuditLogs({
      request_id,
      company_id,
      branch_id,
      actor_id
    });

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in proxy getAuditLogs:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};
