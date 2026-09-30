const dbService = require("../services/manufacturingDBService");
const productDbService = require("../services/productDBService");
const stockCardDbService = require("../services/stockCardDBService");
const rulesDbService = require("../services/rulesDBService");
const userLogDbService = require("../services/userLogDBService");
const branchDBService = require("../services/branchDBService");
const { currentDate } = require("../utils/currentData");
const db = require("../db/db");
const { productHistoryLogHelper } = productDbService;
const {
  findAccountByNameAndGroup,
  creditDebitLogHelper,
} = require("./accountingController");

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTING HELPER — Manufacturing Double Entries
// Called on both create and update (with a reversal flag for updates).
//
// Economic reality when manufacturing runs:
//   Raw materials leave inventory   → Cr  Raw Materials Inventory (Assets↓)
//   Finished goods enter inventory  → Dr  Finished Goods Inventory (Assets↑)
//
// The cost transferred equals the total_material_cost of the job.
// If dedicated accounts don't exist the helper falls back to the generic
// "Inventory" account (net-zero effect on that account, still auditable).
// ─────────────────────────────────────────────────────────────────────────────
const recordManufacturingAccountingEntries = async ({
  jobNumber,
  totalMaterialCost,
  branchId,
  companyId,
  userId,
  connection,
  reverse = false,          // true when reversing an existing job (edit flow)
}) => {
  const roundedCost = Math.round(parseFloat(totalMaterialCost) * 100) / 100;
  if (!roundedCost || roundedCost <= 0) return;

  const description = reverse
    ? `Manufacturing Job ${jobNumber} reversed`
    : `Manufacturing Job ${jobNumber} – materials converted to finished goods`;

  // Lookup finished-goods account; fall back to generic Inventory
  let finishedGoodsAccountId = await findAccountByNameAndGroup(
    "Finished Goods Inventory", "Assets", companyId, branchId, connection
  );
  if (!finishedGoodsAccountId) {
    finishedGoodsAccountId = await findAccountByNameAndGroup(
      "Inventory", "Assets", companyId, branchId, connection
    );
  }

  // Lookup raw-materials account; fall back to generic Inventory
  let rawMaterialsAccountId = await findAccountByNameAndGroup(
    "Raw Materials Inventory", "Assets", companyId, branchId, connection
  );
  if (!rawMaterialsAccountId) {
    rawMaterialsAccountId = await findAccountByNameAndGroup(
      "Inventory", "Assets", companyId, branchId, connection
    );
  }

  // On a normal job:   Dr Finished Goods, Cr Raw Materials
  // On a reversal:     Cr Finished Goods, Dr Raw Materials  (swap directions)
  const finishedGoodsTxType = reverse ? "credit" : "debit";
  const rawMaterialsTxType  = reverse ? "debit"  : "credit";

  if (finishedGoodsAccountId) {
    await creditDebitLogHelper({
      accountType: "Chartered Account",
      group: "Assets",
      amount: roundedCost,
      description: `Finished Goods increase – ${description}`,
      type: "Manufacturing",
      accountId: finishedGoodsAccountId,
      branchId,
      userId,
      companyId,
      transactionType: finishedGoodsTxType,
      connection,
    });
  } else {
    console.warn(`[MANUFACTURING] ⚠️  No Finished Goods / Inventory account found for branch ${branchId}`);
  }

  if (rawMaterialsAccountId) {
    await creditDebitLogHelper({
      accountType: "Chartered Account",
      group: "Assets",
      amount: roundedCost,
      description: `Raw Materials consumed – ${description}`,
      type: "Manufacturing",
      accountId: rawMaterialsAccountId,
      branchId,
      userId,
      companyId,
      transactionType: rawMaterialsTxType,
      connection,
    });
  } else {
    console.warn(`[MANUFACTURING] ⚠️  No Raw Materials / Inventory account found for branch ${branchId}`);
  }
};

const createManufacturingJob = async (req, res) => {
  const {
    job_date,
    total_material_cost,
    note,
    branch_id,
    user_id,
    items, // Raw materials
    finalProducts, // Array of { item_id, variation_id, qty, cost_percentage, profit_margin, selling_price }
    warehouse_id, // added
    manufacturing_card_id, // added for BOM / Recipe card linkage
  } = req.body;

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
        // 0. Get Company ID
        const companyId = await branchDBService.getCompanyIdByBranch(branch_id);

        // 1. Generate Job Number
        const rules = await rulesDbService.getManufacturingNumberDetails(branch_id);
        const prefix = rules[0]?.Manufacture_No_Start_With || "MFJ-";
        const startFrom = rules[0]?.Manufacture_No_Start_From || 1;

        let nextNumber = `${prefix}${startFrom}`;
        const lastJob = await dbService.getLastJobByPrefix(branch_id, prefix);

        if (lastJob && lastJob.length > 0) {
          const lastNumber = lastJob[0].job_number;
          const match = lastNumber.match(/\d+$/);
          if (match) {
            const numericPart = parseInt(match[0]);
            nextNumber = `${prefix}${numericPart + 1}`;
          }
        }

        // 2. Insert Manufacturing Job
        const jobResult = await dbService.insertManufacturingJob(
          nextNumber,
          job_date,
          null, // final_product_id
          null, // final_product_variation_id
          0, // final_product_qty
          total_material_cost,
          note,
          branch_id,
          user_id,
          0, // profit_margin
          0, // selling_price
          warehouse_id || null, // added
          manufacturing_card_id || null,
          connection
        );
        const job_id = jobResult.insertId;

        // 3. Process Raw Materials
        for (const rawItem of items) {
          // Insert Job Item (Always record for cost calculation)
          await dbService.insertManufacturingJobItem(
            job_id,
            rawItem.item_id,
            rawItem.variation_id || null,
            rawItem.qty,
            rawItem.cost,
            rawItem.total_cost,
            connection
          );

          // Fetch product to check type
          const product = await productDbService.fetchItem(rawItem.item_id, connection);
          if (!product || product.length === 0) {
            throw new Error(`Raw material item ${rawItem.item_id} not found`);
          }

          // SKIP stock updates if it's a SERVICE (Type 2)
          const isService = String(product[0].Type) === "2" || product[0].Type === "Service";

          if (!isService) {
            // Update Stock of Raw Material variation
            if (rawItem.variation_id) {
              await productDbService.processInvoiceVariation(
                rawItem.variation_id,
                rawItem.qty,
                connection
              );
            }

            const currentQty = parseFloat(product[0].Qty) || 0;
            const newQty = currentQty - parseFloat(rawItem.qty);

            await productDbService.itemProcess(
              product[0].Cost,
              product[0].Real_Cost,
              newQty,
              rawItem.item_id,
              connection
            );

            // Insert Stock Card for Consume
            let rawDesc = product[0].Description;
            if (rawItem.variation_id) {
              const varResult = await productDbService.fetchVariation(rawItem.variation_id, connection);
              if (varResult && varResult.length > 0) {
                rawDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
              }
            }

            await stockCardDbService.insertStockCard(
              rawItem.item_id,
              rawDesc,
              "MANUFACTURE_CONSUME",
              nextNumber,
              product[0].Cost,
              product[0].Real_Cost,
              product[0].Rate,
              0, // IN_Stock
              rawItem.qty, // Out_Stock
              newQty, // SIH
              branch_id,
              connection
            );

            // 3.1 Log Product History for Raw Material
            await productHistoryLogHelper({
              productId: rawItem.item_id,
              variationId: rawItem.variation_id || null,
              quantityChange: -parseFloat(rawItem.qty),
              oldQty: currentQty,
              newQty: newQty,
              type: "Manufacturing Consume",
              description: `Consumed as raw material for Manufacturing Job: ${nextNumber}`,
              branchId: branch_id,
              companyId,
              userId: user_id,
              referenceId: job_id,
              connection,
            });
          }
        }

        // 4. Process Multiple Final Products
        for (const fp of finalProducts) {
          const qtyVal = parseFloat(fp.qty) || 1;
          const pctVal = fp.cost_percentage !== undefined && fp.cost_percentage !== null
            ? parseFloat(fp.cost_percentage)
            : (100 / finalProducts.length);
          const allocatedCost = (parseFloat(total_material_cost) * pctVal) / 100;
          const materialCostPerUnit = qtyVal > 0 ? allocatedCost / qtyVal : 0;

          // Insert Final Product
          await dbService.insertManufacturingJobFinalProduct(
            job_id,
            fp.item_id,
            fp.variation_id || null,
            qtyVal,
            fp.profit_margin || 0,
            fp.selling_price || 0,
            connection,
            pctVal,
            materialCostPerUnit
          );

          const finalProduct = await productDbService.fetchItem(fp.item_id, connection);
          if (!finalProduct || finalProduct.length === 0) {
            throw new Error(`Final product item ${fp.item_id} not found`);
          }

          const currentFinalQty = parseFloat(finalProduct[0].Qty) || 0;
          const newFinalQty = currentFinalQty + qtyVal;

          // Update Stock of Final Product Variation
          if (fp.variation_id) {
            await productDbService.updateVariationStock(
              fp.variation_id,
              qtyVal,
              materialCostPerUnit,
              fp.selling_price,
              connection
            );
          }

          // Update Stock of Final Product main product
          const updateCost = materialCostPerUnit > 0 ? materialCostPerUnit : (parseFloat(finalProduct[0].Cost) || 0);
          await productDbService.itemProcess(
            updateCost, // New Cost
            updateCost, // New Real_Cost
            newFinalQty,
            fp.item_id,
            connection
          );

          // Update Selling Price of main product if provided
          if (fp.selling_price && parseFloat(fp.selling_price) > 0) {
            await productDbService.updateItemRate(
              fp.item_id,
              fp.selling_price,
              connection
            );
          }

          // Insert Stock Card for Produce
          let finalDesc = finalProduct[0].Description;
          if (fp.variation_id) {
            const varResult = await productDbService.fetchVariation(fp.variation_id, connection);
            if (varResult && varResult.length > 0) {
              finalDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
            }
          }

          await stockCardDbService.insertStockCard(
            fp.item_id,
            finalDesc,
            "MANUFACTURE_PRODUCE",
            nextNumber,
            materialCostPerUnit,
            materialCostPerUnit,
            finalProduct[0].Rate,
            fp.qty, // IN_Stock
            0, // Out_Stock
            newFinalQty, // SIH
            branch_id,
            connection
          );

          // Log Product History for Final Product
          await productHistoryLogHelper({
            productId: fp.item_id,
            variationId: fp.variation_id || null,
            quantityChange: parseFloat(fp.qty),
            oldQty: currentFinalQty,
            newQty: newFinalQty,
            type: "Manufacturing Produce",
            description: `Produced via Manufacturing Job: ${nextNumber}`,
            branchId: branch_id,
            companyId,
            userId: user_id,
            referenceId: job_id,
            connection,
          });

          // Optionally add to Selected Warehouse
          if (warehouse_id) {
            const sqlBatch = `
              INSERT INTO item_batch
              (item_id, cost, rate, qty, total_cost, warehouse_id, updated_user_id, variation_id, manufacturing_job_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await new Promise((resolve, reject) => {
              connection.query(
                sqlBatch,
                [
                  fp.item_id,
                  materialCostPerUnit,
                  fp.selling_price || finalProduct[0].Rate,
                  fp.qty,
                  allocatedCost,
                  warehouse_id,
                  user_id,
                  fp.variation_id || null,
                  job_id,
                ],
                (err, bRes) => {
                  if (err) reject(err);
                  else resolve(bRes);
                }
              );
            });

            // Log Warehouse Audit Log
            const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
            const ua = req.headers["user-agent"] || "unknown";
            const details = {
              type: "MANUFACTURE_PRODUCE",
              reference: `Manufacturing Job: ${nextNumber}`,
              items: [{ item_id: fp.item_id, qty: fp.qty, cost: materialCostPerUnit }],
            };
            const sqlLog = `
              INSERT INTO warehouse_audit_logs 
                (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
              VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
            `;
            await new Promise((resolve) => {
              connection.query(
                sqlLog,
                [warehouse_id, branch_id, user_id, JSON.stringify(details), ip, ua],
                (err) => {
                  if (err) console.error("Warehouse audit log failed:", err);
                  resolve();
                }
              );
            });
          }
        }

        // 5. Log User Action
        await userLogDbService.insertLog(
          user_id,
          currentDate(),
          "Manufacturing",
          job_id,
          "create",
          branch_id,
          connection
        );

        // 6. Record Accounting Double Entries
        try {
          await recordManufacturingAccountingEntries({
            jobNumber: nextNumber,
            totalMaterialCost: total_material_cost,
            branchId: branch_id,
            companyId,
            userId: user_id,
            connection,
            reverse: false,
          });
          console.log(`[MANUFACTURING] ✅ Accounting entries recorded for Job #${nextNumber}`);
        } catch (accErr) {
          console.error(
            `[MANUFACTURING] ⚠️ Accounting double-entry failed for Job #${nextNumber}:`,
            accErr.message
          );
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(201).json({ 
            message: "Manufacturing job created successfully", 
            job_id, 
            job_number: nextNumber 
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error creating manufacturing job:", err);
          res.status(500).json({ error: err.message || "Error creating manufacturing job" });
        });
      }
    });
  });
};

const updateManufacturingJob = async (req, res) => {
  const { id } = req.params;
  const {
    job_date,
    total_material_cost,
    note,
    branch_id,
    user_id,
    items, // Raw materials
    finalProducts, // Array of { item_id, variation_id, qty, cost_percentage, profit_margin, selling_price }
    warehouse_id, // added
  } = req.body;

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
        const companyId = await branchDBService.getCompanyIdByBranch(branch_id);

        // 1. Fetch OLD job, items, and final products
        const oldJobArr = await dbService.fetchJobById(id);
        if (!oldJobArr || oldJobArr.length === 0) {
          throw new Error("Job not found");
        }
        const oldJob = oldJobArr[0];
        const oldItems = await dbService.fetchJobItems(id, connection);
        const oldFinalProducts = await dbService.fetchJobFinalProducts(id, connection);

        // 2. REVERSE old final products stock changes
        for (const oldFP of oldFinalProducts) {
          const oldFinalProduct = await productDbService.fetchItem(oldFP.item_id, connection);
          if (oldFinalProduct && oldFinalProduct.length > 0) {
            const currentQty = parseFloat(oldFinalProduct[0].Qty) || 0;
            const reversedQty = currentQty - parseFloat(oldFP.qty);
            
            if (oldFP.variation_id) {
              await productDbService.updateVariationStock(
                oldFP.variation_id,
                -parseFloat(oldFP.qty),
                oldFinalProduct[0].Cost,
                connection
              );
            }

            await productDbService.itemProcess(
              oldFinalProduct[0].Cost,
              oldFinalProduct[0].Real_Cost,
              reversedQty,
              oldFP.item_id,
              connection
            );

            let oldFinalDesc = oldFinalProduct[0].Description;
            if (oldFP.variation_id) {
              const varResult = await productDbService.fetchVariation(oldFP.variation_id, connection);
              if (varResult && varResult.length > 0) {
                oldFinalDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
              }
            }

            await stockCardDbService.insertStockCard(
              oldFP.item_id,
              oldFinalDesc,
              "MANUFACTURE_PRODUCE_REVERSE",
              oldJob.job_number,
              oldFinalProduct[0].Cost,
              oldFinalProduct[0].Real_Cost,
              oldFinalProduct[0].Rate,
              0, // IN_Stock
              oldFP.qty, // Out_Stock (reversing produce)
              reversedQty,
              branch_id,
              connection
            );

            if (oldJob.warehouse_id) {
              const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
              const ua = req.headers["user-agent"] || "unknown";
              const details = {
                type: "MANUFACTURE_PRODUCE_REVERSE",
                reference: `Reversed Produced Stock (Edit Job ${oldJob.job_number})`,
                items: [{ item_id: oldFP.item_id, qty: oldFP.qty, cost: oldFinalProduct[0].Cost }],
              };
              const sqlLog = `
                INSERT INTO warehouse_audit_logs 
                  (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
                VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
              `;
              await new Promise((resolve) => {
                connection.query(
                  sqlLog,
                  [oldJob.warehouse_id, branch_id, user_id, JSON.stringify(details), ip, ua],
                  (err) => {
                    if (err) console.error("Warehouse audit log failed:", err);
                    resolve();
                  }
                );
              });
            }
          }
        }

        // 3. REVERSE old raw materials stock changes
        for (const oldItem of oldItems) {
          const product = await productDbService.fetchItem(oldItem.item_id, connection);
          if (product && product.length > 0) {
            const isService = String(product[0].Type) === "2" || product[0].Type === "Service";
            if (isService) continue;

            const currentQty = parseFloat(product[0].Qty) || 0;
            const reversedQty = currentQty + parseFloat(oldItem.qty);

            if (oldItem.variation_id) {
              await productDbService.processInvoiceVariation(
                oldItem.variation_id,
                -parseFloat(oldItem.qty),
                connection
              );
            }

            await productDbService.itemProcess(
              product[0].Cost,
              product[0].Real_Cost,
              reversedQty,
              oldItem.item_id,
              connection
            );

            let oldRawDesc = product[0].Description;
            if (oldItem.variation_id) {
              const varResult = await productDbService.fetchVariation(oldItem.variation_id, connection);
              if (varResult && varResult.length > 0) {
                oldRawDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
              }
            }

            await stockCardDbService.insertStockCard(
              oldItem.item_id,
              oldRawDesc,
              "MANUFACTURE_CONSUME_REVERSE",
              oldJob.job_number,
              product[0].Cost,
              product[0].Real_Cost,
              product[0].Rate,
              oldItem.qty, // IN_Stock (reversing consume)
              0,
              reversedQty,
              branch_id,
              connection
            );
          }
        }

        // 4. Update Manufacturing Job Record
        await dbService.updateManufacturingJob(
          id,
          job_date,
          total_material_cost,
          note,
          warehouse_id || null, // added
          connection
        );

        // 5. Delete Old Items and Old Final Products
        await dbService.deleteJobItems(id, connection);
        await dbService.deleteJobFinalProducts(id, connection);
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM item_batch WHERE manufacturing_job_id = ?", [id], (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        });

        // 6. Apply NEW raw materials stock changes
        for (const rawItem of items) {
          await dbService.insertManufacturingJobItem(
            id,
            rawItem.item_id,
            rawItem.variation_id || null,
            rawItem.qty,
            rawItem.cost,
            rawItem.total_cost,
            connection
          );

          const product = await productDbService.fetchItem(rawItem.item_id, connection);
          if (!product || product.length === 0) {
            throw new Error(`Raw material item ${rawItem.item_id} not found`);
          }

          const isService = String(product[0].Type) === "2" || product[0].Type === "Service";

          if (!isService) {
            if (rawItem.variation_id) {
              await productDbService.processInvoiceVariation(
                rawItem.variation_id,
                rawItem.qty,
                connection
              );
            }

            const currentQty = parseFloat(product[0].Qty) || 0;
            const newQty = currentQty - parseFloat(rawItem.qty);

            await productDbService.itemProcess(
              product[0].Cost,
              product[0].Real_Cost,
              newQty,
              rawItem.item_id,
              connection
            );

            let rawDesc = product[0].Description;
            if (rawItem.variation_id) {
              const varResult = await productDbService.fetchVariation(rawItem.variation_id, connection);
              if (varResult && varResult.length > 0) {
                rawDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
              }
            }

            await stockCardDbService.insertStockCard(
              rawItem.item_id,
              rawDesc,
              "MANUFACTURE_CONSUME",
              oldJob.job_number,
              product[0].Cost,
              product[0].Real_Cost,
              product[0].Rate,
              0,
              rawItem.qty,
              newQty,
              branch_id,
              connection
            );

            await productHistoryLogHelper({
              productId: rawItem.item_id,
              variationId: rawItem.variation_id || null,
              quantityChange: -parseFloat(rawItem.qty),
              oldQty: currentQty,
              newQty: newQty,
              type: "Manufacturing Consume (Edit)",
              description: `Consumed as raw material for Manufacturing Job: ${oldJob.job_number} (Updated)`,
              branchId: branch_id,
              companyId,
              userId: user_id,
              referenceId: id,
              connection,
            });
          }
        }

        // 7. Apply NEW final products stock changes
        for (const fp of finalProducts) {
          const qtyVal = parseFloat(fp.qty) || 1;
          const pctVal = fp.cost_percentage !== undefined && fp.cost_percentage !== null
            ? parseFloat(fp.cost_percentage)
            : (100 / finalProducts.length);
          const allocatedCost = (parseFloat(total_material_cost) * pctVal) / 100;
          const materialCostPerUnit = qtyVal > 0 ? allocatedCost / qtyVal : 0;

          await dbService.insertManufacturingJobFinalProduct(
            id,
            fp.item_id,
            fp.variation_id || null,
            qtyVal,
            fp.profit_margin || 0,
            fp.selling_price || 0,
            connection,
            pctVal,
            materialCostPerUnit
          );

          const finalProduct = await productDbService.fetchItem(fp.item_id, connection);
          if (!finalProduct || finalProduct.length === 0) {
            throw new Error(`Final product item ${fp.item_id} not found`);
          }

          const currentFinalQty = parseFloat(finalProduct[0].Qty) || 0;
          const newFinalQty = currentFinalQty + qtyVal;

          if (fp.variation_id) {
            await productDbService.updateVariationStock(
              fp.variation_id,
              qtyVal,
              materialCostPerUnit,
              fp.selling_price,
              connection
            );
          }

          const updateCost = materialCostPerUnit > 0 ? materialCostPerUnit : (parseFloat(finalProduct[0].Cost) || 0);
          await productDbService.itemProcess(
            updateCost,
            updateCost,
            newFinalQty,
            fp.item_id,
            connection
          );

          if (fp.selling_price && parseFloat(fp.selling_price) > 0) {
            await productDbService.updateItemRate(
              fp.item_id,
              fp.selling_price,
              connection
            );
          }

          let finalDesc = finalProduct[0].Description;
          if (fp.variation_id) {
            const varResult = await productDbService.fetchVariation(fp.variation_id, connection);
            if (varResult && varResult.length > 0) {
              finalDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
            }
          }

          await stockCardDbService.insertStockCard(
            fp.item_id,
            finalDesc,
            "MANUFACTURE_PRODUCE",
            oldJob.job_number,
            materialCostPerUnit,
            materialCostPerUnit,
            finalProduct[0].Rate,
            fp.qty,
            0,
            newFinalQty,
            branch_id,
            connection
          );

          await productHistoryLogHelper({
            productId: fp.item_id,
            variationId: fp.variation_id || null,
            quantityChange: parseFloat(fp.qty),
            oldQty: currentFinalQty,
            newQty: newFinalQty,
            type: "Manufacturing Produce (Edit)",
            description: `Produced via Manufacturing Job: ${oldJob.job_number} (Updated)`,
            branchId: branch_id,
            companyId,
            userId: user_id,
            referenceId: id,
            connection,
          });

          // Optionally add to Selected Warehouse
          if (warehouse_id) {
            const sqlBatch = `
              INSERT INTO item_batch
              (item_id, cost, rate, qty, total_cost, warehouse_id, updated_user_id, variation_id, manufacturing_job_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await new Promise((resolve, reject) => {
              connection.query(
                sqlBatch,
                [
                  fp.item_id,
                  materialCostPerUnit,
                  fp.selling_price || finalProduct[0].Rate,
                  fp.qty,
                  allocatedCost,
                  warehouse_id,
                  user_id,
                  fp.variation_id || null,
                  id,
                ],
                (err, bRes) => {
                  if (err) reject(err);
                  else resolve(bRes);
                }
              );
            });

            // Log Warehouse Audit Log
            const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
            const ua = req.headers["user-agent"] || "unknown";
            const details = {
              type: "MANUFACTURE_PRODUCE",
              reference: `Manufacturing Job: ${oldJob.job_number} (Updated)`,
              items: [{ item_id: fp.item_id, qty: fp.qty, cost: materialCostPerUnit }],
            };
            const sqlLog = `
              INSERT INTO warehouse_audit_logs 
                (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
              VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
            `;
            await new Promise((resolve) => {
              connection.query(
                sqlLog,
                [warehouse_id, branch_id, user_id, JSON.stringify(details), ip, ua],
                (err) => {
                  if (err) console.error("Warehouse audit log failed:", err);
                  resolve();
                }
              );
            });
          }
        }

        // 8. Log User Action
        await userLogDbService.insertLog(
          user_id,
          currentDate(),
          "Manufacturing",
          id,
          "update",
          branch_id,
          connection
        );

        // 9. Update Accounting Entries
        try {
          await recordManufacturingAccountingEntries({
            jobNumber: oldJob.job_number,
            totalMaterialCost: oldJob.total_material_cost,
            branchId: branch_id,
            companyId,
            userId: user_id,
            connection,
            reverse: true,
          });

          await recordManufacturingAccountingEntries({
            jobNumber: oldJob.job_number,
            totalMaterialCost: total_material_cost,
            branchId: branch_id,
            companyId,
            userId: user_id,
            connection,
            reverse: false,
          });

          console.log(`[MANUFACTURING] ✅ Accounting entries updated for Job #${oldJob.job_number}`);
        } catch (accErr) {
          console.error(
            `[MANUFACTURING] ⚠️ Accounting double-entry failed on update for Job #${oldJob.job_number}:`,
            accErr.message
          );
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(200).json({ message: "Manufacturing job updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating manufacturing job:", err);
          res.status(500).json({ error: err.message || "Error updating manufacturing job" });
        });
      }
    });
  });
};

const getManufacturingJobs = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const jobs = await dbService.fetchManufacturingJobs(branch_id);
    res.json(jobs);
  } catch (err) {
    console.error("Error fetching manufacturing jobs:", err);
    res.status(500).json({ error: "Error fetching manufacturing jobs" });
  }
};

const getJobDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const job = await dbService.fetchJobById(id);
    if (!job || job.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }
    const items = await dbService.fetchJobItems(id);
    const finalProducts = await dbService.fetchJobFinalProducts(id);
    res.json({ ...job[0], items, finalProducts });
  } catch (err) {
    console.error("Error fetching job details:", err);
    res.status(500).json({ error: "Error fetching job details" });
  }
};

const getManufacturingRules = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const rules = await rulesDbService.getManufacturingNumberDetails(branch_id);
    res.json(rules[0] || { Manufacture_No_Start_With: "MFJ-", Manufacture_No_Start_From: 1 });
  } catch (err) {
    console.error("Error fetching manufacturing rules:", err);
    res.status(500).json({ error: "Error fetching manufacturing rules" });
  }
};

const updateManufacturingRules = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const { Manufacture_No_Start_With, Manufacture_No_Start_From } = req.body;
    await rulesDbService.updateManufacturingNumberDetails(
      branch_id,
      Manufacture_No_Start_With,
      Manufacture_No_Start_From
    );
    res.json({ message: "Manufacturing rules updated successfully" });
  } catch (err) {
    console.error("Error updating manufacturing rules:", err);
    res.status(500).json({ error: "Error updating manufacturing rules" });
  }
};

const deleteManufacturingJob = async (req, res) => {
  const { id } = req.params;

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
        // 1. Fetch OLD job, items, and final products
        const oldJobArr = await dbService.fetchJobById(id);
        if (!oldJobArr || oldJobArr.length === 0) {
          throw new Error("Job not found");
        }
        const oldJob = oldJobArr[0];
        const oldItems = await dbService.fetchJobItems(id, connection);
        const oldFinalProducts = await dbService.fetchJobFinalProducts(id, connection);
        const branch_id = oldJob.branch_id;

        // 0. Get Company ID
        const companyId = await branchDBService.getCompanyIdByBranch(branch_id);

        // 2. REVERSE Final Products Qty & Prices
        for (const oldFP of oldFinalProducts) {
          const oldFinalProduct = await productDbService.fetchItem(oldFP.item_id, connection);
          if (oldFinalProduct && oldFinalProduct.length > 0) {
            const currentQty = parseFloat(oldFinalProduct[0].Qty) || 0;
            const reversedQty = currentQty - parseFloat(oldFP.qty);

            // Fetch previous stock card for final product (excluding current job) to restore cost/selling price
            const prevStockCard = await new Promise((resolve, reject) => {
              const q = `
                SELECT Cost, Real_Cost, Sell_Price 
                FROM stock_card 
                WHERE Item_idItem = ? AND Branch_idBranch = ? AND Transaction_ID != ? 
                ORDER BY idStock_Card DESC LIMIT 1
              `;
              connection.query(q, [oldFP.item_id, branch_id, oldJob.job_number], (err, results) => {
                if (err) reject(err);
                else resolve(results && results.length > 0 ? results[0] : null);
              });
            });

            if (oldFP.variation_id) {
              if (prevStockCard) {
                const updateVarQuery = "UPDATE item_variations SET qty = qty - ?, cost = ?, rate = ? WHERE id = ?";
                await new Promise((resolve, reject) => {
                  connection.query(updateVarQuery, [parseFloat(oldFP.qty), prevStockCard.Cost, prevStockCard.Sell_Price, oldFP.variation_id], (err, res) => {
                    if (err) reject(err);
                    else resolve(res);
                  });
                });
              } else {
                await productDbService.updateVariationStock(
                  oldFP.variation_id,
                  -parseFloat(oldFP.qty),
                  oldFinalProduct[0].Cost,
                  connection
                );
              }
            }

            if (prevStockCard) {
              await productDbService.itemProcess(
                prevStockCard.Cost,
                prevStockCard.Real_Cost,
                reversedQty,
                oldFP.item_id,
                connection
              );
              await productDbService.updateItemRate(
                oldFP.item_id,
                prevStockCard.Sell_Price,
                connection
              );
            } else {
              await productDbService.itemProcess(
                oldFinalProduct[0].Cost,
                oldFinalProduct[0].Real_Cost,
                reversedQty,
                oldFP.item_id,
                connection
              );
            }

            let oldFinalDesc = oldFinalProduct[0].Description;
            if (oldFP.variation_id) {
              const varResult = await productDbService.fetchVariation(oldFP.variation_id, connection);
              if (varResult && varResult.length > 0) {
                oldFinalDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
              }
            }

            await stockCardDbService.insertStockCard(
              oldFP.item_id,
              oldFinalDesc,
              "MANUFACTURE_PRODUCE_REVERSE",
              oldJob.job_number,
              prevStockCard ? prevStockCard.Cost : oldFinalProduct[0].Cost,
              prevStockCard ? prevStockCard.Real_Cost : oldFinalProduct[0].Real_Cost,
              prevStockCard ? prevStockCard.Sell_Price : oldFinalProduct[0].Rate,
              0, // IN_Stock
              oldFP.qty, // Out_Stock (reversing produce)
              reversedQty,
              branch_id,
              connection
            );

            await productHistoryLogHelper({
              productId: oldFP.item_id,
              variationId: oldFP.variation_id || null,
              quantityChange: -parseFloat(oldFP.qty),
              oldQty: currentQty,
              newQty: reversedQty,
              type: "Manufacturing Produce Reverse (Delete)",
              description: `Reversed produced stock because Job ${oldJob.job_number} was deleted`,
              branchId: branch_id,
              companyId,
              userId: req.body.user_id || oldJob.user_id,
              referenceId: id,
              connection,
            });

            if (oldJob.warehouse_id) {
              const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
              const ua = req.headers["user-agent"] || "unknown";
              const details = {
                type: "MANUFACTURE_PRODUCE_REVERSE",
                reference: `Reversed Produced Stock (Delete Job ${oldJob.job_number})`,
                items: [{ item_id: oldFP.item_id, qty: oldFP.qty, cost: prevStockCard ? prevStockCard.Cost : oldFinalProduct[0].Cost }],
              };
              const sqlLog = `
                INSERT INTO warehouse_audit_logs 
                  (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
                VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
              `;
              await new Promise((resolve) => {
                connection.query(
                  sqlLog,
                  [oldJob.warehouse_id, branch_id, req.body.user_id || oldJob.user_id, JSON.stringify(details), ip, ua],
                  (err) => {
                    if (err) console.error("Warehouse audit log failed:", err);
                    resolve();
                  }
                );
              });
            }
          }
        }

        // 3. REVERSE Raw Materials Qty
        for (const oldItem of oldItems) {
          const product = await productDbService.fetchItem(oldItem.item_id, connection);
          if (product && product.length > 0) {
            const isService = String(product[0].Type) === "2" || product[0].Type === "Service";
            if (isService) continue;

            const currentQty = parseFloat(product[0].Qty) || 0;
            const reversedQty = currentQty + parseFloat(oldItem.qty);

            if (oldItem.variation_id) {
              await productDbService.processInvoiceVariation(
                oldItem.variation_id,
                -parseFloat(oldItem.qty),
                connection
              );
            }

            await productDbService.itemProcess(
              product[0].Cost,
              product[0].Real_Cost,
              reversedQty,
              oldItem.item_id,
              connection
            );

            let oldRawDesc = product[0].Description;
            if (oldItem.variation_id) {
              const varResult = await productDbService.fetchVariation(oldItem.variation_id, connection);
              if (varResult && varResult.length > 0) {
                oldRawDesc += ` - ${varResult[0].description || varResult[0].attribute_value}`;
              }
            }

            await stockCardDbService.insertStockCard(
              oldItem.item_id,
              oldRawDesc,
              "MANUFACTURE_CONSUME_REVERSE",
              oldJob.job_number,
              product[0].Cost,
              product[0].Real_Cost,
              product[0].Rate,
              oldItem.qty,
              0,
              reversedQty,
              branch_id,
              connection
            );

            await productHistoryLogHelper({
              productId: oldItem.item_id,
              variationId: oldItem.variation_id || null,
              quantityChange: parseFloat(oldItem.qty),
              oldQty: currentQty,
              newQty: reversedQty,
              type: "Manufacturing Consume Reverse (Delete)",
              description: `Returned raw materials back to stock because Job ${oldJob.job_number} was deleted`,
              branchId: branch_id,
              companyId,
              userId: req.body.user_id || oldJob.user_id,
              referenceId: id,
              connection,
            });
          }
        }

        // 4. Delete Job Items and Final Products
        await dbService.deleteJobItems(id, connection);
        await dbService.deleteJobFinalProducts(id, connection);

        // 5. Delete Job Record
        await new Promise((resolve, reject) => {
          const q = "DELETE FROM manufacturing_jobs WHERE id = ?";
          connection.query(q, [id], (err, results) => {
            if (err) reject(err);
            else resolve(results);
          });
        });

        // 6. Log User Action
        await userLogDbService.insertLog(
          req.body.user_id || oldJob.user_id,
          currentDate(),
          "Manufacturing",
          id,
          "delete",
          branch_id,
          connection
        );

        // 7. Reverse Accounting Entries
        try {
          await recordManufacturingAccountingEntries({
            jobNumber: oldJob.job_number,
            totalMaterialCost: oldJob.total_material_cost,
            branchId: branch_id,
            companyId,
            userId: req.body.user_id || oldJob.user_id,
            connection,
            reverse: true,
          });
          console.log(`[MANUFACTURING] ✅ Accounting entries reversed for deleted Job #${oldJob.job_number}`);
        } catch (accErr) {
          console.error(
            `[MANUFACTURING] ⚠️ Accounting reversal failed for deleted Job #${oldJob.job_number}:`,
            accErr.message
          );
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(200).json({ message: "Manufacturing job deleted and reversed successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error deleting manufacturing job:", err);
          res.status(500).json({ error: err.message || "Error deleting manufacturing job" });
        });
      }
    });
  });
};

const createTemplate = async (req, res) => {
  const { template_name, note, branch_id, items, finalProducts } = req.body;

  if (!template_name) {
    return res.status(400).json({ error: "Template name is required" });
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
        // Insert template main record
        const templateResult = await dbService.insertTemplate(
          template_name,
          note || null,
          branch_id,
          connection
        );
        const template_id = templateResult.insertId;

        // Insert raw materials (items)
        if (items && Array.isArray(items)) {
          for (const rawItem of items) {
            await dbService.insertTemplateItem(
              template_id,
              rawItem.item_id,
              rawItem.variation_id || null,
              rawItem.qty,
              connection
            );
          }
        }

        // Insert final products
        if (finalProducts && Array.isArray(finalProducts)) {
          for (const fp of finalProducts) {
            await dbService.insertTemplateFinalProduct(
              template_id,
              fp.item_id,
              fp.variation_id || null,
              fp.qty,
              fp.cost_percentage || 0,
              fp.profit_margin || 0,
              connection
            );
          }
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(201).json({ message: "Template saved successfully", template_id });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error creating manufacturing template:", err);
          res.status(500).json({ error: err.message || "Failed to create template" });
        });
      }
    });
  });
};

const getTemplates = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const templates = await dbService.fetchTemplates(branch_id);
    res.json(templates);
  } catch (err) {
    console.error("Error fetching templates:", err);
    res.status(500).json({ error: "Error fetching templates" });
  }
};

const getTemplateDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await dbService.fetchTemplateById(id);
    if (!template || template.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }
    const items = await dbService.fetchTemplateItems(id);
    const finalProducts = await dbService.fetchTemplateFinalProducts(id);
    res.json({ ...template[0], items, finalProducts });
  } catch (err) {
    console.error("Error fetching template details:", err);
    res.status(500).json({ error: "Error fetching template details" });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    await dbService.deleteTemplate(id);
    res.json({ message: "Template deleted successfully" });
  } catch (err) {
    console.error("Error deleting template:", err);
    res.status(500).json({ error: "Error deleting template" });
  }
};

module.exports = {
  createManufacturingJob,
  updateManufacturingJob,
  getManufacturingJobs,
  getJobDetails,
  getManufacturingRules,
  updateManufacturingRules,
  deleteManufacturingJob,
  createTemplate,
  getTemplates,
  getTemplateDetails,
  deleteTemplate,
};
