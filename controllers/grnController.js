const dbService = require("../services/grnDBService");
const db = require("../db/db");
const itemDbService = require("../services/productDBService");
const { productHistoryLogHelper } = itemDbService;
const supplierLogDbService = require("../services/supplierCreditLogDBService");
const stockCardDbService = require("../services/stockCardDBService");
const userLogDbService = require("../services/userLogDBService");
const { fetchBranch, getUserDataScope } = require("../services/branchDBService");
const {
  findAccountByNameAndGroup,
  creditDebitLogHelper,
} = require("./accountingController");
const fs = require("fs");
const purchaseReturnDBService = require("../services/purchaseReturnDBService");
const approvalService = require("../services/approvalService");
const bankAccountDBService = require("../services/bankAccountDBService");
const bankAccountLogDBService = require("../services/bankAccountLogDBService");

// convert 0 / "0" / "" / undefined to null for nullable FKs
const opt = (v) =>
  v === 0 || v === "0" || v === "" || v === undefined ? null : v;

// Recalculates the Weighted Average Cost (WAC) based on all processed GRN items
const recalculateItemWAC = async (itemId, connection) => {
  const query = `
    SELECT 
      ghi.Qty, 
      ghi.Cost, 
      ghi.Total, 
      ghi.Bonus_Qty,
      g.Discount_Amount, 
      g.Total_Amount
    FROM grn_has_item ghi
    JOIN grn g ON ghi.GRN_idGRN = g.idGRN
    WHERE ghi.Item_idItem = ? AND g.Status = 1
  `;
  const grnItems = await new Promise((resolve, reject) => {
    connection.query(query, [itemId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  if (grnItems.length === 0) {
    const [itemRow] = await new Promise((resolve, reject) => {
      connection.query("SELECT Cost FROM item WHERE idItem = ?", [itemId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    return parseFloat(itemRow?.Cost || 0);
  }

  let totalInventoryValue = 0;
  let totalQty = 0;

  for (const row of grnItems) {
    const qty = parseFloat(row.Qty || 0);
    const bonusQty = parseFloat(row.Bonus_Qty || 0);
    const itemTotal = parseFloat(row.Total || 0);
    const billTotal = parseFloat(row.Total_Amount || 0);
    const billDiscount = parseFloat(row.Discount_Amount || 0);

    const billDiscountShare = billTotal > 0 ? (itemTotal / billTotal) * billDiscount : 0;
    const netCost = itemTotal - billDiscountShare;

    totalInventoryValue += netCost;
    totalQty += (qty + bonusQty);
  }

  return totalQty > 0 ? parseFloat((totalInventoryValue / totalQty).toFixed(4)) : 0;
};

// Recalculates the Weighted Average Cost (WAC) based on processed GRN items excluding a specific GRN
const recalculateItemWACExcludingGrn = async (itemId, excludingGrnId, connection) => {
  const query = `
    SELECT 
      ghi.Qty, 
      ghi.Cost, 
      ghi.Total, 
      ghi.Bonus_Qty,
      g.Discount_Amount, 
      g.Total_Amount
    FROM grn_has_item ghi
    JOIN grn g ON ghi.GRN_idGRN = g.idGRN
    WHERE ghi.Item_idItem = ? AND g.Status = 1 AND g.idGRN != ?
  `;
  const grnItems = await new Promise((resolve, reject) => {
    connection.query(query, [itemId, excludingGrnId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  if (grnItems.length === 0) {
    const [itemRow] = await new Promise((resolve, reject) => {
      connection.query("SELECT Cost FROM item WHERE idItem = ?", [itemId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    return parseFloat(itemRow?.Cost || 0);
  }

  let totalInventoryValue = 0;
  let totalQty = 0;

  for (const row of grnItems) {
    const qty = parseFloat(row.Qty || 0);
    const bonusQty = parseFloat(row.Bonus_Qty || 0);
    const itemTotal = parseFloat(row.Total || 0);
    const billTotal = parseFloat(row.Total_Amount || 0);
    const billDiscount = parseFloat(row.Discount_Amount || 0);

    const billDiscountShare = billTotal > 0 ? (itemTotal / billTotal) * billDiscount : 0;
    const netCost = itemTotal - billDiscountShare;

    totalInventoryValue += netCost;
    totalQty += (qty + bonusQty);
  }

  return totalQty > 0 ? parseFloat((totalInventoryValue / totalQty).toFixed(4)) : 0;
};

// Recalculates the running supplier credit log balances
const recalculateSupplierCreditLogs = async (supplierId, connection) => {
  const query = "SELECT * FROM supplier_log WHERE Supplier_idSupplier = ? ORDER BY idSupplier_Log ASC";
  const logs = await new Promise((resolve, reject) => {
    (connection || db).query(query, [supplierId], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });

  let runningBalance = 0;
  for (const log of logs) {
    runningBalance += (parseFloat(log.Credit) || 0) - (parseFloat(log.Debit) || 0);
    
    if (parseFloat(log.Total_Credit_Balance) !== runningBalance) {
      const updateQuery = "UPDATE supplier_log SET Total_Credit_Balance = ? WHERE idSupplier_Log = ?";
      await new Promise((resolve, reject) => {
        (connection || db).query(updateQuery, [runningBalance, log.idSupplier_Log], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
};


// ✅ This function creates a new GRN and inserts item/serial/stock data accordingly
const createGrn = async (req, res) => {
  const {
    Date: GrnDate,
    Supplier_idSupplier,
    Bill_no,
    grn_no,
    Total_Amount,
    Bill_Discount,
    Bill_Discount_Type,
    Discount_Amount,
    Net_Total,
    Paid_Amount: Initial_Paid_Amount = 0,
    Credit_Balance_Amount: Initial_Credit_Balance = 0,
    Accounting_Accounts_id,
    Branch_idBranch,
    items = [],
    User_idUser,
    Purchase_Order_id,
    resolvedReturnIds = [],
    Vat_Amount = 0,
    Extra_Charge = 0,
    Extra_Charge_Label = "Delivery Charge",
    update_product_cost = 1,
  } = req.body;

  const filename = req.file ? req.file.filename : null;

  db.getConnection((connErr, connection) => {
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
        console.log("GRN Create Body:", JSON.stringify(req.body, null, 2));

        // ✅ Handle resolved/applied returns value
        let returnTotalValue = 0;
        let returnIds = resolvedReturnIds || appliedReturnIds;
        if (typeof returnIds === "string" && returnIds !== "") {
          try {
            returnIds = JSON.parse(returnIds);
          } catch (e) {
            returnIds = [returnIds];
          }
        } else if (!Array.isArray(returnIds)) {
          returnIds = [];
        }

        if (returnIds.length > 0) {
          const returns = await Promise.all(
            returnIds.map((id) => purchaseReturnDBService.fetchPurchaseReturn(id)),
          );
          returnTotalValue = returns.reduce((sum, ret) => {
            return sum + parseFloat((ret[0] && ret[0].Total_Amount) || 0);
          }, 0);
        }

        // Final Paid and Balance: Net Total minus Applied Return Credits minus Initial Paid Amount
        const finalPaidAmount = parseFloat(Initial_Paid_Amount || 0);
        const finalCreditBalance = Math.max(
          0,
          parseFloat(Net_Total || 0) - returnTotalValue - finalPaidAmount,
        );

        // ✅ Determine and validate GRN Number uniqueness
        let finalGrnNo = grn_no && String(grn_no).trim() !== "" ? String(grn_no).trim() : null;
        if (!finalGrnNo) {
          finalGrnNo = await getNextGrnNo(Branch_idBranch, connection);
        } else {
          const isDuplicate = await dbService.checkDuplicateGrnNo(
            finalGrnNo,
            Branch_idBranch,
            null,
            connection,
          );
          if (isDuplicate) {
            throw new Error(
              `GRN number '${finalGrnNo}' already exists. Each GRN number must be unique.`,
            );
          }
        }

        // ✅ Insert main GRN record
        const grn = await dbService.insertGrn(
          GrnDate,
          Supplier_idSupplier,
          Bill_no,
          items.length,
          Total_Amount,
          Bill_Discount,
          Bill_Discount_Type,
          Discount_Amount,
          Net_Total,
          finalPaidAmount,
          finalCreditBalance,
          filename,
          Branch_idBranch,
          Purchase_Order_id,
          parseFloat(Vat_Amount) || 0,
          parseFloat(Extra_Charge) || 0,
          Extra_Charge_Label || "Delivery Charge",
          update_product_cost,
          connection,
          finalGrnNo,
          returnTotalValue,
        );
        const GRN_idGRN = grn.insertId;

        // APPROVAL ENGINE: Check if approval is required
        let approvalRequired = false;
        try {
          const companyId = req.user?.company_id || req.headers["company_id"] || 1;
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            Branch_idBranch,
            "CREATE_GRN"
          );
          
          if (approvalRequired) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE grn SET approval_status = 'PENDING_APPROVAL' WHERE idGRN = ?",
                [GRN_idGRN],
                (err) => (err ? reject(err) : resolve())
              );
            });
            console.log(`[GRN] GRN ${GRN_idGRN} requires approval (PENDING_APPROVAL)`);
          }
        } catch (err) {
          console.error("Approval check failed for GRN, defaulting to ACTIVE", err);
        }

        // ✅ If converted from Purchase Order, update PO status
        if (Purchase_Order_id) {
          const poDbService = require("../services/purchaseOrderDBService");
          await poDbService.updatePurchaseOrderStatus(Purchase_Order_id, 1, connection);
        }

        // ✅ Generate Batch Codes per Product
        const generatedBatchMap = {};
        const processedItems = new Set();

        // Identify unique items needed
        for (const item of items) {
          if (!item.batch_code || item.batch_code.trim() === "") {
            if (!processedItems.has(item.Item_idItem)) {
              processedItems.add(item.Item_idItem);

              // Get last batch code for THIS item
              // Note: usage of dbService.getLastBatchCode inside transaction might need connection if we want to be strictly safe,
              // but purely reading is often okay outside unless we want to lock.
              // For consistent reads, passing connection is better if the service supports it.
              // Checking grnDBService: getLastBatchCode does NOT accept connection yet in my update.
              // I should probably have updated it, but for now I'll use the default db pool for reading or update it if I can.
              // Actually I didn't update getLastBatchCode to take connection. It's a read operation.
              // It's safer to use the connection for read to see uncommitted data if needed, but here we are checking existing batches.
              // I will proceed without modifying read-only ones for now unless necessary.
              const lastBatchCode = await dbService.getLastBatchCode(
                item.Item_idItem,
              );
              let nextBatchNum = 1;

              if (lastBatchCode) {
                const match = lastBatchCode.match(/^BATCH-(\d+)$/);
                if (match) {
                  nextBatchNum = parseInt(match[1], 10) + 1;
                }
              }

              const paddedNum = String(nextBatchNum).padStart(5, "0");
              generatedBatchMap[item.Item_idItem] = `BATCH-${paddedNum}`;
            }

            // Assign the generated code to this item line
            item.batch_code = generatedBatchMap[item.Item_idItem];
          }
        }

        // ✅ Insert each item + stock update + item_batch
        await Promise.all(
          items.map(async (item) => {
            const Item = await itemDbService.fetchItem(item.Item_idItem);
            if (!Item || !Item[0])
              throw new Error(`Item not found: ${item.Item_idItem}`);

            const safeDesc =
              item.Item_Description && item.Item_Description.trim() !== ""
                ? item.Item_Description
                : item.Item_Long_Description || Item[0].Description;

            // 1) grn_has_item
            await dbService.insertItems(
              GRN_idGRN,
              item.Item_idItem,
              safeDesc,
              item.Cost,
              item.Qty_Type,
              item.Qty,
              item.Total,
              item.Discount,
              item.Discount_Type || "percent",
              item.Sub_Total,
              Branch_idBranch,
              item.Variation_Id,
              item.Bonus_Qty || 0,
              connection,
            );

            // 2) item_batch
            const batchCode = item.batch_code;

            await dbService.insertItemBatch(
              GRN_idGRN,
              item.Item_idItem,
              opt(item.Warehouse_Id),
              opt(item.Zone_IdZone),
              opt(item.Rack_IdRack),
              opt(item.Cell_IdCell),
              parseFloat(item.Qty || 0) + parseFloat(item.Bonus_Qty || 0),
              parseFloat(item.Cost || 0),
              parseFloat(Item[0].Rate || 0),
              parseFloat(item.Sub_Total || 0),
              User_idUser || null,
              batchCode,
              item.Variation_Id,
              item.Expiry_Date,
              connection,
            );

            // 3) Handle Variations
            if (item.Variation_Id) {
              // Flat structure handled via Variation_Id column
            } else if (item.variations && item.variations.length > 0) {
              await dbService.insertGrnItemVariations(
                GRN_idGRN,
                item.Item_idItem,
                item.variations,
                connection,
              );
            }
          }),
        );

        // ✅ Insert serial numbers
        await Promise.all(
          items.map(async (item) => {
            const validSerials = Array.isArray(item.Serial_No)
              ? item.Serial_No.filter(
                  (s) =>
                    (s.Serial_No && String(s.Serial_No).trim() !== "") ||
                    (s.Expiry_Date && String(s.Expiry_Date).trim() !== ""),
                )
              : [];
            if (validSerials.length > 0) {
              await dbService.insertSerialNumbers(
                GRN_idGRN,
                item.Item_idItem,
                item.Qty,
                validSerials,
                Branch_idBranch,
                connection,
                item.Variation_Id || null,
              );
            }
          }),
        );

        // Note: Warehouse stock and audit logs are activated when the GRN is processed (processGrn)

        // ✅ Log to recent activity
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "GRN",
          GRN_idGRN,
          "create",
          Branch_idBranch,
          connection,
        );

        // ✅ If resolved returns are linked, mark them as resolved & record in grn_has_applied_return
        if (returnIds && returnIds.length > 0) {
          await Promise.all(
            returnIds.map(async (returnId) => {
              const ret = await purchaseReturnDBService.fetchPurchaseReturn(returnId);
              const retAmt = parseFloat((ret[0] && ret[0].Total_Amount) || 0);
              await dbService.insertAppliedReturn(
                GRN_idGRN,
                returnId,
                retAmt,
                connection,
              );
              await purchaseReturnDBService.markReturnAsResolved(
                returnId,
                GRN_idGRN,
                "NEW_GRN",
                connection,
              );
            }),
          );
        }

        // ✅ --- Double Entry Accounting (At Creation) ---
        try {
          const branch = await fetchBranch(Branch_idBranch);
          const companyId = branch[0].Company_idCompany;

          const inventoryAccId = await findAccountByNameAndGroup(
            "Inventory",
            "Assets",
            companyId,
            Branch_idBranch,
            connection,
          );
          const accountsPayableAccId = await findAccountByNameAndGroup(
            "Accounts Payable (Creditors)",
            "Liabilities",
            companyId,
            Branch_idBranch,
            connection,
          );

          if (inventoryAccId && accountsPayableAccId) {
            const description = `GRN Created: Bill ${Bill_no} (ID: ${GRN_idGRN})`;

            // Calculate base inventory value (Total - Discount)
            const baseInventoryAmt = parseFloat(Total_Amount || 0) - parseFloat(Discount_Amount || 0);
            let finalInventoryAmt = baseInventoryAmt;

            // VAT Account Lookup (Debited to reduce net payable or track input VAT)
            let vatAccId = null;
            const vatVal = parseFloat(Vat_Amount || 0);
            if (vatVal > 0) {
              vatAccId = await findAccountByNameAndGroup(
                "VAT Payable",
                "Liabilities",
                companyId,
                Branch_idBranch,
                connection,
              );
              if (!vatAccId) {
                // Fallback: capitalize VAT into inventory if no specific VAT account exists
                finalInventoryAmt += vatVal;
              }
            }

            // Extra Charge Account Lookup (Debited to general expenses)
            let expenseAccId = null;
            const extraVal = parseFloat(Extra_Charge || 0);
            if (extraVal > 0) {
              expenseAccId = await findAccountByNameAndGroup(
                "General Expenses",
                "Expenses",
                companyId,
                Branch_idBranch,
                connection,
              );
              if (!expenseAccId) {
                // Fallback: capitalize Extra Charge into inventory if no specific Expense account exists
                finalInventoryAmt += extraVal;
              }
            }

            // Debit Inventory
            if (finalInventoryAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: finalInventoryAmt,
                description,
                type: "GRN Creation",
                accountId: inventoryAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit",
                connection,
              });
            }

            // Debit VAT Payable (decreases net VAT Payable liability, representing input tax)
            if (vatAccId && vatVal > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: vatVal,
                description: `VAT input on ${description}`,
                type: "GRN Creation",
                accountId: vatAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit",
                connection,
              });
            }

            // Debit General Expenses
            if (expenseAccId && extraVal > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Expenses",
                amount: extraVal,
                description: `${Extra_Charge_Label || "Delivery Charge"} on ${description}`,
                type: "GRN Creation",
                accountId: expenseAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit",
                connection,
              });
            }

            // Credit Accounts Payable (Total liability)
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Liabilities",
              amount: Net_Total,
              description,
              type: "GRN Creation",
              accountId: accountsPayableAccId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "credit",
              connection,
            });

            // ✅ --- Accounting for Bonus Quantities ---
            let totalBonusValue = 0;
            items.forEach((item) => {
              const bQty = parseFloat(item.Bonus_Qty || 0);
              const bCost = parseFloat(item.Cost || 0);
              if (bQty > 0 && bCost > 0) {
                totalBonusValue += bQty * bCost;
              }
            });

            if (totalBonusValue > 0) {
              const otherIncomeAccId = await findAccountByNameAndGroup(
                "Other Income (Rental, etc.)",
                "Income",
                companyId,
                Branch_idBranch,
                connection,
              );

              if (otherIncomeAccId) {
                const bonusDescription = `Stock Bonus received on GRN Bill ${Bill_no} (ID: ${GRN_idGRN})`;

                // Debit Inventory (Increase stock value for bonus items)
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: totalBonusValue,
                  description: bonusDescription,
                  type: "GRN Bonus",
                  accountId: inventoryAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "debit",
                  connection,
                });

                // Credit Other Income (Recognize gain from free stock)
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Income",
                  amount: totalBonusValue,
                  description: bonusDescription,
                  type: "GRN Bonus",
                  accountId: otherIncomeAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }

            // ✅ --- Accounting for Upfront Payment ---
            if (parseFloat(Initial_Paid_Amount || 0) > 0) {
              let paymentAccId = Accounting_Accounts_id;

              if (Payment_Method === "bank" && paymentAccId) {
                try {
                  const accountDetails = await bankAccountDBService.getAccountById(
                    paymentAccId,
                    Branch_idBranch,
                  );
                  if (accountDetails && accountDetails.length > 0) {
                    const currentBal = parseFloat(accountDetails[0].account_balance || 0);
                    const paidAmt = parseFloat(Initial_Paid_Amount);
                    const paymentBal = currentBal - paidAmt;
                    await bankAccountDBService.updateCompanyBankAccountBalance(
                      paymentAccId,
                      paymentBal,
                      Branch_idBranch,
                      connection,
                    );

                    const bank_acc_id = paymentAccId;
                    const type = "GRN Payment";
                    const description = `Payment sent for GRN Bill ${Bill_no} (ID: ${GRN_idGRN})`;
                    const note = `Paid Amount: ${paidAmt}`;
                    const debit = "0.00";
                    const credit = paidAmt;
                    const balance = paymentBal;
                    const user = accountDetails[0].user;
                    const updated_status = "paid";
                    const updated_note = `Payment of ${paidAmt} sent for GRN ID: ${GRN_idGRN}`;
                    const updated_date_time = new Date();
                    const updated_user = User_idUser;
                    const payment_id = GRN_idGRN;
                    const contra_account = "-";
                    const reconcilation_status = "0";
                    const branch_id = Branch_idBranch;

                    await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
                      bank_acc_id,
                      type,
                      description,
                      note,
                      debit,
                      credit,
                      balance,
                      user,
                      updated_status,
                      updated_note,
                      updated_date_time,
                      updated_user,
                      payment_id,
                      contra_account,
                      reconcilation_status,
                      branch_id,
                      connection,
                    );
                  }
                } catch (error) {
                  console.error("Error updating bank account balance after GRN creation:", error);
                }
              }

              if (!paymentAccId) {
                const pMethodLower = Payment_Method ? Payment_Method.toLowerCase() : "";
                if (pMethodLower === "bank") {
                  paymentAccId = await findAccountByNameAndGroup("Bank Account", "Assets", companyId, Branch_idBranch, connection);
                } else if (pMethodLower === "cheque") {
                  paymentAccId = await findAccountByNameAndGroup("Cheque Clearing Account", "Assets", companyId, Branch_idBranch, connection);
                } else {
                  paymentAccId = await findAccountByNameAndGroup("Cash in Hand", "Assets", companyId, Branch_idBranch, connection);
                }
              }

              if (paymentAccId) {
                const payDescription = `Upfront Payment for GRN Bill ${Bill_no} (ID: ${GRN_idGRN})`;

                // Debit Accounts Payable (reduce liability)
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Liabilities",
                  amount: Initial_Paid_Amount,
                  description: payDescription,
                  type: "GRN Payment",
                  accountId: accountsPayableAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "debit",
                  connection,
                });

                // Credit Cash/Bank (reduce asset)
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: Initial_Paid_Amount,
                  description: payDescription,
                  type: "GRN Payment",
                  accountId: paymentAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }
          }
        } catch (accError) {
          console.error("Accounting Log Error (Create GRN):", accError);
        }

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit error:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();

          // Automatically award GRN Creation XP upon successful GRN creation
          try {
            const loyaltyService = require("../services/loyaltyService");
            loyaltyService.awardUserXp(User_idUser, "GRN_CREATION")
              .then(() => console.log(`[Loyalty] Successfully awarded GRN creation XP to user ${User_idUser}`))
              .catch((xpErr) => console.error("[Loyalty] Failed to award GRN XP:", xpErr));
          } catch (xpErr) {
            console.error("[Loyalty] Failed to load loyaltyService:", xpErr);
          }

          // Trigger Approval Request if needed
          if (approvalRequired) {
            try {
              const companyId = req.user?.company_id || req.headers["company_id"] || 1;
              const createdBy = req.user?.idUser || User_idUser || 1;
              const approvalService = require("../services/approvalService");

              await approvalService.triggerApprovalRequest(
                "grn",
                GRN_idGRN,
                Branch_idBranch,
                companyId,
                parseFloat(Net_Total) || 0,
                createdBy
              );
            } catch (approvalErr) {
              console.error("[GRN] Error triggering approval webhook:", approvalErr);
            }
          }

          res.json({
            message: approvalRequired
              ? "GRN submitted for approval. It will take effect once approved."
              : "GRN added successfully",
            approval_required: !!approvalRequired,
            approval_status: approvalRequired ? "PENDING_APPROVAL" : "ACTIVE",
            grn_id: GRN_idGRN
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("❌ Error creating GRN:", err);
          res
            .status(500)
            .json({ message: "Error creating GRN", error: err.message });
        });
      }
    });
  });
};

const currentDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

const getGrns = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
    const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];

    let scopedUserId = null;
    if (currentUserId) {
      try {
        const userScope = await getUserDataScope(currentUserId, Branch_idBranch, currentUserRole);
        if (userScope.isRestricted) {
          scopedUserId = currentUserId;
        }
      } catch (scopeErr) {
        console.error("Error checking user scope for GRN:", scopeErr);
      }
    }

    const grns = await dbService.fetchGrns(Branch_idBranch, scopedUserId);

    if (grns?.length === 0) {
      return res.status(404).json({ message: "Grns not found" });
    }

    const grnIds = grns.map((g) => g.idGRN);

    if (grnIds.length > 0) {
      const allItems = await dbService.fetchItemsForGrnList(grnIds);

      // Create a map of GRN ID to items
      const itemsMap = {};
      allItems.forEach((item) => {
        if (!itemsMap[item.GRN_idGRN]) {
          itemsMap[item.GRN_idGRN] = [];
        }
        itemsMap[item.GRN_idGRN].push(item);
      });

      // Assign items to GRNs
      grns.forEach((grn) => {
        grn.items = itemsMap[grn.idGRN] || [];
        if (grn.Grn_File !== null) {
          const baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
            grn.Grn_File
          }`;
          grn.files = baseUrl;
        }
      });
    }

    res.json(grns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const getGrnById = async (req, res) => {
  try {
    const { idGRN } = req.params;
    const grn = await dbService.fetchGrn(idGRN);

    if (!grn || grn.length === 0) {
      return res.status(404).json({ message: "GRN not found" });
    }

    const items = await dbService.fetchItems(grn[0].idGRN);

    // Batch fetch serials and variations for the entire GRN
    const [allSerials, allVariations] = await Promise.all([
      dbService.fetchSerialNoForGrn(idGRN),
      dbService.fetchGrnItemVariationsForGrn(idGRN),
    ]);

    // Map serials and variations to items
    const serialsMap = {};
    allSerials.forEach((s) => {
      if (!serialsMap[s.Item_idItem]) {
        serialsMap[s.Item_idItem] = [];
      }
      serialsMap[s.Item_idItem].push(s);
    });

    const variationsMap = {};
    allVariations.forEach((v) => {
      if (!variationsMap[v.item_id]) {
        variationsMap[v.item_id] = [];
      }
      variationsMap[v.item_id].push(v);
    });

    for (const item of items) {
      item.Serial_No = serialsMap[item.Item_idItem] || [];
      item.variations = variationsMap[item.Item_idItem] || [];
    }

    if (grn[0].Grn_File !== null) {
      const baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
        grn[0].Grn_File
      }`;
      grn[0].files = baseUrl;
    }

    try {
      const appliedReturns = await dbService.fetchAppliedReturnsByGrn(idGRN);
      grn[0].applied_returns = appliedReturns || [];
    } catch (e) {
      grn[0].applied_returns = [];
    }

    grn[0].items = items;

    res.json(grn[0]);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

// ✅ This function updates a GRN, re-inserts items and serials, and adjusts stock + SIH properly
const updateGrn = async (req, res) => {
  const { idGRN } = req.params;
  const {
    Date: GrnDate,
    Bill_no,
    grn_no,
    Total_Amount,
    Bill_Discount,
    Bill_Discount_Type,
    Discount_Amount,
    Net_Total,
    Branch_idBranch,
    items,
    Grn_File,
    User_idUser,
    Vat_Amount = 0,
    Extra_Charge = 0,
    Extra_Charge_Label = "Delivery Charge",
    update_product_cost = 1,
  } = req.body;

  const filename = req.file ? req.file.filename : Grn_File;

  db.getConnection((connErr, connection) => {
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
        // ✅ Generate Batch Codes per Product
        const generatedBatchMap = {};
        const processedItems = new Set();

        for (const item of items) {
          if (!item.batch_code || item.batch_code.trim() === "") {
            if (!processedItems.has(item.Item_idItem)) {
              processedItems.add(item.Item_idItem);
              const lastBatchCode = await dbService.getLastBatchCode(
                item.Item_idItem,
              );
              let nextBatchNum = 1;
              if (lastBatchCode) {
                const match = lastBatchCode.match(/^BATCH-(\d+)$/);
                if (match) {
                  nextBatchNum = parseInt(match[1], 10) + 1;
                }
              }
              const paddedNum = String(nextBatchNum).padStart(5, "0");
              generatedBatchMap[item.Item_idItem] = `BATCH-${paddedNum}`;
            }
            item.batch_code = generatedBatchMap[item.Item_idItem];
          }
        }

        // ✅ Fetch current GRN status
        const grn = await dbService.fetchGrn(idGRN);
        if (!grn || grn.length === 0) {
          throw new Error("GRN not found");
        }
        const isProcessed = String(grn[0].Status) === "1";

        // 🧩 Fetch previous GRN items to calculate delta on SIH (only if GRN is processed)
        // We use the connection for consistent read if possible, or just standard read.
        // Since we are modifying, using connection for reads ensures we see our own changes if we were doing any,
        // but here we are reading existing state.
        const branch = await fetchBranch(Branch_idBranch);
        const companyId = branch[0].Company_idCompany;

        const previousItems = await dbService.fetchItems(idGRN);
        const previousQtyMap = {};
        const previousBonusQtyMap = {};
        previousItems.forEach((item) => {
          previousQtyMap[item.Item_idItem] = parseFloat(item.Qty || 0);
          previousBonusQtyMap[item.Item_idItem] = parseFloat(item.Bonus_Qty || 0);
        });

        // 🧩 Revert previous stock ONLY if GRN was already processed
        if (isProcessed) {
          for (const pItem of previousItems) {
            const Item = await itemDbService.fetchItem(pItem.Item_idItem);
            const existingQty = parseFloat(Item[0].Qty || 0);
            const oldQty = parseFloat(pItem.Qty || 0) + parseFloat(pItem.Bonus_Qty || 0);
            const revertedQty = existingQty - oldQty;

            await itemDbService.itemProcess(
              parseFloat(Item[0].Cost),
              parseFloat(Item[0].Real_Cost),
              revertedQty,
              pItem.Item_idItem,
              connection,
            );

            // Log reversal history
            await productHistoryLogHelper({
              productId: pItem.Item_idItem,
              variationId: pItem.Variation_Id || null,
              quantityChange: -oldQty,
              oldQty: existingQty,
              newQty: revertedQty,
              type: "GRN Update (Reversal)",
              description: `Stock reverted for GRN ID: ${idGRN} (Bill: ${grn[0].Bill_no}) during edit`,
              branchId: Branch_idBranch,
              companyId,
              userId: User_idUser,
              referenceId: idGRN,
              connection,
            });

            // Revert variation stock
            if (pItem.Variation_Id) {
              // Get current variation qty for log
              const [vData] = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT qty FROM item_variations WHERE id = ?",
                  [pItem.Variation_Id],
                  (err, results) => (err ? reject(err) : resolve([results]))
                );
              });
              const vOldQty = parseFloat(vData[0]?.qty || 0);
              const revertVarQty = parseFloat(pItem.Qty || 0) + parseFloat(pItem.Bonus_Qty || 0);

              await itemDbService.updateVariationStock(
                pItem.Variation_Id,
                -revertVarQty,
                parseFloat(pItem.Cost),
                connection,
              );

              // Log variation reversal
              await productHistoryLogHelper({
                productId: pItem.Item_idItem,
                variationId: pItem.Variation_Id,
                quantityChange: -revertVarQty,
                oldQty: vOldQty,
                newQty: vOldQty - revertVarQty,
                type: "GRN Update (Reversal-Variation)",
                description: `Variation stock reverted for GRN ID: ${idGRN} during edit`,
                branchId: Branch_idBranch,
                companyId,
                userId: User_idUser,
                referenceId: idGRN,
                connection,
              });
            } else {
              const pVariations = await dbService.fetchGrnItemVariations(
                idGRN,
                pItem.Item_idItem,
              );
              for (const v of pVariations) {
                // Get current variation qty for log
                const [vData] = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT qty FROM item_variations WHERE id = ?",
                    [v.variation_id],
                    (err, results) => (err ? reject(err) : resolve([results]))
                  );
                });
                const vOldQty = parseFloat(vData[0]?.qty || 0);

                await itemDbService.updateVariationStock(
                  v.variation_id,
                  -parseFloat(v.qty),
                  parseFloat(v.cost),
                  connection,
                );

                // Log variation reversal
                await productHistoryLogHelper({
                  productId: pItem.Item_idItem,
                  variationId: v.variation_id,
                  quantityChange: -parseFloat(v.qty || 0),
                  oldQty: vOldQty,
                  newQty: vOldQty - parseFloat(v.qty || 0),
                  type: "GRN Update (Reversal-Variation)",
                  description: `Variation stock reverted for GRN ID: ${idGRN} during edit`,
                  branchId: Branch_idBranch,
                  companyId,
                  userId: User_idUser,
                  referenceId: idGRN,
                  connection,
                });
              }
            }
          }
        }

        // 🧩 Validate GRN Number uniqueness if provided
        const trimmedGrnNo = grn_no && String(grn_no).trim() !== "" ? String(grn_no).trim() : null;
        if (trimmedGrnNo) {
          const isDuplicate = await dbService.checkDuplicateGrnNo(
            trimmedGrnNo,
            Branch_idBranch,
            idGRN,
            connection,
          );
          if (isDuplicate) {
            throw new Error(
              `GRN number '${trimmedGrnNo}' already exists. Each GRN number must be unique.`,
            );
          }
        }

        // 🧩 Update GRN main table
        await dbService.updateGrn(
          GrnDate,
          Bill_no,
          items?.length,
          Total_Amount,
          Bill_Discount,
          Bill_Discount_Type,
          Discount_Amount,
          Net_Total,
          filename,
          idGRN,
          parseFloat(Vat_Amount) || 0,
          parseFloat(Extra_Charge) || 0,
          Extra_Charge_Label || "Delivery Charge",
          update_product_cost,
          connection,
          trimmedGrnNo,
        );

        // 🧩 Clear old items, serials, and stock card
        await dbService.deleteItems(idGRN, connection);
        await dbService.deleteGrnItemVariations(idGRN, connection);
        await dbService.deleteSerialNumbers(idGRN, connection);
        await dbService.deleteItemBatch(idGRN, connection);
        await stockCardDbService.deleteStockCardByTransactionId(
          "GRN",
          idGRN,
          connection,
        );

        // 🧩 Re-insert updated items, serials, and updated stock card
        for (const item of items) {
          // Fetch Item details first to get Rate and other info
          const Item = await itemDbService.fetchItem(item.Item_idItem);
          if (!Item || !Item[0])
            throw new Error(`Item not found: ${item.Item_idItem}`);

          if (!item.Item_Description || item.Item_Description.trim() === "") {
            item.Item_Description = item.Item_Long_Description;
          }

          await dbService.insertItems(
            idGRN,
            item.Item_idItem,
            item.Item_Description,
            item.Cost,
            item.Qty_Type,
            item.Qty,
            item.Total,
            item.Discount,
            item.Discount_Type || "percent",
            item.Sub_Total,
            Branch_idBranch,
            item.Variation_Id,
            item.Bonus_Qty || 0,
            connection,
          );

          await dbService.insertSerialNumbers(
            idGRN,
            item.Item_idItem,
            item.Qty,
            item.Serial_No,
            Branch_idBranch,
            connection,
            item.Variation_Id || null,
          );

          // 📌 Re-insert Batch
          await dbService.insertItemBatch(
            idGRN,
            item.Item_idItem,
            opt(item.Warehouse_Id),
            opt(item.Zone_IdZone),
            opt(item.Rack_IdRack),
            opt(item.Cell_IdCell),
            parseFloat(item.Qty || 0) + parseFloat(item.Bonus_Qty || 0),
            parseFloat(item.Cost || 0),
            parseFloat(Item[0].Rate || 0),
            parseFloat(item.Sub_Total || 0),
            User_idUser || null,
            item.batch_code,
            item.Variation_Id,
            item.Expiry_Date,
            connection,
          );

          // 📌 Update inventory ONLY if GRN was already processed
          if (isProcessed) {
            const existingQty = parseFloat(Item[0].Qty || 0);
            const newQty = parseFloat(item.Qty || 0) + parseFloat(item.Bonus_Qty || 0);
            const oldQty = (previousQtyMap[item.Item_idItem] || 0) + (previousBonusQtyMap[item.Item_idItem] || 0);
            const newCost = parseFloat(item.Cost || 0);
            const existingRealCost = parseFloat(Item[0].Real_Cost || 0);

            // 📌 Real cost recalculation
            const calculatedRealCost = await recalculateItemWAC(item.Item_idItem, connection);

            // 📌 SIH = existing - oldQty (removed) + newQty (updated)
            const updatedSIH = existingQty - oldQty + newQty;

            const costToUpdate = (update_product_cost === 0 || update_product_cost === "0" || update_product_cost === false)
              ? parseFloat(Item[0].Cost || 0)
              : parseFloat(item.Cost || 0);

            await itemDbService.itemProcess(
              costToUpdate,
              calculatedRealCost,
              updatedSIH,
              item.Item_idItem,
              connection,
            );

            // Log re-apply history
            await productHistoryLogHelper({
              productId: item.Item_idItem,
              variationId: item.Variation_Id || null,
              quantityChange: newQty,
              oldQty: existingQty - oldQty, // oldQty was already reverted
              newQty: updatedSIH,
              type: "GRN Update (Re-apply)",
              description: `Stock re-applied for GRN ID: ${idGRN} (Bill: ${Bill_no}) during edit`,
              branchId: Branch_idBranch,
              companyId,
              userId: User_idUser,
              referenceId: idGRN,
              connection,
            });

            // 📌 Re-insert stock card record
            let stockCardSIH = updatedSIH;
            if (item.Variation_Id) {
              const [vData] = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT qty FROM item_variations WHERE id = ?",
                  [item.Variation_Id],
                  (err, results) => (err ? reject(err) : resolve([results]))
                );
              });
              const vOldQty = parseFloat(vData[0]?.qty || 0);
              stockCardSIH = vOldQty - oldQty + newQty;
            }

            await stockCardDbService.insertStockCard(
              item.Item_idItem,
              Item[0].Description,
              "GRN",
              idGRN,
              item.Cost,
              calculatedRealCost,
              Item[0].Rate,
              newQty,
              0,
              stockCardSIH,
              Branch_idBranch,
              connection,
              item.Variation_Id || null,
            );

            // 📌 Variations Update
            if (item.Variation_Id) {
              // Get current variation qty for log
              const [vData] = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT qty FROM item_variations WHERE id = ?",
                  [item.Variation_Id],
                  (err, results) => (err ? reject(err) : resolve([results]))
                );
              });
              const vOldQty = parseFloat(vData[0]?.qty || 0);

              await itemDbService.updateVariationStock(
                item.Variation_Id,
                newQty,
                parseFloat(item.Cost),
                connection,
              );

              // Log variation re-apply
              await productHistoryLogHelper({
                productId: item.Item_idItem,
                variationId: item.Variation_Id,
                quantityChange: newQty,
                oldQty: vOldQty,
                newQty: vOldQty + newQty,
                type: "GRN Update (Re-apply-Variation)",
                description: `Variation stock re-applied for GRN ID: ${idGRN} during edit`,
                branchId: Branch_idBranch,
                companyId,
                userId: User_idUser,
                referenceId: idGRN,
                connection,
              });
            } else if (item.variations && item.variations.length > 0) {
              await dbService.insertGrnItemVariations(
                idGRN,
                item.Item_idItem,
                item.variations,
                connection,
              );

              for (const v of item.variations) {
                // Get current variation qty for log
                const [vData] = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT qty FROM item_variations WHERE id = ?",
                    [v.id],
                    (err, results) => (err ? reject(err) : resolve([results]))
                  );
                });
                const vOldQty = parseFloat(vData[0]?.qty || 0);

                // Add new Qty
                await itemDbService.updateVariationStock(
                  v.id,
                  parseFloat(v.qty),
                  parseFloat(v.cost),
                  connection,
                );

                // Log variation re-apply
                await productHistoryLogHelper({
                  productId: item.Item_idItem,
                  variationId: v.id,
                  quantityChange: parseFloat(v.qty),
                  oldQty: vOldQty,
                  newQty: vOldQty + parseFloat(v.qty),
                  type: "GRN Update (Re-apply-Variation)",
                  description: `Variation stock re-applied for GRN ID: ${idGRN} during edit`,
                  branchId: Branch_idBranch,
                  companyId,
                  userId: User_idUser,
                  referenceId: idGRN,
                  connection,
                });
              }
            }
          } else {
            // For unprocessed GRNs, just save variation breakdown if provided
            if (item.variations && item.variations.length > 0) {
              await dbService.insertGrnItemVariations(
                idGRN,
                item.Item_idItem,
                item.variations,
                connection,
              );
            }
          }
        }

        // 🧩 Log the update
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "GRN",
          idGRN,
          "edit",
          Branch_idBranch,
          connection,
        );

        // ✅ --- Double Entry Accounting (Update Reversal & Re-post) ---
        try {
          const branch = await fetchBranch(Branch_idBranch);
          const companyId = branch[0].Company_idCompany;

          const inventoryAccId = await findAccountByNameAndGroup(
            "Inventory",
            "Assets",
            companyId,
            Branch_idBranch,
            connection,
          );
          const accountsPayableAccId = await findAccountByNameAndGroup(
            "Accounts Payable (Creditors)",
            "Liabilities",
            companyId,
            Branch_idBranch,
            connection,
          );

          if (inventoryAccId && accountsPayableAccId) {
            const oldNetTotal = parseFloat(grn[0].Net_Total || 0);
            const newNetTotal = parseFloat(Net_Total || 0);
            const oldVat = parseFloat(grn[0].Vat_Amount || 0);
            const newVat = parseFloat(Vat_Amount || 0);
            const oldExtra = parseFloat(grn[0].Extra_Charge || 0);
            const newExtra = parseFloat(Extra_Charge || 0);
            const oldInventoryBase = parseFloat(grn[0].Total_Amount || 0) - parseFloat(grn[0].Discount_Amount || 0);
            const newInventoryBase = parseFloat(Total_Amount || 0) - parseFloat(Discount_Amount || 0);

            // Recheck if we need to update
            if (oldNetTotal !== newNetTotal || oldVat !== newVat || oldExtra !== newExtra || oldInventoryBase !== newInventoryBase) {
              const descriptionRev = `GRN Updated Reversal: Bill ${grn[0].Bill_no} (ID: ${idGRN})`;
              const descriptionNew = `GRN Updated: Bill ${Bill_no} (ID: ${idGRN})`;

              // --- 1. REVERSE OLD ENTRIES ---
              let oldVatAccId = null;
              let oldFinalInventoryAmt = oldInventoryBase;
              if (oldVat > 0) {
                oldVatAccId = await findAccountByNameAndGroup("VAT Payable", "Liabilities", companyId, Branch_idBranch, connection);
                if (!oldVatAccId) oldFinalInventoryAmt += oldVat;
              }

              let oldExpenseAccId = null;
              if (oldExtra > 0) {
                oldExpenseAccId = await findAccountByNameAndGroup("General Expenses", "Expenses", companyId, Branch_idBranch, connection);
                if (!oldExpenseAccId) oldFinalInventoryAmt += oldExtra;
              }

              // Reverse old AP (Debit AP to decrease credit)
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: oldNetTotal,
                description: descriptionRev,
                type: "GRN Update Reversal",
                accountId: accountsPayableAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit",
                connection,
              });

              // Reverse old Inventory (Credit Inventory to decrease debit)
              if (oldFinalInventoryAmt > 0) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: oldFinalInventoryAmt,
                  description: descriptionRev,
                  type: "GRN Update Reversal",
                  accountId: inventoryAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "credit",
                  connection,
                });
              }

              // Reverse old VAT (Credit VAT Payable to decrease debit)
              if (oldVatAccId && oldVat > 0) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Liabilities",
                  amount: oldVat,
                  description: descriptionRev,
                  type: "GRN Update Reversal",
                  accountId: oldVatAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "credit",
                  connection,
                });
              }

              // Reverse old Extra Charge (Credit General Expenses to decrease debit)
              if (oldExpenseAccId && oldExtra > 0) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Expenses",
                  amount: oldExtra,
                  description: descriptionRev,
                  type: "GRN Update Reversal",
                  accountId: oldExpenseAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "credit",
                  connection,
                });
              }

              // --- 2. POST NEW ENTRIES ---
              let newVatAccId = null;
              let newFinalInventoryAmt = newInventoryBase;
              if (newVat > 0) {
                newVatAccId = await findAccountByNameAndGroup("VAT Payable", "Liabilities", companyId, Branch_idBranch, connection);
                if (!newVatAccId) newFinalInventoryAmt += newVat;
              }

              let newExpenseAccId = null;
              if (newExtra > 0) {
                newExpenseAccId = await findAccountByNameAndGroup("General Expenses", "Expenses", companyId, Branch_idBranch, connection);
                if (!newExpenseAccId) newFinalInventoryAmt += newExtra;
              }

              // Debit new Inventory
              if (newFinalInventoryAmt > 0) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: newFinalInventoryAmt,
                  description: descriptionNew,
                  type: "GRN Updated",
                  accountId: inventoryAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "debit",
                  connection,
                });
              }

              // Debit new VAT
              if (newVatAccId && newVat > 0) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Liabilities",
                  amount: newVat,
                  description: `VAT input on ${descriptionNew}`,
                  type: "GRN Updated",
                  accountId: newVatAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "debit",
                  connection,
                });
              }

              // Debit new Extra Charge
              if (newExpenseAccId && newExtra > 0) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Expenses",
                  amount: newExtra,
                  description: `${Extra_Charge_Label || "Delivery Charge"} on ${descriptionNew}`,
                  type: "GRN Updated",
                  accountId: newExpenseAccId,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                  companyId,
                  transactionType: "debit",
                  connection,
                });
              }

              // Credit new Accounts Payable (Creditors)
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: newNetTotal,
                description: descriptionNew,
                type: "GRN Updated",
                accountId: accountsPayableAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "credit",
                connection,
              });
            }
          }
        } catch (accError) {
          console.error("Accounting Log Error (Update GRN):", accError);
        }

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "GRN updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("❌ Error updating GRN:", err);
          res
            .status(500)
            .json({ message: "Error updating grn", error: err.message });
        });
      }
    });
  });
};

const processGrn = async (req, res) => {
  const {
    idGRN,
    Branch_idBranch,
    Credit_Balance_Amount,
    Payment_Method,
    Payment_Type,
    Paid_Amount,
    Cheque_Type,
    Cheque_No,
    Cheque_Name,
    Cheque_Date,
    User_idUser,
    Bank_Account_Id,
  } = req.body;

  db.getConnection((connErr, connection) => {
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
        const grn = await dbService.fetchGrn(idGRN);

        // ✅ Validate GRN exists
        if (!grn || grn.length === 0) {
          throw new Error("Invalid GRN ID provided.");
        }

        const grnItems = await dbService.fetchItems(idGRN);
        const branch = await fetchBranch(Branch_idBranch);
        const companyId = branch[0].Company_idCompany;

        // ✅ Validate GRN items exist
        if (!grnItems || grnItems.length === 0) {
          throw new Error("No items found for this GRN.");
        }

        const appliedReturnAmt = parseFloat(grn[0].Applied_Return_Amount || 0);
        const netPayable = Math.max(0, parseFloat(grn[0].Net_Total || 0) - appliedReturnAmt);
        const paidAmount =
          Payment_Type === "full" ? netPayable : Paid_Amount;

        // ✅ Update GRN payment data
        await dbService.processGrn(
          paidAmount,
          Credit_Balance_Amount,
          idGRN,
          connection,
        );

        // ✅ Fetch last supplier balance
        const lastSupplierLog = await supplierLogDbService.fetchLastLog(
          grn[0].Supplier_idSupplier,
        );

        const Total_Credit_Balance =
          parseFloat(
            lastSupplierLog?.length === 0
              ? 0
              : lastSupplierLog[0].Total_Credit_Balance,
          ) +
          parseFloat(Credit_Balance_Amount === "" ? 0 : Credit_Balance_Amount);

        // ✅ Log supplier credit
        if (
          parseFloat(Credit_Balance_Amount || 0) !== 0 ||
          parseFloat(paidAmount || 0) > 0 ||
          Payment_Method === "cheque"
        ) {
          await supplierLogDbService.insertSupplierCreditLog(
            grn[0].Supplier_idSupplier,
            "GRN",
            idGRN,
            Credit_Balance_Amount || 0,
            0, // Debit (amount paid upfront is already deducted from credit portion)
            Total_Credit_Balance,
            Payment_Type,
            Payment_Method,
            Cheque_Type,
            Cheque_No,
            Cheque_Date,
            Cheque_Name,
            Branch_idBranch,
            connection,
          );
        }

        // ✅ Stock quantity and cost processing
        await Promise.all(
          grnItems.map(async (grnItem) => {
            const Item = await itemDbService.fetchItem(grnItem.Item_idItem);
            if (!Item || !Item[0]) {
              throw new Error(`Item not found: ${grnItem.Item_idItem}`);
            }

            const existingQty = parseFloat(Item[0].Qty || 0);
            const newQty = parseFloat(grnItem.Qty || 0) + parseFloat(grnItem.Bonus_Qty || 0);
            const existingRealCost = parseFloat(Item[0].Real_Cost || 0);
            const newCost = parseFloat(grnItem.Cost || 0);

            // Calculate weighted average cost
            const calcRealCost = await recalculateItemWAC(grnItem.Item_idItem, connection);
            const updatedQty = existingQty + newQty;

            const costToUpdate = (grn[0].update_product_cost === 0 || grn[0].update_product_cost === "0" || grn[0].update_product_cost === false)
              ? parseFloat(Item[0].Cost || 0)
              : newCost;

            // Update item master with new quantity and cost
            await itemDbService.itemProcess(
              costToUpdate,
              calcRealCost,
              updatedQty,
              grnItem.Item_idItem,
              connection,
            );

            // Log history for master item
            await productHistoryLogHelper({
              productId: grnItem.Item_idItem,
              variationId: grnItem.Variation_Id || null,
              quantityChange: newQty,
              oldQty: existingQty,
              newQty: updatedQty,
              type: "GRN Processed",
              description: `Stock added via GRN ID: ${idGRN} (Bill: ${grn[0].Bill_no})`,
              branchId: Branch_idBranch,
              companyId,
              userId: User_idUser,
              referenceId: idGRN,
              connection,
            });

             // Create stock card entry
             let stockCardSIH = updatedQty;
             if (grnItem.Variation_Id) {
               const [vData] = await new Promise((resolve, reject) => {
                 connection.query(
                   "SELECT qty FROM item_variations WHERE id = ?",
                   [grnItem.Variation_Id],
                   (err, results) => (err ? reject(err) : resolve([results]))
                 );
               });
               const vOldQty = parseFloat(vData[0]?.qty || 0);
               stockCardSIH = vOldQty + newQty;
             }

             await stockCardDbService.insertStockCard(
               Item[0].idItem,
               Item[0].Description,
               "GRN",
               idGRN,
               newCost,
               calcRealCost,
               Item[0].Rate,
               newQty,
               0,
               stockCardSIH,
               Branch_idBranch,
               connection,
               grnItem.Variation_Id || null,
             );

            // Handle Variations - update variation stock
            if (grnItem.Variation_Id) {
              // Flat structure: Update single variation
              // We need current variation qty for the log
              const [vData] = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT qty FROM item_variations WHERE id = ?",
                  [grnItem.Variation_Id],
                  (err, results) => (err ? reject(err) : resolve([results]))
                );
              });
              const vOldQty = parseFloat(vData[0]?.qty || 0);

              await itemDbService.updateVariationStock(
                grnItem.Variation_Id,
                newQty,
                newCost,
                connection,
              );

              // Log variation history
              await productHistoryLogHelper({
                productId: grnItem.Item_idItem,
                variationId: grnItem.Variation_Id,
                quantityChange: newQty,
                oldQty: vOldQty,
                newQty: vOldQty + newQty,
                type: "GRN Processed (Variation)",
                description: `Variation stock added via GRN ID: ${idGRN}`,
                branchId: Branch_idBranch,
                companyId,
                userId: User_idUser,
                referenceId: idGRN,
                connection,
              });
            } else {
              // Legacy nested structure: fetch and update variations
              const variations = await dbService.fetchGrnItemVariations(
                idGRN,
                grnItem.Item_idItem,
              );
              if (variations && variations.length > 0) {
                await Promise.all(
                  variations.map(async (v) => {
                    // We need current variation qty for the log
                    const [vData] = await new Promise((resolve, reject) => {
                      connection.query(
                        "SELECT qty FROM item_variations WHERE id = ?",
                        [v.variation_id],
                        (err, results) => (err ? reject(err) : resolve([results]))
                      );
                    });
                    const vOldQty = parseFloat(vData[0]?.qty || 0);

                    await itemDbService.updateVariationStock(
                      v.variation_id,
                      parseFloat(v.qty),
                      parseFloat(v.cost),
                      connection,
                    );

                    // Log variation history
                    await productHistoryLogHelper({
                      productId: grnItem.Item_idItem,
                      variationId: v.variation_id,
                      quantityChange: parseFloat(v.qty),
                      oldQty: vOldQty,
                      newQty: vOldQty + parseFloat(v.qty),
                      type: "GRN Processed (Variation)",
                      description: `Variation stock added via GRN ID: ${idGRN}`,
                      branchId: Branch_idBranch,
                      companyId,
                      userId: User_idUser,
                      referenceId: idGRN,
                      connection,
                    });
                  }),
                );
              }
            }
          }),
        );

        // ✅ Log to Warehouse Audit (STOCK_ADD) and synchronize counters upon processing
        const warehouseBatches = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT ib.item_id, ib.qty, ib.warehouse_id, i.Description AS item_name
             FROM item_batch ib
             INNER JOIN item i ON ib.item_id = i.idItem
             WHERE ib.grn_id = ? AND ib.warehouse_id IS NOT NULL AND ib.warehouse_id > 0 AND ib.qty > 0`,
            [idGRN],
            (err, results) => (err ? reject(err) : resolve(results || []))
          );
        });

        const warehouseLogsMap = {};
        warehouseBatches.forEach((b) => {
          if (!warehouseLogsMap[b.warehouse_id]) {
            warehouseLogsMap[b.warehouse_id] = { items: [], branchId: Branch_idBranch };
          }
          warehouseLogsMap[b.warehouse_id].items.push({
            id: b.item_id,
            name: b.item_name || "Product",
            qty: parseFloat(b.qty || 0),
          });
        });

        for (const [whId, data] of Object.entries(warehouseLogsMap)) {
          const details = {
            type: "STOCK_ADD",
            reference: `GRN PROCESSED (ID: ${idGRN})`,
            billNo: grn[0].Bill_no,
            items: data.items,
          };
          const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
          const ua = req.headers["user-agent"] || "unknown";

          const sqlLog = `
            INSERT INTO warehouse_audit_logs 
              (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
            VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
          `;
          await new Promise((resolve, reject) => {
            connection.query(sqlLog, [whId, data.branchId, User_idUser, JSON.stringify(details), ip, ua], (err) => {
              if (err) console.error("Warehouse audit log failed during processGrn:", err);
              resolve();
            });
          });
        }

        if (Object.keys(warehouseLogsMap).length > 0) {
          const whIds = Object.keys(warehouseLogsMap).map(Number);
          const sqlSyncCounters = `
            UPDATE warehouses w
            SET 
              stock_count = COALESCE((SELECT SUM(ib.qty) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0),
              item_count = COALESCE((SELECT COUNT(DISTINCT ib.item_id) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0)
            WHERE w.id IN (?)
          `;
          await new Promise((resolve) => {
            connection.query(sqlSyncCounters, [whIds], (err) => {
              if (err) console.error("Failed to sync warehouse counters in processGrn:", err);
              resolve();
            });
          });
        }

        // ✅ Log user activity
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "GRN",
          idGRN,
          "process",
          Branch_idBranch,
          connection,
        );

        // ✅ --- Company Bank Account Update & Log (Process GRN) ---
        const processPMethod = Payment_Method ? Payment_Method.toLowerCase() : "";
        if (processPMethod === "bank" && parseFloat(paidAmount || 0) > 0 && Bank_Account_Id) {
          try {
            const accountDetails = await bankAccountDBService.getAccountById(
              Bank_Account_Id,
              Branch_idBranch,
            );
            if (accountDetails && accountDetails.length > 0) {
              const currentBal = parseFloat(accountDetails[0].account_balance || 0);
              const newBal = currentBal - parseFloat(paidAmount);
              await bankAccountDBService.updateCompanyBankAccountBalance(
                Bank_Account_Id,
                newBal,
                Branch_idBranch,
              );

              await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
                Bank_Account_Id,
                "GRN Payment",
                `Payment sent for GRN ID: ${idGRN} (Bill: ${grn[0]?.Bill_no || idGRN})`,
                `Paid Amount: ${paidAmount}`,
                "0.00",
                paidAmount,
                newBal,
                accountDetails[0].user,
                "paid",
                `Payment of ${paidAmount} for GRN ID: ${idGRN}`,
                new Date(),
                User_idUser || 1,
                idGRN,
                "-",
                "0",
                Branch_idBranch,
              );
            }
          } catch (bankError) {
            console.error("Bank account update error (Process GRN):", bankError);
          }
        }

        // ✅ --- Double Entry Accounting (Payment) ---
        if (parseFloat(paidAmount || 0) > 0) {
          try {
            const branch = await fetchBranch(Branch_idBranch);
            const companyId = branch[0].Company_idCompany;

            const accountsPayableAccId = await findAccountByNameAndGroup(
              "Accounts Payable (Creditors)",
              "Liabilities",
              companyId,
              Branch_idBranch,
              connection,
            );

            // For accounting double-entry, always look up by account name — never use bank module IDs
            const pMethodLower = Payment_Method ? Payment_Method.toLowerCase() : "";
            let paymentAccId = null;
            if (pMethodLower === "cash") {
              paymentAccId = await findAccountByNameAndGroup(
                "Cash in Hand",
                "Assets",
                companyId,
                Branch_idBranch,
                connection,
              );
            } else if (pMethodLower === "bank") {
              paymentAccId = await findAccountByNameAndGroup(
                "Bank Account",
                "Assets",
                companyId,
                Branch_idBranch,
                connection,
              );
            } else if (pMethodLower === "cheque") {
              paymentAccId = await findAccountByNameAndGroup(
                "Cheque Clearing Account",
                "Assets",
                companyId,
                Branch_idBranch,
                connection,
              );
            }

            if (accountsPayableAccId && paymentAccId) {
              const description = `GRN Payment: Bill ${grn[0].Bill_no} (ID: ${idGRN})`;

              // Debit Accounts Payable
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: paidAmount,
                description,
                type: "GRN Payment",
                accountId: accountsPayableAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit",
                connection,
              });

              // Credit Cash/Bank
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: paidAmount,
                description,
                type: "GRN Payment",
                accountId: paymentAccId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "credit",
                connection,
              });
            }
          } catch (accError) {
            console.error("Accounting Log Error (Process GRN):", accError);
          }
        }

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(200).json({
            success: true,
            message: "GRN Processed successfully",
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("❌ Error occurred while processing GRN:", err);
          res.status(500).json({
            success: false,
            message: "Error processing GRN",
            error: err.message,
          });
        });
      }
    });
  });
};

const checkSerial = async (req, res) => {
  try {
    const { serial_numbers } = req.body;

    const checkSerials = await dbService.checkSerial(serial_numbers);

    if (checkSerials?.length === 0) {
      res.status(200).json({ message: "All serial numbers are unique" });
    } else {
      // If matching serial numbers found, send the list of existing serial numbers
      res.status(200).json({ existing_serial_numbers: checkSerials });
    }
  } catch (err) {
    res.status(500).json({
      message: "Error checking serials",
      error: err.message,
    });
  }
};

// Add deleteGrn controller
const deleteGrn = async (req, res) => {
  const { idGRN } = req.params;

  db.getConnection((connErr, connection) => {
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
        // fetch grn to validate & get filename
        // validate first
        const grn = await dbService.fetchGrn(idGRN);
        if (!grn || grn.length === 0) {
          throw new Error("GRN not found");
        }

        // log user activity if provided in body
        const { User_idUser, Branch_idBranch } = req.body || {};
        const targetBranchId =
          Branch_idBranch || (grn[0].Branch_idBranch ?? null);

        // If the GRN is processed, reverse stock, product history, warehouse, and payments first
        if (String(grn[0].Status) === "1") {
          const branch = await fetchBranch(targetBranchId);
          const companyId = branch ? branch[0]?.Company_idCompany : null;

          const grnItems = await dbService.fetchItems(idGRN, connection);
          if (grnItems && grnItems.length > 0) {
            await Promise.all(
              grnItems.map(async (grnItem) => {
                const Item = await itemDbService.fetchItem(grnItem.Item_idItem, connection);
                if (!Item || !Item[0]) return;

                const currentMasterQty = parseFloat(Item[0].Qty || 0);
                const addedQty = parseFloat(grnItem.Qty || 0) + parseFloat(grnItem.Bonus_Qty || 0);
                const revertedMasterQty = currentMasterQty - addedQty;

                // Recalculate WAC excluding the current GRN
                const newWAC = await recalculateItemWACExcludingGrn(grnItem.Item_idItem, idGRN, connection);

                // Get the latest remaining cost
                const [latestGrnItem] = await new Promise((resolve, reject) => {
                  connection.query(
                    `SELECT ghi.Cost FROM grn_has_item ghi 
                     JOIN grn g ON ghi.GRN_idGRN = g.idGRN 
                     WHERE ghi.Item_idItem = ? AND g.Status = 1 AND g.idGRN != ?
                     ORDER BY g.Date DESC, g.idGRN DESC LIMIT 1`,
                    [grnItem.Item_idItem, idGRN],
                    (err, rows) => (err ? reject(err) : resolve(rows))
                  );
                });
                const revertedCost = latestGrnItem ? parseFloat(latestGrnItem.Cost) : parseFloat(Item[0].Cost || 0);

                // Update item master
                await itemDbService.itemProcess(
                  revertedCost,
                  newWAC,
                  revertedMasterQty,
                  grnItem.Item_idItem,
                  connection
                );

                // Product History Log for Master Item
                await productHistoryLogHelper({
                  productId: grnItem.Item_idItem,
                  variationId: grnItem.Variation_Id || null,
                  quantityChange: -addedQty,
                  oldQty: currentMasterQty,
                  newQty: revertedMasterQty,
                  type: "GRN Deleted Reversal",
                  description: `Stock deleted due to deletion of processed GRN ID: ${idGRN} (Bill: ${grn[0].Bill_no})`,
                  branchId: targetBranchId,
                  companyId,
                  userId: User_idUser || null,
                  referenceId: idGRN,
                  connection,
                });

                // Revert Variation Stock
                if (grnItem.Variation_Id) {
                  const [vData] = await new Promise((resolve, reject) => {
                    connection.query(
                      "SELECT qty FROM item_variations WHERE id = ?",
                      [grnItem.Variation_Id],
                      (err, results) => (err ? reject(err) : resolve([results]))
                    );
                  });
                  const vCurrentQty = parseFloat(vData[0]?.qty || 0);
                  const revertedVQty = vCurrentQty - addedQty;

                  const [latestVGrnItem] = await new Promise((resolve, reject) => {
                    connection.query(
                      `SELECT ghi.Cost FROM grn_has_item ghi 
                       JOIN grn g ON ghi.GRN_idGRN = g.idGRN 
                       WHERE ghi.Item_idItem = ? AND ghi.Variation_Id = ? AND g.Status = 1 AND g.idGRN != ?
                       ORDER BY g.Date DESC, g.idGRN DESC LIMIT 1`,
                      [grnItem.Item_idItem, grnItem.Variation_Id, idGRN],
                      (err, rows) => (err ? reject(err) : resolve(rows))
                    );
                  });
                  const revertedVCost = latestVGrnItem ? parseFloat(latestVGrnItem.Cost) : revertedCost;

                  await itemDbService.updateVariationStock(
                    grnItem.Variation_Id,
                    -addedQty,
                    revertedVCost,
                    connection
                  );

                  await productHistoryLogHelper({
                    productId: grnItem.Item_idItem,
                    variationId: grnItem.Variation_Id,
                    quantityChange: -addedQty,
                    oldQty: vCurrentQty,
                    newQty: revertedVQty,
                    type: "GRN Deleted Reversal (Variation)",
                    description: `Variation stock deleted due to deletion of processed GRN ID: ${idGRN}`,
                    branchId: targetBranchId,
                    companyId,
                    userId: User_idUser || null,
                    referenceId: idGRN,
                    connection,
                  });
                } else {
                  // Legacy nested variations
                  const variations = await dbService.fetchGrnItemVariations(idGRN, grnItem.Item_idItem);
                  if (variations && variations.length > 0) {
                    await Promise.all(
                      variations.map(async (v) => {
                        const [vData] = await new Promise((resolve, reject) => {
                          connection.query(
                            "SELECT qty FROM item_variations WHERE id = ?",
                            [v.variation_id],
                            (err, results) => (err ? reject(err) : resolve([results]))
                          );
                        });
                        const vCurrentQty = parseFloat(vData[0]?.qty || 0);
                        const vAddedQty = parseFloat(v.qty);
                        const revertedVQty = vCurrentQty - vAddedQty;

                        const [latestVGrnItem] = await new Promise((resolve, reject) => {
                          connection.query(
                            `SELECT ghi.Cost FROM grn_has_item ghi 
                             JOIN grn g ON ghi.GRN_idGRN = g.idGRN 
                             WHERE ghi.Item_idItem = ? AND ghi.Variation_Id = ? AND g.Status = 1 AND g.idGRN != ?
                             ORDER BY g.Date DESC, g.idGRN DESC LIMIT 1`,
                            [grnItem.Item_idItem, v.variation_id, idGRN],
                            (err, rows) => (err ? reject(err) : resolve(rows))
                          );
                        });
                        const revertedVCost = latestVGrnItem ? parseFloat(latestVGrnItem.Cost) : parseFloat(v.cost);

                        await itemDbService.updateVariationStock(
                          v.variation_id,
                          -vAddedQty,
                          revertedVCost,
                          connection
                        );

                        await productHistoryLogHelper({
                          productId: grnItem.Item_idItem,
                          variationId: v.variation_id,
                          quantityChange: -vAddedQty,
                          oldQty: vCurrentQty,
                          newQty: revertedVQty,
                          type: "GRN Deleted Reversal (Variation)",
                          description: `Variation stock deleted due to deletion of processed GRN ID: ${idGRN}`,
                          branchId: targetBranchId,
                          companyId,
                          userId: User_idUser || null,
                          referenceId: idGRN,
                          connection,
                        });
                      })
                    );
                  }
                }
              })
            );

            // Log to Warehouse Audit (STOCK_DELETE)
            const warehouseLogsMap = {};
            grnItems.forEach((item) => {
              if (item.Warehouse_Id) {
                if (!warehouseLogsMap[item.Warehouse_Id]) {
                  warehouseLogsMap[item.Warehouse_Id] = { items: [], branchId: targetBranchId };
                }
                warehouseLogsMap[item.Warehouse_Id].items.push({
                  id: item.Item_idItem,
                  name: item.Item_Description || "Product",
                  qty: parseFloat(item.Qty || 0) + parseFloat(item.Bonus_Qty || 0),
                });
              }
            });

            for (const [whId, data] of Object.entries(warehouseLogsMap)) {
              const details = {
                type: "STOCK_DELETE",
                reference: `GRN DELETED (ID: ${idGRN})`,
                billNo: grn[0].Bill_no,
                items: data.items,
              };
              const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "0.0.0.0";
              const ua = req.headers["user-agent"] || "unknown";

              const sqlLog = `
                INSERT INTO warehouse_audit_logs 
                  (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
                VALUES (?, ?, ?, 'DELETE', ?, ?, ?)
              `;
              await new Promise((resolve, reject) => {
                connection.query(sqlLog, [whId, data.branchId, User_idUser || null, JSON.stringify(details), ip, ua], (err) => {
                  if (err) console.error("Warehouse delete audit log failed:", err);
                  resolve();
                });
              });
            }
          }

          // Reverse Payments, Bank Logs, Accounting Logs & Supplier Logs
          // Fetch associated supplier logs first to get their IDs
          const supplierLogs = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT idSupplier_Log FROM supplier_log WHERE Type_Id = ? AND Type IN ('GRN', 'PAYMENT')",
              [idGRN],
              (err, results) => err ? reject(err) : resolve(results)
            );
          });
          const supplierLogIds = supplierLogs.map(l => l.idSupplier_Log);

          // Revert bank logs for both GRN itself (payment_id = idGRN) and subsequent supplier payments (payment_id IN supplierLogIds)
          const bankLogs = await new Promise((resolve, reject) => {
            const query = supplierLogIds.length > 0
              ? "SELECT * FROM company_bank_has_log WHERE (payment_id = ? OR payment_id IN (?)) AND branch_id = ?"
              : "SELECT * FROM company_bank_has_log WHERE payment_id = ? AND branch_id = ?";
            const params = supplierLogIds.length > 0
              ? [idGRN, supplierLogIds, targetBranchId]
              : [idGRN, targetBranchId];
            connection.query(query, params, (err, results) => err ? reject(err) : resolve(results));
          });

          for (const blog of bankLogs) {
            const debitAmt = parseFloat(blog.debit) || 0;
            const creditAmt = parseFloat(blog.credit) || 0;
            const netChange = debitAmt - creditAmt;

            if (netChange !== 0) {
              console.log(`[deleteGrn] Reverting Bank Account ID ${blog.bank_acc_id} balance by -${netChange}`);
              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE company_bank_accounts SET account_balance = account_balance - ? WHERE idbank = ? AND branch_id = ?",
                  [netChange, blog.bank_acc_id, targetBranchId],
                  (err) => err ? reject(err) : resolve()
                );
              });

              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE company_bank_has_log SET balance = balance - ? WHERE bank_acc_id = ? AND branch_id = ? AND idbank_log > ?",
                  [netChange, blog.bank_acc_id, targetBranchId, blog.idbank_log],
                  (err) => err ? reject(err) : resolve()
                );
              });
            }
          }

          if (bankLogs.length > 0) {
            const logIds = bankLogs.map(l => l.idbank_log);
            await new Promise((resolve, reject) => {
              connection.query(
                "DELETE FROM company_bank_has_log WHERE idbank_log IN (?)",
                [logIds],
                (err) => err ? reject(err) : resolve()
              );
            });
          }

          // Revert Accounting log entries and balances for the GRN and all associated payments
          const accountingLogs = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT * FROM accounting_accounts_log WHERE (Description LIKE ? OR Description LIKE ? OR Description LIKE ? OR Description LIKE ?) AND branchId = ?",
              [`%ID: ${idGRN}%`, `%GRN: ${idGRN}%`, `%GRN Deleted: ${idGRN}%`, `%Bill ${grn[0].Bill_no}%`, targetBranchId],
              (err, results) => err ? reject(err) : resolve(JSON.parse(JSON.stringify(results)))
            );
          });

          for (const alog of accountingLogs) {
            const debitAmt = parseFloat(alog.Debit) || 0;
            const creditAmt = parseFloat(alog.Credit) || 0;

            const accounts = await new Promise((resolve, reject) => {
              connection.query(
                "SELECT Group_Of_Type, Account_Balance FROM accounting_accounts WHERE idAccounting_Accounts = ?",
                [alog.Accounting_Accounts_idAccounting_Accounts],
                (err, results) => err ? reject(err) : resolve(results)
              );
            });

            if (accounts && accounts.length > 0) {
              const account = accounts[0];
              const isAssetOrExpense = ["Assets", "Expenses"].includes(account.Group_Of_Type);

              const revertAmount = isAssetOrExpense
                ? creditAmt - debitAmt
                : debitAmt - creditAmt;

              console.log(`[deleteGrn] Reverting account ID ${alog.Accounting_Accounts_idAccounting_Accounts} (${account.Group_Of_Type}) balance by ${revertAmount}`);

              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE accounting_accounts SET Account_Balance = Account_Balance + ? WHERE idAccounting_Accounts = ?",
                  [revertAmount, alog.Accounting_Accounts_idAccounting_Accounts],
                  (err) => err ? reject(err) : resolve()
                );
              });

              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE accounting_accounts_log SET Balance = Balance + ? WHERE Accounting_Accounts_idAccounting_Accounts = ? AND idAccounting_Accounts_Log > ?",
                  [revertAmount, alog.Accounting_Accounts_idAccounting_Accounts, alog.idAccounting_Accounts_Log],
                  (err) => err ? reject(err) : resolve()
                );
              });
            }
          }

          if (accountingLogs.length > 0) {
            const logIds = accountingLogs.map(l => l.idAccounting_Accounts_Log);
            await new Promise((resolve, reject) => {
              connection.query(
                "DELETE FROM accounting_accounts_log WHERE idAccounting_Accounts_Log IN (?)",
                [logIds],
                (err) => err ? reject(err) : resolve()
              );
            });
          }

          // Delete Supplier Logs related to this GRN
          await new Promise((resolve, reject) => {
            connection.query(
              "DELETE FROM supplier_log WHERE Type_Id = ? AND Type IN ('GRN', 'PAYMENT')",
              [idGRN],
              (err) => (err ? reject(err) : resolve())
            );
          });

          // Recalculate Supplier Log
          await recalculateSupplierCreditLogs(grn[0].Supplier_idSupplier, connection);
        }

        // remove related serials, items, batches, stockcards and grn
        await dbService.deleteSerialNumbers(idGRN, connection);
        await dbService.deleteItems(idGRN, connection);
        await dbService.deleteGrnItemVariations(idGRN, connection); // delete variations
        if (typeof dbService.deleteItemBatch === "function") {
          await dbService.deleteItemBatch(idGRN, connection);
        }
        await stockCardDbService.deleteStockCardByTransactionId(
          "GRN",
          idGRN,
          connection,
        );

        // Revert applied purchase returns linked to this GRN
        const linkedReturns = await new Promise((resolve, reject) => {
          connection.query(
            `SELECT DISTINCT Purchase_Return_idPurchase_Return AS returnId 
             FROM grn_has_applied_return 
             WHERE GRN_idGRN = ? 
             UNION 
             SELECT idPurchase_Return AS returnId 
             FROM purchase_return 
             WHERE Resolved_GRN_Id = ?`,
            [idGRN, idGRN],
            (err, rows) => (err ? reject(err) : resolve(rows || []))
          );
        });

        if (linkedReturns && linkedReturns.length > 0) {
          const returnIdsToRevert = linkedReturns.map((r) => r.returnId);

          // 1. Delete junction rows
          await new Promise((resolve, reject) => {
            connection.query(
              "DELETE FROM grn_has_applied_return WHERE GRN_idGRN = ?",
              [idGRN],
              (err) => (err ? reject(err) : resolve())
            );
          });

          // 2. Revert purchase returns back to unresolved open credit
          await new Promise((resolve, reject) => {
            connection.query(
              `UPDATE purchase_return 
               SET Is_Resolved = 0, Resolved_GRN_Id = NULL, Settlement_Type = 'ACCOUNT_CREDIT' 
               WHERE idPurchase_Return IN (?)`,
              [returnIdsToRevert],
              (err) => (err ? reject(err) : resolve())
            );
          });
        }

        await dbService.deleteGrn(idGRN, connection);

        await userLogDbService.insertLog(
          User_idUser || null,
          currentDate(),
          "GRN",
          idGRN,
          "delete",
          targetBranchId,
          connection,
        );

        // Accounting logs and balance reversion are handled directly above when Status === 1

        // delete uploaded file if present
        if (grn[0].Grn_File) {
          const filePath = path.join(
            __dirname,
            "..",
            "uploads",
            grn[0].Grn_File,
          );
          fs.unlink(filePath, (err) => {
            // swallow errors but log
            if (err) console.error("Failed to remove GRN file:", err);
          });
        }

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "GRN deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("❌ Error deleting GRN:", err);
          res.status(500).json({
            message: "Error deleting GRN",
            error: err.message,
          });
        });
      }
    });
  });
};

const getBatches = async (req, res) => {
  try {
    const { userId, branchId } = req.params;
    const batches = await dbService.fetchBatches(userId, branchId);
    res.json(batches);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching batches", error: err.message });
  }
};

const getBatchDetails = async (req, res) => {
  try {
    const { userId, branchId } = req.params;
    const details = await dbService.fetchBatchDetails(userId, branchId);

    // Grouping Logic: Batch Code -> GRNs -> Items
    const batchMap = new Map();

    details.forEach((row) => {
      // 1. Group by Batch Code
      if (!batchMap.has(row.batch_code)) {
        batchMap.set(row.batch_code, {
          batch_code: row.batch_code,
          grns: [],
          grnMap: new Map(), // Temporary map to track GRNs within this batch
        });
      }
      const batchEntry = batchMap.get(row.batch_code);

      // 2. Group by GRN ID within the Batch
      if (!batchEntry.grnMap.has(row.grn_id)) {
        batchEntry.grnMap.set(row.grn_id, {
          grn_id: row.grn_id,
          grn_bill_no: row.GRN_Bill_No,
          grn_date: row.GRN_Date,
          supplier_name: row.Supplier_Name,
          items: [],
        });
        batchEntry.grns.push(batchEntry.grnMap.get(row.grn_id));
      }
      const grnEntry = batchEntry.grnMap.get(row.grn_id);

      // 3. Add Item Details
      grnEntry.items.push({
        item_id: row.item_id,
        item_code: row.Item_Code,
        name: row.Item_Name,
        item_description: row.Item_Description, // added
        item_name: row.Variation_Name || row.Item_Name, // Show Variation Name if available
        variation_name: row.Variation_Name,
        variation_id: row.Variation_Id,
        // Batch-Item specific details
        batch_id: row.batch_id,
        qty: row.qty,
        cost: row.cost,
        rate: row.rate,
        total_cost: row.total_cost,
        expiry_date: row.expiry_date,
        warehouse_id: row.warehouse_id,
        warehouse_zone: row.warehouse_zone,
        warehouse_rack_id: row.warehouse_rack_id,
        warehouse_rack_cell: row.warehouse_rack_cell,
      });
    });

    // Convert Map to Array and clean up temporary properties
    const groupedData = Array.from(batchMap.values()).map((batch) => {
      delete batch.grnMap; // Remove the temporary helper map
      return batch;
    });

    res.json(groupedData);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching batch details",
      error: err.message,
    });
  }
};

const returnBatchItem = async (req, res) => {
  const {
    userId,
    branchId,
    grn_id,
    batch_id, // This is the ID of the item_batch row
    item_id,
    variation_id, // 🆕 specific variation to return
    return_qty,
    reason,
    return_date,
  } = req.body;

  db.getConnection((connErr, connection) => {
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
        // 1. Validate Batch & Quantity
        const batchRows = await dbService.getBatchById(batch_id);
        if (!batchRows || batchRows.length === 0) {
          throw new Error(
            `Batch record not found. Received batch_id: ${batch_id}`,
          );
        }
        const batch = batchRows[0];

        if (parseFloat(batch.qty) < parseFloat(return_qty)) {
          throw new Error(
            `Return quantity (${return_qty}) exceeds available batch quantity (${batch.qty}).`,
          );
        }

        // 2. Fetch Reference Data (Item, GRN)
        const [itemRows, grnRows] = await Promise.all([
          itemDbService.fetchItem(item_id),
          dbService.fetchGrn(grn_id),
        ]);

        if (!itemRows || itemRows.length === 0)
          throw new Error("Item not found");
        if (!grnRows || grnRows.length === 0)
          throw new Error("GRN ID not found");

        const Item = itemRows[0];
        const Grn = grnRows[0];

        // 3. Update Batch Stock
        const newBatchQty = parseFloat(batch.qty) - parseFloat(return_qty);
        await dbService.updateBatchQty(batch_id, newBatchQty, connection);

        // 4. Update Variation Stock (if applicable)
        if (variation_id) {
          await dbService.updateVariationQty(
            variation_id,
            return_qty,
            connection,
          );
        }

        // 5. Update Master Stock (Item Table)
        const masterQty = parseFloat(Item.Qty) - parseFloat(return_qty);
        await itemDbService.itemProcess(
          Item.Cost,
          Item.Real_Cost,
          masterQty,
          item_id,
          connection,
        );

        // Fetch companyId
        const branch = await fetchBranch(branchId);
        const companyId = branch[0].Company_idCompany;

        // Log Master Stock History
        await productHistoryLogHelper({
          productId: item_id,
          variationId: variation_id || null,
          quantityChange: -parseFloat(return_qty),
          oldQty: parseFloat(Item.Qty),
          newQty: masterQty,
          type: "Batch Return",
          description: `Stock returned from Batch ID: ${batch_id} (GRN Bill: ${Grn.Bill_no})`,
          branchId,
          companyId,
          userId,
          referenceId: grn_id,
          connection,
        });

        // Log Variation Stock History if applicable
        if (variation_id) {
          // Get current variation qty for log
          const [vData] = await new Promise((resolve, reject) => {
            connection.query(
              "SELECT qty FROM item_variations WHERE id = ?",
              [variation_id],
              (err, results) => (err ? reject(err) : resolve([results]))
            );
          });
          const vOldQty = parseFloat(vData[0]?.qty || 0);

          await productHistoryLogHelper({
            productId: item_id,
            variationId: variation_id,
            quantityChange: -parseFloat(return_qty),
            oldQty: vOldQty,
            newQty: vOldQty - parseFloat(return_qty),
            type: "Batch Return (Variation)",
            description: `Variation stock returned from Batch ID: ${batch_id}`,
            branchId,
            companyId,
            userId,
            referenceId: grn_id,
            connection,
          });
        }

        // 5. Create Purchase Return Record (Audit)
        const totalReturnAmount =
          parseFloat(batch.cost) * parseFloat(return_qty);

        const returnResult = await dbService.createBatchReturnRecord(
          return_date || new Date(),
          Grn.Supplier_idSupplier,
          totalReturnAmount,
          1,
          branchId,
          reason || "Batch Return",
          batch_id,
          connection,
        );
        const returnId = returnResult.insertId;

        await dbService.insertBatchReturnItem(
          returnId,
          item_id,
          Item.Description,
          batch.cost,
          return_qty,
          totalReturnAmount,
          branchId,
          variation_id,
          connection,
        );

        // 6. Stock Card Entry
        await stockCardDbService.insertStockCard(
          Item.idItem,
          Item.Description,
          "BATCH_RETURN", // or PURCHASE_RETURN
          returnId,
          batch.cost,
          Item.Real_Cost,
          Item.Rate,
          0, // In Qty
          return_qty, // Out Qty
          masterQty, // Balance
          branchId,
          connection,
          variation_id || null,
        );

        // ✅ --- Supplier Credit Log Integration (Batch Return) ---
        try {
          const lastLogArr = await supplierLogDbService.fetchLastLog(
            Grn.Supplier_idSupplier,
          );
          let currentBalance =
            lastLogArr.length > 0
              ? parseFloat(lastLogArr[0].Total_Credit_Balance || 0)
              : 0;

          const debit = parseFloat(totalReturnAmount);
          const newBalance = currentBalance - debit;

          await supplierLogDbService.insertSupplierCreditLog(
            Grn.Supplier_idSupplier,
            "BATCH RETURN",
            returnId,
            0, // Credit is 0
            debit,
            newBalance,
            "debit",
            "system",
            "-",
            "-",
            "-",
            "-",
            branchId,
            connection,
            `Batch Return #${returnId} (GRN Bill: ${Grn.Bill_no})${reason ? `: ${reason}` : ""}`
          );
        } catch (logError) {
          console.error("Supplier Log Error (Batch Return):", logError);
        }

        // ─────────────────────────────────────────────────────────────────
        // ACCOUNTING DOUBLE ENTRIES — Batch Return
        // A batch return is a purchase return for that specific batch:
        //   Dr Accounts Payable (Creditors) — reduce what we owe supplier
        //   Cr Inventory                    — batch goods leave warehouse
        // ─────────────────────────────────────────────────────────────────
        try {
          const roundedReturnAmount =
            Math.round(totalReturnAmount * 100) / 100;

          if (roundedReturnAmount > 0) {
            const AP_AccountId = await findAccountByNameAndGroup(
              "Accounts Payable (Creditors)",
              "Liabilities",
              companyId,
              branchId,
              connection,
            );
            const Inventory_AccountId = await findAccountByNameAndGroup(
              "Inventory",
              "Assets",
              companyId,
              branchId,
              connection,
            );

            const batchDescription = `Batch Return #${returnId} – Batch ID: ${batch_id} (GRN Bill: ${Grn.Bill_no})`;

            // Dr Accounts Payable — reduce liability to supplier
            if (AP_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: roundedReturnAmount,
                description: `AP reduction – ${batchDescription}`,
                type: "Batch Return",
                accountId: AP_AccountId,
                branchId,
                userId,
                companyId,
                transactionType: "debit", // Debit on Liabilities → decreases AP
                connection,
              });
            }

            // Cr Inventory — batch goods leave the warehouse
            if (Inventory_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: roundedReturnAmount,
                description: `Inventory reduction – ${batchDescription}`,
                type: "Batch Return",
                accountId: Inventory_AccountId,
                branchId,
                userId,
                companyId,
                transactionType: "credit", // Credit on Assets → decreases inventory
                connection,
              });
            }

            console.log(
              `[BATCH-RETURN] ✅ Accounting entries recorded for Batch Return #${returnId} (Batch ID: ${batch_id})`,
            );
          }
        } catch (accErr) {
          // Accounting errors must NOT roll back stock/batch changes
          console.error(
            `[BATCH-RETURN] ⚠️ Accounting double-entry failed for Batch Return #${returnId}:`,
            accErr.message,
          );
        }
        // ─────────────────────────────────────────────────────────────────

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({
            status: "success",
            message: "Batch item returned successfully.",
            data: {
              return_id: returnId,
              new_batch_qty: newBatchQty,
              new_master_qty: masterQty,
            },
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("❌ Error returning batch item:", err);
          res.status(500).json({
            message: "Error returning batch item",
            error: err.message,
          });
        });
      }
    });
  });
};

const getPurchaseReturns = async (req, res) => {
  try {
    const { branchId } = req.params;
    const returns = await dbService.fetchPurchaseReturns(branchId);
    res.json(returns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching purchase returns",
      error: err.message,
    });
  }
};

const getPurchaseReturnDetails = async (req, res) => {
  try {
    const { id } = req.params; // Purchase Return ID
    const [items] = await Promise.all([
      // Fetch specific return record logic if needed separately,
      // but usually the list item is enough or we fetch by ID again.
      // reusing fetchPurchaseReturns might be inefficient for single ID
      // if we didn't implement fetchPurchaseReturnById.
      // For now, let's just fetch items and maybe the header if needed.
      // Let's implement a simple header fetch or just return items for details.
      // But typically we want the header too.
      // Let's assume the frontend passes the header info or we fetch it.
      // I'll add a quick fetchPurchaseReturnById to service if needed,
      // OR just return items which is what was asked "fetch the details".
      dbService.fetchPurchaseReturnItems(id),
    ]);

    // Construct response
    res.json({
      items: items.map((item) => {
        const variationSuffix = item.Variation_Name ? ` - ${item.Variation_Name}` : "";
        const displayName = item.Item_Name
          ? `${item.Item_Name}${variationSuffix}`
          : item.Item_Description || "";
        return {
          ...item,
          Item_Description: displayName,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching purchase return items",
      error: err.message,
    });
  }
};

const getExpiringBatchesAction = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { getExpiringBatches } = require("../services/dashboardDBService");
    const expiring = await getExpiringBatches(branchId);
    res.json(expiring);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching expiring batches",
      error: err.message,
    });
  }
};

// ---- BULK IMPORT FROM EXCEL ----
const importExcelGrns = async (req, res) => {
  try {
    const { rows, Branch_idBranch, User_idUser } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No rows provided" });
    }

    // ========== STEP 1: Find or create unique SUPPLIERS ==========
    const uniqueSupplierNames = [
      ...new Set(
        rows.map((r) => (r.Supplier || "").toString().trim()).filter(Boolean),
      ),
    ];

    const existingSuppliers = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idSupplier, Company_Name FROM supplier WHERE Branch_idBranch = ? AND isDeleted = 0`,
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results || [])));
        },
      );
    });

    const supplierMap = {};
    existingSuppliers.forEach((s) => {
      if (s.Company_Name) {
        supplierMap[s.Company_Name.trim().toLowerCase()] = s.idSupplier;
      }
    });

    for (const name of uniqueSupplierNames) {
      const key = name.toLowerCase();
      if (!supplierMap[key]) {
        const result = await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO supplier (Company_Name, Agent_Name, Contact_No, Contact_No2, Email, Address1, Address2, Address3, Status, Branch_idBranch, isDeleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, "Imported Agent", "", "", "", "", "", "", 1, Branch_idBranch, 0],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            },
          );
        });
        supplierMap[key] = result.insertId;
      }
    }

    // ========== STEP 2: Fetch existing running balances per supplier ==========
    const supplierRunningBalance = {};
    for (const suppKey of Object.keys(supplierMap)) {
      const suppId = supplierMap[suppKey];
      const lastLog = await supplierLogDbService.fetchLastLog(suppId);
      supplierRunningBalance[suppId] =
        lastLog.length > 0
          ? parseFloat(lastLog[0].Total_Credit_Balance) || 0
          : 0;
    }

    // ========== STEP 3: Process ALL rows ==========
    let grnsProcessed = 0;
    let fail = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const supplierName = (row.Supplier || "").toString().trim();
        const billNumber = (row.Bill_Number || "").toString().trim();
        const transactionDate = (row.Date || "").toString().trim();
        const total = parseFloat(row.Total_Amount) || 0;
        const paidAmount = parseFloat(row.Paid_Amount) || 0;
        const balanceAmount = parseFloat(row.Balance) !== undefined && !isNaN(parseFloat(row.Balance))
          ? parseFloat(row.Balance)
          : (total - paidAmount);

        if (!supplierName) {
          fail++;
          errors.push(`Row skipped: missing Supplier name`);
          continue;
        }

        if (!billNumber) {
          fail++;
          errors.push(`Row skipped: missing Bill_Number`);
          continue;
        }

        const supplierId = supplierMap[supplierName.toLowerCase()] || 0;

        // Format date — handle "2026-01-12 00:00:00" → "2026-01-12"
        let formattedDate = transactionDate;
        if (formattedDate.includes(" ")) {
          formattedDate = formattedDate.split(" ")[0];
        }

        // Insert GRN record
        const grnResult = await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO grn (Date, Supplier_idSupplier, Bill_no, Items_Count, Total_Amount, Bill_Discount, Bill_Discount_Type, Discount_Amount, Net_Total, Paid_Amount, Credit_Balance_Amount, Status, Grn_File, Branch_idBranch) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              formattedDate,
              supplierId,
              billNumber,
              0, // Items_Count
              total,
              0, // Bill_Discount
              "percent", // Bill_Discount_Type
              0, // Discount_Amount
              total, // Net_Total
              paidAmount,
              balanceAmount,
              1, // Status = 1 (Processed/recorded)
              null, // Grn_File
              Branch_idBranch
            ],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            }
          );
        });

        const newGrnId = grnResult.insertId;

        // Update running balance: GRN increases the outstanding balance by the balanceAmount (Credit)
        supplierRunningBalance[supplierId] =
          (supplierRunningBalance[supplierId] || 0) + balanceAmount;

        // Insert supplier credit log — GRN record
        await supplierLogDbService.insertSupplierCreditLog(
          supplierId, // Supplier_idSupplier
          "GRN", // Type
          newGrnId, // Type_Id (new GRN ID)
          balanceAmount, // Credit (outstanding amount we owe)
          0, // Debit (amount paid upfront is already deducted from credit portion)
          supplierRunningBalance[supplierId], // Total_Credit_Balance
          paidAmount >= total ? "full" : (paidAmount > 0 ? "partial" : "credit"), // Payment_Type
          paidAmount > 0 ? "cash" : null, // Payment_Method
          null, // Cheque_Type
          null, // Cheque_No
          null, // Cheque_Date
          null, // Cheque_Name
          Branch_idBranch, // Branch_idBranch
          null, // connection
          "Imported from Excel", // Note
          0 // Discount_Amount
        );

        grnsProcessed++;
      } catch (rowErr) {
        fail++;
        console.error(`Import failed for row ${row.Bill_Number || "?"}:`, rowErr);
        errors.push(`Row ${row.Bill_Number || "?"}: ${rowErr.message}`);
      }
    }

    res.json({
      message: "Import completed",
      total: rows.length,
      grnsProcessed: grnsProcessed,
      failed: fail,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    console.error("Error in importExcelGrns:", err);
    res.status(500).json({
      message: "Error importing GRNs",
      error: err.message,
    });
  }
};

const getItemBatchesForSaleAction = async (req, res) => {
  try {
    const { itemId, branchId, variationId } = req.params;
    const vId = variationId && variationId !== "null" && variationId !== "undefined" ? variationId : null;

    const query = `
      SELECT 
        ib.batch_id,
        ib.batch_code,
        ib.expiry_date,
        ib.qty AS batch_qty,
        i.Description AS item_name
      FROM item_batch ib
      JOIN item i ON ib.item_id = i.idItem
      JOIN grn g ON ib.grn_id = g.idGRN
      WHERE ib.item_id = ?
        AND (ib.variation_id = ? OR (? IS NULL AND ib.variation_id IS NULL))
        AND g.Branch_idBranch = ?
        AND ib.qty > 0
        AND (g.Status = 1 OR g.Status = '1')
      ORDER BY ib.batch_id ASC
    `;

    db.query(query, [itemId, vId, vId, branchId], (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Database error", error: err.message });
      }

      // Add severity status to each batch
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const mapped = results.map((batch) => {
        let severity = "safe";
        let daysLeft = null;

        if (batch.expiry_date) {
          const exp = new Date(batch.expiry_date);
          const diffTime = exp - today;
          daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (daysLeft <= 0) {
            severity = "expired";
          } else if (daysLeft <= 15) {
            severity = "critical";
          } else if (daysLeft <= 30) {
            severity = "warning";
          }
        }

        return {
          ...batch,
          severity,
          daysLeft,
        };
      });

      res.json(mapped);
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching item batches", error: err.message });
  }
};

const getNextGrnNo = (branch_id, connection = null) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT grn_no FROM grn WHERE Branch_idBranch = ? AND grn_no LIKE 'GRN-%'";
    (connection || db).query(query, [branch_id], (err, results) => {
      if (err) return reject(err);

      let maxNum = 999;
      if (results && results.length > 0) {
        for (const row of results) {
          if (row.grn_no) {
            const match = row.grn_no.match(/^GRN-(\d+)$/i);
            if (match && match[1]) {
              const num = parseInt(match[1], 10);
              if (num > maxNum) {
                maxNum = num;
              }
            }
          }
        }
      }
      resolve(`GRN-${maxNum + 1}`);
    });
  });
};

const getNextGrnNoAction = async (req, res) => {
  const { Branch_idBranch } = req.params;
  try {
    const nextNo = await getNextGrnNo(Branch_idBranch);
    res.json({ grn_no: nextNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const checkGrnNoAction = async (req, res) => {
  try {
    const Branch_idBranch = req.params.Branch_idBranch || req.query.branchId;
    const grn_no = req.params.grn_no || req.query.grn_no;
    const excludeId = req.query.excludeId || null;

    if (!grn_no || !Branch_idBranch) {
      return res.status(400).json({ message: "GRN Number and Branch ID are required" });
    }

    const isDuplicate = await dbService.checkDuplicateGrnNo(
      String(grn_no).trim(),
      Branch_idBranch,
      excludeId
    );

    if (isDuplicate) {
      return res.status(200).json({
        exists: true,
        message: `GRN number '${grn_no}' already exists. Each GRN number must be unique.`,
      });
    }

    return res.status(200).json({
      exists: false,
      message: "GRN number is available.",
    });
  } catch (err) {
    console.error("Error checking GRN number:", err);
    res.status(500).json({ error: err.message });
  }
};

const getPendingBalanceGrnsAction = async (req, res) => {
  try {
    const { supplierId, branchId } = req.params;
    if (!supplierId || !branchId) {
      return res.status(400).json({ message: "Supplier ID and Branch ID are required" });
    }
    const grns = await dbService.fetchPendingBalanceGrns(supplierId, branchId);
    res.json(grns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching pending balance GRNs",
      error: err.message,
    });
  }
};

module.exports = {
  createGrn,
  getGrns,
  getGrnById,
  updateGrn,
  deleteGrn,
  processGrn,
  checkSerial,
  getBatches,
  getBatchDetails,
  returnBatchItem, // Exporting new function
  getPurchaseReturns,
  getPurchaseReturnDetails,
  getExpiringBatchesAction,
  getItemBatchesForSaleAction,
  importExcelGrns,
  getNextGrnNoAction,
  checkGrnNoAction,
  getPendingBalanceGrnsAction,
};

