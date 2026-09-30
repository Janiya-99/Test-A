/**
 * Stock Correction Script for Double-Deduction Invoice Edit Bug
 * 
 * Usage:
 *   1. Dry Run (See what will be changed without updating database):
 *      node fix_stock_discrepancies.js
 * 
 *   2. Apply Changes (Runs inside a transaction and commits corrections):
 *      node fix_stock_discrepancies.js --commit
 */

const db = require("./db/db");

// Retrieve Colombo timezone formatted date-time
function getColomboDateTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

async function run() {
  const commit = process.argv.includes("--commit");
  console.log("==================================================");
  console.log("   STOCK CARD DOUBLE-DEDUCTION CORRECTION SCRIPT   ");
  console.log("==================================================");
  console.log(commit ? "MODE: COMMIT (Applying updates to database)" : "MODE: DRY RUN (No database writes)");
  console.log("Starting analysis...\n");

  try {
    // ----------------------------------------------------
    // 1. ANALYZE REGULAR ITEMS
    // ----------------------------------------------------
    console.log("Analyzing standard physical items...");
    const items = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idItem, Description, Qty, Cost, Real_Cost, Rate, Branch_idBranch 
         FROM item 
         WHERE Type = '1' 
           AND idItem NOT IN (SELECT DISTINCT item_id FROM item_variations)`, 
        (err, res) => {
          if (err) reject(err); else resolve(res);
        }
      );
    });

    const itemsMap = {};
    for (const item of items) {
      itemsMap[item.idItem] = {
        description: item.Description,
        qty: parseFloat(item.Qty) || 0,
        cost: parseFloat(item.Cost) || 0,
        realCost: parseFloat(item.Real_Cost) || 0,
        rate: parseFloat(item.Rate) || 0,
        branchId: item.Branch_idBranch,
      };
    }

    const stockCards = await new Promise((resolve, reject) => {
      db.query(
        `SELECT Item_idItem, Transaction_ID, IN_Stock, Out_Stock 
         FROM stock_card 
         WHERE Transaction_Type IN ('INVOICE', 'INVOICE-UPDATE', 'INVOICE-UPDATE-REVERT')`,
        (err, res) => {
          if (err) reject(err); else resolve(res);
        }
      );
    });

    const scGroups = {};
    for (const sc of stockCards) {
      const itemId = sc.Item_idItem;
      const invoiceId = sc.Transaction_ID;
      if (!itemsMap[itemId]) continue;
      if (!scGroups[itemId]) scGroups[itemId] = {};
      if (!scGroups[itemId][invoiceId]) scGroups[itemId][invoiceId] = [];
      scGroups[itemId][invoiceId].push(sc);
    }

    const invoiceItems = await new Promise((resolve, reject) => {
      db.query("SELECT Item_idItem, Invoice_idInvoice, Qty, Discount_Type FROM invoice_has_item", (err, res) => {
        if (err) reject(err); else resolve(res);
      });
    });

    const activeGroups = {};
    for (const ii of invoiceItems) {
      const itemId = ii.Item_idItem;
      const invoiceId = ii.Invoice_idInvoice;
      if (!itemsMap[itemId]) continue;
      if (!activeGroups[itemId]) activeGroups[itemId] = {};
      if (!activeGroups[itemId][invoiceId]) activeGroups[itemId][invoiceId] = [];
      activeGroups[itemId][invoiceId].push(ii);
    }

    const itemCorrections = [];
    for (const itemIdStr of Object.keys(scGroups)) {
      const itemId = parseInt(itemIdStr);
      const invoices = scGroups[itemId];
      let itemTotalDiff = 0;

      for (const invoiceId of Object.keys(invoices)) {
        const logs = invoices[invoiceId];
        let totalDeducted = 0;
        for (const log of logs) {
          totalDeducted += ((parseFloat(log.Out_Stock) || 0) - (parseFloat(log.IN_Stock) || 0));
        }

        let activeQty = 0;
        const activeLines = (activeGroups[itemId] && activeGroups[itemId][invoiceId]) || [];
        for (const line of activeLines) {
          const qty = parseFloat(line.Qty) || 0;
          if (line.Discount_Type === 'RTN') activeQty -= qty; else activeQty += qty;
        }

        const diff = totalDeducted - activeQty;
        if (diff !== 0) {
          itemTotalDiff += diff;
        }
      }

      if (itemTotalDiff !== 0) {
        const info = itemsMap[itemId];
        itemCorrections.push({
          idItem: itemId,
          description: info.description,
          branchId: info.branchId,
          currentQty: info.qty,
          overDeducted: itemTotalDiff, // positive means over-deducted (needs to be added back)
          correctedQty: info.qty + itemTotalDiff,
          cost: info.cost,
          realCost: info.realCost,
          rate: info.rate,
        });
      }
    }

    // ----------------------------------------------------
    // 2. ANALYZE VARIATIONS
    // ----------------------------------------------------
    console.log("Analyzing product variations...");
    const variations = await new Promise((resolve, reject) => {
      db.query("SELECT id, item_id, description, qty FROM item_variations", (err, res) => {
        if (err) reject(err); else resolve(res);
      });
    });

    const varMap = {};
    for (const v of variations) {
      varMap[v.id] = {
        itemId: v.item_id,
        description: v.description,
        qty: parseFloat(v.qty) || 0,
      };
    }

    const varLogs = await new Promise((resolve, reject) => {
      db.query(
        `SELECT Product_idProduct, Variation_idVariation, Reference_ID, Quantity_Change 
         FROM product_history_log 
         WHERE Variation_idVariation IS NOT NULL 
           AND Reference_ID IS NOT NULL 
           AND Type IN ('Invoice Sale', 'Invoice Return', 'POS Sale (Variation)', 'POS Sale')`,
        (err, res) => {
          if (err) reject(err); else resolve(res);
        }
      );
    });

    const varLogGroups = {};
    for (const log of varLogs) {
      const vId = log.Variation_idVariation;
      const refId = log.Reference_ID;
      if (!varMap[vId]) continue;
      if (!varLogGroups[vId]) varLogGroups[vId] = {};
      if (!varLogGroups[vId][refId]) varLogGroups[vId][refId] = [];
      varLogGroups[vId][refId].push(log);
    }

    const varInvoiceItems = await new Promise((resolve, reject) => {
      db.query(
        "SELECT Item_idItem, Invoice_idInvoice, Variation_Id, Qty, Discount_Type FROM invoice_has_item WHERE Variation_Id IS NOT NULL AND Variation_Id > 0",
        (err, res) => {
          if (err) reject(err); else resolve(res);
        }
      );
    });

    const varActiveGroups = {};
    for (const ii of varInvoiceItems) {
      const vId = ii.Variation_Id;
      const refId = ii.Invoice_idInvoice;
      if (!varMap[vId]) continue;
      if (!varActiveGroups[vId]) varActiveGroups[vId] = {};
      if (!varActiveGroups[vId][refId]) varActiveGroups[vId][refId] = [];
      varActiveGroups[vId][refId].push(ii);
    }

    const varCorrections = [];
    for (const vIdStr of Object.keys(varLogGroups)) {
      const vId = parseInt(vIdStr);
      const invoices = varLogGroups[vId];
      let totalDiff = 0;

      for (const refId of Object.keys(invoices)) {
        const vLogs = invoices[refId];
        let loggedChange = 0;
        for (const l of vLogs) {
          loggedChange += parseFloat(l.Quantity_Change) || 0;
        }

        let activeChange = 0;
        const activeLines = (varActiveGroups[vId] && varActiveGroups[vId][refId]) || [];
        for (const line of activeLines) {
          const qty = parseFloat(line.Qty) || 0;
          if (line.Discount_Type === 'RTN') activeChange += qty; else activeChange -= qty;
        }

        const diff = loggedChange - activeChange;
        if (diff !== 0) {
          totalDiff += diff;
        }
      }

      if (totalDiff !== 0) {
        const info = varMap[vId];
        const itemInfo = itemsMap[info.itemId] || { branchId: 1 };
        varCorrections.push({
          id: vId,
          itemId: info.itemId,
          description: info.description,
          branchId: itemInfo.branchId,
          currentQty: info.qty,
          overDeducted: -totalDiff, // Negating diff because logged sale is negative, over-deducted means too negative
          correctedQty: info.qty - totalDiff,
        });
      }
    }

    console.log(`\nAnalysis complete.`);
    console.log(`Found ${itemCorrections.length} items requiring correction.`);
    console.log(`Found ${varCorrections.length} variations requiring correction.`);

    if (itemCorrections.length === 0 && varCorrections.length === 0) {
      console.log("No stock discrepancies found. Everything is correct!");
      db.end();
      return;
    }

    // ----------------------------------------------------
    // 3. EXECUTE CORRECTIONS (IF COMMITTING)
    // ----------------------------------------------------
    if (!commit) {
      console.log("\n================ DRY RUN RESULTS ================");
      if (itemCorrections.length > 0) {
        console.log("\nStandard Item Corrections Preview (Top 20):");
        console.table(itemCorrections.slice(0, 20).map(c => ({
          ID: c.idItem,
          Name: c.description,
          Branch: c.branchId,
          "Current Qty": c.currentQty,
          "Qty to Add Back": c.overDeducted,
          "New Qty": c.correctedQty,
        })));
      }
      if (varCorrections.length > 0) {
        console.log("\nVariation Corrections Preview (Top 20):");
        console.table(varCorrections.slice(0, 20).map(c => ({
          ID: c.id,
          Name: c.description,
          Item_ID: c.itemId,
          "Current Qty": c.currentQty,
          "Qty to Add Back": c.overDeducted,
          "New Qty": c.correctedQty,
        })));
      }
      console.log("\nTo apply these corrections, run:");
      console.log("  node fix_stock_discrepancies.js --commit");
      process.exit(0);
      return;
    }

    // Process DB Updates inside Transaction
    console.log("\nApplying corrections to the database...");
    const conn = await new Promise((resolve, reject) => {
      db.getConnection((err, connection) => {
        if (err) reject(err); else resolve(connection);
      });
    });

    await new Promise((resolve, reject) => {
      conn.beginTransaction(err => err ? reject(err) : resolve());
    });

    try {
      const dateTimeStr = getColomboDateTime();

      // 1. Correct Standard Items
      for (const c of itemCorrections) {
        console.log(`Correcting Item ${c.idItem} (${c.description}): adding back ${c.overDeducted}`);
        
        // A. Update item quantity
        await new Promise((resolve, reject) => {
          conn.query(
            "UPDATE item SET Qty = Qty + ? WHERE idItem = ?",
            [c.overDeducted, c.idItem],
            (err) => err ? reject(err) : resolve()
          );
        });

        // B. Insert correction log into stock_card
        await new Promise((resolve, reject) => {
          conn.query(
            `INSERT INTO stock_card 
             (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              dateTimeStr,
              c.idItem,
              c.description + " (Stock Correction)",
              "STOCK-ADJUSTMENT-FIX",
              "BUG-FIX-2026",
              c.cost,
              c.realCost,
              c.rate,
              c.overDeducted > 0 ? c.overDeducted : 0,
              c.overDeducted < 0 ? -c.overDeducted : 0,
              c.correctedQty,
              c.branchId
            ],
            (err) => err ? reject(err) : resolve()
          );
        });

        // C. Insert into product_history_log
        await new Promise((resolve, reject) => {
          conn.query(
            `INSERT INTO product_history_log 
             (Product_idProduct, Variation_idVariation, Date_Time, Type, Description, Quantity_Change, Old_Quantity, New_Quantity, User_idUser, Branch_idBranch, Company_idCompany, Reference_ID) 
             VALUES (?, NULL, NOW(), 'Stock Correction', 'Corrected double-deduction from invoice edits', ?, ?, ?, 1, ?, 1, NULL)`,
            [c.idItem, c.overDeducted, c.currentQty, c.correctedQty, c.branchId],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      // 2. Correct Variations
      for (const c of varCorrections) {
        console.log(`Correcting Variation ${c.id} (${c.description}): adding back ${c.overDeducted}`);

        // A. Update variation quantity
        await new Promise((resolve, reject) => {
          conn.query(
            "UPDATE item_variations SET qty = qty + ? WHERE id = ?",
            [c.overDeducted, c.id],
            (err) => err ? reject(err) : resolve()
          );
        });

        // B. Insert variation history log
        await new Promise((resolve, reject) => {
          conn.query(
            `INSERT INTO product_history_log 
             (Product_idProduct, Variation_idVariation, Date_Time, Type, Description, Quantity_Change, Old_Quantity, New_Quantity, User_idUser, Branch_idBranch, Company_idCompany, Reference_ID) 
             VALUES (?, ?, NOW(), 'Stock Correction', 'Corrected double-deduction from invoice edits (variation)', ?, ?, ?, 1, ?, 1, NULL)`,
            [c.itemId, c.id, c.overDeducted, c.currentQty, c.correctedQty, c.branchId],
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      // Commit transaction
      await new Promise((resolve, reject) => {
        conn.commit(err => err ? reject(err) : resolve());
      });
      console.log("\nTransaction successfully committed. All stock levels updated!");

    } catch (err) {
      console.error("\nError in updates, rolling back transaction:", err);
      await new Promise((resolve) => conn.rollback(() => resolve()));
      throw err;
    } finally {
      conn.release();
    }

  } catch (error) {
    console.error("An error occurred during execution:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

run();
