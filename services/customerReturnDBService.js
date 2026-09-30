const db = require("../db/db");
const productDBService = require("./productDBService");
const branchDBService = require("./branchDBService");
const { productHistoryLogHelper } = productDBService;
const {
  findAccountByNameAndGroup,
  creditDebitLogHelper,
} = require("../controllers/accountingController");
const customerDbService = require("./customerDBService");
const customerLogDbService = require("./customerCreditLogDBService");

// Helper for date time
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

const createCustomerReturn = (
  Date,
  Customer_idCustomer,
  Total_Amount,
  Items_Count,
  Branch_idBranch,
  Reason,
  Return_Type,
  Invoice_idInvoice,
  Return_Receipt_No,
  Employee_idEmployee,
) => {
  const query =
    "INSERT INTO customer_return (Date, Customer_idCustomer, Invoice_idInvoice, Reason, Return_Type, Item_Count, Total_Amount, Status, Branch_idBranch, Return_Receipt_No, Employee_idEmployee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Date,
        Customer_idCustomer,
        Invoice_idInvoice || null,
        Reason,
        Return_Type || "return",
        Items_Count,
        Total_Amount,
        0,
        Branch_idBranch,
        Return_Receipt_No || null,
        Employee_idEmployee || null,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const updateCustomerReturn = (
  Date,
  Item_Count,
  Total_Amount,
  idCustomer_Return,
  Reason,
  Return_Type,
  Return_Receipt_No,
  Employee_idEmployee,
) => {
  const query =
    "UPDATE customer_return SET Date=?, Reason=?, Return_Type=?, Item_Count=?, Total_Amount=?, Return_Receipt_No=?, Employee_idEmployee=? WHERE idCustomer_Return=?";
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Date,
        Reason,
        Return_Type || "return",
        Item_Count,
        Total_Amount,
        Return_Receipt_No || null,
        Employee_idEmployee || null,
        idCustomer_Return,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const insertItems = (
  idCustomer_Return,
  Item_idItem,
  Item_Description,
  Cost,
  Qty_Type,
  Qty,
  Total,
  Branch_idBranch,
  Variation_Id,
  Invoice_Item_Id,
  Item_Return_Type,
) => {
  const query =
    "INSERT INTO customer_return_has_item (Customer_Return_idCustomer_Return, Item_idItem, Item_Description, Cost, Qty_Type, Qty, Total, Branch_idBranch, Variation_Id, Invoice_Item_Id, Item_Return_Type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        idCustomer_Return,
        Item_idItem,
        Item_Description,
        Cost,
        Qty_Type,
        Qty,
        Total,
        Branch_idBranch,
        Variation_Id || null,
        Invoice_Item_Id || null,
        Item_Return_Type || "return",
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const fetchCustomerItems = (Branch_idBranch) => {
  const query =
    "SELECT p.*, COALESCE(s.displayName, 'Walk-in Customer') AS displayName, inv.Invoice_Number, emp.Employee_Name AS Salesman_Name, COALESCE(p.Employee_idEmployee, inv.Employee_idEmployee) AS Employee_idEmployee FROM customer_return p LEFT JOIN customer s ON p.Customer_idCustomer = s.idCustomer LEFT JOIN invoice inv ON p.Invoice_idInvoice = inv.idInvoice LEFT JOIN employee emp ON COALESCE(p.Employee_idEmployee, inv.Employee_idEmployee) = emp.idEmployee WHERE p.Branch_idBranch = ? ORDER BY idCustomer_Return DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchCustomerInvoicesForReturn = (
  Customer_idCustomer,
  Branch_idBranch,
) => {
  const query = `
    SELECT 
      i.idInvoice,
      i.Invoice_Number,
      i.Date,
      i.Net_Amount,
      GREATEST(0, ROUND(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0), 2)) AS Credit_Balance,
      i.Paid_Amount,
      GREATEST(0, ROUND(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0), 2)) AS Balance_Amount,
      i.Payment_Type,
      i.Total,
      i.Employee_idEmployee
    FROM invoice i
    WHERE i.Customer_idCustomer = ? 
      AND i.Branch_idBranch = ?
    ORDER BY i.idInvoice DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_idCustomer, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoiceItemsForReturn = (Invoice_idInvoice) => {
  // Use the exact same query as invoiceDBService.fetchInvoiceItems with Item_Code and barcodes
  const query =
    "SELECT ihi.*, i.Type, i.Cost, i.Real_Cost, i.Qty as Current_Stock, i.Description as Item_Name, i.Item_Code, i.barcode, (SELECT GROUP_CONCAT(pb.barcode) FROM product_barcodes pb WHERE pb.item_id = i.idItem) as extra_barcodes, iv.product_sku as variation_sku, iv.barcode as variation_barcode, ihi.Variation_Id, si.ID as Serial_No_Id, si.Serial_No as Serial_Number, qt.Description AS Unit_Name, qt.Description AS Unit FROM invoice_has_item ihi INNER JOIN item i ON ihi.Item_idItem = i.idItem LEFT JOIN item_variations iv ON ihi.Variation_Id = iv.id LEFT JOIN item_has_serial_no si ON ihi.Serial_No_Id = si.ID LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(ihi.Qty_Type, i.Qty_Type) WHERE ihi.Invoice_idInvoice = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Invoice_idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchItems = (Customer_Return_idCustomer_Return) => {
  const query =
    "SELECT i.*, v.description AS variation_description, v.product_sku AS variation_sku FROM customer_return_has_item i LEFT JOIN item_variations v ON i.Variation_Id = v.id WHERE i.Customer_Return_idCustomer_Return = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_Return_idCustomer_Return], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchCustomerReturn = (idCustomer_Return) => {
  const query =
    "SELECT p.*, COALESCE(s.displayName, 'Walk-in Customer') AS displayName, s.phoneNumber AS Tp, inv.Invoice_Number, emp.Employee_Name AS Salesman_Name FROM customer_return p LEFT JOIN customer s ON p.Customer_idCustomer = s.idCustomer LEFT JOIN invoice inv ON p.Invoice_idInvoice = inv.idInvoice LEFT JOIN employee emp ON COALESCE(p.Employee_idEmployee, inv.Employee_idEmployee) = emp.idEmployee WHERE p.idCustomer_Return = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idCustomer_Return], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteItems = (idCustomer_Return) => {
  const query =
    "DELETE FROM customer_return_has_item WHERE Customer_Return_idCustomer_Return = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idCustomer_Return], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const processCustomerReturn = (idCustomer_Return) => {
  const query = "UPDATE customer_return SET Status=? WHERE idCustomer_Return=?";
  return new Promise((resolve, reject) => {
    db.query(query, [1, idCustomer_Return], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchCustomerOutstandingInvoices = (Customer_idCustomer, Branch_idBranch) => {
  const query = `
    SELECT 
      i.idInvoice,
      i.Invoice_Number,
      i.Date,
      i.Net_Amount,
      GREATEST(0, ROUND(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0), 2)) AS Credit_Balance,
      i.Paid_Amount,
      GREATEST(0, ROUND(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0), 2)) AS Balance_Amount,
      i.Payment_Type
    FROM invoice i
    WHERE i.Customer_idCustomer = ?
      AND i.Branch_idBranch = ?
      AND (COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0)) > 0.005
    ORDER BY i.idInvoice DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_idCustomer, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const processCustomerReturnTransaction = async (
  idCustomer_Return,
  Branch_idBranch,
  User_idUser,
  Selected_Invoice_Ids, // array of invoice IDs in distribution order
) => {
  // 1. Get Connection from Pool
  const connection = await new Promise((resolve, reject) => {
    db.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });

  try {
    // 2. Begin Transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      // Logic with connection.query

      // 1. Validate Status
      console.log("LOG: Validating Status for ID:", idCustomer_Return);
      const checkStatusQuery =
        "SELECT * FROM customer_return WHERE idCustomer_Return = ? FOR UPDATE";
      const [returnRecord] = await new Promise((res, rej) => {
        connection.query(
          checkStatusQuery,
          [idCustomer_Return],
          (err, results) => {
            if (err) {
              console.error("LOG: Error fetching status:", err);
              rej(err);
            } else res(results);
          },
        );
      });
      console.log("LOG: Return Record Found:", !!returnRecord);

      if (!returnRecord) {
        throw new Error("Customer Return record not found");
      }

      if (returnRecord.Status === 1) {
        throw new Error("Customer Return already processed");
      }

      // Return_Type is now per-item; header Return_Type is kept as fallback for legacy records
      const Header_Return_Type = returnRecord.Return_Type || "return";
      const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);

      // 2. Fetch Customer Items
      const itemsQuery =
        "SELECT * FROM customer_return_has_item WHERE Customer_Return_idCustomer_Return = ?";
      const items = await new Promise((res, rej) => {
        connection.query(itemsQuery, [idCustomer_Return], (err, results) => {
          if (err) rej(err);
          else res(results);
        });
      });

      // ─── Credit-log helper (runs inside transaction connection) ───────────────
      const insertCreditLogEntry = async ({
        type,
        typeId,
        credit,
        debit,
        runningBalance,
        paymentMethod,
        note,
      }) => {
        const insertLogQuery = `
          INSERT INTO customer_credit_log (
            Customer_idCustomer, Date_Time, Type, Type_Id, Credit, Debit,
            Total_Credit_Balance, Payment_Type, Payment_Method, Cheque_Type,
            Cheque_No, Cheque_Date, Cheque_Name, Cheque_Status, Branch_idBranch,
            Card_Type, Card_Number, Transaction_Id, Receipt, Bank_Name, Bank_No, Note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await new Promise((res, rej) => {
          connection.query(
            insertLogQuery,
            [
              returnRecord.Customer_idCustomer,
              getColomboDateTime(),
              type,
              typeId,
              credit,
              debit,
              runningBalance,
              "-",          // Payment_Type
              paymentMethod || "-", // Payment_Method
              "-",          // Cheque_Type
              "-",          // Cheque_No
              null,         // Cheque_Date
              "-",          // Cheque_Name
              0,            // Cheque_Status
              Branch_idBranch,
              "-",          // Card_Type
              "-",          // Card_Number
              "-",          // Transaction_Id
              null,         // Receipt
              "-",          // Bank_Name
              0,            // Bank_No
              note || null, // Note
            ],
            (err, result) => {
              if (err) rej(err);
              else res(result);
            }
          );
        });
      };
      // ─────────────────────────────────────────────────────────────────────────

      // 3. Build running credit-log balance and write initial CUSTOMER RETURN entry
      //    We defer writing the full credit log until AFTER invoice allocations so
      //    we can track the running balance accurately.
      const customerId = returnRecord.Customer_idCustomer;
      let runningCreditBalance = 0;

      if (customerId && customerId > 0) {
        const lastLogQuery =
          "SELECT Total_Credit_Balance FROM customer_credit_log WHERE Customer_idCustomer = ? ORDER BY idCustomer_Credit_Log DESC LIMIT 1";
        const [lastLog] = await new Promise((res, rej) => {
          connection.query(lastLogQuery, [customerId], (err, results) => {
            if (err) rej(err);
            else res(results);
          });
        });
        runningCreditBalance = parseFloat(lastLog ? lastLog.Total_Credit_Balance : 0);
      }

      // Determine per-item types (use item-level type, fall back to header type for legacy)
      const itemsWithType = items.map((item) => ({
        ...item,
        _effectiveType: item.Item_Return_Type || Header_Return_Type,
      }));

      const damageItems = itemsWithType.filter((i) => i._effectiveType === "damage");
      const returnOnlyItems = itemsWithType.filter((i) => i._effectiveType === "return");

      let idDamage_Note = null;
      if (damageItems.length > 0) {
        const damageTotalAmount = damageItems.reduce(
          (sum, i) => sum + parseFloat(i.Total || 0), 0
        );
        const damageNoteReason = `Customer Return Damage (Return #${idCustomer_Return})${returnRecord.Reason ? `: ${returnRecord.Reason}` : ""}`;
        const insertDamageNoteQuery =
          "INSERT INTO damage_note (Date, Reason, Total_Amount, Item_Count, Status, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?)";
        
        const damageNoteResult = await new Promise((res, rej) => {
          connection.query(
            insertDamageNoteQuery,
            [
              returnRecord.Date,
              damageNoteReason,
              damageTotalAmount,
              damageItems.length,
              0,
              Branch_idBranch,
            ],
            (err, results) => {
              if (err) rej(err);
              else res(results);
            }
          );
        });
        idDamage_Note = damageNoteResult.insertId;
      }

      // 4. Update Inventory & Stock Cards (per-item type)
      for (const returnItem of itemsWithType) {
        const itemEffectiveType = returnItem._effectiveType;
        // Fetch Item
        const itemQuery = "SELECT * FROM item WHERE idItem = ?";
        const [item] = await new Promise((res, rej) => {
          connection.query(
            itemQuery,
            [returnItem.Item_idItem],
            (err, results) => {
              if (err) rej(err);
              else res(results);
            },
          );
        });

        if (!item) continue;

        if (itemEffectiveType === "return") {
          // Update Item Qty
          const newQty = parseFloat(item.Qty) + parseFloat(returnItem.Qty);
          // Assuming COST also might need update logic based on business rules, keeping existing logic
          // Existing logic seemed to just set Cost/Real_Cost/Qty but didn't recalculate Cost.
          // Waiting... original code: "UPDATE item SET Cost=?, Real_Cost=?, Qty=? WHERE idItem=?"
          // passing [item.Cost, item.Real_Cost, newQty, item.idItem]. So costs don't change, only Qty.

          const updateItemQuery =
            "UPDATE item SET Cost=?, Real_Cost=?, Qty=? WHERE idItem=?";
          await new Promise((res, rej) => {
            connection.query(
              updateItemQuery,
              [item.Cost, item.Real_Cost, newQty, item.idItem],
              (err, result) => {
                if (err) rej(err);
                else res(result);
              },
            );
          });

          // Log Master History
          await productHistoryLogHelper({
            productId: item.idItem,
            variationId: returnItem.Variation_Id || null,
            quantityChange: parseFloat(returnItem.Qty),
            oldQty: parseFloat(item.Qty),
            newQty: newQty,
            type: "Customer Return",
            description: `Stock returned from Customer Return ID: ${idCustomer_Return}`,
            branchId: Branch_idBranch,
            companyId,
            userId: User_idUser,
            referenceId: idCustomer_Return,
            connection,
          });

          // Insert Stock Card
          const stockCardQuery = `INSERT INTO stock_card (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          await new Promise((res, rej) => {
            connection.query(
              stockCardQuery,
              [
                getColomboDateTime(),
                item.idItem,
                item.Description,
                "CUSTOMER RETURN",
                idCustomer_Return,
                returnItem.Cost,
                item.Real_Cost,
                item.Rate,
                parseFloat(returnItem.Qty), // IN_Stock
                0, // OUT_Stock
                newQty, // SIH
                Branch_idBranch,
                returnItem.Variation_Id || null,
              ],
              (err, result) => {
                if (err) rej(err);
                else res(result);
              },
            );
          });

          // Variation Update
          if (returnItem.Variation_Id) {
            // Fetch variation
            const varQuery = "SELECT * FROM item_variations WHERE id = ?";
            const [variation] = await new Promise((resolve, reject) => {
              connection.query(
                varQuery,
                [returnItem.Variation_Id],
                (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                },
              );
            });

            if (variation) {
              const currentVarQty = parseFloat(variation.qty || 0);
              const currentVarCost = parseFloat(variation.cost || 0);
              const addedVarQty = parseFloat(returnItem.Qty);
              const addedVarCost = parseFloat(returnItem.Cost);
              const totalVarQty = currentVarQty + addedVarQty;

              let updatedVarCost = addedVarCost;
              if (totalVarQty > 0) {
                updatedVarCost =
                  (currentVarCost * currentVarQty +
                    addedVarCost * addedVarQty) /
                  totalVarQty;
              }

              const updateVarQuery =
                "UPDATE item_variations SET qty = ?, cost = ? WHERE id = ?";
              await new Promise((res, rej) => {
                connection.query(
                  updateVarQuery,
                  [totalVarQty, updatedVarCost, returnItem.Variation_Id],
                  (err, result) => {
                    if (err) rej(err);
                    else res(result);
                  },
                );
              });

              // Log Variation History
              await productHistoryLogHelper({
                productId: item.idItem,
                variationId: returnItem.Variation_Id,
                quantityChange: parseFloat(returnItem.Qty),
                oldQty: currentVarQty,
                newQty: totalVarQty,
                type: "Customer Return (Variation)",
                description: `Variation stock returned from Customer Return ID: ${idCustomer_Return}`,
                branchId: Branch_idBranch,
                companyId,
                userId: User_idUser,
                referenceId: idCustomer_Return,
                connection,
              });
            }
          }

          // Update Serials
          if (item.Item_Has_Serial === 1) {
            const serialsQuery =
              "SELECT cr.*, i.Serial_No FROM customer_return_has_item_serial_no cr INNER JOIN item_has_serial_no i ON cr.Item_Serial_No_id = i.ID  WHERE Customer_Return_idCustomer_Return = ?";
            const serials = await new Promise((resolve, reject) => {
              connection.query(
                serialsQuery,
                [idCustomer_Return],
                (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                },
              );
            });

            for (const s of serials) {
              const updateSerialQuery =
                "UPDATE item_has_serial_no SET Qty = 1 WHERE Serial_No = ?";
              await new Promise((resolve, reject) => {
                connection.query(
                  updateSerialQuery,
                  [s.Serial_No],
                  (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                  },
                );
              });
            }
          }
        } else if (itemEffectiveType === "damage") {
          // Do NOT update Item Qty

          // Insert into damage_note_has_item
          if (idDamage_Note) {
            const insertDamageItemQuery =
              "INSERT INTO damage_note_has_item (Damage_Note_idDamage_Note, Item_idItem, Item_Description, Cost, Qty, Total, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, ?)";
            await new Promise((res, rej) => {
              connection.query(
                insertDamageItemQuery,
                [
                  idDamage_Note,
                  returnItem.Item_idItem,
                  returnItem.Item_Description,
                  returnItem.Cost,
                  returnItem.Qty,
                  returnItem.Total,
                  Branch_idBranch,
                ],
                (err, result) => {
                  if (err) rej(err);
                  else res(result);
                }
              );
            });
          }

          // Insert Stock Card (Damage)
          const stockCardQuery = `INSERT INTO stock_card (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          await new Promise((res, rej) => {
            connection.query(
              stockCardQuery,
              [
                getColomboDateTime(),
                item.idItem,
                item.Description,
                "CUSTOMER RETURN - DAMAGE",
                idCustomer_Return,
                returnItem.Cost,
                item.Real_Cost,
                item.Rate,
                0, // IN_Stock is 0 because it's not added to sellable stock
                0, // OUT_Stock
                item.Qty, // SIH remains same as current Qty
                Branch_idBranch,
                returnItem.Variation_Id || null,
              ],
              (err, result) => {
                if (err) rej(err);
                else res(result);
              },
            );
          });
        }
      }

      // 5. Update Status
      const updateStatusQuery =
        "UPDATE customer_return SET Status=? WHERE idCustomer_Return=?";
      await new Promise((res, rej) => {
        connection.query(
          updateStatusQuery,
          [1, idCustomer_Return],
          (err, result) => {
            if (err) rej(err);
            else res(result);
          },
        );
      });

      // ── Helper: apply return credit to one invoice and write credit-log entry ──
      const applyAmountToInvoice = async (invoiceId, applyAmount) => {
        if (!invoiceId || applyAmount <= 0) return 0;

        const invoiceQuery = "SELECT * FROM invoice WHERE idInvoice = ? FOR UPDATE";
        const [invoice] = await new Promise((res, rej) => {
          connection.query(invoiceQuery, [invoiceId], (err, results) => {
            if (err) rej(err);
            else res(results);
          });
        });

        if (!invoice) return 0;

        const currentPaidAmount    = parseFloat(invoice.Paid_Amount || 0);
        const invoiceNetAmount     = parseFloat(invoice.Net_Amount || 0);
        const invoiceInterestAmount= parseFloat(invoice.Interest_Amount || 0);
        const invoiceTotalAmount   = invoiceNetAmount + invoiceInterestAmount;
        const actualOutstanding    = Math.max(0, invoiceTotalAmount - currentPaidAmount);

        // Only apply up to what the invoice actually owes
        const clampedAmount = Math.min(applyAmount, actualOutstanding);
        if (clampedAmount <= 0) return 0;

        let newPaidAmount    = Math.min(currentPaidAmount + clampedAmount, invoiceTotalAmount);
        let newBalanceAmount = Math.max(0, invoiceTotalAmount - newPaidAmount);
        let newCreditBalance = newBalanceAmount;

        if (newCreditBalance < 1.0) newCreditBalance = 0;
        if (newBalanceAmount < 1.0) newBalanceAmount = 0;

        const existingNote = invoice.Note || "";
        const returnNote   = `[RETURN #${idCustomer_Return}] Credit applied: LKR ${clampedAmount.toFixed(2)} on ${getColomboDateTime()}`;
        const updatedNote  = existingNote ? `${existingNote}\n${returnNote}` : returnNote;

        // Update the invoice
        await new Promise((res, rej) => {
          connection.query(
            "UPDATE invoice SET Credit_Balance = ?, Balance_Amount = ?, Paid_Amount = ?, Note = ? WHERE idInvoice = ?",
            [newCreditBalance, newBalanceAmount, newPaidAmount, updatedNote, invoiceId],
            (err, result) => (err ? rej(err) : res(result))
          );
        });

        // Credit-log: DEBIT (reduces what the customer owes for that invoice)
        if (customerId && customerId > 0) {
          runningCreditBalance -= clampedAmount;
          await insertCreditLogEntry({
            type:           "CUSTOMER RETURN - INVOICE CREDIT",
            typeId:         invoiceId,
            credit:         0,
            debit:          clampedAmount,
            runningBalance: runningCreditBalance,
            paymentMethod:  `Return #${idCustomer_Return} applied to Invoice ${invoice.Invoice_Number}`,
            note:           `Customer Return #${idCustomer_Return}: LKR ${clampedAmount.toFixed(2)} applied to Invoice ${invoice.Invoice_Number}`,
          });
        }

        console.log(`[CUSTOMER-RETURN] Applied LKR ${clampedAmount.toFixed(2)} to Invoice #${invoice.Invoice_Number} (ID: ${invoiceId}). New credit balance: ${newCreditBalance}`);
        return clampedAmount;
      };
      // ────────────────────────────────────────────────────────────────────────────

      const returnAmount = parseFloat(returnRecord.Total_Amount || 0);
      let remainingReturnAmount = returnAmount;

      // 5a. Write CUSTOMER RETURN entry in credit log FIRST (credit side — adds the
      //     return credit to the customer's running balance so we can subsequently
      //     deduct it per invoice)
      //     Think of this as: customer is "owed" returnAmount by us.
      if (customerId && customerId > 0 && returnAmount > 0) {
        runningCreditBalance -= returnAmount; // return reduces what customer owes overall
        await insertCreditLogEntry({
          type:           "CUSTOMER RETURN",
          typeId:         idCustomer_Return,
          credit:         0,
          debit:          returnAmount,     // reduces the customer's total credit balance
          runningBalance: runningCreditBalance,
          paymentMethod:  "Customer Return",
          note:           `Return #${idCustomer_Return} processed. Total: LKR ${returnAmount.toFixed(2)}`,
        });
        console.log(`[CUSTOMER-RETURN] Main credit log entry written. Running balance: ${runningCreditBalance}`);
      }

      // 5b. Apply to the linked invoice (attached when return was created)
      if (returnRecord.Invoice_idInvoice && remainingReturnAmount > 0) {
        const applied = await applyAmountToInvoice(returnRecord.Invoice_idInvoice, remainingReturnAmount);
        remainingReturnAmount -= applied;
      }

      // 5c. Distribute remaining amount across user-selected outstanding invoices
      if (Selected_Invoice_Ids && Selected_Invoice_Ids.length > 0 && remainingReturnAmount > 0) {
        for (const invoiceId of Selected_Invoice_Ids) {
          if (remainingReturnAmount <= 0) break;
          // Skip the linked invoice (already handled above)
          if (invoiceId == returnRecord.Invoice_idInvoice) continue;

          // Fetch current credit balance to know how much this invoice can absorb
          const [currentInvoice] = await new Promise((res, rej) => {
            connection.query(
              "SELECT idInvoice, Paid_Amount, Net_Amount, Interest_Amount, GREATEST(0, ROUND(COALESCE(Net_Amount, 0) + COALESCE(Interest_Amount, 0) - COALESCE(Paid_Amount, 0), 2)) AS Credit_Balance FROM invoice WHERE idInvoice = ?",
              [invoiceId],
              (err, results) => (err ? rej(err) : res(results))
            );
          });

          if (!currentInvoice) continue;
          const canAbsorb = parseFloat(currentInvoice.Credit_Balance || 0);
          const toApply   = Math.min(remainingReturnAmount, canAbsorb);

          if (toApply > 0) {
            const applied = await applyAmountToInvoice(invoiceId, toApply);
            remainingReturnAmount -= applied;
          }
        }
      }

      // 5d. Any leftover return amount becomes customer overpayment
      //     (exactly the same pattern as how invoices handle excess payments)
      const overpaymentAmount = Math.round(remainingReturnAmount * 100) / 100;
      if (customerId && customerId > 0 && overpaymentAmount > 0.009) {
        console.log(`[CUSTOMER-RETURN] Unallocated return surplus: LKR ${overpaymentAmount.toFixed(2)} → stored as customer overpayment.`);

        // 5d-i. Increase customer.overpayment
        await customerDbService.updateCustomerOverpayment(customerId, overpaymentAmount, connection);

        // 5d-ii. Credit-log entry (mirrors how invoices record overpayments)
        //        The balance already dropped in step 5a; this debit accounts for the
        //        extra credit being parked as an overpayment reserve.
        runningCreditBalance -= overpaymentAmount;
        await insertCreditLogEntry({
          type:           "CUSTOMER RETURN - OVERPAYMENT",
          typeId:         idCustomer_Return,
          credit:         0,
          debit:          overpaymentAmount,
          runningBalance: runningCreditBalance,
          paymentMethod:  "Excess Return (Overpayment Created)",
          note:           `Return #${idCustomer_Return}: LKR ${overpaymentAmount.toFixed(2)} stored as overpayment (no outstanding invoice to apply against)`,
        });

        console.log(`[CUSTOMER-RETURN] ✅ Overpayment of LKR ${overpaymentAmount.toFixed(2)} saved for customer ${customerId}.`);
      }

      // 6. User Log
      const userLogQuery =
        "INSERT INTO user_log (User_idUser, Date_Time, Task_Type, Task_ID, Task_Category, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?)";
      await new Promise((res, rej) => {
        connection.query(
          userLogQuery,
          [
            User_idUser,
            getColomboDateTime(),
            "Customer Return",
            idCustomer_Return,
            "process",
            Branch_idBranch,
          ],
          (err, result) => {
            if (err) rej(err);
            else res(result);
          },
        );
      });

      // ─────────────────────────────────────────────────────────────
      // ACCOUNTING DOUBLE ENTRIES (recorded at processing time only)
      // ─────────────────────────────────────────────────────────────
      try {
        const totalReturnAmount = parseFloat(returnRecord.Total_Amount || 0);

        // Look up all account IDs we need
        const AR_AccountId = await findAccountByNameAndGroup(
          "Accounts Receivable (Debtors)",
          "Assets",
          companyId,
          Branch_idBranch,
          connection,
        );
        const Sales_AccountId = await findAccountByNameAndGroup(
          "Sales Revenue",
          "Income",
          companyId,
          Branch_idBranch,
          connection,
        );

        const returnDescription = `Customer Return #${idCustomer_Return} processed`;

        // ── ENTRIES 1 & 2 (both return AND damage types) ──────────
        // Reverse the revenue originally recorded on the invoice sale
        // Dr Sales Revenue   (reduce income — revenue is reversed)
        // Cr Accounts Receivable (reduce what customer owes)
        if (Sales_AccountId && totalReturnAmount > 0) {
          await creditDebitLogHelper({
            accountType: "Chartered Account",
            group: "Income",
            amount: totalReturnAmount,
            description: `Sales Revenue reversal – ${returnDescription}`,
            type: "Customer Return",
            accountId: Sales_AccountId,
            branchId: Branch_idBranch,
            userId: User_idUser,
            companyId,
            transactionType: "debit", // Debit on Income → decreases revenue
            connection,
          });
        }

        if (AR_AccountId && totalReturnAmount > 0) {
          await creditDebitLogHelper({
            accountType: "Chartered Account",
            group: "Assets",
            amount: totalReturnAmount,
            description: `AR reduction (credit note) – ${returnDescription}`,
            type: "Customer Return",
            accountId: AR_AccountId,
            branchId: Branch_idBranch,
            userId: User_idUser,
            companyId,
            transactionType: "credit", // Credit on Assets → decreases AR
            connection,
          });
        }

        if (returnOnlyItems.length > 0) {
          // ── ENTRIES 3 & 4 — Stock Restoration (return items only) ──
          // Items back in sellable stock — restore at cost
          // Dr Inventory    (assets increase)
          // Cr COGS         (reverse the expense originally on sale)

          let totalCOGSCost = 0;
          for (const returnItem of returnOnlyItems) {
            const [itemData] = await new Promise((res, rej) => {
              connection.query(
                "SELECT idItem, Cost, Type FROM item WHERE idItem = ?",
                [returnItem.Item_idItem],
                (err, results) => (err ? rej(err) : res(results)),
              );
            });
            if (itemData && itemData.Type === "1") {
              totalCOGSCost +=
                parseFloat(itemData.Cost || 0) *
                parseFloat(returnItem.Qty || 0);
            }
          }
          totalCOGSCost = Math.round(totalCOGSCost * 100) / 100;

          if (totalCOGSCost > 0) {
            const Inventory_AccountId = await findAccountByNameAndGroup(
              "Inventory",
              "Assets",
              companyId,
              Branch_idBranch,
              connection,
            );
            const Cogs_AccountId = await findAccountByNameAndGroup(
              "Cost of Goods Sold (COGS)",
              "Expenses",
              companyId,
              Branch_idBranch,
              connection,
            );

            if (Inventory_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: totalCOGSCost,
                description: `Inventory restored – ${returnDescription}`,
                type: "Customer Return",
                accountId: Inventory_AccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit",
                connection,
              });
            }

            if (Cogs_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Expenses",
                amount: totalCOGSCost,
                description: `COGS reversal – ${returnDescription}`,
                type: "Customer Return",
                accountId: Cogs_AccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "credit",
                connection,
              });
            }
          }
        }

        if (damageItems.length > 0) {
          // ── ENTRIES 3 & 4 — Damage Loss (damage items only) ────────
          // Items are destroyed / unsaleable — record as a business loss
          // Dr General Expenses  (loss on damaged goods)
          // Cr Sales Revenue     (offset entry)

          const damageTotal = damageItems.reduce((s, i) => s + parseFloat(i.Total || 0), 0);

          const GeneralExpenses_AccountId = await findAccountByNameAndGroup(
            "General Expenses",
            "Expenses",
            companyId,
            Branch_idBranch,
            connection,
          );

          if (GeneralExpenses_AccountId && damageTotal > 0) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: damageTotal,
              description: `Loss on damaged goods returned – ${returnDescription}`,
              type: "Customer Return - Damage",
              accountId: GeneralExpenses_AccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "debit",
              connection,
            });
          }

          if (Sales_AccountId && damageTotal > 0) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Income",
              amount: damageTotal,
              description: `Damage offset entry – ${returnDescription}`,
              type: "Customer Return - Damage",
              accountId: Sales_AccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "credit",
              connection,
            });
          }
        }

        console.log(
          `[CUSTOMER-RETURN] ✅ Accounting entries recorded for Return #${idCustomer_Return} (return items: ${returnOnlyItems.length}, damage items: ${damageItems.length})`,
        );
      } catch (accErr) {
        // Accounting errors must NOT roll back the stock / credit-log changes
        console.error(
          `[CUSTOMER-RETURN] ⚠️ Accounting double-entry failed for Return #${idCustomer_Return}:`,
          accErr.message,
        );
      }
      // ─────────────────────────────────────────────────────────────

      if (customerId && customerId > 0) {
        await customerLogDbService.recalculateCustomerCreditLogs(customerId, connection);
      }

      // Commit Transaction
      await new Promise((resolve, reject) => {
        connection.commit((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return { message: "Customer Return Processed successfully" };
    } catch (error) {
      // Rollback Transaction
      await new Promise((resolve, reject) => {
        connection.rollback(() => {
          console.error("LOG: Transaction failed, rolling back. Error:", error);
          resolve(); // Resolve to propagate the original error
        });
      });
      throw error;
    }
  } finally {
    // Release Connection
    if (connection) connection.release();
  }
};

const unprocessCustomerReturnTransaction = async (
  idCustomer_Return,
  Branch_idBranch,
  User_idUser
) => {
  // 1. Get Connection from Pool
  const connection = await new Promise((resolve, reject) => {
    db.getConnection((err, conn) => {
      if (err) reject(err);
      else resolve(conn);
    });
  });

  try {
    // 2. Begin Transaction
    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    try {
      // 1. Validate Status
      console.log("LOG: Validating Status for Unprocess ID:", idCustomer_Return);
      const checkStatusQuery =
        "SELECT * FROM customer_return WHERE idCustomer_Return = ? FOR UPDATE";
      const [returnRecord] = await new Promise((res, rej) => {
        connection.query(
          checkStatusQuery,
          [idCustomer_Return],
          (err, results) => {
            if (err) rej(err);
            else res(results);
          }
        );
      });

      if (!returnRecord) {
        throw new Error("Customer Return record not found");
      }

      if (returnRecord.Status === 0) {
        throw new Error("Customer Return is not processed yet");
      }

      const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
      const customerId = returnRecord.Customer_idCustomer;

      // 2. Fetch Customer Items
      const itemsQuery =
        "SELECT * FROM customer_return_has_item WHERE Customer_Return_idCustomer_Return = ?";
      const items = await new Promise((res, rej) => {
        connection.query(itemsQuery, [idCustomer_Return], (err, results) => {
          if (err) rej(err);
          else res(results);
        });
      });

      const Header_Return_Type = returnRecord.Return_Type || "return";
      const itemsWithType = items.map((item) => ({
        ...item,
        _effectiveType: item.Item_Return_Type || Header_Return_Type,
      }));

      // 3. Revert Inventory & Stock Cards (per-item type)
      for (const returnItem of itemsWithType) {
        const itemEffectiveType = returnItem._effectiveType;
        const itemQuery = "SELECT * FROM item WHERE idItem = ?";
        const [item] = await new Promise((res, rej) => {
          connection.query(itemQuery, [returnItem.Item_idItem], (err, results) => {
            if (err) rej(err);
            else res(results);
          });
        });

        if (!item) continue;

        if (itemEffectiveType === "return") {
          // Revert Item Qty (Decrease)
          const newQty = parseFloat(item.Qty) - parseFloat(returnItem.Qty);
          const updateItemQuery = "UPDATE item SET Qty=? WHERE idItem=?";
          await new Promise((res, rej) => {
            connection.query(updateItemQuery, [newQty, item.idItem], (err, result) => {
              if (err) rej(err);
              else res(result);
            });
          });

          // Log Master History (with negative quantityChange)
          await productHistoryLogHelper({
            productId: item.idItem,
            variationId: returnItem.Variation_Id || null,
            quantityChange: -parseFloat(returnItem.Qty),
            oldQty: parseFloat(item.Qty),
            newQty: newQty,
            type: "Customer Return Unprocessed",
            description: `Stock deducted due to unprocessed Customer Return ID: ${idCustomer_Return}`,
            branchId: Branch_idBranch,
            companyId,
            userId: User_idUser,
            referenceId: idCustomer_Return,
            connection,
          });

          // Insert Stock Card (OUT_Stock = Qty)
          const stockCardQuery = `INSERT INTO stock_card (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          await new Promise((res, rej) => {
            connection.query(
              stockCardQuery,
              [
                getColomboDateTime(),
                item.idItem,
                item.Description,
                "CUSTOMER RETURN UNPROCESSED",
                idCustomer_Return,
                returnItem.Cost,
                item.Real_Cost,
                item.Rate,
                0, // IN_Stock
                parseFloat(returnItem.Qty), // OUT_Stock
                newQty, // SIH
                Branch_idBranch,
                returnItem.Variation_Id || null,
              ],
              (err, result) => {
                if (err) rej(err);
                else res(result);
              }
            );
          });

          // Variation Update
          if (returnItem.Variation_Id) {
            const varQuery = "SELECT * FROM item_variations WHERE id = ?";
            const [variation] = await new Promise((resolve, reject) => {
              connection.query(varQuery, [returnItem.Variation_Id], (err, result) => {
                if (err) reject(err);
                else resolve(result);
              });
            });

            if (variation) {
              const currentVarQty = parseFloat(variation.qty || 0);
              const totalVarQty = currentVarQty - parseFloat(returnItem.Qty);

              const updateVarQuery = "UPDATE item_variations SET qty = ? WHERE id = ?";
              await new Promise((res, rej) => {
                connection.query(updateVarQuery, [totalVarQty, returnItem.Variation_Id], (err, result) => {
                  if (err) rej(err);
                  else res(result);
                });
              });

              // Log Variation History
              await productHistoryLogHelper({
                productId: item.idItem,
                variationId: returnItem.Variation_Id,
                quantityChange: -parseFloat(returnItem.Qty),
                oldQty: currentVarQty,
                newQty: totalVarQty,
                type: "Customer Return Unprocessed (Variation)",
                description: `Variation stock deducted due to unprocessed Customer Return ID: ${idCustomer_Return}`,
                branchId: Branch_idBranch,
                companyId,
                userId: User_idUser,
                referenceId: idCustomer_Return,
                connection,
              });
            }
          }

          // Revert Serials (Set Qty back to 0)
          if (item.Item_Has_Serial === 1) {
            const serialsQuery =
              "SELECT cr.*, i.Serial_No FROM customer_return_has_item_serial_no cr INNER JOIN item_has_serial_no i ON cr.Item_Serial_No_id = i.ID WHERE Customer_Return_idCustomer_Return = ?";
            const serials = await new Promise((resolve, reject) => {
              connection.query(serialsQuery, [idCustomer_Return], (err, result) => {
                if (err) reject(err);
                else resolve(result);
              });
            });

            for (const s of serials) {
              const updateSerialQuery = "UPDATE item_has_serial_no SET Qty = 0 WHERE Serial_No = ?";
              await new Promise((resolve, reject) => {
                connection.query(updateSerialQuery, [s.Serial_No], (err, result) => {
                  if (err) reject(err);
                  else resolve(result);
                });
              });
            }
          }
        } else if (itemEffectiveType === "damage") {
          // Revert Damage items (Do not affect stock since process didn't, but insert stock card showing unprocess)
          const stockCardQuery = `INSERT INTO stock_card (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          await new Promise((res, rej) => {
            connection.query(
              stockCardQuery,
              [
                getColomboDateTime(),
                item.idItem,
                item.Description,
                "CUSTOMER RETURN UNPROCESSED - DAMAGE",
                idCustomer_Return,
                returnItem.Cost,
                item.Real_Cost,
                item.Rate,
                0,
                0,
                item.Qty,
                Branch_idBranch,
                returnItem.Variation_Id || null,
              ],
              (err, result) => {
                if (err) rej(err);
                else res(result);
              }
            );
          });
        }
      }

      // Revert Damage Note if it exists
      const damageNoteReasonPattern = `Customer Return Damage (Return #${idCustomer_Return})%`;
      const selectDamageNotes = "SELECT idDamage_Note FROM damage_note WHERE Reason LIKE ? AND Branch_idBranch = ?";
      const damageNotes = await new Promise((resolve, reject) => {
        connection.query(selectDamageNotes, [damageNoteReasonPattern, Branch_idBranch], (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      for (const dn of damageNotes) {
        // Delete items first
        const deleteDNItems = "DELETE FROM damage_note_has_item WHERE Damage_Note_idDamage_Note = ?";
        await new Promise((resolve, reject) => {
          connection.query(deleteDNItems, [dn.idDamage_Note], (err) => (err ? reject(err) : resolve()));
        });
        // Delete note
        const deleteDN = "DELETE FROM damage_note WHERE idDamage_Note = ?";
        await new Promise((resolve, reject) => {
          connection.query(deleteDN, [dn.idDamage_Note], (err) => (err ? reject(err) : resolve()));
        });
      }

      // 4. Revert credit application & overpayment & customer credit logs
      // Find all customer credit logs associated with this return
      const fetchLogsQuery = `
        SELECT * FROM customer_credit_log 
        WHERE Customer_idCustomer = ? AND Branch_idBranch = ?
          AND (
            (Type = 'CUSTOMER RETURN' AND Type_Id = ?)
            OR (Type = 'CUSTOMER RETURN - OVERPAYMENT' AND Type_Id = ?)
            OR (Type = 'CUSTOMER RETURN - INVOICE CREDIT' AND (Payment_Method LIKE ? OR Note LIKE ?))
          )
      `;
      const returnIdStr = `Return #${idCustomer_Return}`;
      const returnNotePattern = `%Return #${idCustomer_Return}%`;
      const matchedLogs = await new Promise((resolve, reject) => {
        connection.query(
          fetchLogsQuery,
          [customerId, Branch_idBranch, idCustomer_Return, idCustomer_Return, `%${returnIdStr}%`, returnNotePattern],
          (err, results) => (err ? reject(err) : resolve(results))
        );
      });

      for (const log of matchedLogs) {
        if (log.Type === "CUSTOMER RETURN - INVOICE CREDIT") {
          // Revert invoice balances
          const invoiceId = log.Type_Id;
          const debitAmount = parseFloat(log.Debit || 0);

          const [invoice] = await new Promise((resolve, reject) => {
            connection.query("SELECT * FROM invoice WHERE idInvoice = ?", [invoiceId], (err, results) => (err ? reject(err) : resolve(results)));
          });

          if (invoice) {
            const invoiceTotal = (parseFloat(invoice.Net_Amount) || 0) + (parseFloat(invoice.Interest_Amount) || 0);
            const newPaidAmount    = Math.max(0, parseFloat(invoice.Paid_Amount || 0) - debitAmount);
            const newBalanceAmount = Math.max(0, invoiceTotal - newPaidAmount);
            const newCreditBalance = newBalanceAmount;

            const existingNote = invoice.Note || "";
            const unprocessNote = `[UNPROCESSED RETURN #${idCustomer_Return}] Credit reversed: LKR ${debitAmount.toFixed(2)} on ${getColomboDateTime()}`;
            const updatedNote  = existingNote ? `${existingNote}\n${unprocessNote}` : unprocessNote;

            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE invoice SET Credit_Balance = ?, Balance_Amount = ?, Paid_Amount = ?, Note = ? WHERE idInvoice = ?",
                [newCreditBalance, newBalanceAmount, newPaidAmount, updatedNote, invoiceId],
                (err, result) => (err ? reject(err) : resolve(result))
              );
            });
          }
        } else if (log.Type === "CUSTOMER RETURN - OVERPAYMENT") {
          // Revert overpayment balance
          const debitAmount = parseFloat(log.Debit || 0);
          await customerDbService.updateCustomerOverpayment(customerId, -debitAmount, connection);
        }
        
        // Delete log entry
        await new Promise((resolve, reject) => {
          connection.query(
            "DELETE FROM customer_credit_log WHERE idCustomer_Credit_Log = ?",
            [log.idCustomer_Credit_Log],
            (err) => (err ? reject(err) : resolve())
          );
        });
      }

      // Delete linked invoice if return was converted to an invoice (Option A)
      const linkedInvoiceId = returnRecord.Invoice_idInvoice;
      if (linkedInvoiceId) {
        console.log(`[UNPROCESS-RETURN] Linked Invoice ID found: ${linkedInvoiceId}. Deleting linked invoice and line items.`);

        // Delete invoice line items
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM invoice_has_item WHERE Invoice_idInvoice = ?", [linkedInvoiceId], (err) => (err ? reject(err) : resolve()));
        });

        // Delete invoice installment logs if present
        try {
          await new Promise((resolve, reject) => {
            connection.query("DELETE FROM installment_payment WHERE Invoice_idInvoice = ?", [linkedInvoiceId], (err) => (err ? reject(err) : resolve()));
          });
        } catch (instErr) {
          console.warn("[UNPROCESS-RETURN] Installment deletion note:", instErr.message);
        }

        // Delete customer credit logs for this invoice
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM customer_credit_log WHERE Type_Id = ? AND Type IN ('INVOICE', 'PAYMENT')", [linkedInvoiceId], (err) => (err ? reject(err) : resolve()));
        });

        // Delete the linked invoice record
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM invoice WHERE idInvoice = ?", [linkedInvoiceId], (err) => (err ? reject(err) : resolve()));
        });
      }

      // Recalculate customer credit logs
      if (customerId && customerId > 0) {
        await customerLogDbService.recalculateCustomerCreditLogs(customerId, connection);
      }

      // 5. Update Customer Return Status to 0 and clear Invoice_idInvoice
      const updateStatusQuery = "UPDATE customer_return SET Status=?, Invoice_idInvoice=NULL WHERE idCustomer_Return=?";
      await new Promise((res, rej) => {
        connection.query(updateStatusQuery, [0, idCustomer_Return], (err, result) => (err ? rej(err) : res(result)));
      });

      // 6. User Log
      const userLogQuery =
        "INSERT INTO user_log (User_idUser, Date_Time, Task_Type, Task_ID, Task_Category, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?)";
      await new Promise((res, rej) => {
        connection.query(
          userLogQuery,
          [
            User_idUser,
            getColomboDateTime(),
            "Customer Return",
            idCustomer_Return,
            "unprocess",
            Branch_idBranch,
          ],
          (err, result) => (err ? rej(err) : res(result))
        );
      });

      // 7. Revert Accounting Double Entries
      try {
        const totalReturnAmount = parseFloat(returnRecord.Total_Amount || 0);
        const AR_AccountId = await findAccountByNameAndGroup("Accounts Receivable (Debtors)", "Assets", companyId, Branch_idBranch, connection);
        const Sales_AccountId = await findAccountByNameAndGroup("Sales Revenue", "Income", companyId, Branch_idBranch, connection);

        const returnDescription = `Customer Return #${idCustomer_Return} unprocessed`;

        // Reverse Dr Sales Revenue, Cr Accounts Receivable
        if (Sales_AccountId && totalReturnAmount > 0) {
          await creditDebitLogHelper({
            accountType: "Chartered Account",
            group: "Income",
            amount: totalReturnAmount,
            description: `Reversal of Sales Revenue reversal – ${returnDescription}`,
            type: "Customer Return Unprocessed",
            accountId: Sales_AccountId,
            branchId: Branch_idBranch,
            userId: User_idUser,
            companyId,
            transactionType: "credit", // Credit on Income → increases revenue back
            connection,
          });
        }

        if (AR_AccountId && totalReturnAmount > 0) {
          await creditDebitLogHelper({
            accountType: "Chartered Account",
            group: "Assets",
            amount: totalReturnAmount,
            description: `Reversal of AR reduction – ${returnDescription}`,
            type: "Customer Return Unprocessed",
            accountId: AR_AccountId,
            branchId: Branch_idBranch,
            userId: User_idUser,
            companyId,
            transactionType: "debit", // Debit on Assets → increases AR back
            connection,
          });
        }

        const returnOnlyItems = itemsWithType.filter((i) => i._effectiveType === "return");
        if (returnOnlyItems.length > 0) {
          let totalCOGSCost = 0;
          for (const returnItem of returnOnlyItems) {
            const [itemData] = await new Promise((res, rej) => {
              connection.query("SELECT idItem, Cost, Type FROM item WHERE idItem = ?", [returnItem.Item_idItem], (err, results) => (err ? rej(err) : res(results)));
            });
            if (itemData && itemData.Type === "1") {
              totalCOGSCost += parseFloat(itemData.Cost || 0) * parseFloat(returnItem.Qty || 0);
            }
          }
          totalCOGSCost = Math.round(totalCOGSCost * 100) / 100;

          if (totalCOGSCost > 0) {
            const Inventory_AccountId = await findAccountByNameAndGroup("Inventory", "Assets", companyId, Branch_idBranch, connection);
            const Cogs_AccountId = await findAccountByNameAndGroup("Cost of Goods Sold (COGS)", "Expenses", companyId, Branch_idBranch, connection);

            if (Inventory_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: totalCOGSCost,
                description: `Inventory reversal – ${returnDescription}`,
                type: "Customer Return Unprocessed",
                accountId: Inventory_AccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "credit", // Credit on Assets -> decreases inventory
                connection,
              });
            }

            if (Cogs_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Expenses",
                amount: totalCOGSCost,
                description: `COGS reversal – ${returnDescription}`,
                type: "Customer Return Unprocessed",
                accountId: Cogs_AccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit", // Debit on Expenses -> increases COGS back
                connection,
              });
            }
          }
        }

        const damageItems = itemsWithType.filter((i) => i._effectiveType === "damage");
        if (damageItems.length > 0) {
          const damageTotal = damageItems.reduce((s, i) => s + parseFloat(i.Total || 0), 0);
          const GeneralExpenses_AccountId = await findAccountByNameAndGroup("General Expenses", "Expenses", companyId, Branch_idBranch, connection);

          if (GeneralExpenses_AccountId && damageTotal > 0) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: damageTotal,
              description: `Reversal of loss on damaged goods – ${returnDescription}`,
              type: "Customer Return Unprocessed - Damage",
              accountId: GeneralExpenses_AccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "credit", // Credit on Expenses -> decreases expenses
              connection,
            });
          }

          if (Sales_AccountId && damageTotal > 0) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Income",
              amount: damageTotal,
              description: `Reversal of damage offset entry – ${returnDescription}`,
              type: "Customer Return Unprocessed - Damage",
              accountId: Sales_AccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "debit", // Debit on Income -> decreases revenue
              connection,
            });
          }
        }
      } catch (accErr) {
        console.error("Accounting reversal double-entry failed:", accErr.message);
      }

      // Commit Transaction
      await new Promise((resolve, reject) => {
        connection.commit((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return { message: "Customer Return Unprocessed successfully" };
    } catch (error) {
      await new Promise((resolve) => {
        connection.rollback(() => {
          console.error("Transaction failed, rolling back. Error:", error);
          resolve();
        });
      });
      throw error;
    }
  } finally {
    if (connection) connection.release();
  }
};

const fetchSoldSerials = async (Item_idItem, Branch_idBranch) => {
  try {
    let query = "SELECT * FROM item_has_serial_no WHERE Qty = 0 AND Item_idItem = ?";
    const params = [Item_idItem];
    if (Branch_idBranch) {
      query += " AND Branch_idBranch = ?";
      params.push(Branch_idBranch);
    }
    return new Promise((resolve, reject) => {
      db.query(query, params, (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const checkReturnSerial = async (serial_numbers) => {
  try {
    const query =
      "SELECT Serial_No FROM item_has_serial_no WHERE Serial_No IN (?) AND Qty = 0";
    return new Promise((resolve, reject) => {
      db.query(query, [serial_numbers], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const getSerials = async (serial_numbers) => {
  try {
    const selectQuery = "SELECT * FROM item_has_serial_no WHERE Serial_No = ?";
    return new Promise((resolve, reject) => {
      db.query(selectQuery, [serial_numbers], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results[0]);
        }
      });
    });
  } catch (error) {
    throw error;
  }
};
const deleteCustomerRetrunSerials = async (idCustomer_Return) => {
  try {
    const selectQuery =
      "DELETE FROM customer_return_has_item_serial_no WHERE Customer_Return_idCustomer_Return = ?";
    return new Promise((resolve, reject) => {
      db.query(selectQuery, [idCustomer_Return], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const updateSerials = (serial_number) => {
  try {
    const updateQuery =
      "UPDATE item_has_serial_no SET Qty = 1 WHERE Serial_No = ?";
    const selectQuery = "SELECT * FROM item_has_serial_no WHERE Serial_No = ?";

    return new Promise((resolve, reject) => {
      db.query(updateQuery, [serial_number], (err, result) => {
        if (err) {
          reject(err);
        } else {
          // After updating, select the updated row
          db.query(selectQuery, [serial_number], (err, updatedResult) => {
            if (err) {
              reject(err);
            } else {
              if (updatedResult.length > 0) {
                resolve(updatedResult[0]); // Return the first item from the array
              } else {
                resolve(null); // No row found with the provided serial number
              }
            }
          });
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const insertCustomerReturnSerials = (
  Customer_Return_idCustomer_Return,
  Item_Serial_No_id,
) => {
  try {
    const query =
      "INSERT INTO customer_return_has_item_serial_no (Customer_Return_idCustomer_Return, Item_Serial_No_id) VALUES (?,?)";
    return new Promise((resolve, reject) => {
      db.query(
        query,
        [Customer_Return_idCustomer_Return, Item_Serial_No_id],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        },
      );
    });
  } catch (error) {
    throw error;
  }
};

const fetchSerialNoForItem = (Customer_Return_idCustomer_Return) => {
  const query =
    "SELECT cr.*, i.Serial_No FROM customer_return_has_item_serial_no cr INNER JOIN item_has_serial_no i ON cr.Item_Serial_No_id = i.ID  WHERE Customer_Return_idCustomer_Return = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_Return_idCustomer_Return], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteCustomerReturn = async (idCustomer_Return) => {
  return new Promise((resolve, reject) => {
    // First delete serial records (child of items)
    const deleteSerials =
      "DELETE FROM customer_return_has_item_serial_no WHERE Customer_Return_idCustomer_Return = ?";
    db.query(deleteSerials, [idCustomer_Return], (err) => {
      if (err) return reject(err);
      // Then delete line items
      const deleteLineItems =
        "DELETE FROM customer_return_has_item WHERE Customer_Return_idCustomer_Return = ?";
      db.query(deleteLineItems, [idCustomer_Return], (err2) => {
        if (err2) return reject(err2);
        // Finally delete the return header
        const deleteHeader =
          "DELETE FROM customer_return WHERE idCustomer_Return = ?";
        db.query(deleteHeader, [idCustomer_Return], (err3, results) => {
          if (err3) return reject(err3);
          resolve(results);
        });
      });
    });
  });
};

const lookupBarcodeForCustomerReturn = async (barcode, branchId, customerId = null) => {
  const trimmed = (barcode || "").trim();
  if (!trimmed) return null;

  // 1. Check if barcode is an Invoice Number in this branch
  const invQuery = `
    SELECT inv.*, COALESCE(c.displayName, CONCAT(c.First_Name, ' ', COALESCE(c.lastName, ''))) AS Customer_Name, c.Tp AS Customer_Phone 
    FROM invoice inv 
    LEFT JOIN customer c ON inv.Customer_idCustomer = c.idCustomer 
    WHERE (inv.Invoice_Number = ? OR inv.Invoice_Number LIKE ?) AND inv.Branch_idBranch = ?
    LIMIT 1
  `;
  const invoiceMatch = await new Promise((resolve, reject) => {
    db.query(invQuery, [trimmed, `%${trimmed}`, branchId], (err, res) => {
      if (err) return reject(err);
      resolve(res && res.length > 0 ? JSON.parse(JSON.stringify(res[0])) : null);
    });
  });

  if (invoiceMatch) {
    const items = await fetchInvoiceItemsForReturn(invoiceMatch.idInvoice);
    return {
      type: "invoice",
      invoice: invoiceMatch,
      items,
    };
  }

  // 2. Check if barcode is a Serial Number (sold or in stock)
  const serialQuery = `
    SELECT sn.*, ihi.Invoice_idInvoice, inv.Invoice_Number, inv.Date as Invoice_Date, inv.Customer_idCustomer,
           COALESCE(c.displayName, CONCAT(c.First_Name, ' ', COALESCE(c.lastName, ''))) AS Customer_Name,
           i.idItem, i.Description as Item_Name, i.Item_Code, i.Cost, ihi.Rate as Invoiced_Rate, ihi.Qty as Invoiced_Qty
    FROM item_has_serial_no sn
    LEFT JOIN invoice_has_item ihi ON (ihi.Serial_No_Id = sn.ID OR (ihi.Item_idItem = sn.Item_idItem AND ihi.Branch_idBranch = ?))
    LEFT JOIN invoice inv ON ihi.Invoice_idInvoice = inv.idInvoice
    LEFT JOIN customer c ON inv.Customer_idCustomer = c.idCustomer
    JOIN item i ON sn.Item_idItem = i.idItem
    WHERE sn.Serial_No = ? AND sn.Branch_idBranch = ?
    ORDER BY inv.idInvoice DESC
    LIMIT 10
  `;
  const serialMatches = await new Promise((resolve, reject) => {
    db.query(serialQuery, [branchId, trimmed, branchId], (err, res) => {
      if (err) return reject(err);
      resolve(res && res.length > 0 ? JSON.parse(JSON.stringify(res)) : []);
    });
  });

  if (serialMatches.length > 0 && serialMatches[0].Invoice_idInvoice) {
    const firstMatch = serialMatches[0];
    const invoices = serialMatches
      .filter((m) => m.Invoice_idInvoice)
      .map((m) => ({
        idInvoice: m.Invoice_idInvoice,
        Invoice_Number: m.Invoice_Number,
        Date: m.Invoice_Date,
        Customer_idCustomer: m.Customer_idCustomer,
        Customer_Name: m.Customer_Name,
        Sold_Qty: m.Invoiced_Qty || 1,
        Rate: m.Invoiced_Rate || m.Cost,
        Item_idItem: m.idItem,
        Item_Name: m.Item_Name,
        Item_Code: m.Item_Code,
      }));

    return {
      type: "serial",
      serial_no: trimmed,
      product: {
        idItem: firstMatch.idItem,
        Description: firstMatch.Item_Name,
        Item_Code: firstMatch.Item_Code,
        Cost: firstMatch.Cost,
      },
      invoices,
    };
  }

  // 3. Check if barcode matches a product (barcode, extra barcodes, variation barcode/sku, or Item_Code)
  const productQuery = `
    SELECT DISTINCT i.*,
           (SELECT GROUP_CONCAT(pb.barcode) FROM product_barcodes pb WHERE pb.item_id = i.idItem) as extra_barcodes,
           iv.id as matched_variation_id, iv.description as variation_description, iv.product_sku as variation_sku, iv.barcode as variation_barcode, iv.rate as variation_rate, iv.cost as variation_cost
    FROM item i
    LEFT JOIN product_barcodes pb ON pb.item_id = i.idItem
    LEFT JOIN item_variations iv ON iv.item_id = i.idItem
    WHERE i.Branch_idBranch = ?
      AND (
        i.barcode = ? 
        OR pb.barcode = ? 
        OR iv.barcode = ? 
        OR iv.product_sku = ? 
        OR i.Item_Code = ?
      )
    LIMIT 1
  `;
  const productMatch = await new Promise((resolve, reject) => {
    db.query(productQuery, [branchId, trimmed, trimmed, trimmed, trimmed, trimmed], (err, res) => {
      if (err) return reject(err);
      resolve(res && res.length > 0 ? JSON.parse(JSON.stringify(res[0])) : null);
    });
  });

  if (productMatch) {
    // Find invoices where this product (and variation if applicable) was sold in this branch
    let invParams = [productMatch.idItem, branchId];
    let customerFilter = "";
    if (customerId && parseInt(customerId) > 0) {
      customerFilter = "AND inv.Customer_idCustomer = ?";
      invParams.push(parseInt(customerId));
    }

    const soldInvoicesQuery = `
      SELECT DISTINCT inv.idInvoice, inv.Invoice_Number, inv.Date, inv.Customer_idCustomer,
             COALESCE(c.displayName, CONCAT(c.First_Name, ' ', COALESCE(c.lastName, ''))) AS Customer_Name,
             c.Tp AS Customer_Phone,
             ihi.Qty AS Sold_Qty, ihi.Rate, ihi.Cost, ihi.Total_Amount, ihi.Variation_Id,
             iv.description AS variation_description, iv.product_sku AS variation_sku
      FROM invoice_has_item ihi
      JOIN invoice inv ON ihi.Invoice_idInvoice = inv.idInvoice
      LEFT JOIN customer c ON inv.Customer_idCustomer = c.idCustomer
      LEFT JOIN item_variations iv ON ihi.Variation_Id = iv.id
      WHERE ihi.Item_idItem = ?
        AND inv.Branch_idBranch = ?
        ${customerFilter}
      ORDER BY inv.idInvoice DESC
      LIMIT 25
    `;

    const invoices = await new Promise((resolve, reject) => {
      db.query(soldInvoicesQuery, invParams, (err, res) => {
        if (err) return reject(err);
        resolve(res && res.length > 0 ? JSON.parse(JSON.stringify(res)) : []);
      });
    });

    // Also fetch all variations for this product if any
    let variations = [];
    try {
      variations = await new Promise((resolve, reject) => {
        db.query("SELECT * FROM item_variations WHERE item_id = ?", [productMatch.idItem], (err, res) => {
          if (err) return reject(err);
          resolve(res || []);
        });
      });
    } catch (e) {
      console.error("Error fetching variations:", e);
    }

    return {
      type: "product",
      product: {
        ...productMatch,
        variations,
      },
      matched_variation: productMatch.matched_variation_id ? {
        id: productMatch.matched_variation_id,
        description: productMatch.variation_description,
        sku: productMatch.variation_sku,
        barcode: productMatch.variation_barcode,
        rate: productMatch.variation_rate,
        cost: productMatch.variation_cost,
      } : null,
      invoices,
    };
  }

  return null;
};

module.exports = {
  createCustomerReturn,
  insertItems,
  fetchCustomerItems,
  fetchItems,
  fetchCustomerReturn,
  deleteItems,
  updateCustomerReturn,
  processCustomerReturn,
  processCustomerReturnTransaction,
  unprocessCustomerReturnTransaction,
  checkReturnSerial,
  updateSerials,
  insertCustomerReturnSerials,
  fetchSerialNoForItem,
  getSerials,
  deleteCustomerRetrunSerials,
  fetchCustomerInvoicesForReturn,
  fetchInvoiceItemsForReturn,
  fetchCustomerOutstandingInvoices,
  deleteCustomerReturn,
  fetchSoldSerials,
  lookupBarcodeForCustomerReturn,
};
