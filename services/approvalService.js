const db = require('../db/db');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const APPROVAL_ENGINE_URL = process.env.APPROVAL_ENGINE_URL || 'http://localhost:5055';

// Helper to wrap db in promises for cleaner async/await
const promisePool = db.promise();

const ACTION_ALIASES = {
  ADD_PRODUCT: ['ADD_PRODUCT', 'CREATE_PRODUCT'],
  CREATE_PRODUCT: ['ADD_PRODUCT', 'CREATE_PRODUCT'],
  EDIT_PRODUCT: ['EDIT_PRODUCT', 'UPDATE_PRODUCT'],
  UPDATE_PRODUCT: ['EDIT_PRODUCT', 'UPDATE_PRODUCT'],
  DELETE_PRODUCT: ['DELETE_PRODUCT', 'REMOVE_PRODUCT'],
  ADD_CUSTOMER: ['ADD_CUSTOMER', 'CREATE_CUSTOMER'],
  CREATE_CUSTOMER: ['ADD_CUSTOMER', 'CREATE_CUSTOMER'],
  EDIT_CUSTOMER: ['EDIT_CUSTOMER', 'UPDATE_CUSTOMER'],
  UPDATE_CUSTOMER: ['EDIT_CUSTOMER', 'UPDATE_CUSTOMER'],
  ADD_SUPPLIER: ['ADD_SUPPLIER', 'CREATE_SUPPLIER'],
  CREATE_SUPPLIER: ['ADD_SUPPLIER', 'CREATE_SUPPLIER'],
  EDIT_SUPPLIER: ['EDIT_SUPPLIER', 'UPDATE_SUPPLIER'],
  UPDATE_SUPPLIER: ['EDIT_SUPPLIER', 'UPDATE_SUPPLIER'],
  CREATE_INVOICE: ['CREATE_INVOICE', 'ADD_INVOICE'],
  ADD_INVOICE: ['CREATE_INVOICE', 'ADD_INVOICE'],
  EDIT_INVOICE: ['EDIT_INVOICE', 'UPDATE_INVOICE'],
  UPDATE_INVOICE: ['EDIT_INVOICE', 'UPDATE_INVOICE'],
  CREATE_GRN: ['CREATE_GRN', 'ADD_GRN'],
  ADD_GRN: ['CREATE_GRN', 'ADD_GRN'],
  CREATE_DAMAGE_NOTE: ['CREATE_DAMAGE_NOTE', 'ADD_DAMAGE_NOTE'],
  CREATE_CUSTOMER_RETURN: ['CREATE_CUSTOMER_RETURN', 'ADD_CUSTOMER_RETURN'],
  CREATE_PURCHASE_RETURN: ['CREATE_PURCHASE_RETURN', 'ADD_PURCHASE_RETURN'],
  CREATE_PURCHASE_ORDER: ['CREATE_PURCHASE_ORDER', 'ADD_PURCHASE_ORDER', 'CREATE_PO'],
  CREATE_PO: ['CREATE_PURCHASE_ORDER', 'ADD_PURCHASE_ORDER', 'CREATE_PO'],
  CREATE_ESTIMATE: ['CREATE_ESTIMATE', 'ADD_ESTIMATE'],
  CREATE_EXPENSE: ['CREATE_EXPENSE', 'ADD_EXPENSE', 'RECORD_EXPENSE'],
  RECORD_EXPENSE: ['CREATE_EXPENSE', 'ADD_EXPENSE', 'RECORD_EXPENSE'],
  DELETE_CUSTOMER: ['DELETE_CUSTOMER', 'REMOVE_CUSTOMER'],
  DELETE_SUPPLIER: ['DELETE_SUPPLIER', 'REMOVE_SUPPLIER'],
  DELETE_INVOICE: ['DELETE_INVOICE', 'REMOVE_INVOICE'],
  APPLY_INVOICE_DISCOUNT: ['APPLY_INVOICE_DISCOUNT', 'APPLY_DISCOUNT'],
  APPLY_DISCOUNT: ['APPLY_INVOICE_DISCOUNT', 'APPLY_DISCOUNT'],
  MAKE_CHEQUE_PAYMENT: ['MAKE_CHEQUE_PAYMENT', 'MAKE_PAYMENT_CHEQUE'],
  MAKE_PAYMENT_CHEQUE: ['MAKE_CHEQUE_PAYMENT', 'MAKE_PAYMENT_CHEQUE'],
  CREDIT_LIMIT_OVERRIDE: ['CREDIT_LIMIT_OVERRIDE']
};

/**
 * Fast check against cache/DB to determine if an action requires approval
 * @param {number} company_id 
 * @param {number} branch_id 
 * @param {string} action_type 
 * @returns {Promise<boolean>}
 */
exports.isApprovalRequired = async (company_id, branch_id, action_type) => {
  try {
    const cId = parseInt(company_id, 10) || 1;
    const bId = parseInt(branch_id, 10) || 1;

    // Check if approval process master toggle is enabled
    let isMasterEnabled = true;
    const [settings] = await promisePool.query(
      'SELECT enable_approval_processes FROM approval_system_settings WHERE company_id = ? AND branch_id IN (?, 1) ORDER BY (branch_id = ?) DESC LIMIT 1',
      [cId, bId, bId]
    );

    if (settings.length > 0) {
      isMasterEnabled = !!settings[0].enable_approval_processes;
    }

    if (!isMasterEnabled) {
      return false; // Fast exit if explicitly disabled
    }

    // Direct database query for efficiency (ERP has access to the engine schema)
    try {
      const actionTypes = ACTION_ALIASES[action_type] || [action_type];
      const branchCandidates = [bId];
      if (bId !== 1) branchCandidates.push(1);

      const [maps] = await promisePool.query(
        'SELECT is_active FROM asipbook_approval_engine.process_maps WHERE company_id = ? AND branch_id IN (?) AND action_type IN (?) AND is_active = 1 LIMIT 1',
        [cId, branchCandidates, actionTypes]
      );
      
      return maps.length > 0;
    } catch (engineError) {
      console.warn('Database error while checking process maps for approval requirement. Defaulting to FALSE.', engineError.message);
      return false;
    }

  } catch (error) {
    console.error('Error in isApprovalRequired:', error);
    return false; // Zero disruption safeguard
  }
};

/**
 * Triggers an approval request in the Approval Engine Microservice
 * Supports both object argument and legacy positional arguments:
 * triggerApprovalRequest({ action_type, module_name, erp_record_id, company_id, branch_id, initiated_by, payload_summary })
 * triggerApprovalRequest(moduleOrAction, erp_record_id, branch_id, company_id, amount, initiated_by)
 */
exports.triggerApprovalRequest = async (arg1, ...rest) => {
  let action_type, module_name, erp_record_id, company_id, branch_id, initiated_by, payload_summary;

  if (typeof arg1 === 'object' && arg1 !== null) {
    ({ action_type, module_name, erp_record_id, company_id, branch_id, initiated_by, payload_summary } = arg1);
  } else {
    // Positional arguments
    const [id, bId, cId, amount, initiator] = rest;
    erp_record_id = id;
    branch_id = bId;
    company_id = cId;
    initiated_by = initiator || 1;

    const moduleKey = String(arg1).toLowerCase();
    if (moduleKey === 'customer') { action_type = 'ADD_CUSTOMER'; module_name = 'Customer Management'; }
    else if (moduleKey === 'supplier') { action_type = 'ADD_SUPPLIER'; module_name = 'Supplier Management'; }
    else if (moduleKey === 'customer_return') { action_type = 'CREATE_CUSTOMER_RETURN'; module_name = 'Customer Return'; }
    else if (moduleKey === 'purchase_return') { action_type = 'CREATE_PURCHASE_RETURN'; module_name = 'Purchase Return'; }
    else if (moduleKey === 'damage_note') { action_type = 'CREATE_DAMAGE_NOTE'; module_name = 'Damage Note'; }
    else if (moduleKey === 'grn') { action_type = 'CREATE_GRN'; module_name = 'GRN'; }
    else if (moduleKey === 'invoice') { action_type = 'CREATE_INVOICE'; module_name = 'Invoice'; }
    else if (moduleKey === 'product') { action_type = 'ADD_PRODUCT'; module_name = 'Product Management'; }
    else { action_type = arg1; module_name = arg1; }

    payload_summary = { amount, action: action_type };
  }

  // Ensure default module name if missing
  if (!module_name) {
    if (action_type?.includes('PRODUCT')) module_name = 'Product Management';
    else if (action_type?.includes('CUSTOMER')) module_name = 'Customer Management';
    else if (action_type?.includes('SUPPLIER')) module_name = 'Supplier Management';
    else if (action_type?.includes('INVOICE')) module_name = 'Invoice';
    else if (action_type?.includes('GRN')) module_name = 'GRN';
    else if (action_type?.includes('DAMAGE')) module_name = 'Damage Note';
    else if (action_type?.includes('RETURN')) module_name = 'Return';
    else module_name = action_type || 'General';
  }

  try {
    const serviceToken = jwt.sign(
      {
        company_id: parseInt(company_id, 10) || 1,
        branch_id: parseInt(branch_id, 10) || 1,
        id: initiated_by || 1,
        roles: ['USER']
      },
      process.env.JWT_SECRET || 'ASIPBOOK_SECRET',
      { expiresIn: '5m' }
    );

    const erp_callback_url =
      process.env.ERP_CALLBACK_URL ||
      `${process.env.SERVER_CALLBACK_URI || 'http://localhost:8000'}/api/webhooks/approval-callback`;

    const res = await axios.post(`${APPROVAL_ENGINE_URL}/api/requests`, {
      erp_record_id: String(erp_record_id),
      action_type,
      module: module_name,
      payload_summary: payload_summary || {},
      erp_callback_url,
      initiated_by: initiated_by || 1
    }, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      timeout: 15000
    });

    return res.data;
  } catch (error) {
    console.error('Error triggering approval request:', error.response?.data || error.message);
    throw new Error('Failed to trigger approval request');
  }
};

/**
 * Reverses an approval request in the Approval Engine Microservice
 */
exports.reverseApprovalRequest = async ({ request_id, target_tier, comments, company_id, branch_id, actor_id }) => {
  try {
    const serviceToken = jwt.sign(
      { company_id, branch_id, id: actor_id, roles: ['USER'] },
      process.env.JWT_SECRET || 'ASIPBOOK_SECRET',
      { expiresIn: '5m' }
    );

    const res = await axios.post(`${APPROVAL_ENGINE_URL}/api/requests/${request_id}/reverse`, {
      target_tier,
      comments
    }, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      timeout: 15000
    });

    return res.data;
  } catch (error) {
    console.error('Error reversing approval request:', error.response?.data?.message || error.message);
    throw new Error(error.response?.data?.message || 'Failed to reverse approval request');
  }
};

/**
 * Gets requests for the Manager Dashboard
 */
exports.getPendingRequests = async ({ status, company_id, branch_id, actor_id, role_id, is_admin }) => {
  try {
    let role_name = null;
    if (role_id && !is_admin) {
      const [rows] = await promisePool.query('SELECT name FROM asipbook_db.userdesignation WHERE id = ?', [role_id]);
      if (rows.length > 0) {
        role_name = rows[0].name;
      }
    }

    const serviceToken = jwt.sign(
      { company_id, branch_id, id: actor_id, role_id: role_name || role_id, is_admin, roles: ['USER'] },
      process.env.JWT_SECRET || 'ASIPBOOK_SECRET',
      { expiresIn: '5m' }
    );

    const res = await axios.get(`${APPROVAL_ENGINE_URL}/api/requests?status=${status || 'PENDING'}`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      timeout: 15000
    });

    if (res.data && Array.isArray(res.data.data)) {
      const missingCustIds = new Set();
      res.data.data.forEach(item => {
        let p = item.payload_summary;
        if (typeof p === 'string') {
          try { p = JSON.parse(p); } catch (e) { p = {}; }
        }
        if (p && (!p.customer_name || p.customer_name === 'Unknown Customer')) {
          const cid = p.Customer_idCustomer || p.pending_updates?.req_body?.Customer_idCustomer || p.pending_updates?.customer_id;
          if (cid) missingCustIds.add(cid);
        }
      });
      if (missingCustIds.size > 0) {
        try {
          const idList = Array.from(missingCustIds);
          const [cRows] = await promisePool.query(
            `SELECT idCustomer, displayName, companyName, First_Name, lastName FROM asipbook_db.customer WHERE idCustomer IN (?)`,
            [idList]
          );
          const custMap = new Map();
          (cRows || []).forEach(c => {
            const name = c.displayName || c.companyName || (c.First_Name ? `${c.First_Name} ${c.lastName || ''}`.trim() : null) || `Customer #${c.idCustomer}`;
            custMap.set(c.idCustomer, name);
          });
          res.data.data.forEach(item => {
            let p = item.payload_summary;
            const wasString = typeof p === 'string';
            if (wasString) {
              try { p = JSON.parse(p); } catch (e) { p = {}; }
            }
            if (p && (!p.customer_name || p.customer_name === 'Unknown Customer')) {
              const cid = p.Customer_idCustomer || p.pending_updates?.req_body?.Customer_idCustomer || p.pending_updates?.customer_id;
              if (cid && custMap.has(cid)) {
                p.customer_name = custMap.get(cid);
                item.payload_summary = wasString ? JSON.stringify(p) : p;
              }
            }
          });
        } catch (enrichErr) {
          console.error('Error enriching customer names:', enrichErr.message);
        }
      }
    }

    return res.data;
  } catch (error) {
    console.error('Error getting requests:', error.message);
    throw new Error('Failed to fetch approval requests');
  }
};

/**
 * Approves or Rejects a request
 */
exports.handleApprovalAction = async ({ request_id, action, comments, company_id, branch_id, actor_id, target_tier }) => {
  if (action && action.toUpperCase() === 'REVERSE') {
    return exports.reverseApprovalRequest({ request_id, target_tier, comments, company_id, branch_id, actor_id });
  }
  try {
    const serviceToken = jwt.sign(
      { company_id, branch_id, id: actor_id, roles: ['USER'] },
      process.env.JWT_SECRET || 'ASIPBOOK_SECRET',
      { expiresIn: '5m' }
    );

    const endpoint = action.toUpperCase() === 'APPROVE' ? 'approve' : 'reject';
    
    const res = await axios.post(`${APPROVAL_ENGINE_URL}/api/requests/${request_id}/${endpoint}`, {
      comments
    }, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      timeout: 15000
    });

    return res.data;
  } catch (error) {
    console.error(`Error handling ${action} action:`, error.response?.data?.message || error.message);
    throw new Error(error.response?.data?.message || `Failed to ${action} approval request`);
  }
};

/**
 * Gets audit logs for a specific request
 */
exports.getAuditLogs = async ({ request_id, company_id, branch_id, actor_id }) => {
  try {
    const serviceToken = jwt.sign(
      { company_id, branch_id, id: actor_id, roles: ['USER'] },
      process.env.JWT_SECRET || 'ASIPBOOK_SECRET',
      { expiresIn: '5m' }
    );

    const res = await axios.get(`${APPROVAL_ENGINE_URL}/api/logs/${request_id}`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
      timeout: 15000
    });

    return res.data;
  } catch (error) {
    console.error('Error getting audit logs:', error.message);
    throw new Error('Failed to fetch audit logs');
  }
};
