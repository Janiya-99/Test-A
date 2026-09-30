const db = require("../db/db");
const customerLogDbService = require("../services/customerCreditLogDBService");

const getAllCheques = (req, res) => {
  const branchId = req.query.branchId;

  if (!branchId) {
    return res.status(400).json({ message: "Branch ID is required" });
  }

  const customerQuery = `
    SELECT 
      'Received' AS type,
      ccl.*,
      ccl.Cheque_Date AS date,
      ccl.Cheque_Name AS name,
      ccl.Cheque_No AS chequeNumber,
      ccl.Debit AS amount,
      ccl.Cheque_Status AS status,
      ccl.Note AS Note,
      'customer' AS source,
      ccl.idCustomer_Credit_Log AS id,
      CONCAT('customer-', ccl.idCustomer_Credit_Log) AS uniqueId,
      ccl.Cheque_Type AS chequeType,
      cu.displayName AS chequeHolder
    FROM customer_credit_log ccl
    JOIN customer cu ON ccl.Customer_idCustomer = cu.idCustomer
    WHERE ccl.Cheque_No IS NOT NULL AND ccl.Cheque_No != ''
    AND ccl.Branch_idBranch = ?
    AND ccl.Type != 'INVOICE'
  `;

  const supplierQuery = `
    SELECT 
      'Issued' AS type,
      sl.*,
      sl.Cheque_Date AS date,
      sl.Cheque_Name AS name,
      sl.Cheque_No AS chequeNumber,
      sl.Debit AS amount,
      sl.Cheque_Status AS status,
      sl.Note AS Note,
      'supplier' AS source,
      sl.idSupplier_Log AS id,
      CONCAT('supplier-', sl.idSupplier_Log) AS uniqueId,
      sl.Cheque_Type AS chequeType,
      s.Company_Name AS chequeHolder
    FROM supplier_log sl
    JOIN supplier s ON sl.Supplier_idSupplier = s.idSupplier
    WHERE sl.Cheque_No IS NOT NULL AND sl.Cheque_No != ''
    AND sl.Branch_idBranch = ?
  `;

  const invoiceQuery = `
    SELECT 
      'Received' AS type,
      i.idInvoice,
      i.Date AS Date_Time,
      'Invoice' AS Type,
      i.idInvoice AS Type_Id,
      i.Cheque_Date AS date,
      i.Cheque_Name AS name,
      i.Cheque_No AS chequeNumber,
      i.Paid_Amount AS amount,
      COALESCE(ccl.Cheque_Status, 0) AS status,
      ccl.Note AS Note,
      'invoice' AS source,
      i.idInvoice AS id,
      CONCAT('invoice-', i.idInvoice) AS uniqueId,
      i.Cheque_Type AS chequeType,
      c.displayName AS chequeHolder
    FROM invoice i
    JOIN customer c ON i.Customer_idCustomer = c.idCustomer
    LEFT JOIN customer_credit_log ccl ON ccl.Type = 'INVOICE' AND ccl.Type_Id = i.idInvoice
    WHERE i.Payment_Method = 'cheque' 
    AND i.Cheque_No IS NOT NULL 
    AND i.Cheque_No != ''
    AND i.Branch_idBranch = ?
  `;

  const params = [branchId];

  const queries = [
    { sql: customerQuery, params },
    { sql: supplierQuery, params },
    { sql: invoiceQuery, params },
  ];

  Promise.all(
    queries.map(
      ({ sql, params }) =>
        new Promise((resolve, reject) => {
          db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
          });
        }),
    ),
  )
    .then(([customerCheques, supplierCheques, invoiceCheques]) => {
      const allCheques = [
        ...customerCheques,
        ...supplierCheques,
        ...invoiceCheques,
      ];
      allCheques.sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json(allCheques);
    })
    .catch((err) => {
      console.error("Error fetching cheques:", err);
      res.status(500).json({ message: "Error fetching cheques", error: err });
    });
};

const handleInvoiceRejection = (
  id,
  debitAmount,
  ownerId,
  Branch_idBranch,
  res,
) => {
  const debit = parseFloat(debitAmount) || 0;

  // 1. Reverse invoice payment status (Using WHERE Payment_Type != 0 to prevent double-refund)
  const reverseInvoiceQuery = `
    UPDATE invoice 
    SET Payment_Type = 0, 
        Credit_Balance = Credit_Balance + ?, 
        Balance_Amount = Balance_Amount + ?,
        Paid_Amount = Paid_Amount - ? 
    WHERE idInvoice = ? AND (Payment_Type != 0 OR Payment_Type IS NULL)
  `;

  db.query(reverseInvoiceQuery, [debit, debit, debit, id], (revErr, revResult) => {
    if (revErr) {
      console.error("Error reversing invoice status:", revErr);
      return res.status(500).json({
        message: "Cheque rejected, but failed to reverse invoice status.",
      });
    }

    // Check if it was already reversed (idempotency check)
    if (revResult.affectedRows === 0) {
      const checkQuery = "SELECT 1 FROM customer_credit_log WHERE Type = 'Cheque Rejected' AND Type_Id = ?";
      return db.query(checkQuery, [id], (chkErr, chkRes) => {
        if (chkRes && chkRes.length > 0) {
          return res.json({ message: "Cheque already rejected and balance restored." });
        }
        // If not even the log exists, maybe it was a direct reset? Still return success for UX.
        return res.json({ message: "Invoice state was already updated." });
      });
    }

    // 2. Create log entry for cheque rejection (Atomic check using WHERE NOT EXISTS)
    const insertQuery = `
      INSERT INTO customer_credit_log (
        Customer_idCustomer,
        Type, Type_Id, Credit, Debit, Total_Credit_Balance, Date_Time, Note, Branch_idBranch
      )
      SELECT ?, 'Cheque Rejected', ?, ?, 0, 
        IFNULL((SELECT CAST(ccl2.Total_Credit_Balance AS DECIMAL(10,2)) FROM customer_credit_log ccl2 WHERE ccl2.Customer_idCustomer = ? ORDER BY ccl2.idCustomer_Credit_Log DESC LIMIT 1), 0) + ?, 
        NOW(), ?, ?
      FROM DUAL
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_credit_log WHERE Type = 'Cheque Rejected' AND Type_Id = ?
      )
    `;

    db.query(
      insertQuery,
      [
        ownerId,
        id,
        debit,
        ownerId,
        debit,
        "Cheque rejected & amount added back to balance",
        Branch_idBranch,
        id,
      ],
      async (insertErr) => {
        if (insertErr) {
          console.error("Error inserting rejection log:", insertErr);
        } else {
          try {
            await customerLogDbService.recalculateCustomerCreditLogs(ownerId);
          } catch (recErr) {
            console.error("Error recalculating customer credit logs after cheque rejection:", recErr);
          }
        }
        return res.json({
          message: "Cheque rejected. Balance restored and invoice updated.",
        });
      },
    );
  });
};

const handleInvoiceCompletion = (
  id,
  creditAmount,
  ownerId,
  Branch_idBranch,
  res,
) => {
  const credit = parseFloat(creditAmount) || 0;

  // 1. Create log entry for cheque acceptance (Atomic check)
  const insertLogQuery = `
    INSERT INTO customer_credit_log (
      Customer_idCustomer,
      Type, Type_Id, Credit, Debit, Total_Credit_Balance, Date_Time, Note, Branch_idBranch
    )
    SELECT ?, 'Cheque Accepted', ?, 0, ?, 
      IFNULL((SELECT CAST(ccl2.Total_Credit_Balance AS DECIMAL(10,2)) FROM customer_credit_log ccl2 WHERE ccl2.Customer_idCustomer = ? ORDER BY ccl2.idCustomer_Credit_Log DESC LIMIT 1), 0) - ?, 
      NOW(), ?, ?
    FROM DUAL
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_credit_log WHERE Type = 'Cheque Accepted' AND Type_Id = ?
    )
  `;

  db.query(
    insertLogQuery,
    [ownerId, id, 0, ownerId, 0, "Cheque accepted", Branch_idBranch, id],
    async (insertErr, insertRes) => {
      if (insertErr) {
        console.error("Error inserting completion log:", insertErr);
        return res.status(500).json({
          message: "Failed to create payment log for accepted cheque.",
        });
      }

      try {
        await customerLogDbService.recalculateCustomerCreditLogs(ownerId);
      } catch (recErr) {
        console.error("Error recalculating customer credit logs after cheque acceptance:", recErr);
      }

      return res.json({
        message: "Cheque accepted successfully.",
      });
    },
  );
};

const updateChequeStatus = (req, res) => {
  const { source, id } = req.params;
  const { status, note } = req.body;

  let table = "";
  let statusColumn = "Cheque_Status";
  let noteColumn = "Note";
  let idColumn = "";
  let debitColumn = "Debit";
  let customerOrSupplierIdColumn = "";

  if (source === "customer") {
    table = "customer_credit_log";
    idColumn = "idCustomer_Credit_Log";
    customerOrSupplierIdColumn = "Customer_idCustomer";
  } else if (source === "supplier") {
    table = "supplier_log";
    idColumn = "idSupplier_Log";
    customerOrSupplierIdColumn = "Supplier_idSupplier";
  } else if (source === "invoice") {
    // For invoice cheques, update the corresponding customer_credit_log entry
    // where Type='INVOICE' and Type_Id matches invoice id
    const updateQuery = `
      UPDATE customer_credit_log
      SET ${statusColumn} = ?, ${noteColumn} = ?
      WHERE Type = 'INVOICE' AND Type_Id = ? AND Cheque_No IS NOT NULL
      AND (Cheque_Status IS NULL OR Cheque_Status != ?)
    `;

    db.query(updateQuery, [status, note || null, id, status], (err, result) => {
      if (err) {
        console.error("Error updating invoice cheque status:", err);
        return res
          .status(500)
          .json({ message: "Failed to update cheque status" });
      }

      if (result.affectedRows === 0) {
        // Check if it already exists and has the same status (idempotency check)
        const checkExist = "SELECT Cheque_Status FROM customer_credit_log WHERE Type = 'INVOICE' AND Type_Id = ? AND Cheque_No IS NOT NULL";
        return db.query(checkExist, [id], (chkErr, chkRes) => {
          if (chkRes && chkRes.length > 0 && chkRes[0].Cheque_Status == status) {
            return res.json({ message: "Cheque status already processed" });
          }
          
          // Log entry doesn't exist (e.g. fully paid invoice), let's create it
          const fetchInvQuery = "SELECT * FROM invoice WHERE idInvoice = ?";
          db.query(fetchInvQuery, [id], (invErr, invResults) => {
            if (invErr || invResults.length === 0) {
              console.error("Invoice not found for missing log entry:", invErr);
              return res.status(404).json({
                message: "Invoice not found or no status row to update.",
              });
            }

            const inv = invResults[0];
            const insertLogQuery = `
              INSERT INTO customer_credit_log (
                Customer_idCustomer, Date_Time, Type, Type_Id, 
                Credit, Debit, Total_Credit_Balance, 
                Payment_Method, Cheque_Type, Cheque_No, Cheque_Date, Cheque_Name, 
                Cheque_Status, Note, Branch_idBranch
              ) 
              SELECT ?, NOW(), 'INVOICE', ?, 0, 0, 
                (SELECT IFNULL(MAX(CAST(Total_Credit_Balance AS DECIMAL(10,2))), 0) FROM customer_credit_log ccl WHERE ccl.Customer_idCustomer = ?), 
                'cheque', ?, ?, ?, ?, ?, ?, ?
              FROM DUAL
              WHERE NOT EXISTS (
                SELECT 1 FROM customer_credit_log 
                WHERE Type = 'INVOICE' AND Type_Id = ? AND Cheque_No IS NOT NULL
              )
            `;

            db.query(
              insertLogQuery,
              [
                inv.Customer_idCustomer,
                id,
                inv.Customer_idCustomer,
                inv.Cheque_Type,
                inv.Cheque_No,
                inv.Cheque_Date,
                inv.Cheque_Name,
                status,
                note || null,
                inv.Branch_idBranch,
                id,
              ],
              (insErr, insRes) => {
                if (insErr) {
                  console.error("Error creating missing cheque log:", insErr);
                  return res
                    .status(500)
                    .json({ message: "Failed to create cheque status record." });
                }

                // Handle rejection or completion logic for the newly created row
                if (status === 2) {
                  return handleInvoiceRejection(
                    id,
                    inv.Paid_Amount,
                    inv.Customer_idCustomer,
                    inv.Branch_idBranch,
                    res,
                  );
                } else if (status === 1) {
                  return handleInvoiceCompletion(
                    id,
                    inv.Paid_Amount,
                    inv.Customer_idCustomer,
                    inv.Branch_idBranch,
                    res,
                  );
                }

                return res.json({
                  message:
                    "Cheque status record created and updated successfully",
                });
              },
            );
          });
        });
      }

      if (status === 2) {
        // Handle rejection: add credit back to customer balance
        const selectQuery = `
          SELECT ccl.Customer_idCustomer as ownerId, ccl.Branch_idBranch, i.Paid_Amount as debit
          FROM customer_credit_log ccl
          JOIN invoice i ON ccl.Type_Id = i.idInvoice
          WHERE ccl.Type = 'INVOICE' AND ccl.Type_Id = ? AND ccl.Cheque_No IS NOT NULL
        `;

        db.query(selectQuery, [id], (selectErr, selectResult) => {
          if (selectErr || selectResult.length === 0) {
            return res.status(500).json({
              message: "Failed to fetch debit data for rejected cheque.",
            });
          }

          const { debit, ownerId, Branch_idBranch } = selectResult[0];
          return handleInvoiceRejection(
            id,
            debit,
            ownerId,
            Branch_idBranch,
            res,
          );
        });
      } else if (status === 1) {
        // Handle completion: deduct balance and update invoice
        const selectQuery = `
          SELECT ccl.Customer_idCustomer as ownerId, ccl.Branch_idBranch, i.Paid_Amount as debit
          FROM customer_credit_log ccl
          JOIN invoice i ON ccl.Type_Id = i.idInvoice
          WHERE ccl.Type = 'INVOICE' AND ccl.Type_Id = ? AND ccl.Cheque_No IS NOT NULL
        `;

        db.query(selectQuery, [id], (selectErr, selectResult) => {
          if (selectErr || selectResult.length === 0) {
            return res.status(500).json({
              message: "Failed to fetch data for completed cheque.",
            });
          }

          const { debit, ownerId, Branch_idBranch } = selectResult[0];
          return handleInvoiceCompletion(
            id,
            debit,
            ownerId,
            Branch_idBranch,
            res,
          );
        });
      } else {
        return res.json({ message: "Cheque status updated successfully" });
      }
    });
    return;
  } else {
    return res.status(400).json({ message: "Invalid source type" });
  }

  // Step 1: Update cheque status and note (for non-invoice)
  const updateQuery = `
    UPDATE ${table}
    SET ${statusColumn} = ?, ${noteColumn} = ?
    WHERE ${idColumn} = ? AND (${statusColumn} IS NULL OR ${statusColumn} != ?)
  `;

  db.query(updateQuery, [status, note || null, id, status], (err, result) => {
    if (err) {
      console.error("Error updating cheque status:", err);
      return res
        .status(500)
        .json({ message: "Failed to update cheque status" });
    }

    if (result.affectedRows === 0) {
      return res.status(200).json({ message: "Cheque status already updated or not found." });
    }

    if (status === 2) {
      // Step 2: Fetch the Debit amount and owner ID (customer or supplier)
      const selectQuery = `
        SELECT ${debitColumn} AS debit, ${customerOrSupplierIdColumn} AS ownerId, Branch_idBranch, Type_Id
        FROM ${table}
        WHERE ${idColumn} = ?
      `;

      db.query(selectQuery, [id], (selectErr, selectResult) => {
        if (selectErr || selectResult.length === 0) {
          return res.status(500).json({
            message: "Failed to fetch debit data for rejected cheque.",
          });
        }

        const { debit, ownerId, Branch_idBranch, Type_Id } = selectResult[0];
        const debitAmount = parseFloat(debit) || 0;

        // Step 3: Insert new log entry with updated total balance
        const insertQuery = `
          INSERT INTO ${table} (
            ${customerOrSupplierIdColumn},
            Type, Type_Id, Credit, Debit, Total_Credit_Balance, Date_Time, Note, Branch_idBranch
          )
          SELECT ?, 'Cheque Rejected', ?, ?, 0, 
            IFNULL((SELECT CAST(ccl2.Total_Credit_Balance AS DECIMAL(10,2)) FROM customer_credit_log ccl2 WHERE ccl2.Customer_idCustomer = ? ORDER BY ccl2.idCustomer_Credit_Log DESC LIMIT 1), 0) + ?, 
            NOW(), ?, ?
        `;

        db.query(
          insertQuery,
          [
            ownerId,
            Type_Id,
            debitAmount,
            ownerId,
            debitAmount,
            "Cheque rejected & amount added back to balance",
            Branch_idBranch,
          ],
          async (insertErr, insertRes) => {
            if (insertErr) {
              console.error("Error inserting updated balance:", insertErr);
              return res.status(500).json({
                message: "Cheque rejected, but failed to update balance.",
              });
            }

            if (source === "customer") {
              try {
                await customerLogDbService.recalculateCustomerCreditLogs(ownerId);
              } catch (recErr) {
                console.error("Error recalculating customer credit logs after cheque rejection:", recErr);
              }
            }

            if (source === "customer" && Type_Id) {
              const reverseInvoiceQuery = `
                UPDATE invoice 
                SET Payment_Type = 0, 
                    Credit_Balance = Credit_Balance + ?, 
                    Balance_Amount = Balance_Amount + ?,
                    Paid_Amount = Paid_Amount - ? 
                WHERE idInvoice = ? AND (Payment_Type != 0 OR Payment_Type IS NULL)
              `;
        
              db.query(reverseInvoiceQuery, [debitAmount, debitAmount, debitAmount, Type_Id], (revErr) => {
                if (revErr) {
                  console.error("Error reversing invoice status for customer cheque:", revErr);
                }
                return res.json({
                  message: "Cheque rejected. Balance restored and invoice updated.",
                });
              });
            } else {
              return res.json({
                message: "Cheque rejected and debit amount added back to balance.",
              });
            }
          },
        );
      });
    } else {
      return res.json({ message: "Cheque status updated successfully" });
    }
  });
};

module.exports = { getAllCheques, updateChequeStatus };
