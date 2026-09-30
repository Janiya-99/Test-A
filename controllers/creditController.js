const db = require("../db/db");

const getCustomerCreditSummary = (req, res) => {
  const { Branch_idBranch } = req.params;

  const query = `
    SELECT 
      cc.Customer_idCustomer AS idCustomer,
      c.displayName,
      i.Payment_Type,

      COUNT(DISTINCT cc.Type_Id) AS totalInvoices,

      SUM(
        CASE 
          WHEN cc.Type = 'INVOICE' AND (cc.Credit IS NULL OR CAST(cc.Credit AS DECIMAL(10,2)) = 0)
          THEN CAST(cc.Debit AS DECIMAL(10,2))
          WHEN cc.Credit IS NOT NULL AND cc.Credit != '' 
          THEN CAST(cc.Credit AS DECIMAL(10,2)) 
          ELSE 0 
        END
      ) AS totalInvoiceAmount,

      SUM(
        COALESCE((
          SELECT SUM(CAST(Debit AS DECIMAL(10,2)))
          FROM customer_credit_log p
          WHERE p.Type = 'PAYMENT'
            AND p.Type_Id = cc.Type_Id
            AND p.Customer_idCustomer = cc.Customer_idCustomer
        ), 0)
      ) AS totalPaidAmount

    FROM 
      customer_credit_log cc
    JOIN 
      customer c ON c.idCustomer = cc.Customer_idCustomer
    JOIN 
      invoice i ON i.idInvoice = cc.Type_Id
    WHERE 
      cc.Branch_idBranch = ?
      AND cc.Type IN ('INVOICE', 'Cheque Rejected')
    GROUP BY 
      cc.Customer_idCustomer, i.Payment_Type
    HAVING 
      SUM(
        CASE 
          WHEN cc.Type = 'INVOICE' AND (cc.Credit IS NULL OR CAST(cc.Credit AS DECIMAL(10,2)) = 0)
          THEN CAST(cc.Debit AS DECIMAL(10,2))
          WHEN cc.Credit IS NOT NULL AND cc.Credit != '' 
          THEN CAST(cc.Credit AS DECIMAL(10,2)) 
          ELSE 0 
        END
      )
      -
      SUM(
        COALESCE((
          SELECT SUM(CAST(Debit AS DECIMAL(10,2)))
          FROM customer_credit_log p
          WHERE p.Type = 'PAYMENT'
            AND p.Type_Id = cc.Type_Id
            AND p.Customer_idCustomer = cc.Customer_idCustomer
        ), 0)
      ) > 0
    ORDER BY 
      SUM(
        CASE 
          WHEN cc.Type = 'INVOICE' AND (cc.Credit IS NULL OR CAST(cc.Credit AS DECIMAL(10,2)) = 0)
          THEN CAST(cc.Debit AS DECIMAL(10,2))
          WHEN cc.Credit IS NOT NULL AND cc.Credit != '' 
          THEN CAST(cc.Credit AS DECIMAL(10,2)) 
          ELSE 0 
        END
      )
      -
      SUM(
        COALESCE((
          SELECT SUM(CAST(Debit AS DECIMAL(10,2)))
          FROM customer_credit_log p
          WHERE p.Type = 'PAYMENT'
            AND p.Type_Id = cc.Type_Id
            AND p.Customer_idCustomer = cc.Customer_idCustomer
        ), 0)
      ) DESC
  `;

  db.query(query, [Branch_idBranch], (err, results) => {
    if (err) {
      console.error("❌ SQL error:", err);
      return res.status(500).json({ message: "Server error", error: err });
    }

    // Add calculated field & label
    const formatted = results.map((row) => ({
      ...row,
      totalCredit:
        parseFloat(row.totalInvoiceAmount || 0) -
        parseFloat(row.totalPaidAmount || 0),
      paymentTypeLabel:
        row.Payment_Type === 2
          ? "Installment"
          : row.Payment_Type === 3
            ? "Credit"
            : "Unknown",
    }));

    res.status(200).json(formatted);
  });
};

// ✅ Updated getCustomerInvoices to include Payment_Type and calculate Balance
const getCustomerInvoices = (req, res) => {
  const customerId = req.params.customerId;

  const query = `
    SELECT 
      c.displayName,
      c.credit_period,
      i.Date,
      i.idInvoice AS Type_Id,
      COALESCE(i.created_at, i.Date) AS Date_Time,
      i.Net_Amount AS Credit,
      i.Payment_Type,
      i.Invoice_Number,
      CAST((CAST(i.Net_Amount AS DECIMAL(10,2)) + CAST(COALESCE(i.Interest_Amount, 0) AS DECIMAL(10,2)) - CAST(COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2))) AS DECIMAL(10,2)) AS Balance_Amount,
      CAST(COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2)) AS Paid_Amount
    FROM 
      invoice i
    JOIN 
      customer c ON c.idCustomer = i.Customer_idCustomer
    WHERE 
      i.Customer_idCustomer = ?
      AND (CAST(i.Net_Amount AS DECIMAL(10,2)) + CAST(COALESCE(i.Interest_Amount, 0) AS DECIMAL(10,2)) - CAST(COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2))) > 0.01
    ORDER BY 
      i.idInvoice DESC
  `;

  db.query(query, [customerId], async (err, results) => {
    if (err) {
      console.error("❌ SQL error:", err);
      return res.status(500).json({ message: "Server error" });
    }

    try {
      // Also fetch any manual credits for this customer that have an unpaid balance
      const manualCreditsQuery = `
        SELECT 
          c.displayName,
          c.credit_period,
          ccl.Date_Time AS Date,
          ccl.idCustomer_Credit_Log AS Type_Id,
          ccl.Date_Time,
          CAST(ccl.Credit AS DECIMAL(10,2)) AS Credit,
          ccl.Payment_Method AS Description,
          0 AS Payment_Type,
          CONCAT('Manual Credit #', ccl.idCustomer_Credit_Log, IF(ccl.Payment_Method IS NOT NULL AND ccl.Payment_Method != '' AND ccl.Payment_Method != 'Manual Credit Addition', CONCAT(' (', ccl.Payment_Method, ')'), '')) AS Invoice_Number
        FROM customer_credit_log ccl
        JOIN customer c ON c.idCustomer = ccl.Customer_idCustomer
        WHERE ccl.Customer_idCustomer = ?
          AND ccl.Type = 'MANUAL_CREDIT'
        ORDER BY ccl.idCustomer_Credit_Log ASC
      `;

      const manualCredits = await new Promise((resolve, reject) => {
        db.query(manualCreditsQuery, [customerId], (err2, rows) => {
          if (err2) reject(err2);
          else resolve(rows || []);
        });
      });

      let manualCreditItems = [];
      if (manualCredits.length > 0) {
        // Fetch all payments made by this customer that are not linked to an invoice
        const nonInvoicePayments = await new Promise((resolve, reject) => {
          const pSql = `
            SELECT 
              Type_Id,
              Payment_Type,
              Note,
              CAST(Debit AS DECIMAL(10,2)) AS Debit
            FROM customer_credit_log
            WHERE Customer_idCustomer = ?
              AND Type = 'PAYMENT'
              AND (
                Type_Id = 0 
                OR Payment_Type = 0 
                OR Note LIKE '%Manual Credit%'
                OR Type_Id NOT IN (SELECT idInvoice FROM invoice WHERE Customer_idCustomer = ?)
              )
            ORDER BY idCustomer_Credit_Log ASC
          `;
          db.query(pSql, [customerId, customerId], (err3, pRows) => {
            if (err3) reject(err3);
            else resolve(pRows || []);
          });
        });

        // Track how much has been paid for each manual credit
        let remainingUnallocatedPayments = 0;
        const paidPerManualCredit = {};

        for (const p of nonInvoicePayments) {
          const debitAmt = parseFloat(p.Debit || 0);
          if (p.Type_Id && p.Type_Id > 0) {
            paidPerManualCredit[p.Type_Id] = (paidPerManualCredit[p.Type_Id] || 0) + debitAmt;
          } else {
            remainingUnallocatedPayments += debitAmt;
          }
        }

        // Calculate remaining balance for each manual credit (and apply FIFO unallocated payments if any)
        for (const mc of manualCredits) {
          const totalCredit = parseFloat(mc.Credit || 0);
          let paidAmount = paidPerManualCredit[mc.Type_Id] || 0;

          if (remainingUnallocatedPayments > 0 && paidAmount < totalCredit) {
            const absorb = Math.min(totalCredit - paidAmount, remainingUnallocatedPayments);
            paidAmount += absorb;
            remainingUnallocatedPayments -= absorb;
          }

          const balanceAmount = Math.max(0, totalCredit - paidAmount);
          if (balanceAmount > 0.01) {
            manualCreditItems.push({
              ...mc,
              Balance_Amount: balanceAmount,
              Paid_Amount: paidAmount,
              isManualCredit: true,
              itemKey: `mc_${mc.Type_Id}`,
              Installments: [],
            });
          }
        }
      }

      const updatedResults = await Promise.all(
        results.map(async (item) => {
          const balance = parseFloat(item.Balance_Amount || 0);

          let installments = [];
          if (item.Payment_Type === 2) {
            // Fetch installment data for this invoice
            const [installmentRows] = await new Promise((resolve, reject) => {
              const instQuery = `
                SELECT 
                  Date,idInstallment_Payment , Term, Amount, Penalty_Amount, Total_Pending_Amount,
                  Paid_Date, Paid_Amount, Balance_Amount, Status
                FROM installment_payment
                WHERE Invoice_idInvoice = ? AND Customer_idCustomer = ?
              `;
              db.query(instQuery, [item.Type_Id, customerId], (err2, rows) => {
                if (err2) reject(err2);
                else resolve([rows]);
              });
            });

            installments = installmentRows;
          }

          return {
            ...item,
            Balance_Amount: balance,
            Installments: installments,
            isManualCredit: false,
            itemKey: `inv_${item.Type_Id}`,
          };
        }),
      );

      res.status(200).json([...updatedResults, ...manualCreditItems]);
    } catch (catchErr) {
      console.error("Error processing getCustomerInvoices:", catchErr);
      res.status(500).json({ message: "Server error", error: catchErr.message });
    }
  });
};

const getCustomerInvoiceDetails = (req, res) => {
  const customerId = req.params.customerId;

  const query = `
    SELECT 
      Date,
      Payment_Type,
      Credit_Balance,
      Total_Credit_Balance,
      Invoice_Number
    FROM 
      invoice
    WHERE 
      Customer_idCustomer = ?
    ORDER BY 
      STR_TO_DATE(Date, '%Y-%m-%d') DESC
  `;

  db.query(query, [customerId], (err, results) => {
    if (err) {
      console.error("❌ Error fetching invoices:", err);
      return res.status(500).json({ message: "Server error" });
    }

    res.status(200).json(results);
  });
};

const getAllCustomerInvoiceDetails = (req, res) => {
  const { branchId } = req.query;

  let branchClauseI = "";
  let branchClauseCCL = "";
  const queryParams = [];

  if (branchId) {
    branchClauseI = "AND i.Branch_idBranch = ?";
    branchClauseCCL = "AND Branch_idBranch = ?";
    queryParams.push(branchId, branchId, branchId, branchId, branchId);
  }

  // Comprehensive payment report query uniting:
  // 1. All payment transaction records from customer_credit_log (installments, spot payments for registered customers, voucher/loyalty)
  // 2. All invoices without customer_credit_log payment entries (POS cash/card sales, initial credit invoices, direct walk-in invoices)
  // 3. Initial issuance records for credit/installment invoices whose payments were received on later dates, ensuring their issuance date is reflected accurately
  const query = `
    SELECT
      ccl.idCustomer_Credit_Log              AS payment_log_id,
      DATE_FORMAT(ccl.Date_Time, '%Y-%m-%d') AS Date,
      ccl.Date_Time                          AS Payment_DateTime,
      DATE_FORMAT(COALESCE(i.Date, i.created_at), '%Y-%m-%d') AS Invoice_Date,
      CAST(ccl.Debit AS DECIMAL(10,2))       AS Paid_Amount,
      ccl.Payment_Method,
      COALESCE(c.displayName, 'Walk-in Customer') AS Customer_Name,
      i.Invoice_Number,
      i.idInvoice,
      i.Payment_Type,
      CASE
        WHEN i.Payment_Type = 1 THEN 'Full Payment'
        WHEN i.Payment_Type = 2 THEN 'Installment Payment'
        WHEN i.Payment_Type = 3 THEN 'Credit Payment'
        ELSE 'Unknown'
      END AS Payment_Type_Label
    FROM
      customer_credit_log ccl
    INNER JOIN
      invoice i ON CAST(ccl.Type_Id AS UNSIGNED) = i.idInvoice
    LEFT JOIN
      customer c ON i.Customer_idCustomer = c.idCustomer
    WHERE
      ccl.Type = 'PAYMENT'
      AND CAST(ccl.Debit AS DECIMAL(10,2)) > 0
      ${branchClauseI}

    UNION ALL

    SELECT
      NULL                                   AS payment_log_id,
      DATE_FORMAT(COALESCE(i.created_at, i.Date), '%Y-%m-%d') AS Date,
      COALESCE(i.created_at, i.Date)         AS Payment_DateTime,
      DATE_FORMAT(COALESCE(i.Date, i.created_at), '%Y-%m-%d') AS Invoice_Date,
      CAST(COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2)) AS Paid_Amount,
      COALESCE(NULLIF(i.Payment_Method, ''), CASE WHEN i.Payment_Type = 3 THEN 'credit' ELSE 'cash' END) AS Payment_Method,
      COALESCE(c.displayName, 'Walk-in Customer') AS Customer_Name,
      i.Invoice_Number,
      i.idInvoice,
      i.Payment_Type,
      CASE
        WHEN i.Payment_Type = 1 THEN 'Full Payment'
        WHEN i.Payment_Type = 2 THEN 'Installment Payment'
        WHEN i.Payment_Type = 3 THEN 'Credit Payment'
        ELSE 'Unknown'
      END AS Payment_Type_Label
    FROM
      invoice i
    LEFT JOIN
      customer c ON i.Customer_idCustomer = c.idCustomer
    WHERE
      1 = 1
      ${branchClauseI}
      AND i.idInvoice NOT IN (
        SELECT DISTINCT CAST(Type_Id AS UNSIGNED)
        FROM customer_credit_log
        WHERE Type = 'PAYMENT'
          AND CAST(Debit AS DECIMAL(10,2)) > 0
          ${branchClauseCCL}
      )

    UNION ALL

    SELECT
      NULL                                   AS payment_log_id,
      DATE_FORMAT(COALESCE(i.created_at, i.Date), '%Y-%m-%d') AS Date,
      COALESCE(i.created_at, i.Date)         AS Payment_DateTime,
      DATE_FORMAT(COALESCE(i.Date, i.created_at), '%Y-%m-%d') AS Invoice_Date,
      0.00                                   AS Paid_Amount,
      COALESCE(NULLIF(i.Payment_Method, ''), CASE WHEN i.Payment_Type = 3 THEN 'credit' ELSE 'cash' END) AS Payment_Method,
      COALESCE(c.displayName, 'Walk-in Customer') AS Customer_Name,
      i.Invoice_Number,
      i.idInvoice,
      i.Payment_Type,
      CASE
        WHEN i.Payment_Type = 1 THEN 'Full Payment'
        WHEN i.Payment_Type = 2 THEN 'Installment Payment'
        WHEN i.Payment_Type = 3 THEN 'Credit Payment'
        ELSE 'Unknown'
      END AS Payment_Type_Label
    FROM
      invoice i
    LEFT JOIN
      customer c ON i.Customer_idCustomer = c.idCustomer
    WHERE
      1 = 1
      ${branchClauseI}
      AND i.idInvoice IN (
        SELECT DISTINCT CAST(Type_Id AS UNSIGNED)
        FROM customer_credit_log
        WHERE Type = 'PAYMENT'
          AND CAST(Debit AS DECIMAL(10,2)) > 0
          ${branchClauseCCL}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM customer_credit_log ccl_same_day
        WHERE ccl_same_day.Type = 'PAYMENT'
          AND CAST(ccl_same_day.Debit AS DECIMAL(10,2)) > 0
          AND CAST(ccl_same_day.Type_Id AS UNSIGNED) = i.idInvoice
          AND DATE(ccl_same_day.Date_Time) = DATE(COALESCE(i.Date, i.created_at))
      )
    ORDER BY Payment_DateTime DESC
  `;

  db.query(query, queryParams, (err, results) => {
    if (err) {
      console.error("❌ Error fetching payment report:", err);
      return res.status(500).json({ message: "Server error" });
    }

    res.status(200).json(results);
  });
};

const getPaymentLogs = (req, res) => {
  const { branchId, customerId } = req.query;

  if (!branchId || !customerId) {
    return res
      .status(400)
      .json({ message: "branchId and customerId are required" });
  }

  const query = `
    SELECT * FROM customer_credit_log
    WHERE Type = 'PAYMENT'
      AND Branch_idBranch = ?
      AND Customer_idCustomer = ?
  `;

  db.query(query, [branchId, customerId], (err, results) => {
    if (err) {
      console.error("Error fetching payment logs:", err);
      return res.status(500).json({ message: "Server error" });
    }
    res.json(results);
  });
};

module.exports = {
  getCustomerCreditSummary,
  getCustomerInvoices,
  getCustomerInvoiceDetails,
  getAllCustomerInvoiceDetails,
  getPaymentLogs,
};
