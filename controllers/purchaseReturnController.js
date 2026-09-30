const db = require("../db/db");
const dbService = require("../services/purchaseReturnDBService");
const grnDBService = require("../services/grnDBService");
const itemDbService = require("../services/productDBService");
const { productHistoryLogHelper } = itemDbService;
const branchDBService = require("../services/branchDBService");
const supplierLogDbService = require("../services/supplierCreditLogDBService");
const stockCardDbService = require("../services/stockCardDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const {
  findAccountByNameAndGroup,
  creditDebitLogHelper,
} = require("./accountingController");
const approvalService = require("../services/approvalService"); // 🆕 Added approvalService


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

const createPurchaseReturn = async (req, res) => {
  try {
    const {
      Date,
      Supplier_idSupplier,
      Total_Amount,
      Branch_idBranch,
      items,
      Reason,
      User_idUser,
    } = req.body;

    // APPROVAL ENGINE: Check if approval is required for CREATE_PURCHASE_RETURN
    const companyId = req.user?.company_id || req.headers["company_id"] || 1;
    const createdBy = req.user?.idUser || req.user?.id || User_idUser || 1;

    let approvalRequired = false;
    try {
      approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        Branch_idBranch,
        "CREATE_PURCHASE_RETURN"
      );
    } catch (appErr) {
      console.error("Approval check failed for CREATE_PURCHASE_RETURN:", appErr);
    }

    if (approvalRequired) {
      const pendingUpdates = req.body;
      
      try {
        await approvalService.triggerApprovalRequest({
          action_type: "CREATE_PURCHASE_RETURN",
          module_name: "Purchase Return",
          erp_record_id: null,
          company_id: companyId,
          branch_id: Branch_idBranch,
          initiated_by: createdBy,
          payload_summary: {
            total_amount: Total_Amount,
            action: "CREATE_PURCHASE_RETURN",
            pending_updates: pendingUpdates,
          },
        });
        console.log(`[PURCHASE RETURN] Triggered approval request for creating PR`);
      } catch (approvalErr) {
        console.error("[PURCHASE RETURN] Error triggering approval webhook for CREATE_PURCHASE_RETURN:", approvalErr);
      }

      return res.status(200).json({
        success: true,
        message: "Purchase Return creation submitted for approval. It will be created once approved.",
        approval_required: true,
        approval_status: "PENDING_APPROVAL",
      });
    }

    const purchaseReturn = await dbService.createPurchaseReturn(
      Date,
      Supplier_idSupplier,
      Total_Amount,
      items.length,
      Branch_idBranch,
      Reason
    );

    const idPurchase_Return = purchaseReturn.insertId;

    await Promise.all(
      items.map(async (item) => {
        const Item = await itemDbService.fetchItem(item.Item_idItem);

        if (item.Item_Description == " " || !item.Item_Description) {
          item.Item_Description = item.Item_Long_Description;
        }

        await dbService.insertItems(
          idPurchase_Return,
          item.Item_idItem,
          item.Item_Description,
          item.Cost,
          item.Qty_Type,
          item.Qty,
          item.Total,
          Branch_idBranch,
          item.Variation_Id || item.Variation_idVariation || null
        );

        if (item.Item_Has_Serial === 1) {
          await Promise.all(
            item.Serial_No.map(async (serial_number) => {
              const serial_no_id = await dbService.getSerials(serial_number);
              await dbService.insertPurchaseReturnSerials(
                idPurchase_Return,
                serial_no_id.ID
              );
              await dbService.updateSerialQtyForReturn(serial_no_id.ID);
            })
          );
        }
      })
    );

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Purchase Return",
      idPurchase_Return,
      "create",
      Branch_idBranch
    );

    res.json({
      message: "Purchase Return is added successfully",
    });
  } catch (err) {
    res.status(500).json({ message: "Error creating grn", error: err.message });
  }
};

const getProcessReturns = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const purchaseReturns = await dbService.fetchPurchaseItems(Branch_idBranch);

    if (purchaseReturns.length === 0) {
      return res.status(404).json({ message: "Purchase Returns not found" });
    }

    await Promise.all(
      purchaseReturns.map(async (purchaseReturn) => {
        const items = await dbService.fetchItems(
          purchaseReturn.idPurchase_Return
        );
        for (const item of items) {
          if (item.Item_Has_Serial === 1) {
            const serialNumbers = await dbService.fetchSerialNoForItem(
              purchaseReturn.idPurchase_Return
            );
            item.Serial_No = serialNumbers;
          }
        }
        purchaseReturn.items = items;
      })
    );

    res.json(purchaseReturns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const getPurchaseById = async (req, res) => {
  try {
    const { idPurchase_Return } = req.params;
    const purchaseRetrurn = await dbService.fetchPurchaseReturn(
      idPurchase_Return
    );

    const items = await dbService.fetchItems(
      purchaseRetrurn[0].idPurchase_Return
    );

    for (const item of items) {
      const serialNumbers = await dbService.fetchSerialNoForItem(
        idPurchase_Return
      );
      item.Serial_No = serialNumbers;
    }
    purchaseRetrurn[0].items = items;

    res.json(purchaseRetrurn[0]);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const updatePurchaseReturn = async (req, res) => {
  try {
    const { idPurchase_Return } = req.params;
    const { Date, Total_Amount, Branch_idBranch, items, Reason, User_idUser } =
      req.body;

    const existing = await dbService.fetchPurchaseReturn(idPurchase_Return);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ message: "Purchase return not found" });
    }
    if (existing[0].Status === 1 || existing[0].Is_Resolved === 1) {
      return res.status(400).json({
        message: "Cannot edit a processed or resolved purchase return. Please unprocess it first.",
      });
    }

    await dbService.updatePurchaseReturn(
      Date,
      items.length,
      Total_Amount,
      idPurchase_Return,
      Reason
    );

    await dbService.deleteItems(idPurchase_Return);
    await Promise.all(
      items.map(async (item) => {
        if (item.Item_Description == " " || !item.Item_Description) {
          item.Item_Description = item.Item_Long_Description;
        }

        await dbService.insertItems(
          idPurchase_Return,
          item.Item_idItem,
          item.Item_Description,
          item.Cost,
          item.Qty_Type,
          item.Qty,
          item.Total,
          Branch_idBranch,
          item.Variation_Id || item.Variation_idVariation || null
        );

        await dbService.deletePurchaseRetrunSerials(idPurchase_Return);
        if (item.Item_Has_Serial === 1) {
          item.Serial_No.map(async (serial_number) => {
            serial_no_id = await dbService.getSerials(serial_number);
            await dbService.insertPurchaseReturnSerials(
              idPurchase_Return,
              serial_no_id.ID
            );
          });
        }
      })
    );

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Purchase Return",
      idPurchase_Return,
      "edit",
      Branch_idBranch
    );

    res.json({
      message: "Purchase Return has been updated successfully",
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating purchase return", error: err.message });
  }
};

const processPurchaseReturn = async (req, res) => {
  const connection = await new Promise((resolve, reject) => {
    db.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      const { idPurchase_Return, Branch_idBranch, User_idUser, settlement_type, target_grn_id } = req.body;
      const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);

      // 1. Fetch Purchase Return Details
      const purchaseReturn = await new Promise((resolve, reject) => {
        const query =
          "SELECT p.*, s.Company_Name, s.Contact_No FROM purchase_return p INNER JOIN supplier s ON p.Supplier_idSupplier = s.idSupplier WHERE p.idPurchase_Return = ?";
        connection.query(query, [idPurchase_Return], (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results)));
        });
      });

      if (!purchaseReturn || purchaseReturn.length === 0) {
        throw new Error("Purchase return record not found.");
      }

      const returnAmount = parseFloat(purchaseReturn[0].Total_Amount || 0);
      const isExistingGrnSettlement =
        (settlement_type === "EXISTING_GRN" || settlement_type === "existing_grn") &&
        Boolean(target_grn_id);

      let resolvedGrnId = null;
      let settlementTypeVal = "ACCOUNT_CREDIT";
      let targetGrn = null;

      if (isExistingGrnSettlement) {
        const grnRows = await grnDBService.fetchGrn(target_grn_id);
        if (!grnRows || grnRows.length === 0) {
          throw new Error("Target GRN not found for balance settlement.");
        }
        targetGrn = grnRows[0];
        resolvedGrnId = target_grn_id;
        settlementTypeVal = "EXISTING_GRN";

        const currentGrnBal = parseFloat(targetGrn.Credit_Balance_Amount || 0);
        const newGrnBal = Math.max(0, currentGrnBal - returnAmount);
        const appliedDeduction = Math.min(currentGrnBal, returnAmount);

        // Deduct balance from existing target GRN
        await grnDBService.updateGrnCreditBalance(target_grn_id, newGrnBal, connection);

        // Record tracking in grn_has_applied_return
        await grnDBService.insertAppliedReturn(
          target_grn_id,
          idPurchase_Return,
          appliedDeduction,
          connection,
        );
      }

      // 2. Process Purchase Return (Update Status & Settlement Info)
      await new Promise((resolve, reject) => {
        const query =
          "UPDATE purchase_return SET Status=?, Is_Resolved=?, Resolved_GRN_Id=?, Settlement_Type=? WHERE idPurchase_Return=?";
        connection.query(
          query,
          [
            1,
            isExistingGrnSettlement ? 1 : 0,
            resolvedGrnId,
            settlementTypeVal,
            idPurchase_Return,
          ],
          (err, results) => {
            if (err) reject(err);
            else resolve(results);
          },
        );
      });

      // 3. Fetch Purchase Return Items
      const purchaseReturnItems = await new Promise((resolve, reject) => {
        const query =
          "SELECT * FROM purchase_return_has_item WHERE Purchase_Return_idPurchase_Return = ?";
        connection.query(query, [idPurchase_Return], (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results)));
        });
      });

      // 4. Fetch Last Supplier Log
      const lastSupplierLog = await new Promise((resolve, reject) => {
        const query =
          "SELECT * FROM supplier_log WHERE Supplier_idSupplier = ? ORDER BY idSupplier_Log DESC LIMIT 1";
        connection.query(
          query,
          [purchaseReturn[0].Supplier_idSupplier],
          (err, results) => {
            if (err) reject(err);
            else resolve(JSON.parse(JSON.stringify(results)));
          }
        );
      });

      const Total_Credit_Balance =
        parseFloat(
          lastSupplierLog.length === 0
            ? 0
            : lastSupplierLog[0].Total_Credit_Balance
        ) - returnAmount;

      // 5. Insert Supplier Credit Log (Debit)
      const settlementNote = isExistingGrnSettlement
        ? `Purchase Return #${idPurchase_Return} (Applied to GRN #${target_grn_id}${targetGrn?.Bill_no ? ` / Bill: ${targetGrn.Bill_no}` : ""})${purchaseReturn[0].Reason ? `: ${purchaseReturn[0].Reason}` : ""}`
        : `Purchase Return #${idPurchase_Return}${purchaseReturn[0].Reason ? `: ${purchaseReturn[0].Reason}` : ""}`;

      try {
        await supplierLogDbService.insertSupplierCreditLog(
          purchaseReturn[0].Supplier_idSupplier,
          "PURCHASE RETURN",
          idPurchase_Return,
          0,    // Credit
          purchaseReturn[0].Total_Amount,
          Total_Credit_Balance,
          "debit",
          "system",
          null, // Cheque_Type  — not a cheque transaction, must be null
          null, // Cheque_No    — null so cheque management query ignores this entry
          null, // Cheque_Date
          null, // Cheque_Name
          Branch_idBranch,
          connection,
          settlementNote
        );
      } catch (logError) {
        console.error("Supplier Log Error (Purchase Return):", logError);
      }

      // 6. Process Items
      for (const returnItem of purchaseReturnItems) {
        const item = await new Promise((resolve, reject) => {
          const query = "SELECt * FROM item WHERE idItem=?";
          connection.query(query, [returnItem.Item_idItem], (err, results) => {
            if (err) reject(err);
            else resolve(JSON.parse(JSON.stringify(results)));
          });
        });

        const Qty = parseFloat(item[0].Qty) - parseFloat(returnItem.Qty);

        if (item[0].Item_Has_Serial === 1) {
          const serial_items = await new Promise((resolve, reject) => {
            const query =
              "SELECT cr.*, i.Serial_No FROM purchase_return_has_item_serial_no cr INNER JOIN item_has_serial_no i ON cr.Item_Serial_No_id = i.ID  WHERE Purchase_Return_idPurchase_Return = ?";
            connection.query(query, [idPurchase_Return], (err, results) => {
              if (err) reject(err);
              else resolve(JSON.parse(JSON.stringify(results)));
            });
          });

          for (const serial_number of serial_items) {
            await new Promise((resolve, reject) => {
              const updateSerialQuery =
                "UPDATE item_has_serial_no SET Qty = 0 WHERE Serial_No = ?";
              connection.query(
                updateSerialQuery,
                [serial_number.Serial_No],
                (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                }
              );
            });
          }
        }

        // Update Item Inventory
        await new Promise((resolve, reject) => {
          const query =
            "UPDATE item SET Cost=?, Real_Cost=?, Qty=? WHERE idItem=?";
          connection.query(
            query,
            [item[0].Cost, item[0].Real_Cost, Qty, returnItem.Item_idItem],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            }
          );
        });

        // Update Variation Stock if Variation_Id is present
        if (returnItem.Variation_Id) {
          const varQuery = "SELECT * FROM item_variations WHERE id = ?";
          const [variation] = await new Promise((resolve, reject) => {
            connection.query(
              varQuery,
              [returnItem.Variation_Id],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });

          if (variation) {
            const currentVarQty = parseFloat(variation.qty || 0);
            const returnedVarQty = parseFloat(returnItem.Qty);
            const totalVarQty = Math.max(0, currentVarQty - returnedVarQty);

            const updateVarQuery =
              "UPDATE item_variations SET qty = ? WHERE id = ?";
            await new Promise((resolve, reject) => {
              connection.query(
                updateVarQuery,
                [totalVarQty, returnItem.Variation_Id],
                (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                }
              );
            });
          }
        }

        // Log history
        await productHistoryLogHelper({
          productId: returnItem.Item_idItem,
          variationId: returnItem.Variation_Id || null,
          quantityChange: -parseFloat(returnItem.Qty),
          oldQty: parseFloat(item[0].Qty),
          newQty: Qty,
          type: "Purchase Return",
          description: `Stock removed via Purchase Return ID: ${idPurchase_Return}`,
          branchId: Branch_idBranch,
          companyId,
          userId: User_idUser,
          referenceId: idPurchase_Return,
          connection,
        });

        // Insert Stock Card
        await new Promise((resolve, reject) => {
          // Use Asia/Colombo time for Stock Card
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
          const Date_Time_Stock = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;

          const query =
            "INSERT INTO stock_card (Date,Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) VALUES (?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
          connection.query(
            query,
            [
              Date_Time_Stock,
              item[0].idItem,
              item[0].Description,
              "PURCHASE RETURN",
              idPurchase_Return,
              returnItem.Cost,
              item[0].Real_Cost,
              item[0].Rate,
              0,
              returnItem.Qty,
              Qty,
              Branch_idBranch,
              returnItem.Variation_Id || null,
            ],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            }
          );
        });

      }

      // 7. Insert User Log
      await new Promise((resolve, reject) => {
        const query =
          "INSERT INTO user_log (User_idUser, Date_Time, Task_Type, Task_ID, Task_Category, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?)";
        connection.query(
          query,
          [
            User_idUser,
            currentDate(),
            "Purchase Return",
            idPurchase_Return,
            "process",
            Branch_idBranch,
          ],
          (err, results) => {
            if (err) reject(err);
            else resolve(results);
          }
        );
      });

      // ─────────────────────────────────────────────────────────────────
      // ACCOUNTING DOUBLE ENTRIES — Purchase Return Processing
      // When goods are returned to supplier, we reverse the GRN entries:
      //   Dr Accounts Payable (Creditors) — reduce what we owe supplier
      //   Cr Inventory                    — goods leave our warehouse
      // ─────────────────────────────────────────────────────────────────
      try {
        // Sum total cost value of all returned items (cost × qty)
        const totalReturnCost = purchaseReturnItems.reduce((sum, ri) => {
          return sum + parseFloat(ri.Cost || 0) * parseFloat(ri.Qty || 0);
        }, 0);
        const roundedReturnCost = Math.round(totalReturnCost * 100) / 100;

        if (roundedReturnCost > 0) {
          const AP_AccountId = await findAccountByNameAndGroup(
            "Accounts Payable (Creditors)",
            "Liabilities",
            companyId,
            Branch_idBranch,
            connection,
          );
          const Inventory_AccountId = await findAccountByNameAndGroup(
            "Inventory",
            "Assets",
            companyId,
            Branch_idBranch,
            connection,
          );

          const description = `Purchase Return #${idPurchase_Return} processed`;

          // Dr Accounts Payable — reduce the liability to supplier
          if (AP_AccountId) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Liabilities",
              amount: roundedReturnCost,
              description: `AP reduction – ${description}`,
              type: "Purchase Return",
              accountId: AP_AccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "debit", // Debit on Liabilities → decreases AP
              connection,
            });
          }

          // Cr Inventory — goods physically leave warehouse
          if (Inventory_AccountId) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Assets",
              amount: roundedReturnCost,
              description: `Inventory reduction – ${description}`,
              type: "Purchase Return",
              accountId: Inventory_AccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "credit", // Credit on Assets → decreases inventory
              connection,
            });
          }

          console.log(
            `[PURCHASE-RETURN] ✅ Accounting entries recorded for Return #${idPurchase_Return}`,
          );
        }
      } catch (accErr) {
        // Accounting errors must NOT roll back stock/supplier-log changes
        console.error(
          `[PURCHASE-RETURN] ⚠️ Accounting double-entry failed for Return #${idPurchase_Return}:`,
          accErr.message,
        );
      }
      // ─────────────────────────────────────────────────────────────────

      await new Promise((resolve, reject) => {
        connection.commit((commitErr) => {
          if (commitErr) reject(commitErr);
          else resolve();
        });
      });

      res.json({
        message: "Purchase Return Processed successfully",
      });
    } catch (err) {
      console.error("Error executing transaction:", err);
      await new Promise((resolve) => connection.rollback(resolve));
      throw err;
    }

  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({
      message: "Error processing purchase return",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

const checkReturnSerial = async (req, res) => {
  try {
    const { serial_numbers } = req.body;

    const checkSerials = await dbService.checkReturnSerial(serial_numbers);

    if (checkSerials.length === 0) {
      res
        .status(200)
        .json({ message: "The item os not found or already in stock" });
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

const getUnresolvedReturns = async (req, res) => {
  try {
    const { supplierId, branchId } = req.params;
    const purchaseReturns = await dbService.fetchUnresolvedReturns(supplierId, branchId);

    if (purchaseReturns.length === 0) {
      return res.json([]); // Return empty array if none found
    }

    await Promise.all(
      purchaseReturns.map(async (purchaseReturn) => {
        const items = await dbService.fetchItems(
          purchaseReturn.idPurchase_Return
        );
        for (const item of items) {
          if (item.Item_Has_Serial === 1) {
            const serialNumbers = await dbService.fetchSerialNoForItem(
              purchaseReturn.idPurchase_Return
            );
            item.Serial_No = serialNumbers;
          }
        }
        purchaseReturn.items = items;
      })
    );

    res.json(purchaseReturns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const unprocessPurchaseReturn = async (req, res) => {
  const connection = await new Promise((resolve, reject) => {
    db.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      const { idPurchase_Return, Branch_idBranch, User_idUser } = req.body;
      const targetBranchId = Branch_idBranch;

      // 1. Fetch Purchase Return Details with lock
      const [purchaseReturn] = await new Promise((resolve, reject) => {
        const query = "SELECT * FROM purchase_return WHERE idPurchase_Return = ? FOR UPDATE";
        connection.query(query, [idPurchase_Return], (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      });

      if (!purchaseReturn) {
        throw new Error("Purchase return record not found.");
      }

      if (Number(purchaseReturn.Status) === 0) {
        throw new Error("Purchase return is not processed yet.");
      }

      // 2. Validate that return is NOT applied to an active GRN
      if (Number(purchaseReturn.Is_Resolved) === 1 && purchaseReturn.Resolved_GRN_Id) {
        const [targetGrn] = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT idGRN, grn_no, Bill_no FROM grn WHERE idGRN = ?",
            [purchaseReturn.Resolved_GRN_Id],
            (err, results) => (err ? reject(err) : resolve(results || []))
          );
        });
        if (targetGrn) {
          const grnIdentifier = targetGrn.grn_no || targetGrn.Bill_no || `#${targetGrn.idGRN}`;
          throw new Error(
            `Cannot unprocess purchase return: This return is currently applied to GRN ${grnIdentifier}. You must remove it from the GRN or delete the GRN before unprocessing.`
          );
        }
      }

      const [appliedRow] = await new Promise((resolve, reject) => {
        connection.query(
          `SELECT g.idGRN, g.grn_no, g.Bill_no 
           FROM grn_has_applied_return har 
           JOIN grn g ON har.GRN_idGRN = g.idGRN 
           WHERE har.Purchase_Return_idPurchase_Return = ? LIMIT 1`,
          [idPurchase_Return],
          (err, results) => (err ? reject(err) : resolve(results || []))
        );
      });

      if (appliedRow) {
        const grnIdentifier = appliedRow.grn_no || appliedRow.Bill_no || `#${appliedRow.idGRN}`;
        throw new Error(
          `Cannot unprocess purchase return: This return is currently applied to GRN ${grnIdentifier}. You must remove it from the GRN or delete the GRN before unprocessing.`
        );
      }

      const companyId = await branchDBService.getCompanyIdByBranch(targetBranchId || purchaseReturn.Branch_idBranch);

      // 3. Fetch Items & Reverse Inventory Stock
      const returnItems = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT * FROM purchase_return_has_item WHERE Purchase_Return_idPurchase_Return = ?",
          [idPurchase_Return],
          (err, results) => (err ? reject(err) : resolve(results || []))
        );
      });

      for (const returnItem of returnItems) {
        const [item] = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM item WHERE idItem = ? FOR UPDATE",
            [returnItem.Item_idItem],
            (err, results) => (err ? reject(err) : resolve(results || []))
          );
        });

        if (item) {
          const currentQty = parseFloat(item.Qty || 0);
          const returnedQty = parseFloat(returnItem.Qty || 0);
          const newQty = currentQty + returnedQty; // Restoring inventory

          // Update item master stock
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE item SET Qty = ? WHERE idItem = ?",
              [newQty, returnItem.Item_idItem],
              (err, results) => (err ? reject(err) : resolve(results))
            );
          });

          // Update variation stock if applicable
          if (returnItem.Variation_Id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_variations SET qty = qty + ? WHERE id = ?",
                [returnedQty, returnItem.Variation_Id],
                (err, results) => (err ? reject(err) : resolve(results))
              );
            });
          }

          // Restore serial numbers to Qty = 2 (reserved for draft return)
          if (item.Item_Has_Serial === 1) {
            await new Promise((resolve, reject) => {
              const query = `
                UPDATE item_has_serial_no i 
                JOIN purchase_return_has_item_serial_no prs ON i.ID = prs.Item_Serial_No_id 
                SET i.Qty = 2 
                WHERE prs.Purchase_Return_idPurchase_Return = ?
              `;
              connection.query(query, [idPurchase_Return], (err, results) => {
                if (err) reject(err);
                else resolve(results);
              });
            });
          }

          // Product History Log
          await productHistoryLogHelper({
            productId: returnItem.Item_idItem,
            variationId: returnItem.Variation_Id || null,
            quantityChange: returnedQty,
            oldQty: currentQty,
            newQty: newQty,
            type: "Purchase Return Unprocessed",
            description: `Stock restored due to unprocessing Purchase Return ID: ${idPurchase_Return}`,
            branchId: targetBranchId || purchaseReturn.Branch_idBranch,
            companyId,
            userId: User_idUser || null,
            referenceId: idPurchase_Return,
            connection,
          });

          // Insert Stock Card (IN_Stock = returnedQty, SIH = newQty)
          const Date_Time_Stock = getColomboDateTime();
          await new Promise((resolve, reject) => {
            const scQuery = `
              INSERT INTO stock_card (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            connection.query(
              scQuery,
              [
                Date_Time_Stock,
                item.idItem,
                item.Description,
                "PURCHASE RETURN UNPROCESSED",
                idPurchase_Return,
                returnItem.Cost,
                item.Real_Cost,
                item.Rate,
                returnedQty, // IN_Stock restored
                0,           // Out_Stock
                newQty,      // SIH
                targetBranchId || purchaseReturn.Branch_idBranch,
                returnItem.Variation_Id || null,
              ],
              (err, results) => (err ? reject(err) : resolve(results))
            );
          });
        }
      }

      // 4. Revert Supplier Credit Log & Recalculate
      await new Promise((resolve, reject) => {
        connection.query(
          "DELETE FROM supplier_log WHERE Type_Id = ? AND Type = 'PURCHASE RETURN'",
          [idPurchase_Return],
          (err) => (err ? reject(err) : resolve())
        );
      });

      await supplierLogDbService.recalculateSupplierCreditLogs(
        purchaseReturn.Supplier_idSupplier,
        connection
      );

      // 5. Revert Purchase Return Record
      await new Promise((resolve, reject) => {
        connection.query(
          "UPDATE purchase_return SET Status = 0, Is_Resolved = 0, Resolved_GRN_Id = NULL, Settlement_Type = NULL WHERE idPurchase_Return = ?",
          [idPurchase_Return],
          (err, results) => (err ? reject(err) : resolve(results))
        );
      });

      // 6. User Activity Log
      await userLogDbService.insertLog(
        User_idUser || null,
        currentDate(),
        "Purchase Return",
        idPurchase_Return,
        "unprocess",
        targetBranchId || purchaseReturn.Branch_idBranch,
        connection
      );

      connection.commit((commitErr) => {
        if (commitErr) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ message: "Failed to commit unprocess transaction", error: commitErr.message });
          });
        }
        connection.release();
        res.json({ message: "Purchase Return has been successfully unprocessed." });
      });
    } catch (innerErr) {
      connection.rollback(() => {
        connection.release();
        res.status(400).json({ message: innerErr.message || "Error unprocessing purchase return" });
      });
    }
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ message: "Database connection error", error: err.message });
  }
};

const deletePurchaseReturn = async (req, res) => {
  const { idPurchase_Return } = req.params;
  const { User_idUser, Branch_idBranch } = req.body || {};

  const connection = await new Promise((resolve, reject) => {
    db.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });

  try {
    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      const [purchaseReturn] = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT * FROM purchase_return WHERE idPurchase_Return = ? FOR UPDATE",
          [idPurchase_Return],
          (err, results) => (err ? reject(err) : resolve(results || []))
        );
      });

      if (!purchaseReturn) {
        throw new Error("Purchase return not found.");
      }

      if (Number(purchaseReturn.Status) === 1) {
        throw new Error("Cannot delete a processed purchase return. Please unprocess it first.");
      }

      if (Number(purchaseReturn.Is_Resolved) === 1 || purchaseReturn.Resolved_GRN_Id) {
        throw new Error("Cannot delete purchase return: It is currently applied to a GRN.");
      }

      const [appliedRow] = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT GRN_idGRN FROM grn_has_applied_return WHERE Purchase_Return_idPurchase_Return = ? LIMIT 1",
          [idPurchase_Return],
          (err, results) => (err ? reject(err) : resolve(results || []))
        );
      });

      if (appliedRow) {
        throw new Error("Cannot delete purchase return: It is currently applied to a GRN.");
      }

      // Restore reserved serial numbers (Qty = 1)
      await new Promise((resolve, reject) => {
        const query = `
          UPDATE item_has_serial_no i 
          JOIN purchase_return_has_item_serial_no prs ON i.ID = prs.Item_Serial_No_id 
          SET i.Qty = 1 
          WHERE prs.Purchase_Return_idPurchase_Return = ?
        `;
        connection.query(query, [idPurchase_Return], (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      // Delete serial links
      await new Promise((resolve, reject) => {
        connection.query(
          "DELETE FROM purchase_return_has_item_serial_no WHERE Purchase_Return_idPurchase_Return = ?",
          [idPurchase_Return],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Delete items
      await new Promise((resolve, reject) => {
        connection.query(
          "DELETE FROM purchase_return_has_item WHERE Purchase_Return_idPurchase_Return = ?",
          [idPurchase_Return],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Delete main purchase return
      await new Promise((resolve, reject) => {
        connection.query(
          "DELETE FROM purchase_return WHERE idPurchase_Return = ?",
          [idPurchase_Return],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Log user activity
      await userLogDbService.insertLog(
        User_idUser || null,
        currentDate(),
        "Purchase Return",
        idPurchase_Return,
        "delete",
        Branch_idBranch || purchaseReturn.Branch_idBranch,
        connection
      );

      connection.commit((commitErr) => {
        if (commitErr) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ message: "Failed to commit deletion", error: commitErr.message });
          });
        }
        connection.release();
        res.json({ message: "Purchase Return deleted successfully." });
      });
    } catch (innerErr) {
      connection.rollback(() => {
        connection.release();
        res.status(400).json({ message: innerErr.message || "Error deleting purchase return" });
      });
    }
  } catch (err) {
    if (connection) connection.release();
    res.status(500).json({ message: "Database connection error", error: err.message });
  }
};

const applyPendingPurchaseReturnCreate = async (pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[PURCHASE RETURN] No pending updates found for PR creation`);
    return;
  }

  const {
    Date,
    Supplier_idSupplier,
    Total_Amount,
    Branch_idBranch,
    items,
    Reason,
    User_idUser,
  } = pendingUpdates;

  try {
    const purchaseReturn = await dbService.createPurchaseReturn(
      Date,
      Supplier_idSupplier,
      Total_Amount,
      items.length,
      Branch_idBranch,
      Reason
    );

    const idPurchase_Return = purchaseReturn.insertId;

    await Promise.all(
      items.map(async (item) => {
        const Item = await itemDbService.fetchItem(item.Item_idItem);

        if (item.Item_Description == " " || !item.Item_Description) {
          item.Item_Description = item.Item_Long_Description;
        }

        await dbService.insertItems(
          idPurchase_Return,
          item.Item_idItem,
          item.Item_Description,
          item.Cost,
          item.Qty_Type,
          item.Qty,
          item.Total,
          Branch_idBranch,
          item.Variation_Id || item.Variation_idVariation || null
        );

        if (item.Item_Has_Serial === 1) {
          await Promise.all(
            item.Serial_No.map(async (serial_number) => {
              const serial_no_id = await dbService.getSerials(serial_number);
              await dbService.insertPurchaseReturnSerials(
                idPurchase_Return,
                serial_no_id.ID
              );
              await dbService.updateSerialQtyForReturn(serial_no_id.ID);
            })
          );
        }
      })
    );

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Purchase Return",
      idPurchase_Return,
      "create",
      Branch_idBranch
    );

    return idPurchase_Return;
  } catch (err) {
    console.error("Error applying pending PR create:", err);
    throw err;
  }
};

module.exports = {
  createPurchaseReturn,
  getProcessReturns,
  getPurchaseById,
  updatePurchaseReturn,
  processPurchaseReturn,
  unprocessPurchaseReturn,
  deletePurchaseReturn,
  checkReturnSerial,
  getUnresolvedReturns,
  applyPendingPurchaseReturnCreate,
};
