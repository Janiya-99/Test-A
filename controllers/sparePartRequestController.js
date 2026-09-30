/**
 * sparePartRequestController.js
 *
 * Handles the full lifecycle of the Spare Part Request and Store Approval module:
 *   - Creating requests (technicians)
 *   - Verifying high-value thresholds (supervisor approval routing)
 *   - Listing requests in queue or by job
 *   - Supervisor approval/rejection
 *   - Store keeper approval & issuing (GRN stock check, FIFO/batch deduction, MIN generation)
 *   - Returning unused items (reversing stock & card logs)
 */

const conn = require("../db/db"); // Pool — supports both .query() and .getConnection()
const stockCardDBService = require("../services/stockCardDBService");
const materialIssueDBService = require("../services/materialIssueDBService");
const userLogDbService = require("../services/userLogDBService");

// ─── 1. CREATE SPARE PART REQUEST ───────────────────────────────────────────

/**
 * POST /api/spare-part-requests
 * Body: { service_job_id, item_id, variation_id?, requested_qty, technician_employee_id?, branch_id }
 */
exports.createRequest = (req, res) => {
  const {
    service_job_id,
    item_id,
    variation_id,
    requested_qty,
    technician_employee_id,
    branch_id,
  } = req.body || {};

  const technician_user_id = req.userId; // Loaded by verifyToken middleware

  // Validation
  const errors = {};
  if (!service_job_id) errors.service_job_id = "Service job is required";
  if (!item_id)        errors.item_id        = "Item is required";
  if (!requested_qty || Number(requested_qty) <= 0)
    errors.requested_qty = "Quantity must be greater than 0";
  if (!branch_id)      errors.branch_id      = "Branch is required";

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  // Fetch branch-specific approval settings
  const settingsQuery = "SELECT spare_part_approval_flow, spare_part_high_value_threshold, spare_part_high_value_keywords FROM service_job_settings WHERE branch_id = ?";
  conn.query(settingsQuery, [branch_id], (err, settingsRows) => {
    let approvalFlow = "value_based";
    let threshold = 5000.0;
    let keywords = "panel,display,screen,motherboard";

    if (!err && settingsRows && settingsRows.length > 0) {
      approvalFlow = settingsRows[0].spare_part_approval_flow || approvalFlow;
      threshold = settingsRows[0].spare_part_high_value_threshold !== null ? Number(settingsRows[0].spare_part_high_value_threshold) : threshold;
      keywords = settingsRows[0].spare_part_high_value_keywords !== null ? settingsRows[0].spare_part_high_value_keywords : keywords;
    }

    // Check if item is high-value
    const itemQuery = "SELECT Cost, Description FROM item WHERE idItem = ?";
    conn.query(itemQuery, [item_id], (err, itemRows) => {
      if (err) {
        console.error("createRequest > itemQuery:", err);
        return res.status(500).json({ ok: false, message: "Database error" });
      }

      if (!itemRows || itemRows.length === 0) {
        return res.status(404).json({ ok: false, message: "Item not found" });
      }

      const item = itemRows[0];
      const unitCost = Number(item.Cost) || 0;
      const desc = (item.Description || "").toLowerCase();

      // Dynamic evaluation based on settings
      let isHighValue = false;
      if (approvalFlow === "always_supervisor") {
        isHighValue = true;
      } else if (approvalFlow === "direct_store") {
        isHighValue = false;
      } else {
        // value_based
        const keywordList = keywords
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length > 0);
        const hasKeyword = keywordList.some((k) => desc.includes(k));
        isHighValue = unitCost >= threshold || hasKeyword;
      }

      const status = isHighValue ? "pending_supervisor" : "pending_store";
      const request_no = `REQ/SP-${branch_id}-${Date.now().toString().slice(-6)}`;

      const insertSql = `
        INSERT INTO spare_part_requests 
        (request_no, service_job_id, item_id, variation_id, requested_qty, status, technician_user_id, technician_employee_id, branch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        request_no,
        service_job_id,
        item_id,
        variation_id || null,
        requested_qty,
        status,
        technician_user_id,
        technician_employee_id || null,
        branch_id,
      ];

      conn.query(insertSql, params, (err, result) => {
        if (err) {
          console.error("createRequest > insert:", err);
          return res.status(500).json({ ok: false, message: "Failed to submit request" });
        }

        // Log activity
        userLogDbService
          .insertLog(technician_user_id, new Date(), "created", result.insertId, `Spare Part Request ${request_no}`, branch_id)
          .catch((e) => console.error("UserLog error:", e));

        return res.status(201).json({
          ok: true,
          message: isHighValue 
            ? "High-value item request submitted successfully. Pending supervisor approval."
            : "Request submitted successfully. Pending store approval.",
          requestId: result.insertId,
          request_no,
          status,
        });
      });
    });
  });
};

// ─── 2. LIST SPARE PART REQUESTS / QUEUE ────────────────────────────────────

/**
 * GET /api/spare-part-requests?branchId=&serviceJobId=&status=&technicianId=
 */
exports.getRequests = (req, res) => {
  const { branchId, serviceJobId, status, technicianId } = req.query;

  if (!branchId) {
    return res.status(400).json({ ok: false, message: "branchId is required" });
  }

  let query = `
    SELECT 
      spr.*, 
      MAX(i.Item_Code) AS item_code, 
      MAX(i.Description) AS item_name,
      MAX(i.Cost) AS latest_grn_cost,
      MAX(sj.job_no) AS service_job_no,
      MAX(c.displayName) AS customer_name,
      MAX(sji.model) AS model_number,
      COALESCE(MAX(e.Employee_Name), MAX(CONCAT(u.First_Name, ' ', u.Last_Name))) AS technician_name,
      MAX(min.issue_number) AS min_number,
      MAX(mii.id) AS min_item_id
    FROM spare_part_requests spr
    INNER JOIN item i ON spr.item_id = i.idItem
    INNER JOIN service_jobs sj ON spr.service_job_id = sj.id
    LEFT JOIN customer c ON sj.customer_id = c.idCustomer
    LEFT JOIN service_job_items sji ON sj.id = sji.service_job_id
    LEFT JOIN employee e ON COALESCE(spr.technician_employee_id, sj.technician_id) = e.idEmployee
    LEFT JOIN asipbook_account_center.asipiya_user u ON spr.technician_user_id = u.idAsipiya_User
    LEFT JOIN material_issue_notes min ON spr.min_id = min.id
    LEFT JOIN material_issue_items mii ON mii.issue_note_id = spr.min_id AND mii.item_id = spr.item_id
    WHERE spr.branch_id = ?
  `;
  const params = [branchId];

  if (serviceJobId) {
    query += " AND spr.service_job_id = ?";
    params.push(serviceJobId);
  }
  if (status) {
    query += " AND spr.status = ?";
    params.push(status);
  }
  if (technicianId) {
    query += " AND spr.technician_user_id = ?";
    params.push(technicianId);
  }

  query += " GROUP BY spr.id ORDER BY spr.id DESC";

  conn.query(query, params, (err, rows) => {
    if (err) {
      console.error("getRequests error:", err);
      return res.status(500).json({ ok: false, message: "Failed to fetch requests" });
    }
    return res.json({ ok: true, requests: rows || [] });
  });
};

// ─── 3. SUPERVISOR APPROVAL ──────────────────────────────────────────────────

/**
 * PUT /api/spare-part-requests/:id/approve-supervisor
 */
exports.approveSupervisor = (req, res) => {
  const { id } = req.params;
  const supervisor_user_id = req.userId;

  const updateSql = `
    UPDATE spare_part_requests 
    SET status = 'pending_store', supervisor_approved_by = ?, supervisor_approved_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending_supervisor'
  `;

  conn.query(updateSql, [supervisor_user_id, id], (err, result) => {
    if (err) {
      console.error("approveSupervisor error:", err);
      return res.status(500).json({ ok: false, message: "Failed to approve request" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Request not found or not in pending supervisor status" });
    }

    return res.json({ ok: true, message: "Supervisor approved. Sent to Store queue." });
  });
};

// ─── 4. REJECT REQUEST ───────────────────────────────────────────────────────

/**
 * PUT /api/spare-part-requests/:id/reject
 * Body: { rejection_reason }
 */
exports.rejectRequest = (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body || {};

  if (!rejection_reason || rejection_reason.trim() === "") {
    return res.status(400).json({ ok: false, message: "Rejection reason is mandatory" });
  }

  const updateSql = `
    UPDATE spare_part_requests 
    SET status = 'rejected', rejection_reason = ?, store_approved_by = ?, store_approved_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending_supervisor', 'pending_store')
  `;

  conn.query(updateSql, [rejection_reason, req.userId, id], (err, result) => {
    if (err) {
      console.error("rejectRequest error:", err);
      return res.status(500).json({ ok: false, message: "Failed to reject request" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Request not found or already processed" });
    }

    return res.json({ ok: true, message: "Request rejected successfully." });
  });
};

// ─── 5. STORE APPROVAL & ISSUING (MIN GENERATION) ───────────────────────────

/**
 * PUT /api/spare-part-requests/:id/approve-store
 * Body: { warehouse_id, batch_id, qty_issued }
 */
exports.approveStore = (req, res) => {
  const { id } = req.params;
  const { warehouse_id, batch_id, qty_issued } = req.body || {};
  const storekeeper_user_id = req.userId;

  if (!qty_issued || Number(qty_issued) <= 0)
    return res.status(400).json({ ok: false, message: "Valid issue quantity is required" });

  const qty = Number(qty_issued);

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("approveStore > getConnection:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ ok: false, message: "Transaction error" });
      }

      const rollbackWith = (status, body) => {
        connection.rollback(() => {
          connection.release();
          res.status(status).json(body);
        });
      };

      try {
        // 1. Fetch and Lock Spare Part Request
        const request = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM spare_part_requests WHERE id = ? AND status = 'pending_store' FOR UPDATE",
            [id],
            (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
          );
        });

        if (!request) {
          return rollbackWith(404, { ok: false, message: "Request not found or not pending store approval" });
        }

        // 2. Fetch and Lock Batches (Specific Batch or FIFO)
        let deductions = [];

        if (batch_id && warehouse_id) {
          // Specific batch selection
          const batch = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT * FROM item_batch WHERE batch_id = ? AND warehouse_id = ? FOR UPDATE",
              [batch_id, warehouse_id],
              (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
            );
          });

          if (!batch) {
            return rollbackWith(404, { ok: false, message: "Selected stock batch not found in the warehouse" });
          }

          if (Number(batch.qty) < qty) {
            return rollbackWith(400, {
              ok: false,
              message: `Insufficient stock in batch. Available: ${batch.qty}, Required: ${qty}`,
            });
          }

          deductions.push({ batch, qty });
        } else {
          // FIFO flow: check total available in item_batch first
          let totalBatchSql = "SELECT SUM(qty) AS total_qty FROM item_batch WHERE item_id = ? AND qty > 0";
          let totalBatchParams = [request.item_id];
          if (warehouse_id) {
            totalBatchSql += " AND warehouse_id = ?";
            totalBatchParams.push(warehouse_id);
          }

          const totalBatchRes = await new Promise((resolve, reject) => {
            connection.query(totalBatchSql, totalBatchParams, (e, rows) => { if (e) reject(e); else resolve(rows[0]); });
          });

          const totalBatchAvailable = Number(totalBatchRes?.total_qty || 0);

          if (totalBatchAvailable >= qty) {
            // ── Enough stock in item_batch rows → use FIFO batch deduction ──
            let fetchBatchesSql = "SELECT * FROM item_batch WHERE item_id = ? AND qty > 0";
            let fetchBatchesParams = [request.item_id];
            if (warehouse_id) {
              fetchBatchesSql += " AND warehouse_id = ?";
              fetchBatchesParams.push(warehouse_id);
            }
            fetchBatchesSql += " ORDER BY batch_id ASC FOR UPDATE";

            const availableBatches = await new Promise((resolve, reject) => {
              connection.query(fetchBatchesSql, fetchBatchesParams, (e, rows) => { if (e) reject(e); else resolve(rows); });
            });

            let remaining = qty;
            for (const b of availableBatches) {
              if (remaining <= 0) break;
              const deduct = Math.min(Number(b.qty), remaining);
              remaining -= deduct;
              deductions.push({ batch: b, qty: deduct });
            }
          } else {
            // ── Fallback: check item.Qty (master stock) for items without full batch records ──
            const itemStockRes = await new Promise((resolve, reject) => {
              connection.query(
                "SELECT Qty FROM item WHERE idItem = ? FOR UPDATE",
                [request.item_id],
                (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
              );
            });

            const itemQty = Number(itemStockRes?.Qty || 0);
            if (itemQty < qty) {
              return rollbackWith(400, {
                ok: false,
                message: `Insufficient stock in inventory. Total available: ${itemQty}, Required: ${qty}`
              });
            }
            // No batch rows to deduct — item.Qty-only path (deductions stays empty, item.Qty updated in step 4b)
          }
        }

        // 3. Fetch Item Details
        const item = await new Promise((resolve, reject) => {
          connection.query("SELECT * FROM item WHERE idItem = ?", [request.item_id], (e, rows) => {
            if (e) reject(e); else resolve(rows[0]);
          });
        });

        // 4. Deduct Stock
        for (const d of deductions) {
          // 4a. Batch deduction
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
              [d.qty, d.batch.batch_id],
              (e, r) => { if (e) reject(e); else resolve(r); }
            );
          });
        }

        // 4b. Total stock deduction
        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE item SET Qty = Qty - ? WHERE idItem = ?",
            [qty, request.item_id],
            (e, r) => { if (e) reject(e); else resolve(r); }
          );
        });

        // 4c. Fetch updated SIH (Stock In Hand)
        const sihRow = await new Promise((resolve, reject) => {
          connection.query("SELECT Qty FROM item WHERE idItem = ?", [request.item_id], (e, rows) => {
            if (e) reject(e); else resolve(rows[0]);
          });
        });

        // 5. Insert Stock Card entries for each deduction (batch path only)
        for (const d of deductions) {
          await stockCardDBService.insertStockCard(
            request.item_id,
            item.Description,
            "ISSUE_OUT",
            0,
            d.batch.cost,
            d.batch.cost,
            item.Rate,
            0,
            d.qty,
            sihRow.Qty,
            request.branch_id,
            connection
          );
        }
        // If no batch rows, insert a single stock card entry using item master cost
        if (deductions.length === 0) {
          await stockCardDBService.insertStockCard(
            request.item_id,
            item.Description,
            "ISSUE_OUT",
            0,
            Number(item.Cost || item.Rate || 0),
            Number(item.Cost || item.Rate || 0),
            item.Rate,
            0,
            qty,
            sihRow.Qty,
            request.branch_id,
            connection
          );
        }

        // 6. Generate Material Issue Note (MIN)
        const min_number = await materialIssueDBService.generateIssueNumber(request.branch_id, connection);
        
        let total_cost = 0;
        if (deductions.length > 0) {
          deductions.forEach(d => { total_cost += Number(d.batch.cost) * d.qty; });
        } else {
          // No batch rows — use item master cost as fallback
          total_cost = Number(item.Cost || item.Rate || 0) * qty;
        }

        // Use provided warehouse_id, or first batch's warehouse, or null
        const minWarehouseId = warehouse_id || (deductions[0]?.batch?.warehouse_id ?? null);

        // Fetch assigned person name (technician name of the service job / request)
        let assigned_person_name = null;
        const empId = request.technician_employee_id || null;
        if (empId) {
          const empRow = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Employee_Name FROM employee WHERE idEmployee = ?",
              [empId],
              (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
            );
          });
          if (empRow) {
            assigned_person_name = empRow.Employee_Name;
          }
        }

        if (!assigned_person_name && request.service_job_id) {
          const sjRow = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT e.Employee_Name FROM service_jobs sj LEFT JOIN employee e ON sj.technician_id = e.idEmployee WHERE sj.id = ?",
              [request.service_job_id],
              (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
            );
          });
          if (sjRow) {
            assigned_person_name = sjRow.Employee_Name;
          }
        }

        // Insert MIN Header
        const minResult = await materialIssueDBService.insertMaterialIssueNote(
          {
            issue_number: min_number,
            issue_date: new Date().toISOString().split("T")[0],
            project_id: null,
            issued_for_type: "general",
            warehouse_id: minWarehouseId,
            delivery_location: "Service Center Repair Job",
            assigned_person_name,
            assigned_user_id: request.technician_user_id,
            transport_note: `Spare part issue for Job ID: ${request.service_job_id}`,
            note: `Auto-generated MIN from Spare Part Request: ${request.request_no}`,
            total_cost,
            item_count: deductions.length,
            status: "issued",
            branch_id: request.branch_id,
            created_by: storekeeper_user_id,
            service_job_id: request.service_job_id,
            spare_part_request_id: request.id,
          },
          connection
        );
        const minId = minResult.insertId;

        // Insert MIN Items
        if (deductions.length > 0) {
          // Batch-tracked path: one MIN item row per batch deduction
          for (const d of deductions) {
            await materialIssueDBService.insertMaterialIssueItem(
              {
                issue_note_id: minId,
                item_id: request.item_id,
                batch_id: d.batch.batch_id,
                variation_id: request.variation_id || null,
                item_description: item.Description,
                item_code: item.Item_Code,
                qty_issued: d.qty,
                unit_cost: d.batch.cost,
                unit_rate: item.Rate,
                total_cost: Number(d.batch.cost) * d.qty,
                branch_id: request.branch_id,
              },
              connection
            );
          }
        } else {
          // No batch rows — single MIN item row using item master cost
          await materialIssueDBService.insertMaterialIssueItem(
            {
              issue_note_id: minId,
              item_id: request.item_id,
              batch_id: null,
              variation_id: request.variation_id || null,
              item_description: item.Description,
              item_code: item.Item_Code,
              qty_issued: qty,
              unit_cost: Number(item.Cost || item.Rate || 0),
              unit_rate: item.Rate,
              total_cost: Number(item.Cost || item.Rate || 0) * qty,
              branch_id: request.branch_id,
            },
            connection
          );
        }

        // 7. Update Spare Part Request
        await new Promise((resolve, reject) => {
          connection.query(
            `UPDATE spare_part_requests 
             SET status = 'approved_issued', issued_qty = ?, store_approved_by = ?, store_approved_at = CURRENT_TIMESTAMP, min_id = ?
             WHERE id = ?`,
            [qty, storekeeper_user_id, minId, id],
            (e, r) => { if (e) reject(e); else resolve(r); }
          );
        });

        // 8. Commit
        connection.commit((err) => {
          if (err) return rollbackWith(500, { ok: false, message: "Commit failed" });
          connection.release();

          // Log activities
          userLogDbService
            .insertLog(storekeeper_user_id, new Date(), "approved", id, `Spare Part Request ${request.request_no} issued`, request.branch_id)
            .catch((e) => console.error("UserLog error:", e));

          return res.status(200).json({
            ok: true,
            message: "Request approved and MIN issued successfully.",
            minId,
            min_number,
          });
        });
      } catch (e) {
        console.error("approveStore error transaction:", e);
        return rollbackWith(500, { ok: false, message: "Failed to process approval: " + e.message });
      }
    });
  });
};

// ─── 6. RETURN UNUSED SPARE PARTS ───────────────────────────────────────────

/**
 * POST /api/spare-part-requests/:id/return
 * Body: { qty_returned }
 */
exports.returnUnusedItem = (req, res) => {
  const { id } = req.params;
  const { qty_returned } = req.body || {};
  const return_user_id = req.userId;

  if (!qty_returned || Number(qty_returned) <= 0) {
    return res.status(400).json({ ok: false, message: "Valid return quantity is required" });
  }

  const qty = Number(qty_returned);

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("returnUnusedItem > getConnection:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ ok: false, message: "Transaction error" });
      }

      const rollbackWith = (status, body) => {
        connection.rollback(() => {
          connection.release();
          res.status(status).json(body);
        });
      };

      try {
        // 1. Fetch and Lock Spare Part Request
        const request = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM spare_part_requests WHERE id = ? AND status = 'approved_issued' FOR UPDATE",
            [id],
            (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
          );
        });

        if (!request) {
          return rollbackWith(404, { ok: false, message: "Issued request not found or not in correct status" });
        }

        const maxReturnable = Number(request.issued_qty) - Number(request.returned_qty);
        if (qty > maxReturnable) {
          return rollbackWith(400, {
            ok: false,
            message: `Return quantity (${qty}) exceeds issued quantity remaining (${maxReturnable})`,
          });
        }

        // 2. Fetch MIN item to find the originally issued batch
        const minItem = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM material_issue_items WHERE issue_note_id = ? AND item_id = ? LIMIT 1",
            [request.min_id, request.item_id],
            (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
          );
        });

        if (!minItem || !minItem.batch_id) {
          return rollbackWith(404, { ok: false, message: "Original Material Issue Batch not found" });
        }

        // 3. Fetch Item details
        const item = await new Promise((resolve, reject) => {
          connection.query("SELECT * FROM item WHERE idItem = ?", [request.item_id], (e, rows) => {
            if (e) reject(e); else resolve(rows[0]);
          });
        });

        // 4. Restore Stock
        // 4a. Batch increment
        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?",
            [qty, minItem.batch_id],
            (e, r) => { if (e) reject(e); else resolve(r); }
          );
        });

        // 4b. Total stock increment
        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE item SET Qty = Qty + ? WHERE idItem = ?",
            [qty, request.item_id],
            (e, r) => { if (e) reject(e); else resolve(r); }
          );
        });

        // 4c. Fetch updated SIH (Stock In Hand)
        const sihRow = await new Promise((resolve, reject) => {
          connection.query("SELECT Qty FROM item WHERE idItem = ?", [request.item_id], (e, rows) => {
            if (e) reject(e); else resolve(rows[0]);
          });
        });

        // 5. Insert Reversal Stock Card Entry
        await stockCardDBService.insertStockCard(
          request.item_id,
          item.Description,
          "ISSUE_REVERSAL",
          request.min_id,
          minItem.unit_cost,
          minItem.unit_cost,
          item.Rate,
          qty, // IN_Stock (returned)
          0,
          sihRow.Qty,
          request.branch_id,
          connection
        );

        // 6. Update Spare Part Request quantities and status
        const nextReturnedQty = Number(request.returned_qty) + qty;
        const nextStatus = nextReturnedQty === Number(request.issued_qty) ? "returned" : "approved_issued";

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE spare_part_requests SET returned_qty = ?, status = ? WHERE id = ?",
            [nextReturnedQty, nextStatus, id],
            (e, r) => { if (e) reject(e); else resolve(r); }
          );
        });

        // 7. Commit
        connection.commit((err) => {
          if (err) return rollbackWith(500, { ok: false, message: "Commit failed" });
          connection.release();

          // Log activities
          userLogDbService
            .insertLog(return_user_id, new Date(), "returned", id, `Spare Part Request ${request.request_no} returned`, request.branch_id)
            .catch((e) => console.error("UserLog error:", e));

          return res.status(200).json({
            ok: true,
            message: "Unused spare part returned and stock restored successfully.",
            returnedQty: nextReturnedQty,
            status: nextStatus,
          });
        });
      } catch (e) {
        console.error("returnUnusedItem error transaction:", e);
        return rollbackWith(500, { ok: false, message: "Failed to process return: " + e.message });
      }
    });
  });
};
