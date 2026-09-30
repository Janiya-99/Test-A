const dbService = require("../services/supplierCreditLogDBService");
const grnDBService = require("../services/grnDBService");
const { fetchBranch } = require("../services/branchDBService");
const { findAccountByNameAndGroup, creditDebitLogHelper } = require("./accountingController");
const bankAccountDBService = require("../services/bankAccountDBService");
const bankAccountLogDBService = require("../services/bankAccountLogDBService");
const db = require("../db/db");

const createSupplierLog = async (req, res) => {
  try {
    const payments = req.body.payments; // Expect an array of payments
    if (!Array.isArray(payments)) {
      return res.status(400).json({ message: "Expected array of payments" });
    }

    const insertedIds = [];

    for (const payment of payments) {
      const {
        Supplier_idSupplier,
        GRN_Id,
        Paid_Amount, // Use this as Debit
        Discount_Amount = 0,
        Payment_Type,
        Payment_Method,
        Cheque_Type,
        Cheque_No,
        Cheque_Date,
        Cheque_Name,
        Branch_idBranch,
        Accounting_Accounts_id,
        Bank_Account_Id,
        User_idUser: PaymentUser,
        Date_Time: customDateTime,
        Date: customDate,
        receipt_number,
        voucher_number,
        Note: paymentNote,
      } = payment;

      const bankAccountId = Bank_Account_Id || Accounting_Accounts_id;
      const userId = PaymentUser || req.body.User_idUser || req.user?.id || req.user?.userId || 1;
      const paymentDate = customDateTime || customDate || null;
      const voucherRef = receipt_number || voucher_number || req.body.receipt_number || req.body.voucher_number || null;

      // Fetch last log to get current balance
      const lastLogArr = await dbService.fetchLastLog(Supplier_idSupplier);
      const lastBalance =
        lastLogArr.length > 0
          ? parseFloat(lastLogArr[0].Total_Credit_Balance)
          : 0;

      // Calculate new balance
      const debit = parseFloat(Paid_Amount) || 0;
      const discount = parseFloat(Discount_Amount) || 0;
      const userNote = paymentNote || req.body.Note ? `: ${paymentNote || req.body.Note}` : "";
      const voucherNote = voucherRef ? ` [Voucher: ${voucherRef}]` : "";
      const discountNote = discount > 0 ? ` | Settlement discount: ${discount}` : "";
      const settlementReduction = debit + discount;

      if (GRN_Id && GRN_Id !== 0) {
        const grnResult = await grnDBService.fetchGrn(GRN_Id);
        const grnBalance = parseFloat(grnResult?.[0]?.Credit_Balance_Amount || 0);

        if (settlementReduction > grnBalance + 0.01) {
          return res.status(400).json({
            message: "Cash paid plus discount cannot exceed the GRN balance",
          });
        }
      } else if (settlementReduction > lastBalance + 0.01) {
        return res.status(400).json({
          message: "Cash paid plus discount cannot exceed the supplier balance",
        });
      }
      const newBalance = lastBalance - settlementReduction;

      const insertResult = await dbService.insertSupplierCreditLog(
        Supplier_idSupplier,
        "PAYMENT",
        GRN_Id || 0,
        0, // Credit is 0 for payment
        debit,
        newBalance,
        Payment_Type,
        Payment_Method,
        Cheque_Type,
        Cheque_No,
        Cheque_Date,
        Cheque_Name,
        Branch_idBranch,
        null, // No connection here as it's not in a transaction
        `Supplier Payment (ID: ${Supplier_idSupplier}, GRN: ${GRN_Id || 'Bulk'})${voucherNote}${userNote}${discountNote}`,
        discount,
        bankAccountId || null,
        paymentDate
      );

      if (insertResult && insertResult.insertId) {
        insertedIds.push(insertResult.insertId);
      }

      // ✅ --- Company Bank Account Update & Log ---
      if (Payment_Method === "bank" && debit > 0 && bankAccountId) {
        try {
          const accountDetails = await bankAccountDBService.getAccountById(
            bankAccountId,
            Branch_idBranch,
          );
          if (accountDetails && accountDetails.length > 0) {
            const currentBal = parseFloat(accountDetails[0].account_balance || 0);
            const paymentBal = currentBal - debit; // Subtract for supplier payment!
            await bankAccountDBService.updateCompanyBankAccountBalance(
              bankAccountId,
              paymentBal,
              Branch_idBranch,
            );

            const bank_acc_id = bankAccountId;
            const type = "Supplier Payment";
            const description = `Payment sent to Supplier ID: ${Supplier_idSupplier} for GRN: ${GRN_Id || 'Bulk'}`;
            const noteText = `Paid Amount: ${debit}`;
            const debitAmt = "0.00";
            const creditAmt = debit; // Credit column represents bank balance decrease
            const balance = paymentBal;
            const user = accountDetails[0].user;
            const updated_status = "paid";
            const updated_note = `Payment of ${debit} sent to Supplier ID: ${Supplier_idSupplier}`;
            const updated_date_time = new Date();
            const updated_user = userId || 1;
            const payment_id = insertResult ? insertResult.insertId : 0;
            const contra_account = "-";
            const reconcilation_status = "0";
            const branch_id = Branch_idBranch;

            await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
              bank_acc_id,
              type,
              description,
              noteText,
              debitAmt,
              creditAmt,
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
            );
          }
        } catch (error) {
          console.error("Error updating bank account balance after supplier payment:", error);
        }
      }

      // ✅ --- Double Entry Accounting (Payment) ---
      if (settlementReduction > 0) {
        try {
          const branch = await fetchBranch(Branch_idBranch);
          const companyId = branch[0].Company_idCompany;
          
          const accountsPayableAccId = await findAccountByNameAndGroup("Accounts Payable (Creditors)", "Liabilities", companyId, Branch_idBranch);
          
          const pMethodLower = Payment_Method ? Payment_Method.toLowerCase() : "";
          let paymentAccId = null;
          if (pMethodLower === "cash") {
            paymentAccId = await findAccountByNameAndGroup("Cash in Hand", "Assets", companyId, Branch_idBranch);
          } else if (pMethodLower === "bank") {
            paymentAccId = await findAccountByNameAndGroup("Bank Account", "Assets", companyId, Branch_idBranch);
          } else if (pMethodLower === "cheque") {
            paymentAccId = await findAccountByNameAndGroup("Cheque Clearing Account", "Assets", companyId, Branch_idBranch);
          }

          let discountAccId = null;
          if (discount > 0) {
            discountAccId =
              (await findAccountByNameAndGroup(
                "Purchase Discounts Received",
                "Income",
                companyId,
                Branch_idBranch,
              )) ||
              (await findAccountByNameAndGroup(
                "Other Income (Rental, etc.)",
                "Income",
                companyId,
                Branch_idBranch,
              ));
          }

          if (accountsPayableAccId && (paymentAccId || discountAccId)) {
            const description = `Supplier Payment (ID: ${Supplier_idSupplier}, GRN: ${GRN_Id || 'Bulk'})`;
            const totalReduction = debit + discount;
            
            // Debit Accounts Payable
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Liabilities",
              amount: totalReduction,
              description,
              type: "Supplier Payment",
              accountId: accountsPayableAccId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId,
              transactionType: "debit"
            });

            // Credit Cash/Bank for the cash portion only
            if (paymentAccId && debit > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: debit,
                description,
                type: "Supplier Payment",
                accountId: paymentAccId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId,
                transactionType: "credit"
              });
            }

            // Credit Purchase Discounts Received for the settlement discount
            if (discountAccId && discount > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Income",
                amount: discount,
                description: `${description} - Settlement discount`,
                type: "Supplier Discount",
                accountId: discountAccId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId,
                transactionType: "credit"
              });
            }
          }
        } catch (accError) {
          console.error("Accounting Log Error (Supplier Payment):", accError);
        }
      }

      // GRN Handling (Specific or Bulk)
      if (GRN_Id && GRN_Id !== 0) {
        // Specific GRN Payment
        const grnResult = await grnDBService.fetchGrn(GRN_Id);

        if (grnResult && grnResult.length > 0) {
          const grn = grnResult[0];

          const currentPaid = parseFloat(grn.Paid_Amount || 0);
          const currentBalance = parseFloat(grn.Credit_Balance_Amount || 0);
          const totalReduction = debit + discount;

          const newPaid = currentPaid + debit;
          const newBalanceGRN = currentBalance - totalReduction;

          await grnDBService.processGrn(newPaid, newBalanceGRN, GRN_Id);
        }
      } else {
        // Bulk Payment (FIFO Distribution)
        const pendingGrns =
          await grnDBService.fetchPendingGrns(Supplier_idSupplier);
        let remainingPayment = parseFloat(debit);

        for (const grn of pendingGrns) {
          if (remainingPayment <= 0) break;

          const currentBalance = parseFloat(grn.Credit_Balance_Amount || 0);
          const currentPaid = parseFloat(grn.Paid_Amount || 0);

          const paymentForThisGrn =
            remainingPayment >= currentBalance
              ? currentBalance
              : remainingPayment;

          const newBalanceGRN = currentBalance - paymentForThisGrn;
          const newPaid = currentPaid + paymentForThisGrn;

          await grnDBService.processGrn(newPaid, newBalanceGRN, grn.idGRN);
          remainingPayment -= paymentForThisGrn;
        }
      }
    }

    res.status(200).json({
      message: "All supplier logs added successfully",
      insertId: insertedIds.length > 0 ? insertedIds[0] : null,
      insertedIds,
      insertIds: insertedIds,
    });
  } catch (err) {
    res.status(500).json({
      message: "Error creating supplier log",
      error: err.message,
    });
  }
};

const getSupplierLog = async (req, res) => {
  try {
    const { Supplier_idSupplier } = req.params;

    const supplierLog = await dbService.fetchLogs(Supplier_idSupplier);

    if (supplierLog.length === 0) {
      return res.status(404).json({ message: "Supplier Log not found" });
    }
    res.json(supplierLog);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res
      .status(500)
      .json({ message: "Error fetching supplier log", error: err.message });
  }
};

const addManualCredit = async (req, res) => {
  try {
    const Supplier_idSupplier = req.body.Supplier_idSupplier || req.body.supplierId;
    const Amount = req.body.Amount || req.body.amount;
    const Description = req.body.Description || req.body.description;
    const Branch_idBranch = req.body.Branch_idBranch || req.body.branchId || (req.body.branch && (req.body.branch.idBranch || req.body.branch));
    const User_idUser = req.body.User_idUser || req.body.userId || req.body.idAsipiya_User || req.body.idUser || req.body.id;

    if (!Supplier_idSupplier || !Amount || !Branch_idBranch || !User_idUser) {
      console.error("❌ Missing required fields in manual credit:", {
        Supplier_idSupplier,
        Amount,
        Branch_idBranch,
        User_idUser,
        body: req.body
      });
      return res.status(400).json({ 
        message: "Missing required fields",
        details: {
          Supplier_idSupplier: !Supplier_idSupplier,
          Amount: !Amount,
          Branch_idBranch: !Branch_idBranch,
          User_idUser: !User_idUser
        }
      });
    }

    // Fetch last log to get current running balance
    const lastLog = await dbService.fetchLastLog(Supplier_idSupplier);
    let runningBalance = 0;
    if (lastLog && lastLog.length > 0) {
      runningBalance = parseFloat(lastLog[0].Total_Credit_Balance || 0);
    }

    const newBalance = runningBalance + parseFloat(Amount);

    // Insert manual credit log entry
    await dbService.insertSupplierCreditLog(
      Supplier_idSupplier,
      "MANUAL_CREDIT",
      0, // Type_Id = 0
      parseFloat(Amount), // Credit
      0, // Debit
      newBalance.toFixed(2), // Total_Credit_Balance
      0, // Payment_Type
      "MANUAL_CREDIT", // Payment_Method
      null, // Cheque_Type
      null, // Cheque_No
      null, // Cheque_Date
      null, // Cheque_Name
      Branch_idBranch,
      null, // connection
      Description || "Manual Credit Addition" // Note
    );

    await dbService.recalculateSupplierCreditLogs(Supplier_idSupplier);

    const updatedLastLog = await dbService.fetchLastLog(Supplier_idSupplier);
    const finalBalance =
      updatedLastLog && updatedLastLog.length > 0
        ? parseFloat(updatedLastLog[0].Total_Credit_Balance || 0)
        : newBalance;

    // Log the action in user activity log
    const pad = (n) => (n < 10 ? "0" + n : n);
    const dateObj = new Date();
    const formattedNow = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;

    const userLogDbService = require("../services/userLogDBService");
    await userLogDbService.insertLog(
      User_idUser,
      formattedNow,
      "Supplier",
      Supplier_idSupplier,
      "add-manual-credit",
      Branch_idBranch
    );

    return res.status(200).json({
      message: "Manual credit added successfully",
      newBalance: finalBalance.toFixed(2),
    });
  } catch (error) {
    console.error("Error adding manual credit:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getGrnPayments = async (req, res) => {
  try {
    const { idGRN } = req.params;
    const payments = await dbService.fetchLogsByGrnId(idGRN);

    // Also check if the GRN itself had an initial/upfront payment
    const grnRows = await new Promise((resolve, reject) => {
      db.query("SELECT * FROM grn WHERE idGRN = ?", [idGRN], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    if (grnRows.length > 0) {
      const grn = grnRows[0];
      const totalPaidOnGrn = parseFloat(grn.Paid_Amount || 0);
      const subsequentPaid = (payments || []).reduce(
        (sum, p) => sum + parseFloat(p.Debit || 0),
        0
      );
      const initialPaid = Math.round((totalPaidOnGrn - subsequentPaid) * 100) / 100;

      if (initialPaid > 0.009) {
        // Fetch the original GRN log to get payment method, cheque details, date, etc.
        const grnLogRows = await new Promise((resolve, reject) => {
          db.query(
            "SELECT * FROM supplier_log WHERE Type_Id = ? AND Type = 'GRN' ORDER BY idSupplier_Log ASC LIMIT 1",
            [idGRN],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });

        const grnLog = grnLogRows.length > 0 ? grnLogRows[0] : null;

        const initialPaymentItem = {
          idSupplier_Log: grnLog ? grnLog.idSupplier_Log : `init_${idGRN}`,
          Supplier_idSupplier: grn.Supplier_idSupplier,
          Date_Time: grnLog?.Date_Time || (grn.Date ? `${grn.Date} 00:00:00` : new Date().toISOString()),
          Type: "PAYMENT",
          Type_Id: String(idGRN),
          Credit: 0,
          Debit: initialPaid,
          Total_Credit_Balance: parseFloat(grn.Credit_Balance_Amount || 0),
          Payment_Type: grnLog?.Payment_Type || (initialPaid >= parseFloat(grn.Net_Total || 0) ? "full" : "half"),
          Payment_Method: grnLog?.Payment_Method || "cash",
          Cheque_Type: grnLog?.Cheque_Type || null,
          Cheque_No: grnLog?.Cheque_No || null,
          Cheque_Date: grnLog?.Cheque_Date || null,
          Cheque_Name: grnLog?.Cheque_Name || null,
          Cheque_Status: grnLog?.Cheque_Status || 0,
          Branch_idBranch: grn.Branch_idBranch,
          Discount_Amount: 0,
          Note: grnLog?.Note ? `${grnLog.Note} (Initial Upfront Payment)` : "Initial Upfront Payment",
          Bank_Account_Id: grnLog?.Bank_Account_Id || null,
          isInitialPayment: true,
        };

        payments.push(initialPaymentItem);
      }
    }

    res.json(payments || []);
  } catch (err) {
    console.error("Error fetching GRN payments:", err);
    res.status(500).json({
      message: "Error fetching GRN payments",
      error: err.message,
    });
  }
};

const deleteSupplierCreditLog = async (req, res) => {
  const { idSupplier_Log } = req.params;
  const userId = req.user?.id || req.user?.userId || req.body?.User_idUser || 1;

  db.getConnection((connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection from pool:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        console.error("Transaction begin error:", beginErr);
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        // 1. Get the log entry
        const logResult = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM supplier_log WHERE idSupplier_Log = ?",
            [idSupplier_Log],
            (err, results) => (err ? reject(err) : resolve(results))
          );
        });

        if (!logResult || logResult.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ message: "Supplier credit log not found" });
          });
        }

        const log = logResult[0];
        const Supplier_idSupplier = log.Supplier_idSupplier;
        const Branch_idBranch = log.Branch_idBranch;

        // Strictly allow only MANUAL_CREDIT deletion to protect GRN, Payment, and Purchase Return integrity
        if (log.Type !== "MANUAL_CREDIT") {
          return connection.rollback(() => {
            connection.release();
            res.status(400).json({ message: "Only manual credit entries can be deleted" });
          });
        }

        // 2. Delete the log entry
        await dbService.deleteSupplierLogById(idSupplier_Log, connection);

        // 3. Recalculate running balance for subsequent logs
        await dbService.recalculateSupplierCreditLogs(Supplier_idSupplier, connection);

        // 4. Log the activity in user activity log
        try {
          const userLogDbService = require("../services/userLogDBService");
          const pad = (n) => (n < 10 ? "0" + n : n);
          const dateObj = new Date();
          const formattedNow = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
          await userLogDbService.insertLog(
            userId,
            formattedNow,
            "Supplier",
            Supplier_idSupplier,
            "delete-manual-credit",
            Branch_idBranch
          );
        } catch (uErr) {
          console.error("Error logging user activity for supplier log deletion:", uErr);
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit error:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }

          connection.release();
          res.status(200).json({ message: "Manual credit deleted successfully" });
        });
      } catch (error) {
        connection.rollback(() => {
          connection.release();
          console.error("Error in deleteSupplierCreditLog:", error);
          res.status(500).json({
            message: "Error deleting supplier log",
            error: error.message,
          });
        });
      }
    });
  });
};

module.exports = {
  getSupplierLog,
  getGrnPayments,
  createSupplierLog,
  addManualCredit,
  deleteSupplierCreditLog,
};
