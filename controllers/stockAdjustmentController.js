const db = require("../db/db");
const dbService = require("../services/productDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const stockCardDbService = require("../services/stockCardDBService");
const branchDBService = require("../services/branchDBService");
const { productHistoryLogHelper } = require("../services/productDBService");
const { postStockAdjustmentAccounting } = require("../services/inventoryAccountingService");

// Helper to format date as YYYY-MM-DD HH:mm:ss
const formatMySQLDateTime = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const createStockAdjustment = async (req, res) => {
  const { notes, items, userId, branchId, warehouseId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one item is required for stock adjustment." });
  }

  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        // 1. Generate unique Adjustment Number
        const countQuery = "SELECT COUNT(*) AS count FROM stock_adjustment WHERE Branch_idBranch = ?";
        const countResult = await new Promise((resolve, reject) => {
          connection.query(countQuery, [branchId], (err, results) => {
            if (err) reject(err);
            else resolve(results[0]?.count || 0);
          });
        });

        const today = new Date();
        const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
        const adjustmentNumber = `STK-ADJ-${yyyymmdd}-${String(countResult + 1).padStart(4, "0")}`;

        // 2. Insert into stock_adjustment table
        const insertAdjQuery = `
          INSERT INTO stock_adjustment (Adjustment_Number, Date, Notes, User_idUser, Branch_idBranch)
          VALUES (?, ?, ?, ?, ?)
        `;
        const adjResult = await new Promise((resolve, reject) => {
          connection.query(
            insertAdjQuery,
            [adjustmentNumber, formatMySQLDateTime(today), notes || null, userId, branchId],
            (err, results) => {
              if (err) reject(err);
              else resolve(results.insertId);
            }
          );
        });

        let companyId = await branchDBService.getCompanyIdByBranch(branchId);
        if (!companyId) {
          const [bRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM branch WHERE idBranch = ? LIMIT 1",
            [branchId]
          );
          companyId = bRows[0]?.Company_idCompany;
        }
        if (!companyId) {
          const [anyRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Company_idCompany IS NOT NULL ORDER BY idProduct_History_Log DESC LIMIT 1"
          );
          companyId = anyRows[0]?.Company_idCompany || 1;
        }

        // 3. Process each item
        for (const item of items) {
          const { productId, adjustmentQty, variationId } = item;
          const targetWhId = item.warehouseId || warehouseId || null;
          
          // Fetch current item details
          const fetchedItems = await dbService.fetchItem(productId, connection);
          if (!fetchedItems || fetchedItems.length === 0) {
            throw new Error(`Product with ID ${productId} not found.`);
          }
          
          const currentItem = fetchedItems[0];
          const oldQty = parseFloat(currentItem.Qty) || 0;
          const adjVal = parseFloat(adjustmentQty) || 0;
          const newQty = oldQty + adjVal;

          let in_qty = adjVal > 0 ? adjVal : 0;
          let out_qty = adjVal < 0 ? -adjVal : 0;

          // Update product qty in database
          await dbService.adjustProductQty(newQty, productId, connection);

          // If warehouseId is given, synchronize warehouse batches
          if (targetWhId) {
            if (adjVal < 0) {
              const [wBatches] = await connection.promise().query(
                `SELECT * FROM item_batch WHERE item_id = ? AND (variation_id <=> ?) AND warehouse_id = ? AND qty > 0 ORDER BY batch_id ASC FOR UPDATE`,
                [productId, variationId || null, Number(targetWhId)]
              );
              let toDeduct = Math.abs(adjVal);
              for (const b of wBatches) {
                if (toDeduct <= 0) break;
                const bQty = parseFloat(b.qty) || 0;
                const take = Math.min(toDeduct, bQty);
                await connection.promise().query("UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?", [take, b.batch_id]);
                toDeduct -= take;
              }
            } else if (adjVal > 0) {
              const [wBatches] = await connection.promise().query(
                `SELECT * FROM item_batch WHERE item_id = ? AND (variation_id <=> ?) AND warehouse_id = ? ORDER BY batch_id DESC LIMIT 1 FOR UPDATE`,
                [productId, variationId || null, Number(targetWhId)]
              );
              if (wBatches.length > 0) {
                await connection.promise().query("UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?", [adjVal, wBatches[0].batch_id]);
              } else {
                await connection.promise().query(
                  `INSERT INTO item_batch (item_id, variation_id, warehouse_id, qty, cost, total_cost, date, status, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, CURDATE(), 1, ?)`,
                  [productId, variationId || null, Number(targetWhId), adjVal, Number(currentItem.Cost || 0), Number(currentItem.Cost || 0) * adjVal, branchId]
                );
              }
            }

            // Sync warehouse counters
            await connection.promise().query(
              `UPDATE warehouses w
               SET 
                 stock_count = COALESCE((SELECT SUM(ib.qty) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0),
                 item_count = COALESCE((SELECT COUNT(DISTINCT ib.item_id) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0)
               WHERE w.id = ?`,
              [Number(targetWhId)]
            );

            // Audit log for warehouse
            const [whNameRows] = await connection.promise().query("SELECT name FROM warehouses WHERE id = ?", [Number(targetWhId)]);
            const whName = whNameRows[0]?.name || `Warehouse #${targetWhId}`;
            const auditDetails = {
              type: "STOCK_ADJUSTMENT",
              reference: adjustmentNumber,
              warehouseName: whName,
              items: [{ id: productId, delta: adjVal, newQty }]
            };
            const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
            const ua = req.headers["user-agent"] || null;
            await connection.promise().query(
              `INSERT INTO warehouse_audit_logs (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)`,
              [Number(targetWhId), branchId, userId, JSON.stringify(auditDetails), ip, ua]
            );
          }

          // Log history
          await productHistoryLogHelper({
            productId,
            variationId: null,
            quantityChange: adjVal,
            oldQty,
            newQty,
            type: "Stock Adjustment",
            description: `Bulk Stock Adjustment ${adjustmentNumber}: Adjusted by ${adjVal} (from ${oldQty} to ${newQty})`,
            branchId,
            companyId,
            userId,
            referenceId: adjResult,
            connection,
          });

          // Log stock card
          await stockCardDbService.insertStockCard(
            productId,
            currentItem.Description,
            "adjustQty",
            productId,
            currentItem.Cost,
            currentItem.Real_Cost,
            currentItem.Rate,
            in_qty,
            out_qty,
            newQty,
            branchId,
            connection
          );

          // Accounting: Post standard double entry for stock adjustment
          if (adjVal !== 0) {
            const adjCost = parseFloat(currentItem.Cost || currentItem.Real_Cost || 0);
            await postStockAdjustmentAccounting({
              productId,
              productName: currentItem.Description,
              deltaQty: adjVal,
              unitCost: adjCost,
              branchId,
              companyId,
              userId,
              reference: adjustmentNumber,
              notes: notes || `Bulk Stock Adjustment ${adjustmentNumber}`,
              connection,
            });
          }

          // Insert into stock_adjustment_items table
          const insertItemQuery = `
            INSERT INTO stock_adjustment_items (Stock_Adjustment_idStock_Adjustment, Product_idItem, Old_Qty, Adjustment_Qty, New_Qty)
            VALUES (?, ?, ?, ?, ?)
          `;
          await new Promise((resolve, reject) => {
            connection.query(
              insertItemQuery,
              [adjResult, productId, oldQty, adjVal, newQty],
              (err, results) => {
                if (err) reject(err);
                else resolve(results);
              }
            );
          });
        }

        // 4. Insert user action log
        await userLogDbService.insertLog(
          userId,
          currentDate(),
          "Stock Adjustment",
          adjResult,
          "createBulkAdjustment",
          branchId,
          connection
        );

        // Commit transaction
        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit stock adjustment" });
            });
          }
          connection.release();
          res.json({ success: true, message: "Bulk stock adjustment successfully saved.", id: adjResult });
        });

      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error processing bulk stock adjustment:", err);
          res.status(500).json({
            error: "Error processing bulk stock adjustment",
            message: err.message,
          });
        });
      }
    });
  });
};

const getStockAdjustments = async (req, res) => {
  const { branchId } = req.params;

  const query = `
    SELECT sa.*, u.First_Name, u.Last_Name AS lastName
    FROM stock_adjustment sa
    LEFT JOIN user u ON sa.User_idUser = u.idUser
    WHERE sa.Branch_idBranch = ?
    ORDER BY sa.Date DESC
  `;

  db.query(query, [branchId], (err, results) => {
    if (err) {
      console.error("Error fetching stock adjustments:", err);
      return res.status(500).json({ error: "Failed to fetch stock adjustments" });
    }
    res.json(results);
  });
};

const getStockAdjustmentById = async (req, res) => {
  const { id } = req.params;

  const mainQuery = `
    SELECT sa.*, u.First_Name, u.Last_Name AS lastName
    FROM stock_adjustment sa
    LEFT JOIN user u ON sa.User_idUser = u.idUser
    WHERE sa.idStock_Adjustment = ?
  `;

  const itemsQuery = `
    SELECT sai.*, i.Description AS Item_Name, i.Item_Code AS Code, i.Cost AS Cost
    FROM stock_adjustment_items sai
    LEFT JOIN item i ON sai.Product_idItem = i.idItem
    WHERE sai.Stock_Adjustment_idStock_Adjustment = ?
  `;

  db.query(mainQuery, [id], (err, mainResults) => {
    if (err) {
      console.error("Error fetching stock adjustment:", err);
      return res.status(500).json({ error: "Failed to fetch stock adjustment record" });
    }

    if (mainResults.length === 0) {
      return res.status(404).json({ error: "Stock adjustment record not found" });
    }

    db.query(itemsQuery, [id], (errItems, itemsResults) => {
      if (errItems) {
        console.error("Error fetching stock adjustment items:", errItems);
        return res.status(500).json({ error: "Failed to fetch stock adjustment entries" });
      }

      res.json({
        ...mainResults[0],
        items: itemsResults
      });
    });
  });
};

module.exports = {
  createStockAdjustment,
  getStockAdjustments,
  getStockAdjustmentById
};
