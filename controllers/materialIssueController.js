/**
 * materialIssueController.js
 *
 * Handles the full lifecycle of the Project Material Issue & Billing module:
 *   - Creating issue notes (with stock deduction)
 *   - Viewing and listing issue notes
 *   - Updating / deleting (with guards if invoiced)
 *   - Generating invoices from unbilled issue items
 *
 * Architecture:
 *   - Read operations  → direct `db.query()` callbacks (matches projectController.js pattern)
 *   - Write operations → `conn.getConnection()` + `beginTransaction()` (matches warehouseController.js pattern)
 */

const conn = require("../db/db"); // Pool — supports both .query() and .getConnection()
const materialIssueDBService = require("../services/materialIssueDBService");
const stockCardDBService = require("../services/stockCardDBService");
const userLogDbService = require("../services/userLogDBService");
const invoiceDBService = require("../services/invoiceDBService");
const productDBService = require("../services/productDBService");
const branchDBService = require("../services/branchDBService");

// ─── Helpers ────────────────────────────────────────────────────────────────

const getClientInfo = (req) => ({
  ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null,
  ua: req.headers["user-agent"] || null,
});

// ─── 1. CREATE MATERIAL ISSUE NOTE ──────────────────────────────────────────

/**
 * POST /api/material-issues
 * Body: {
 *   issue_date, project_id?, issued_for_type, warehouse_id,
 *   delivery_location?, assigned_person_name?, transport_note?, note?,
 *   branch_id, created_by,
 *   items: [{ item_id, batch_id?, variation_id?, item_description, item_code?, qty_issued, unit_cost?, unit_rate? }]
 * }
 */
exports.createMaterialIssueNote = (req, res) => {
  const {
    issue_date,
    project_id,
    issued_for_type,
    warehouse_id,
    delivery_location,
    assigned_person_name,
    transport_note,
    note,
    branch_id,
    created_by,
    items,
    customer_id,
  } = req.body || {};

  // ── Validation ──────────────────────────────────────────────────────────
  const errors = {};
  if (!issue_date)    errors.issue_date    = "Issue date is required";
  if (!branch_id)     errors.branch_id     = "Branch is required";
  if (!created_by)    errors.created_by    = "Created by (user id) is required";
  if (!items || !Array.isArray(items) || items.length === 0)
    errors.items = "At least one item is required";

  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  // Validate each item
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.item_id && !it.is_manual_item)      errors[`items[${i}].item_id`]    = "Item is required";
    if (!it.qty_issued || Number(it.qty_issued) <= 0)
      errors[`items[${i}].qty_issued`] = "Quantity must be > 0";
    if (!it.item_description)
      errors[`items[${i}].item_description`] = "Item description is required";
  }
  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  // ── Transaction ─────────────────────────────────────────────────────────
  conn.getConnection((err, connection) => {
    if (err) {
      console.error("createMaterialIssueNote > getConnection:", err);
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
        const companyId = await branchDBService.getCompanyIdByBranch(branch_id);
        // 1. Generate issue number
        const issue_number = await materialIssueDBService.generateIssueNumber(branch_id, connection);

        // 2. Calculate totals
        let total_cost = 0;
        const processedItems = [];

        // 3. Process each item — deduct stock
        for (const item of items) {
          const qty = Number(item.qty_issued);
          const unit_cost = Number(item.unit_cost) || 0;
          const unit_rate = Number(item.unit_rate) || 0;

          // Fetch the item's Type from DB to see if it's a Service/Package
          const dbItem = (item.item_id && item.item_id > 0) ? await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Type FROM item WHERE idItem = ?",
              [item.item_id],
              (e, rows) => { if (e) reject(e); else resolve(rows ? rows[0] : null); }
            );
          }) : null;
          const itemType = dbItem ? String(dbItem.Type) : "";
          const isService = itemType === "2" || itemType === "Service" || itemType === "Package" || item.is_service === 1 || item.is_service === true || item.is_manual_item === 1 || !item.item_id || item.item_id <= 0;

          if (isService) {
            const line_total = unit_rate * qty;
            total_cost += line_total;

            processedItems.push({
              ...item,
              batch_id: null,
              qty_issued: qty,
              unit_cost,
              unit_rate,
              total_cost: line_total,
            });
            continue;
          }

          // If this is a serial number item and has selected serials:
          if (item.Item_Has_Serial === 1 && item.SelectedSerials && item.SelectedSerials.length > 0) {
            for (const serial of item.SelectedSerials) {
              const singleQty = 1;
              const line_total = unit_rate * singleQty;
              total_cost += line_total;

              // Find or insert the serial number, set its status to sold (Qty = 0)
              let serial_no_id = 0;
              if (serial.exists === 1) {
                // Find ID of existing serial
                const serialRow = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT ID FROM item_has_serial_no WHERE Serial_No = ? AND Item_idItem = ?",
                    [serial.Serial_No, item.item_id],
                    (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
                  );
                });
                if (serialRow) {
                  serial_no_id = serialRow.ID;
                  await new Promise((resolve, reject) => {
                    connection.query(
                      "UPDATE item_has_serial_no SET Qty = 0 WHERE ID = ?",
                      [serial_no_id],
                      (e, r) => { if (e) reject(e); else resolve(r); }
                    );
                  });
                } else {
                  // Fallback if not found: insert new
                  const insertSerial = await new Promise((resolve, reject) => {
                    connection.query(
                      "INSERT INTO item_has_serial_no (GRN_idGRN, Item_idItem, Qty, Serial_No, Branch_idBranch, variation_id) VALUES (?, ?, 0, ?, ?, ?)",
                      [0, item.item_id, serial.Serial_No, branch_id, item.variation_id || null],
                      (e, r) => { if (e) reject(e); else resolve(r); }
                    );
                  });
                  serial_no_id = insertSerial.insertId;
                }
              } else {
                // Insert new serial as sold
                const insertSerial = await new Promise((resolve, reject) => {
                  connection.query(
                    "INSERT INTO item_has_serial_no (GRN_idGRN, Item_idItem, Qty, Serial_No, Branch_idBranch, variation_id) VALUES (?, ?, 0, ?, ?, ?)",
                    [0, item.item_id, serial.Serial_No, branch_id, item.variation_id || null],
                    (e, r) => { if (e) reject(e); else resolve(r); }
                  );
                });
                serial_no_id = insertSerial.insertId;
              }

              // Deduct variation stock if variation_id present
              if (item.variation_id) {
                await productDBService.processInvoiceVariation(item.variation_id, singleQty, connection);
              }

              // Deduct batch stock
              let batchId = item.batch_id ? Number(item.batch_id) : null;
              if (batchId) {
                await new Promise((resolve, reject) => {
                  connection.query(
                    "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                    [singleQty, batchId],
                    (e, r) => { if (e) reject(e); else resolve(r); }
                  );
                });
              } else {
                // FIFO batch deduction for 1 unit
                const batches = await new Promise((resolve, reject) => {
                  let q;
                  let params;
                  if (warehouse_id) {
                    q = `SELECT ib.* FROM item_batch ib
                         LEFT JOIN grn g ON ib.grn_id = g.idGRN
                         WHERE ib.item_id = ? AND ib.warehouse_id = ? AND ib.qty > 0
                           AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
                         ORDER BY ib.batch_id ASC FOR UPDATE`;
                    params = [item.item_id, warehouse_id];
                  } else {
                    q = `SELECT ib.* FROM item_batch ib
                         INNER JOIN grn g ON ib.grn_id = g.idGRN
                         WHERE ib.item_id = ? AND g.Branch_idBranch = ? AND ib.qty > 0
                           AND (g.Status = 1 OR g.Status = '1')
                         ORDER BY ib.batch_id ASC FOR UPDATE`;
                    params = [item.item_id, branch_id];
                  }
                  connection.query(q, params, (e, rows) => { if (e) reject(e); else resolve(rows); });
                });

                if (batches.length > 0) {
                  batchId = batches[0].batch_id;
                  await new Promise((resolve, reject) => {
                    connection.query(
                      "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                      [singleQty, batchId],
                      (e, r) => { if (e) reject(e); else resolve(r); }
                    );
                  });
                }
              }

              // Deduct main item stock
              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE item SET Qty = Qty - ? WHERE idItem = ?",
                  [singleQty, item.item_id],
                  (e, r) => { if (e) reject(e); else resolve(r); }
                );
              });

              // Get current SIH for stock card
              const sihRow = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT Qty FROM item WHERE idItem = ?",
                  [item.item_id],
                  (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
                );
              });

              // Stock card entry
              await stockCardDBService.insertStockCard(
                item.item_id,
                `${item.item_description} (Serial: ${serial.Serial_No})`,
                "ISSUE_OUT",
                0,
                unit_cost,
                unit_cost,
                unit_rate,
                0,
                singleQty,
                sihRow.Qty,
                branch_id,
                connection,
                item.variation_id || null
              );

              processedItems.push({
                item_id: item.item_id,
                batch_id: batchId,
                variation_id: item.variation_id || null,
                serial_no_id: serial_no_id,
                item_description: `${item.item_description} (Serial: ${serial.Serial_No})`,
                item_code: item.item_code || null,
                qty_issued: singleQty,
                unit_cost,
                unit_rate,
                total_cost: line_total,
              });
            }
          } else {
            // Normal non-serial item
            const line_total = unit_rate * qty;
            total_cost += line_total;

            // Deduct variation stock if variation_id present
            if (item.variation_id) {
              await productDBService.processInvoiceVariation(item.variation_id, qty, connection);
            }

            // 3a. Find batch to deduct from
            let batchId = item.batch_id ? Number(item.batch_id) : null;

            if (batchId) {
              // Use specific batch — lock it
              const lockResult = await new Promise((resolve, reject) => {
                let q = "SELECT * FROM item_batch WHERE batch_id = ? AND qty >= ? FOR UPDATE";
                let params = [batchId, qty];
                if (warehouse_id) {
                  q = "SELECT * FROM item_batch WHERE batch_id = ? AND warehouse_id = ? AND qty >= ? FOR UPDATE";
                  params = [batchId, warehouse_id, qty];
                }
                connection.query(q, params, (e, rows) => { if (e) reject(e); else resolve(rows); });
              });

              if (!lockResult || lockResult.length === 0) {
                return rollbackWith(400, {
                  ok: false,
                  message: `Insufficient stock in batch ${batchId} for item '${item.item_description}'. Required: ${qty}`,
                });
              }

              // Deduct from batch
              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                  [qty, batchId],
                  (e, r) => { if (e) reject(e); else resolve(r); }
                );
              });
            } else {
              // FIFO: find batches with stock
              const batches = await new Promise((resolve, reject) => {
                let q, params;
                if (warehouse_id) {
                  q = `SELECT ib.* FROM item_batch ib
                       LEFT JOIN grn g ON ib.grn_id = g.idGRN
                       WHERE ib.item_id = ? AND ib.warehouse_id = ? AND ib.qty > 0
                         AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
                       ORDER BY ib.batch_id ASC FOR UPDATE`;
                  params = [item.item_id, warehouse_id];
                } else {
                  q = `SELECT ib.* FROM item_batch ib
                       INNER JOIN grn g ON ib.grn_id = g.idGRN
                       WHERE ib.item_id = ? AND g.Branch_idBranch = ? AND ib.qty > 0
                         AND (g.Status = 1 OR g.Status = '1')
                       ORDER BY ib.batch_id ASC FOR UPDATE`;
                  params = [item.item_id, branch_id];
                }
                connection.query(q, params, (e, rows) => { if (e) reject(e); else resolve(rows); });
              });

              const totalAvailable = batches.reduce((s, b) => s + Number(b.qty), 0);
              if (totalAvailable < qty) {
                if (!warehouse_id) {
                  const itemStockRes = await new Promise((resolve, reject) => {
                    connection.query(
                      "SELECT Qty FROM item WHERE idItem = ? FOR UPDATE",
                      [item.item_id],
                      (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
                    );
                  });
                  const itemQty = Number(itemStockRes?.Qty || 0);
                  if (itemQty < qty) {
                    return rollbackWith(400, {
                      ok: false,
                      message: `Insufficient stock for item '${item.item_description}'. Available: ${itemQty}, Required: ${qty}`,
                    });
                  }
                } else {
                  return rollbackWith(400, {
                    ok: false,
                    message: `Insufficient stock for item '${item.item_description}'. Available: ${totalAvailable}, Required: ${qty}`,
                  });
                }
              }

              // Deduct FIFO
              let remaining = qty;
              for (const batch of batches) {
                if (remaining <= 0) break;
                const deduct = Math.min(remaining, Number(batch.qty));
                await new Promise((resolve, reject) => {
                  connection.query(
                    "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                    [deduct, batch.batch_id],
                    (e, r) => { if (e) reject(e); else resolve(r); }
                  );
                });
                remaining -= deduct;
                if (!batchId) batchId = batch.batch_id; // record first batch used
              }
            }

            // 3b. Update item.Qty (total stock across all warehouses)
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item SET Qty = Qty - ? WHERE idItem = ?",
                [qty, item.item_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });

            // 3c. Get current SIH for stock card
            const sihRow = await new Promise((resolve, reject) => {
              connection.query(
                "SELECT Qty FROM item WHERE idItem = ?",
                [item.item_id],
                (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
              );
            });

            // 3d. Stock card entry
            await stockCardDBService.insertStockCard(
              item.item_id,
              item.item_description,
              "ISSUE_OUT",
              0, // transaction ID updated after note insert
              unit_cost,
              unit_cost,
              unit_rate,
              0,       // IN_Stock
              qty,     // Out_Stock
              sihRow.Qty,
              branch_id,
              connection,
              item.variation_id || null
            );

            // Log history
            await productDBService.productHistoryLogHelper({
              productId: item.item_id,
              variationId: item.variation_id || null,
              quantityChange: -qty,
              oldQty: sihRow.Qty + qty,
              newQty: sihRow.Qty,
              type: "Material Issue",
              description: `Stock issued via Material Issue Note: ${issue_number}`,
              branchId: branch_id,
              companyId,
              userId: created_by,
              connection,
            });

            processedItems.push({
              ...item,
              batch_id: batchId,
              qty_issued: qty,
              unit_cost,
              unit_rate,
              total_cost: line_total,
            });
          }
        }

        // 4. Insert issue note header
        const noteResult = await materialIssueDBService.insertMaterialIssueNote(
          {
            issue_number,
            issue_date,
            project_id: project_id || null,
            issued_for_type: issued_for_type || "general",
            warehouse_id: warehouse_id || null,
            delivery_location: delivery_location || null,
            assigned_person_name: assigned_person_name || null,
            assigned_user_id: null,
            transport_note: transport_note || null,
            note: note || null,
            total_cost,
            item_count: items.length,
            status: "issued",
            branch_id,
            created_by,
            customer_id: customer_id || null,
          },
          connection
        );
        const noteId = noteResult.insertId;

        // 5. Insert line items
        for (const item of processedItems) {
          await materialIssueDBService.insertMaterialIssueItem(
            {
              issue_note_id: noteId,
              item_id: item.item_id,
              batch_id: item.batch_id || null,
              variation_id: item.variation_id || null,
              serial_no_id: item.serial_no_id || null,
              item_description: item.item_description,
              item_code: item.item_code || null,
              qty_issued: item.qty_issued,
              unit_cost: item.unit_cost,
              unit_rate: item.unit_rate,
              total_cost: item.total_cost,
              branch_id,
              is_manual_item: item.is_manual_item || 0,
              manual_supplier_name: item.manual_supplier_name || null,
              manual_cost: item.manual_cost || null,
            },
            connection
          );
        }

        // 6. Commit
        connection.commit((err) => {
          if (err) return rollbackWith(500, { ok: false, message: "Commit failed" });
          connection.release();

          // 7. Activity log (non-blocking)
          userLogDbService
            .insertLog(created_by, new Date(), "created", noteId, "Material Issue Note", branch_id)
            .catch((e) => console.error("UserLog error:", e));

          return res.status(201).json({
            ok: true,
            message: "Material issue note created successfully.",
            issueNoteId: noteId,
            issue_number,
          });
        });
      } catch (e) {
        console.error("createMaterialIssueNote error:", e);
        return rollbackWith(500, { ok: false, message: "Failed to create material issue note. " + e.message });
      }
    });
  });
};

// ─── 2. GET LIST ─────────────────────────────────────────────────────────────

/**
 * GET /api/material-issues?branchId=&projectId=&warehouseId=&from=&to=&status=&search=
 */
exports.getMaterialIssueNotes = (req, res) => {
  const { branchId, projectId, warehouseId, status, from, to, search, customerId } = req.query;

  if (!branchId || branchId === "undefined" || branchId === "null")
    return res.status(400).json({ ok: false, message: "branchId is required" });

  materialIssueDBService
    .fetchMaterialIssueNotes(branchId, { projectId, warehouseId, status, from, to, search, customerId })
    .then((notes) => res.json({ ok: true, notes }))
    .catch((err) => {
      console.error("getMaterialIssueNotes error:", err);
      res.status(500).json({ ok: false, message: "Failed to fetch material issue notes: " + err.message });
    });
};

// ─── 3. GET SINGLE ───────────────────────────────────────────────────────────

/**
 * GET /api/material-issues/:id
 */
exports.getMaterialIssueNoteById = (req, res) => {
  const { id } = req.params;

  materialIssueDBService
    .fetchMaterialIssueNoteById(id)
    .then((note) => {
      if (!note) return res.status(404).json({ ok: false, message: "Issue note not found" });
      res.json({ ok: true, note });
    })
    .catch((err) => {
      console.error("getMaterialIssueNoteById error:", err);
      res.status(500).json({ ok: false, message: "Failed to fetch issue note" });
    });
};

// ─── 4. UPDATE MATERIAL ISSUE NOTE ──────────────────────────────────────────

/**
 * PUT /api/material-issues/:id
 * Restricted: cannot update quantity if any items are invoiced
 */
exports.updateMaterialIssueNote = (req, res) => {
  const { id } = req.params;
  const {
    issue_date,
    project_id,
    issued_for_type,
    warehouse_id,
    delivery_location,
    assigned_person_name,
    transport_note,
    note,
    branch_id,
    created_by,
    items,
    customer_id,
  } = req.body || {};

  // ── Validation ──
  const errors = {};
  if (!issue_date)    errors.issue_date = "Issue date is required";
  if (!branch_id)     errors.branch_id  = "Branch is required";
  if (!created_by)    errors.created_by = "Created by (user id) is required";

  if (items && (!Array.isArray(items) || items.length === 0)) {
    errors.items = "At least one item is required";
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  if (items) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.item_id && !it.is_manual_item)      errors[`items[${i}].item_id`] = "Item is required";
      if (!it.qty_issued || Number(it.qty_issued) <= 0)
        errors[`items[${i}].qty_issued`] = "Quantity must be > 0";
      if (!it.item_description)
        errors[`items[${i}].item_description`] = "Item description is required";
    }
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("updateMaterialIssueNote > getConnection:", err);
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
        const companyId = await branchDBService.getCompanyIdByBranch(branch_id || oldNote?.branch_id || note?.branch_id);
        // 1. Fetch current note
        const oldNote = await materialIssueDBService.fetchMaterialIssueNoteById(id);
        if (!oldNote) {
          return rollbackWith(404, { ok: false, message: "Issue note not found" });
        }

        if (["fully_invoiced"].includes(oldNote.status)) {
          return rollbackWith(403, {
            ok: false,
            message: "Cannot update a fully invoiced issue note.",
          });
        }

        // 2. Fetch existing database items for this note
        const oldItems = await materialIssueDBService.fetchIssueItemsByNoteId(id, connection);

        // 3. If items list is sent, perform invoiced quantities checks
        if (items) {
          for (const oldItem of oldItems) {
            const qtyInvoiced = Number(oldItem.qty_invoiced || 0);
            if (qtyInvoiced > 0) {
              // The item must exist in the new items list
              const newItem = items.find(it => Number(it.id) === Number(oldItem.id));
              if (!newItem) {
                return rollbackWith(400, {
                  ok: false,
                  message: `Cannot delete item '${oldItem.item_description}' as it has been partially/fully invoiced to a customer.`
                });
              }
              if (Number(newItem.qty_issued) < qtyInvoiced) {
                return rollbackWith(400, {
                  ok: false,
                  message: `Quantity for '${oldItem.item_description}' cannot be reduced below the invoiced quantity of ${qtyInvoiced}.`
                });
              }
            }
          }
        }

        // 4. Reverse existing items' stock levels
        for (const oldItem of oldItems) {
          const qty = Number(oldItem.qty_issued);

          // Check if it's a Service/Package
          const dbItem = oldItem.item_id ? await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Type FROM item WHERE idItem = ?",
              [oldItem.item_id],
              (e, rows) => { if (e) reject(e); else resolve(rows ? rows[0] : null); }
            );
          }) : null;
          const itemType = dbItem ? String(dbItem.Type) : "";
          const isService = itemType === "2" || itemType === "Service" || itemType === "Package" || oldItem.is_manual_item === 1 || !oldItem.item_id;

          if (isService) {
            continue; // Services and manual items do not manage inventory stock
          }

          // Restore to item_batch
          if (oldItem.batch_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?",
                [qty, oldItem.batch_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Restore variation stock
          if (oldItem.variation_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_variations SET qty = qty + ? WHERE id = ?",
                [qty, oldItem.variation_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Restore serial status to available
          if (oldItem.serial_no_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_has_serial_no SET Qty = 1 WHERE ID = ?",
                [oldItem.serial_no_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Restore item.Qty (total stock Sih)
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE item SET Qty = Qty + ? WHERE idItem = ?",
              [qty, oldItem.item_id],
              (e, r) => { if (e) reject(e); else resolve(r); }
            );
          });

          // Fetch current SIH for stock card reversal record
          const sihRow = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Qty FROM item WHERE idItem = ?",
              [oldItem.item_id],
              (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
            );
          });

          // Write stock card reversal
          await stockCardDBService.insertStockCard(
            oldItem.item_id,
            oldItem.item_description,
            "ISSUE_REVERSAL",
            Number(id),
            oldItem.unit_cost,
            oldItem.unit_cost,
            oldItem.unit_rate,
            qty, // IN stock
            0,
            sihRow.Qty,
            oldItem.branch_id,
            connection,
            oldItem.variation_id || null
          );

          // Log history
          await productDBService.productHistoryLogHelper({
            productId: oldItem.item_id,
            variationId: oldItem.variation_id || null,
            quantityChange: qty,
            oldQty: sihRow.Qty - qty,
            newQty: sihRow.Qty,
            type: "Material Issue Reversal",
            description: `Stock restored via Material Issue Note update: ${oldNote.issue_number}`,
            branchId: oldNote.branch_id,
            companyId,
            userId: created_by,
            connection,
          });
        }

        // 5. Delete old line items
        await materialIssueDBService.deleteMaterialIssueItems(id, connection);

        // 6. Process new items list (deduct stock and write lines)
        let total_cost = 0;
        const processedItems = [];
        const itemsToProcess = items || oldItems; // fallback to old items metadata if not sent

        for (const item of itemsToProcess) {
          const qty = Number(item.qty_issued);
          const unit_cost = Number(item.unit_cost) || 0;
          const unit_rate = Number(item.unit_rate) || 0;

          // Check if it's a Service/Package
          const dbItem = (item.item_id && item.item_id > 0) ? await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Type FROM item WHERE idItem = ?",
              [item.item_id],
              (e, rows) => { if (e) reject(e); else resolve(rows ? rows[0] : null); }
            );
          }) : null;
          const itemType = dbItem ? String(dbItem.Type) : "";
          const isService = itemType === "2" || itemType === "Service" || itemType === "Package" || item.is_service === 1 || item.is_service === true || item.is_manual_item === 1 || !item.item_id || item.item_id <= 0;

          // Carry over previous invoiced quantities if existing
          const matchingOldItem = oldItems.find(oi => Number(oi.id) === Number(item.id));
          const qtyInvoiced = matchingOldItem ? Number(matchingOldItem.qty_invoiced || 0) : 0;
          let finalBillingStatus = 'pending';
          if (qtyInvoiced >= qty) {
            finalBillingStatus = 'invoiced';
          } else if (qtyInvoiced > 0) {
            finalBillingStatus = 'partial';
          }

          if (isService) {
            const line_total = unit_rate * qty;
            total_cost += line_total;

            processedItems.push({
              ...item,
              batch_id: null,
              qty_issued: qty,
              qty_invoiced: qtyInvoiced,
              billing_status: finalBillingStatus,
              unit_cost,
              unit_rate,
              total_cost: line_total,
            });
            continue;
          }

          // If serial number item and has selected serials:
          if (item.Item_Has_Serial === 1 && item.SelectedSerials && item.SelectedSerials.length > 0) {
            for (const serial of item.SelectedSerials) {
              const singleQty = 1;
              const line_total = unit_rate * singleQty;
              total_cost += line_total;

              let serial_no_id = 0;
              if (serial.exists === 1) {
                const serialRow = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT ID FROM item_has_serial_no WHERE Serial_No = ? AND Item_idItem = ?",
                    [serial.Serial_No, item.item_id],
                    (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
                  );
                });
                if (serialRow) {
                  serial_no_id = serialRow.ID;
                  await new Promise((resolve, reject) => {
                    connection.query(
                      "UPDATE item_has_serial_no SET Qty = 0 WHERE ID = ?",
                      [serial_no_id],
                      (e, r) => { if (e) reject(e); else resolve(r); }
                    );
                  });
                } else {
                  const insertSerial = await new Promise((resolve, reject) => {
                    connection.query(
                      "INSERT INTO item_has_serial_no (GRN_idGRN, Item_idItem, Qty, Serial_No, Branch_idBranch, variation_id) VALUES (?, ?, 0, ?, ?, ?)",
                      [0, item.item_id, serial.Serial_No, branch_id, item.variation_id || null],
                      (e, r) => { if (e) reject(e); else resolve(r); }
                    );
                  });
                  serial_no_id = insertSerial.insertId;
                }
              } else {
                const insertSerial = await new Promise((resolve, reject) => {
                  connection.query(
                    "INSERT INTO item_has_serial_no (GRN_idGRN, Item_idItem, Qty, Serial_No, Branch_idBranch, variation_id) VALUES (?, ?, 0, ?, ?, ?)",
                    [0, item.item_id, serial.Serial_No, branch_id, item.variation_id || null],
                    (e, r) => { if (e) reject(e); else resolve(r); }
                  );
                });
                serial_no_id = insertSerial.insertId;
              }

              // Deduct variation stock
              if (item.variation_id) {
                await productDBService.processInvoiceVariation(item.variation_id, singleQty, connection);
              }

              // Deduct batch stock
              let batchId = item.batch_id ? Number(item.batch_id) : null;
              if (batchId) {
                await new Promise((resolve, reject) => {
                  connection.query(
                    "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                    [singleQty, batchId],
                    (e, r) => { if (e) reject(e); else resolve(r); }
                  );
                });
              } else {
                // FIFO batch deduction
                const batches = await new Promise((resolve, reject) => {
                  let q, params;
                  const warehouseToUse = warehouse_id || oldNote.warehouse_id;
                  if (warehouseToUse) {
                    q = `SELECT ib.* FROM item_batch ib
                         LEFT JOIN grn g ON ib.grn_id = g.idGRN
                         WHERE ib.item_id = ? AND ib.warehouse_id = ? AND ib.qty > 0
                           AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
                         ORDER BY ib.batch_id ASC FOR UPDATE`;
                    params = [item.item_id, warehouseToUse];
                  } else {
                    q = `SELECT ib.* FROM item_batch ib
                         INNER JOIN grn g ON ib.grn_id = g.idGRN
                         WHERE ib.item_id = ? AND g.Branch_idBranch = ? AND ib.qty > 0
                           AND (g.Status = 1 OR g.Status = '1')
                         ORDER BY ib.batch_id ASC FOR UPDATE`;
                    params = [item.item_id, branch_id];
                  }
                  connection.query(q, params, (e, rows) => { if (e) reject(e); else resolve(rows); });
                });

                if (batches.length > 0) {
                  batchId = batches[0].batch_id;
                  await new Promise((resolve, reject) => {
                    connection.query(
                      "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                      [singleQty, batchId],
                      (e, r) => { if (e) reject(e); else resolve(r); }
                    );
                  });
                }
              }

              // Deduct main item stock
              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE item SET Qty = Qty - ? WHERE idItem = ?",
                  [singleQty, item.item_id],
                  (e, r) => { if (e) reject(e); else resolve(r); }
                );
              });

              // Get current SIH for stock card
              const sihRow = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT Qty FROM item WHERE idItem = ?",
                  [item.item_id],
                  (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
                );
              });

              // Stock card entry
              await stockCardDBService.insertStockCard(
                item.item_id,
                `${item.item_description} (Serial: ${serial.Serial_No})`,
                "ISSUE_OUT",
                Number(id),
                unit_cost,
                unit_cost,
                unit_rate,
                0,
                singleQty,
                sihRow.Qty,
                branch_id,
                connection,
                item.variation_id || null
              );

              // Log history
              await productDBService.productHistoryLogHelper({
                productId: item.item_id,
                variationId: item.variation_id || null,
                quantityChange: -singleQty,
                oldQty: sihRow.Qty + singleQty,
                newQty: sihRow.Qty,
                type: "Material Issue",
                description: `Stock issued via Material Issue Note update: ${oldNote.issue_number}`,
                branchId: branch_id,
                companyId,
                userId: created_by,
                connection,
              });

              processedItems.push({
                item_id: item.item_id,
                batch_id: batchId,
                variation_id: item.variation_id || null,
                serial_no_id: serial_no_id,
                item_description: `${item.item_description} (Serial: ${serial.Serial_No})`,
                item_code: item.item_code || null,
                qty_issued: singleQty,
                qty_invoiced: 0,
                billing_status: 'pending',
                unit_cost,
                unit_rate,
                total_cost: line_total,
              });
            }
          } else {
            // Normal non-serial item
            const line_total = unit_rate * qty;
            total_cost += line_total;

            if (item.variation_id) {
              await productDBService.processInvoiceVariation(item.variation_id, qty, connection);
            }

            let batchId = item.batch_id ? Number(item.batch_id) : null;
            const warehouseToUse = warehouse_id || oldNote.warehouse_id;

            if (batchId) {
              const lockResult = await new Promise((resolve, reject) => {
                let q = "SELECT * FROM item_batch WHERE batch_id = ? AND qty >= ? FOR UPDATE";
                let params = [batchId, qty];
                if (warehouseToUse) {
                  q = "SELECT * FROM item_batch WHERE batch_id = ? AND warehouse_id = ? AND qty >= ? FOR UPDATE";
                  params = [batchId, warehouseToUse, qty];
                }
                connection.query(q, params, (e, rows) => { if (e) reject(e); else resolve(rows); });
              });

              if (!lockResult || lockResult.length === 0) {
                return rollbackWith(400, {
                  ok: false,
                  message: `Insufficient stock in batch ${batchId} for item '${item.item_description}'. Required: ${qty}`,
                });
              }

              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                  [qty, batchId],
                  (e, r) => { if (e) reject(e); else resolve(r); }
                );
              });
            } else {
              // FIFO
              const batches = await new Promise((resolve, reject) => {
                let q, params;
                if (warehouseToUse) {
                  q = `SELECT ib.* FROM item_batch ib
                       LEFT JOIN grn g ON ib.grn_id = g.idGRN
                       WHERE ib.item_id = ? AND ib.warehouse_id = ? AND ib.qty > 0
                         AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
                       ORDER BY ib.batch_id ASC FOR UPDATE`;
                  params = [item.item_id, warehouseToUse];
                } else {
                  q = `SELECT ib.* FROM item_batch ib
                       INNER JOIN grn g ON ib.grn_id = g.idGRN
                       WHERE ib.item_id = ? AND g.Branch_idBranch = ? AND ib.qty > 0
                         AND (g.Status = 1 OR g.Status = '1')
                       ORDER BY ib.batch_id ASC FOR UPDATE`;
                  params = [item.item_id, branch_id];
                }
                connection.query(q, params, (e, rows) => { if (e) reject(e); else resolve(rows); });
              });

              const totalAvailable = batches.reduce((s, b) => s + Number(b.qty), 0);
              if (totalAvailable < qty) {
                if (!warehouseToUse) {
                  const itemStockRes = await new Promise((resolve, reject) => {
                    connection.query(
                      "SELECT Qty FROM item WHERE idItem = ? FOR UPDATE",
                      [item.item_id],
                      (e, rows) => { if (e) reject(e); else resolve(rows[0]); }
                    );
                  });
                  const itemQty = Number(itemStockRes?.Qty || 0);
                  if (itemQty < qty) {
                    return rollbackWith(400, {
                      ok: false,
                      message: `Insufficient stock for item '${item.item_description}'. Available: ${itemQty}, Required: ${qty}`,
                    });
                  }
                } else {
                  return rollbackWith(400, {
                    ok: false,
                    message: `Insufficient stock for item '${item.item_description}'. Available: ${totalAvailable}, Required: ${qty}`,
                  });
                }
              }

              let remaining = qty;
              for (const batch of batches) {
                if (remaining <= 0) break;
                const deduct = Math.min(remaining, Number(batch.qty));
                await new Promise((resolve, reject) => {
                  connection.query(
                    "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                    [deduct, batch.batch_id],
                    (e, r) => { if (e) reject(e); else resolve(r); }
                  );
                });
                remaining -= deduct;
                if (!batchId) batchId = batch.batch_id;
              }
            }

            // Update Sih
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item SET Qty = Qty - ? WHERE idItem = ?",
                [qty, item.item_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });

            const sihRow = await new Promise((resolve, reject) => {
              connection.query(
                "SELECT Qty FROM item WHERE idItem = ?",
                [item.item_id],
                (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
              );
            });

            // Write stock card
            await stockCardDBService.insertStockCard(
              item.item_id,
              item.item_description,
              "ISSUE_OUT",
              Number(id),
              unit_cost,
              unit_cost,
              unit_rate,
              0,
              qty,
              sihRow.Qty,
              branch_id,
              connection,
              item.variation_id || null
            );

            // Log history
            await productDBService.productHistoryLogHelper({
              productId: item.item_id,
              variationId: item.variation_id || null,
              quantityChange: -qty,
              oldQty: sihRow.Qty + qty,
              newQty: sihRow.Qty,
              type: "Material Issue",
              description: `Stock issued via Material Issue Note update: ${oldNote.issue_number}`,
              branchId: branch_id,
              companyId,
              userId: created_by,
              connection,
            });

            processedItems.push({
              ...item,
              batch_id: batchId,
              qty_issued: qty,
              qty_invoiced: qtyInvoiced,
              billing_status: finalBillingStatus,
              unit_cost,
              unit_rate,
              total_cost: line_total,
            });
          }
        }

        // 7. Insert the new lines
        for (const item of processedItems) {
          await materialIssueDBService.insertMaterialIssueItem(
            {
              issue_note_id: id,
              item_id: item.item_id,
              batch_id: item.batch_id || null,
              variation_id: item.variation_id || null,
              serial_no_id: item.serial_no_id || null,
              item_description: item.item_description,
              item_code: item.item_code || null,
              qty_issued: item.qty_issued,
              qty_invoiced: item.qty_invoiced,
              unit_cost: item.unit_cost,
              unit_rate: item.unit_rate,
              total_cost: item.total_cost,
              billing_status: item.billing_status,
              branch_id,
              is_manual_item: item.is_manual_item || 0,
              manual_supplier_name: item.manual_supplier_name || null,
              manual_cost: item.manual_cost || null,
            },
            connection
          );
        }

        // 8. Update issue note header
        await materialIssueDBService.updateMaterialIssueNote(
          id,
          {
            issue_date: issue_date || oldNote.issue_date,
            delivery_location: delivery_location || null,
            assigned_person_name: assigned_person_name || null,
            transport_note: transport_note || null,
            note: note || null,
            total_cost,
            item_count: processedItems.length,
            status: oldNote.status, // will be recalculated below
            customer_id: customer_id || null,
          },
          connection
        );

        // 9. Recalculate parent note status
        await materialIssueDBService.recalcNoteStatus(id, connection);

        // 10. Commit
        connection.commit((err) => {
          if (err) return rollbackWith(500, { ok: false, message: "Commit failed" });
          connection.release();

          userLogDbService
            .insertLog(created_by, new Date(), "updated", id, "Material Issue Note", branch_id)
            .catch((e) => console.error("UserLog error:", e));

          return res.json({
            ok: true,
            message: "Material issue note updated successfully.",
          });
        });
      } catch (e) {
        console.error("updateMaterialIssueNote error:", e);
        return rollbackWith(500, { ok: false, message: "Failed to update material issue note. " + e.message });
      }
    });
  });
};

// ─── 5. DELETE MATERIAL ISSUE NOTE ──────────────────────────────────────────

/**
 * DELETE /api/material-issues/:id
 * - Blocked if any items are invoiced
 * - Reverses stock if note is in 'issued' state
 */
exports.deleteMaterialIssueNote = (req, res) => {
  const { id } = req.params;
  const { userId, branchId } = req.query;

  conn.getConnection((err, connection) => {
    if (err) return res.status(500).json({ ok: false, message: "Server error" });

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ ok: false, message: "Transaction error" });
      }

      const rollbackWith = (status, body) => {
        connection.rollback(() => { connection.release(); res.status(status).json(body); });
      };

      try {
        // Check status
        const noteRow = await materialIssueDBService.fetchNoteStatusCheck(id);
        if (!noteRow) return rollbackWith(404, { ok: false, message: "Issue note not found" });

        const companyId = await branchDBService.getCompanyIdByBranch(noteRow.branch_id);

        if (["partially_invoiced", "fully_invoiced"].includes(noteRow.status)) {
          return rollbackWith(403, {
            ok: false,
            message: "Cannot delete an issue note that has been partially or fully invoiced.",
          });
        }

        // Get items to reverse stock
        const items = await materialIssueDBService.fetchIssueItemsByNoteId(id, connection);

        for (const item of items) {
          const qty = Number(item.qty_issued);

          // Fetch the item's Type from DB to see if it's a Service/Package
          const dbItem = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Type FROM item WHERE idItem = ?",
              [item.item_id],
              (e, rows) => { if (e) reject(e); else resolve(rows ? rows[0] : null); }
            );
          });
          const itemType = dbItem ? String(dbItem.Type) : "";
          const isService = itemType === "2" || itemType === "Service" || itemType === "Package";

          if (isService) {
            // Services/packages do not track or have stock/batches/serial numbers, skip all stock reversal updates
            continue;
          }

          // Restore to item_batch (restore to the specific batch if tracked, else add to any existing batch)
          if (item.batch_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?",
                [qty, item.batch_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Restore variation stock if variation_id present
          if (item.variation_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_variations SET qty = qty + ? WHERE id = ?",
                [qty, item.variation_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Restore serial status to available if serial_no_id present
          if (item.serial_no_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_has_serial_no SET Qty = 1 WHERE ID = ?",
                [item.serial_no_id],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Restore item.Qty
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE item SET Qty = Qty + ? WHERE idItem = ?",
              [qty, item.item_id],
              (e, r) => { if (e) reject(e); else resolve(r); }
            );
          });

          // Stock card reversal entry
          const sihRow = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT Qty FROM item WHERE idItem = ?",
              [item.item_id],
              (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
            );
          });

           await stockCardDBService.insertStockCard(
             item.item_id,
             item.item_description,
             "ISSUE_REVERSAL",
             Number(id),
             item.unit_cost,
             item.unit_cost,
             item.unit_rate,
             qty, // IN_Stock (returned)
             0,
             sihRow.Qty,
             item.branch_id,
             connection,
             item.variation_id || null
           );

          // Log history
          await productDBService.productHistoryLogHelper({
            productId: item.item_id,
            variationId: item.variation_id || null,
            quantityChange: qty,
            oldQty: sihRow.Qty - qty,
            newQty: sihRow.Qty,
            type: "Material Issue Reversal",
            description: `Stock restored via Material Issue Note deletion: ${noteRow.issue_number}`,
            branchId: noteRow.branch_id,
            companyId,
            userId: userId,
            connection,
          });
        }

        // Delete items then note
        await materialIssueDBService.deleteMaterialIssueItems(id, connection);
        await materialIssueDBService.deleteMaterialIssueNote(id, connection);

        connection.commit((err) => {
          if (err) return rollbackWith(500, { ok: false, message: "Commit failed" });
          connection.release();

          userLogDbService
            .insertLog(userId, new Date(), "deleted", id, "Material Issue Note", branchId)
            .catch((e) => console.error("UserLog error:", e));

          return res.json({ ok: true, message: "Issue note deleted and stock restored successfully." });
        });
      } catch (e) {
        console.error("deleteMaterialIssueNote error:", e);
        return rollbackWith(500, { ok: false, message: "Failed to delete issue note. " + e.message });
      }
    });
  });
};

// ─── 6. PROJECT MATERIAL SUMMARY ─────────────────────────────────────────────

/**
 * GET /api/material-issues/project/:projectId/summary
 */
exports.getProjectMaterialSummary = (req, res) => {
  const { projectId } = req.params;

  Promise.all([
    materialIssueDBService.fetchProjectMaterialSummary(projectId),
    materialIssueDBService.fetchRecentIssueNotesByProject(projectId, 5),
  ])
    .then(([summary, recentNotes]) => {
      res.json({ ok: true, summary, recentNotes });
    })
    .catch((err) => {
      console.error("getProjectMaterialSummary error:", err);
      res.status(500).json({ ok: false, message: "Failed to fetch project material summary" });
    });
};

// ─── 7. UNBILLED ITEMS BY PROJECT ────────────────────────────────────────────

/**
 * GET /api/material-issues/project/:projectId/unbilled
 */
exports.getUnbilledProjectMaterials = (req, res) => {
  const { projectId } = req.params;

  materialIssueDBService
    .fetchUnbilledItemsByProject(projectId)
    .then((items) => res.json({ ok: true, items }))
    .catch((err) => {
      console.error("getUnbilledProjectMaterials error:", err);
      res.status(500).json({ ok: false, message: "Failed to fetch unbilled materials" });
    });
};

// ─── 7b. UNBILLED ITEMS BY NOTE ID ───────────────────────────────────────────

/**
 * GET /api/material-issues/note/:noteId/unbilled
 * Fetches pending/partial items for a specific issue note.
 * More reliable than project-based lookup when opening from the detail view.
 */
exports.getUnbilledItemsByNote = (req, res) => {
  const { noteId } = req.params;

  materialIssueDBService
    .fetchUnbilledItemsByNote(noteId)
    .then((items) => res.json({ ok: true, items }))
    .catch((err) => {
      console.error("getUnbilledItemsByNote error:", err);
      res.status(500).json({ ok: false, message: "Failed to fetch unbilled items for note" });
    });
};

// ─── DEBUG: Raw DB state for a note ──────────────────────────────────────────
exports.debugNoteItems = (req, res) => {
  const { noteId } = req.params;
  const db = require("../db/db");

  db.query(
    `SELECT i.id, i.issue_note_id, i.item_id, i.item_description,
            i.qty_issued, i.qty_invoiced,
            i.billing_status, i.unit_cost, i.unit_rate,
            (i.qty_issued - i.qty_invoiced) AS qty_remaining,
            n.project_id, n.status AS note_status
     FROM material_issue_items i
     INNER JOIN material_issue_notes n ON n.id = i.issue_note_id
     WHERE i.issue_note_id = ?`,
    [noteId],
    (err, rows) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, noteId, rowCount: rows.length, items: rows });
    }
  );
};

// ─── 8. GENERATE INVOICE FROM ISSUE ITEMS ────────────────────────────────────

/**
 * POST /api/material-issues/generate-invoice
 * Body: {
 *   project_id, customer_id, invoice_date, branch_id, created_by,
 *   items: [{ issue_item_id, issue_note_id, item_id, qty, unit_rate, item_description }]
 * }
 */
exports.generateInvoiceFromIssues = (req, res) => {
  const {
    project_id,
    customer_id,
    invoice_date,
    branch_id,
    created_by,
    items,
  } = req.body || {};

  // ── Validation ──────────────────────────────────────────────────────────
  const errors = {};
  if (!customer_id)  errors.customer_id  = "Customer is required";
  if (!invoice_date) errors.invoice_date = "Invoice date is required";
  if (!branch_id)    errors.branch_id    = "Branch is required";
  if (!created_by)   errors.created_by   = "Created by is required";
  if (!items || !Array.isArray(items) || items.length === 0)
    errors.items = "At least one item is required";

  if (Object.keys(errors).length > 0)
    return res.status(400).json({ ok: false, errors });

  conn.getConnection((err, connection) => {
    if (err) return res.status(500).json({ ok: false, message: "Server error" });

    connection.beginTransaction(async (err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ ok: false, message: "Transaction error" });
      }

      const rollbackWith = (status, body) => {
        connection.rollback(() => { connection.release(); res.status(status).json(body); });
      };

      try {
        // Validate each issue item and quantity
        let invoiceTotal = 0;
        const validatedItems = [];

        for (const it of items) {
          const issueItem = await materialIssueDBService.fetchIssueItemById(it.issue_item_id, connection);

          if (!issueItem) {
            return rollbackWith(404, {
              ok: false,
              message: `Issue item ${it.issue_item_id} not found`,
            });
          }

          const remaining = Number(issueItem.qty_issued) - Number(issueItem.qty_invoiced);
          const qtyToInvoice = Number(it.qty);

          if (qtyToInvoice <= 0 || qtyToInvoice > remaining) {
            return rollbackWith(400, {
              ok: false,
              message: `Invalid quantity for '${issueItem.item_description}'. Remaining: ${remaining}, Requested: ${qtyToInvoice}`,
            });
          }

          const unitRate = Number(it.unit_rate) || Number(issueItem.unit_rate) || 0;
          const lineTotal = unitRate * qtyToInvoice;
          invoiceTotal += lineTotal;

          validatedItems.push({
            ...it,
            issueItem,
            unit_rate: unitRate,
            line_total: lineTotal,
            qty_to_invoice: qtyToInvoice,
          });
        }

        // Create Invoice header using invoiceDBService
        let invoiceId;
        try {
          const invoiceResult = await invoiceDBService.insertInvoice(
            invoice_date,
            invoiceTotal,
            0,              // discount
            invoiceTotal,   // net total
            0,              // paid
            invoiceTotal,   // balance
            customer_id,
            branch_id,
            created_by,
            `Material issue billing for project ${project_id || "N/A"}`, // note
            0,              // tax
            connection
          );
          invoiceId = invoiceResult.insertId;
        } catch (invErr) {
          // Fallback: manually insert if invoiceDBService signature differs
          const invInsert = await new Promise((resolve, reject) => {
            connection.query(
              `INSERT INTO invoice (Date, Total, Discount, Net_Total, Paid, Balance,
                Customer_idCustomer, Branch_idBranch, User_idUser, Note, Tax, Status)
               VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, 0, 1)`,
              [
                invoice_date,
                invoiceTotal,
                invoiceTotal,
                invoiceTotal,
                customer_id,
                branch_id,
                created_by,
                `Material issue billing - Project ${project_id || "N/A"}`,
              ],
              (e, r) => { if (e) reject(e); else resolve(r); }
            );
          });
          invoiceId = invInsert.insertId;
        }

        // Insert invoice line items and update billing records
        for (const vi of validatedItems) {
          const isManual = vi.issueItem.is_manual_item === 1 || vi.issueItem.item_id <= 0;
          // Invoice has item
          const insertedItemId = await new Promise((resolve, reject) => {
            connection.query(
              `INSERT INTO invoice_has_item
                (Invoice_idInvoice, Item_idItem, Qty, Rate, Total, Description, Branch_idBranch, is_manual_item)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                invoiceId,
                vi.issueItem.item_id,
                vi.qty_to_invoice,
                vi.unit_rate,
                vi.line_total,
                vi.issueItem.item_description,
                branch_id,
                isManual ? 1 : 0,
              ],
              (e, r) => { if (e) reject(e); else resolve(r.insertId); }
            );
          });

          if (isManual && (vi.issueItem.manual_supplier_name || vi.issueItem.manual_cost)) {
            await new Promise((resolve, reject) => {
              connection.query(
                `INSERT INTO invoice_has_item_manual_details
                  (invoice_has_item_id, Branch_idBranch, supplier_name, cost)
                 VALUES (?, ?, ?, ?)`,
                [
                  insertedItemId,
                  branch_id,
                  vi.issueItem.manual_supplier_name || null,
                  vi.issueItem.manual_cost || null,
                ],
                (e, r) => { if (e) reject(e); else resolve(r); }
              );
            });
          }

          // Update issue item billing qty
          await materialIssueDBService.updateIssueItemBillingQty(
            vi.issue_item_id,
            vi.qty_to_invoice,
            connection
          );

          // Insert mapping record
          await materialIssueDBService.insertIssueInvoiceMap(
            {
              issue_item_id: vi.issue_item_id,
              issue_note_id: vi.issueItem.issue_note_id,
              invoice_id: invoiceId,
              qty_invoiced: vi.qty_to_invoice,
              project_id: project_id || null,
              branch_id,
            },
            connection
          );

          // Recalc parent note status
          await materialIssueDBService.recalcNoteStatus(vi.issueItem.issue_note_id, connection);
        }

        connection.commit((err) => {
          if (err) return rollbackWith(500, { ok: false, message: "Commit failed" });
          connection.release();

          userLogDbService
            .insertLog(created_by, new Date(), "generated invoice", invoiceId, "Material Issue Invoice", branch_id)
            .catch((e) => console.error("UserLog error:", e));

          return res.status(201).json({
            ok: true,
            message: "Invoice generated successfully from material issues.",
            invoiceId,
            totalAmount: invoiceTotal,
          });
        });
      } catch (e) {
        console.error("generateInvoiceFromIssues error:", e);
        return rollbackWith(500, { ok: false, message: "Failed to generate invoice. " + e.message });
      }
    });
  });
};

// ─── 9. ITEM AUTOCOMPLETE (for Add form) ─────────────────────────────────────

/**
 * GET /api/material-issues/autocomplete?warehouseId=&q=&branchId=
 * Returns items with stock in the specified warehouse
 */
exports.getMaterialIssueAutoComplete = (req, res) => {
  const { warehouseId, q, branchId } = req.query;

  if (!warehouseId)
    return res.status(400).json({ ok: false, message: "warehouseId is required" });

  const search = q ? `%${q}%` : "%";

  const query = `
    SELECT
      ib.batch_id,
      ib.item_id,
      i.Item_Code AS item_code,
      i.Description AS item_description,
      i.Rate AS unit_rate,
      i.Cost AS unit_cost,
      COALESCE(SUM(ib.qty), 0) AS available_qty,
      qt.Description AS uom
    FROM item_batch ib
    INNER JOIN item i ON i.idItem = ib.item_id
    LEFT JOIN quantity_type qt ON qt.idQuantity_Type = i.Qty_Type
    LEFT JOIN grn g ON ib.grn_id = g.idGRN
    WHERE ib.warehouse_id = ?
      AND ib.qty > 0
      AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
      AND (i.Description LIKE ? OR i.Item_Code LIKE ?)
    GROUP BY ib.item_id, ib.batch_id, i.Item_Code, i.Description, i.Rate, i.Cost, qt.Description
    ORDER BY i.Description ASC
    LIMIT 30
  `;

  conn.query(query, [warehouseId, search, search], (err, rows) => {
    if (err) {
      console.error("getMaterialIssueAutoComplete error:", err);
      return res.status(500).json({ ok: false, message: "Search failed" });
    }
    res.json({ ok: true, items: rows || [] });
  });
};
