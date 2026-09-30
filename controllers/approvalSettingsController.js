const db = require('../db/db');
const promisePool = db.promise();
const approvalService = require('../services/approvalService');

const MODULES = [
  { module: 'Product Management', action_type: 'ADD_PRODUCT' },
  { module: 'Product Management', action_type: 'EDIT_PRODUCT' },
  { module: 'Product Management', action_type: 'DELETE_PRODUCT' },
  { module: 'Customer Management', action_type: 'ADD_CUSTOMER' },
  { module: 'Customer Management', action_type: 'EDIT_CUSTOMER' },
  { module: 'Supplier Management', action_type: 'ADD_SUPPLIER' },
  { module: 'Supplier Management', action_type: 'EDIT_SUPPLIER' },
  { module: 'Invoice', action_type: 'CREATE_INVOICE' },
  { module: 'Invoice', action_type: 'EDIT_INVOICE' },
  { module: 'Invoice', action_type: 'DELETE_INVOICE' },
  { module: 'Invoice', action_type: 'CREDIT_LIMIT_OVERRIDE' },
  { module: 'Invoice', action_type: 'APPLY_DISCOUNT' },
  { module: 'Invoice', action_type: 'PAYMENT_CHEQUE' },
  { module: 'Customer Return', action_type: 'CREATE_CUSTOMER_RETURN' },
  { module: 'Purchase Return', action_type: 'CREATE_PURCHASE_RETURN' },
  { module: 'GRN', action_type: 'CREATE_GRN' },
  { module: 'Damage Note', action_type: 'CREATE_DAMAGE_NOTE' },
  { module: 'POS', action_type: 'POS_DISCOUNT' },
  { module: 'POS', action_type: 'POS_CHEQUE' },
  { module: 'POS', action_type: 'POS_VOID' },
  { module: 'Stock Allocation', action_type: 'STOCK_ALLOCATION' },
  { module: 'Purchase Order', action_type: 'CREATE_PURCHASE_ORDER' },
  { module: 'Estimates', action_type: 'CREATE_ESTIMATE' },
  { module: 'Expense', action_type: 'CREATE_EXPENSE' }
];

const resolveCompanyAndBranch = async (req) => {
  let branch_id = req.body?.branch_id || req.query?.branch_id || req.headers['branch_id'] || req.params?.branch_id;
  let company_id = req.body?.company_id || req.query?.company_id || req.headers['company_id'] || req.params?.company_id || req.params?.companyid;

  if (branch_id) {
    branch_id = parseInt(branch_id, 10);
  }

  // If company_id is missing or default 1, try resolving it from the branch_id in account center or asipbook_db
  if ((!company_id || parseInt(company_id, 10) === 1) && branch_id && branch_id !== 1) {
    try {
      const [bRows] = await promisePool.query(
        `SELECT Company_idCompany FROM asipbook_account_center.branch WHERE idBranch = ? 
         UNION 
         SELECT Company_idCompany FROM asipbook_db.branch WHERE idBranch = ? LIMIT 1`,
        [branch_id, branch_id]
      );
      if (bRows && bRows.length > 0 && bRows[0].Company_idCompany) {
        company_id = bRows[0].Company_idCompany;
      }
    } catch (err) {
      console.warn('Could not auto-resolve company from branch:', err.message);
    }
  }

  return {
    company_id: parseInt(company_id, 10) || 1,
    branch_id: parseInt(branch_id, 10) || 1
  };
};

exports.getModules = (req, res) => {
  res.status(200).json({ success: true, data: MODULES });
};

exports.getCompanyRoles = async (req, res) => {
  const { company_id } = await resolveCompanyAndBranch(req);

  try {
    let [rows] = await promisePool.query(
      'SELECT id, name FROM asipbook_db.userdesignation WHERE companyid = ? ORDER BY name ASC',
      [company_id]
    );

    // If company doesn't have designations in userdesignation yet, auto-seed standard initial roles
    if (rows.length === 0) {
      const defaultRoles = [
        'Branch Manager',
        'General Manager',
        'Senior Accountant',
        'Operations Director',
        'Supervisor',
        'Cashier',
        'Staff'
      ];
      for (const roleName of defaultRoles) {
        try {
          await promisePool.query(
            'INSERT INTO asipbook_db.userdesignation (name, companyid) VALUES (?, ?)',
            [roleName, company_id]
          );
        } catch (insertErr) {
          console.warn('Failed to auto-seed role:', roleName, insertErr.message);
        }
      }
      [rows] = await promisePool.query(
        'SELECT id, name FROM asipbook_db.userdesignation WHERE companyid = ? ORDER BY name ASC',
        [company_id]
      );
    }

    res.status(200).json({ success: true, roles: rows });
  } catch (error) {
    console.error('Error fetching designations for company:', error);
    res.status(500).json({ success: false, message: 'Server error fetching designations' });
  }
};

exports.getSettings = async (req, res) => {
  const { company_id, branch_id } = await resolveCompanyAndBranch(req);

  try {
    const [settings] = await promisePool.query(
      'SELECT * FROM approval_system_settings WHERE company_id = ? AND branch_id = ?',
      [company_id, branch_id]
    );
    
    let isMasterEnabled = false;
    if (settings.length > 0) {
      isMasterEnabled = !!settings[0].enable_approval_processes;
    }

    // Fetch process maps
    const [maps] = await promisePool.query(
      `SELECT m.id, m.action_type, m.is_active, COUNT(t.id) as tiers 
       FROM asipbook_approval_engine.process_maps m 
       LEFT JOIN asipbook_approval_engine.process_tiers t ON m.id = t.map_id 
       WHERE m.company_id = ? AND m.branch_id = ? 
       GROUP BY m.id`,
      [company_id, branch_id]
    );

    res.status(200).json({ success: true, enable_approval_processes: isMasterEnabled, maps });
  } catch (error) {
    console.error('Error fetching approval settings:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateToggle = async (req, res) => {
  const { enable_approval_processes } = req.body;
  const { company_id, branch_id } = await resolveCompanyAndBranch(req);

  try {
    const [settings] = await promisePool.query(
      'SELECT id FROM approval_system_settings WHERE company_id = ? AND branch_id = ?',
      [company_id, branch_id]
    );

    if (settings.length > 0) {
      await promisePool.query(
        'UPDATE approval_system_settings SET enable_approval_processes = ? WHERE id = ?',
        [enable_approval_processes ? 1 : 0, settings[0].id]
      );
    } else {
      await promisePool.query(
        'INSERT INTO approval_system_settings (company_id, branch_id, enable_approval_processes) VALUES (?, ?, ?)',
        [company_id, branch_id, enable_approval_processes ? 1 : 0]
      );
    }

    res.status(200).json({ success: true, message: 'Settings updated' });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.toggleMapStatus = async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  const { company_id, branch_id } = await resolveCompanyAndBranch(req);

  try {
    const [result] = await promisePool.query(
      'UPDATE asipbook_approval_engine.process_maps SET is_active = ? WHERE id = ? AND company_id = ? AND branch_id = ?',
      [is_active ? 1 : 0, id, company_id, branch_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Map not found or unauthorized' });
    }

    res.status(200).json({ success: true, message: 'Map status updated successfully' });
  } catch (error) {
    console.error('Error toggling map status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getProcessMap = async (req, res) => {
  const { action_type } = req.params;
  const { company_id, branch_id } = await resolveCompanyAndBranch(req);

  try {
    const [maps] = await promisePool.query(
      'SELECT * FROM asipbook_approval_engine.process_maps WHERE company_id = ? AND branch_id = ? AND action_type = ?',
      [company_id, branch_id, action_type]
    );

    if (maps.length === 0) {
      return res.status(200).json({ success: true, map: { is_active: false, tiers: [] } });
    }

    const map = maps[0];
    const [tiers] = await promisePool.query(
      'SELECT tier_level, approver_role, approver_id FROM asipbook_approval_engine.process_tiers WHERE map_id = ? ORDER BY tier_level ASC',
      [map.id]
    );

    map.tiers = tiers;
    res.status(200).json({ success: true, map });
  } catch (error) {
    console.error('Error fetching map:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.saveProcessMap = async (req, res) => {
  const { action_type, is_active, tiers } = req.body;
  const { company_id, branch_id } = await resolveCompanyAndBranch(req);

  let connection;
  try {
    connection = await promisePool.getConnection();
    await connection.beginTransaction();

    let mapId;
    const [maps] = await connection.query(
      'SELECT id FROM asipbook_approval_engine.process_maps WHERE company_id = ? AND branch_id = ? AND action_type = ?',
      [company_id, branch_id, action_type]
    );

    if (maps.length > 0) {
      mapId = maps[0].id;
      await connection.query(
        'UPDATE asipbook_approval_engine.process_maps SET is_active = ?, company_id = ?, branch_id = ? WHERE id = ?',
        [is_active ? 1 : 0, company_id, branch_id, mapId]
      );
      await connection.query('DELETE FROM asipbook_approval_engine.process_tiers WHERE map_id = ?', [mapId]);
    } else {
      const [result] = await connection.query(
        'INSERT INTO asipbook_approval_engine.process_maps (company_id, branch_id, action_type, is_active) VALUES (?, ?, ?, ?)',
        [company_id, branch_id, action_type, is_active ? 1 : 0]
      );
      mapId = result.insertId;
    }

    if (tiers && tiers.length > 0) {
      for (const tier of tiers) {
        await connection.query(
          'INSERT INTO asipbook_approval_engine.process_tiers (map_id, tier_level, approver_role, approver_id) VALUES (?, ?, ?, ?)',
          [mapId, tier.tier_level, tier.approver_role, tier.approver_id || null]
        );
      }
    }

    await connection.commit();
    res.status(200).json({ success: true, message: 'Process map saved', company_id, branch_id });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error saving map:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};
