const db = require("../db/db");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate the next issue number for a branch in format ISS-YYYY-NNN
 * Uses a connection (inside a transaction) to be safe.
 */
const generateIssueNumber = (branchId, connection) => {
  const year = new Date().getFullYear();
  const query = `
    SELECT COUNT(*) AS cnt
    FROM material_issue_notes
    WHERE branch_id = ? AND YEAR(issue_date) = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [branchId, year], (err, rows) => {
      if (err) return reject(err);
      const seq = String((rows[0].cnt || 0) + 1).padStart(3, "0");
      resolve(`ISS-${year}-${seq}`);
    });
  });
};

// ─── Issue Note Header ───────────────────────────────────────────────────────

const insertMaterialIssueNote = (fields, connection) => {
  const {
    issue_number,
    issue_date,
    project_id,
    issued_for_type,
    warehouse_id,
    delivery_location,
    assigned_person_name,
    assigned_user_id,
    transport_note,
    note,
    total_cost,
    item_count,
    status,
    branch_id,
    created_by,
    customer_id,
  } = fields;

  const query = `
    INSERT INTO material_issue_notes
      (issue_number, issue_date, project_id, issued_for_type, warehouse_id,
       delivery_location, assigned_person_name, assigned_user_id,
       transport_note, note, total_cost, item_count, status, branch_id, created_by, customer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        issue_number,
        issue_date,
        project_id || null,
        issued_for_type || "general",
        warehouse_id,
        delivery_location || null,
        assigned_person_name || null,
        assigned_user_id || null,
        transport_note || null,
        note || null,
        total_cost || 0,
        item_count || 0,
        status || "issued",
        branch_id,
        created_by,
        customer_id || null,
      ],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
  });
};

const updateMaterialIssueNote = (id, fields, connection) => {
  const {
    issue_date,
    delivery_location,
    assigned_person_name,
    transport_note,
    note,
    total_cost,
    item_count,
    status,
    customer_id,
  } = fields;

  const query = `
    UPDATE material_issue_notes
    SET issue_date = ?, delivery_location = ?, assigned_person_name = ?,
        transport_note = ?, note = ?, total_cost = ?, item_count = ?, status = ?, customer_id = ?
    WHERE id = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        issue_date,
        delivery_location || null,
        assigned_person_name || null,
        transport_note || null,
        note || null,
        total_cost || 0,
        item_count || 0,
        status,
        customer_id || null,
        id,
      ],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
  });
};

const updateIssueNoteStatus = (noteId, status, connection) => {
  const query = `UPDATE material_issue_notes SET status = ? WHERE id = ?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [status, noteId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const deleteMaterialIssueNote = (id, connection) => {
  const query = `DELETE FROM material_issue_notes WHERE id = ?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [id], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// ─── Issue Note Items ────────────────────────────────────────────────────────

const insertMaterialIssueItem = (fields, connection) => {
  const {
    issue_note_id,
    item_id,
    batch_id,
    variation_id,
    serial_no_id,
    item_description,
    item_code,
    qty_issued,
    qty_invoiced,
    unit_cost,
    unit_rate,
    total_cost,
    billing_status,
    branch_id,
    is_manual_item,
    manual_supplier_name,
    manual_cost,
  } = fields;

  const finalQtyInvoiced = qty_invoiced !== undefined ? qty_invoiced : 0;
  const finalBillingStatus = billing_status || "pending";

  const query = `
    INSERT INTO material_issue_items
      (issue_note_id, item_id, batch_id, variation_id, serial_no_id, item_description,
       item_code, qty_issued, qty_invoiced, unit_cost, unit_rate, total_cost,
       billing_status, branch_id, is_manual_item, manual_supplier_name, manual_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        issue_note_id,
        item_id || null,
        batch_id || null,
        variation_id || null,
        serial_no_id || null,
        item_description,
        item_code || null,
        qty_issued,
        finalQtyInvoiced,
        unit_cost || 0,
        unit_rate || 0,
        total_cost || 0,
        finalBillingStatus,
        branch_id,
        is_manual_item || 0,
        manual_supplier_name || null,
        manual_cost || null,
      ],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
  });
};

const updateIssueItemBillingQty = (issueItemId, addQtyInvoiced, connection) => {
  const query = `
    UPDATE material_issue_items
    SET qty_invoiced = qty_invoiced + ?,
        billing_status = CASE
          WHEN qty_invoiced + ? >= qty_issued THEN 'invoiced'
          ELSE 'partial'
        END
    WHERE id = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [addQtyInvoiced, addQtyInvoiced, issueItemId],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
  });
};

const deleteMaterialIssueItems = (issueNoteId, connection) => {
  const query = `DELETE FROM material_issue_items WHERE issue_note_id = ?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [issueNoteId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// ─── Invoice Map ─────────────────────────────────────────────────────────────

const insertIssueInvoiceMap = (fields, connection) => {
  const {
    issue_item_id,
    issue_note_id,
    invoice_id,
    qty_invoiced,
    project_id,
    branch_id,
  } = fields;
  const query = `
    INSERT INTO material_issue_invoice_map
      (issue_item_id, issue_note_id, invoice_id, qty_invoiced, project_id, branch_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [issue_item_id, issue_note_id, invoice_id, qty_invoiced, project_id || null, branch_id],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      }
    );
  });
};

// ─── Fetch Queries ───────────────────────────────────────────────────────────

const fetchMaterialIssueNotes = (branchId, filters = {}) => {
  const { projectId, warehouseId, status, from, to, search, customerId } = filters;

  let whereClauses = ["n.branch_id = ?"];
  let params = [branchId];

  if (projectId) {
    whereClauses.push("n.project_id = ?");
    params.push(projectId);
  }
  if (customerId) {
    whereClauses.push("n.customer_id = ?");
    params.push(customerId);
  }
  if (warehouseId) {
    whereClauses.push("n.warehouse_id = ?");
    params.push(warehouseId);
  }
  if (status) {
    whereClauses.push("n.status = ?");
    params.push(status);
  }
  if (from) {
    whereClauses.push("n.issue_date >= ?");
    params.push(from);
  }
  if (to) {
    whereClauses.push("n.issue_date <= ?");
    params.push(to);
  }
  if (search) {
    whereClauses.push("(n.issue_number LIKE ? OR n.assigned_person_name LIKE ? OR p.project_name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = whereClauses.join(" AND ");

  const query = `
    SELECT
      n.id,
      n.issue_number,
      n.issue_date,
      n.issued_for_type,
      n.project_id,
      p.project_name,
      n.customer_id,
      c.displayName AS customer_name,
      n.warehouse_id,
      w.name AS warehouse_name,
      n.delivery_location,
      n.assigned_person_name,
      n.transport_note,
      n.note,
      n.total_cost,
      n.item_count,
      n.status,
      n.created_by,
      n.created_at
    FROM material_issue_notes n
    LEFT JOIN pro p ON p.id = n.project_id
    LEFT JOIN customer c ON c.idCustomer = n.customer_id
    LEFT JOIN warehouses w ON w.id = n.warehouse_id
    WHERE ${where}
    ORDER BY n.id DESC
  `;

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchMaterialIssueNoteById = (id) => {
  const noteQuery = `
    SELECT
      n.*,
      p.project_name,
      w.name AS warehouse_name,
      c.displayName AS customer_name,
      c.billingAddress1 AS customer_address,
      c.phoneNumber AS customer_phone
    FROM material_issue_notes n
    LEFT JOIN pro p ON p.id = n.project_id
    LEFT JOIN warehouses w ON w.id = n.warehouse_id
    LEFT JOIN customer c ON c.idCustomer = n.customer_id
    WHERE n.id = ?
  `;
  const itemsQuery = `
    SELECT
      i.*,
      it.Description AS item_name_db,
      it.Rate        AS item_rate,
      it.Type        AS item_type,
      si.Serial_No   AS serial_number
    FROM material_issue_items i
    LEFT JOIN item it ON it.idItem = i.item_id
    LEFT JOIN item_has_serial_no si ON si.ID = i.serial_no_id
    WHERE i.issue_note_id = ?
    ORDER BY i.id ASC
  `;

  return new Promise((resolve, reject) => {
    db.query(noteQuery, [id], (err, noteRows) => {
      if (err) return reject(err);
      if (!noteRows || noteRows.length === 0) return resolve(null);

      const note = JSON.parse(JSON.stringify(noteRows[0]));

      db.query(itemsQuery, [id], (err2, itemRows) => {
        if (err2) return reject(err2);
        note.items = JSON.parse(JSON.stringify(itemRows));
        resolve(note);
      });
    });
  });
};

const fetchUnbilledItemsByProject = (projectId) => {
  const query = `
    SELECT
      i.id            AS issue_item_id,
      i.issue_note_id,
      i.item_id,
      i.batch_id,
      i.variation_id,
      i.serial_no_id,
      si.Serial_No    AS serial_number,
      i.item_description,
      i.item_code,
      i.qty_issued,
      i.qty_invoiced,
      (i.qty_issued - i.qty_invoiced)  AS qty_remaining,
      i.unit_cost,
      i.unit_rate,
      i.billing_status,
      i.is_manual_item,
      i.manual_supplier_name,
      i.manual_cost,
      n.issue_number,
      n.issue_date,
      n.project_id,
      it.Rate          AS current_rate,
      it.Description   AS item_name_db
    FROM material_issue_items i
    INNER JOIN material_issue_notes n ON n.id = i.issue_note_id
    LEFT JOIN item it ON it.idItem = i.item_id
    LEFT JOIN item_has_serial_no si ON si.ID = i.serial_no_id
    WHERE n.project_id = ?
      AND i.billing_status IN ('pending', 'partial')
      AND (i.qty_issued - i.qty_invoiced) > 0
    ORDER BY n.issue_date ASC, i.id ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [projectId], (err, rows) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(rows)));
    });
  });
};

/**
 * Fetch all unbilled/partially-billed items from a SPECIFIC issue note.
 * Used from the detail view page so we don't rely on project_id.
 */
const fetchUnbilledItemsByNote = (noteId) => {
  const query = `
    SELECT
      i.id            AS issue_item_id,
      i.issue_note_id,
      i.item_id,
      i.batch_id,
      i.variation_id,
      i.serial_no_id,
      si.Serial_No    AS serial_number,
      i.item_description,
      i.item_code,
      i.qty_issued,
      i.qty_invoiced,
      (i.qty_issued - i.qty_invoiced)  AS qty_remaining,
      i.unit_cost,
      i.unit_rate,
      i.billing_status,
      i.is_manual_item,
      i.manual_supplier_name,
      i.manual_cost,
      n.issue_number,
      n.issue_date,
      n.project_id,
      it.Rate          AS current_rate,
      it.Description   AS item_name_db
    FROM material_issue_items i
    INNER JOIN material_issue_notes n ON n.id = i.issue_note_id
    LEFT JOIN item it ON it.idItem = i.item_id
    LEFT JOIN item_has_serial_no si ON si.ID = i.serial_no_id
    WHERE i.issue_note_id = ?
      AND i.billing_status IN ('pending', 'partial')
      AND (i.qty_issued - i.qty_invoiced) > 0
    ORDER BY i.id ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [noteId], (err, rows) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(rows)));
    });
  });
};

const fetchProjectMaterialSummary = (projectId) => {
  const query = `
    SELECT
      COUNT(DISTINCT n.id)                        AS total_issue_notes,
      COALESCE(SUM(i.qty_issued), 0)              AS total_qty_issued,
      COALESCE(SUM(i.total_cost), 0)              AS total_cost_issued,
      COALESCE(SUM(i.qty_invoiced), 0)            AS total_qty_invoiced,
      COALESCE(SUM(i.qty_invoiced * i.unit_rate), 0) AS total_value_invoiced,
      COALESCE(SUM((i.qty_issued - i.qty_invoiced) * i.unit_rate), 0) AS outstanding_value
    FROM material_issue_notes n
    LEFT JOIN material_issue_items i ON i.issue_note_id = n.id
    WHERE n.project_id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [projectId], (err, rows) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(rows[0] || {})));
    });
  });
};

const fetchRecentIssueNotesByProject = (projectId, limit = 5) => {
  const query = `
    SELECT
      n.id, n.issue_number, n.issue_date, n.status,
      n.total_cost, n.item_count, n.assigned_person_name,
      w.name AS warehouse_name
    FROM material_issue_notes n
    LEFT JOIN warehouses w ON w.id = n.warehouse_id
    WHERE n.project_id = ?
    ORDER BY n.id DESC
    LIMIT ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [projectId, limit], (err, rows) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(rows)));
    });
  });
};

const fetchNoteStatusCheck = (noteId) => {
  const query = `SELECT status FROM material_issue_notes WHERE id = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [noteId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows[0] || null);
    });
  });
};

const fetchIssueItemsByNoteId = (noteId, connection) => {
  const query = `SELECT * FROM material_issue_items WHERE issue_note_id = ?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [noteId], (err, rows) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(rows)));
    });
  });
};

const fetchIssueItemById = (issueItemId, connection) => {
  const query = `SELECT * FROM material_issue_items WHERE id = ? FOR UPDATE`;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [issueItemId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows[0] || null);
    });
  });
};

// ─── Recalculate parent note status after invoicing ──────────────────────────

const recalcNoteStatus = (noteId, connection) => {
  const query = `
    UPDATE material_issue_notes n
    SET n.status = (
      SELECT CASE
        WHEN COUNT(*) = SUM(CASE WHEN i.billing_status = 'invoiced' THEN 1 ELSE 0 END)
          THEN 'fully_invoiced'
        WHEN SUM(CASE WHEN i.billing_status IN ('partial','invoiced') THEN 1 ELSE 0 END) > 0
          THEN 'partially_invoiced'
        ELSE 'issued'
      END
      FROM material_issue_items i
      WHERE i.issue_note_id = ?
    )
    WHERE n.id = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [noteId, noteId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

module.exports = {
  generateIssueNumber,
  insertMaterialIssueNote,
  updateMaterialIssueNote,
  updateIssueNoteStatus,
  deleteMaterialIssueNote,
  insertMaterialIssueItem,
  updateIssueItemBillingQty,
  deleteMaterialIssueItems,
  insertIssueInvoiceMap,
  fetchMaterialIssueNotes,
  fetchMaterialIssueNoteById,
  fetchUnbilledItemsByProject,
  fetchUnbilledItemsByNote,
  fetchProjectMaterialSummary,
  fetchRecentIssueNotesByProject,
  fetchNoteStatusCheck,
  fetchIssueItemsByNoteId,
  fetchIssueItemById,
  recalcNoteStatus,
};
