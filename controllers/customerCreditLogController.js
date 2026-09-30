const dbService = require("../services/customerCreditLogDBService");
const db = require("../db/db");
const branchDBService = require("../services/branchDBService");
const { findAccountByNameAndGroup, creditDebitLogHelper } = require("./accountingController");
const bankAccountDBService = require("../services/bankAccountDBService");
const bankAccountLogDBService = require("../services/bankAccountLogDBService");

const createCustomerLog = async (req, res) => {
  try {
    const {
      Customer_idCustomer,
      Total_Credit_Balance,
      Paid_Amount,
      Credit,
      Payment_Type,
      Type_Id,
      Payment_Method,
      Cheque_Type,
      Cheque_No,
      Cheque_Date,
      Cheque_Name,
      Branch_idBranch,
      Card_Type,
      Card_Number,
      Transaction_Id,
      Receipt,
      Bank_Name,
      Bank_No,
      idInstallment_Payment,
      Overpayment_Amount,
      Overpayment_Option,
      cheques,
      Applied_Overpayment,
      Note,
      Date_Time,
      receipt_number,
      Bank_Account_Id,
      isManualCredit,
    } = req.body;

    // Validate required fields (Allow Payment_Type 0, Allow Type_Id 0)
    if (
      !Customer_idCustomer || 
      (Type_Id === undefined || Type_Id === null) || 
      (Payment_Type === undefined || Payment_Type === null) || 
      !Payment_Method
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Process receipt if provided (base64 string)
    let receiptBuffer = null;
    if (Receipt && typeof Receipt === "string" && Receipt.startsWith("data:")) {
      try {
        // Extract base64 data from the string
        const matches = Receipt.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const base64Data = matches[2];
          receiptBuffer = Buffer.from(base64Data, "base64");

          // Validate file size (e.g., 5MB limit)
          if (receiptBuffer.length > 5 * 1024 * 1024) {
            return res
              .status(400)
              .json({ message: "Receipt file too large (max 5MB)" });
          }
        }
      } catch (err) {
        console.error("Error processing receipt:", err);
        return res.status(400).json({ message: "Invalid receipt format" });
      }
    }

    console.log("Inserting customer log with data:", {
      Customer_idCustomer,
      Log_Type: "PAYMENT",
      Type_Id,
      Credit,
      Paid_Amount,
      Total_Credit_Balance,
      Payment_Type,
      Payment_Method,
      Cheque_Type,
      Cheque_No,
      Cheque_Date,
      Cheque_Name,
      Branch_idBranch,
      Card_Type: Card_Type || null,
      Card_Number: Card_Number || null,
      Transaction_Id: Transaction_Id || null,
      Receipt: receiptBuffer ? "[binary data]" : null,
      Bank_Name,
      Bank_No,
      Cheque_Status: 0,
    });

    // Insert into customer_credit_log table (supports multiple cheques)
    // Support multiple cheques ONLY for the main payment allocation, NOT for the overpayment log itself!
    const isOverpaymentPayload = Overpayment_Amount !== undefined && Overpayment_Amount !== null && parseFloat(Overpayment_Amount) > 0;
    const hasMultiCheques = Payment_Method === "cheque" && cheques && cheques.length > 0 && !isOverpaymentPayload;
    const finalNote = Note || (isManualCredit ? `Payment for Manual Credit #${Type_Id}` : null);
    
    let insertResult = null;
    if (hasMultiCheques) {
      let startBalance = (parseFloat(Total_Credit_Balance) || 0) + (parseFloat(Paid_Amount) || 0);
      for (const cheque of cheques) {
        const chequeAmount = parseFloat(cheque.Amount) || 0;
        startBalance -= chequeAmount;
        insertResult = await dbService.insertCustomerCreditLog(
          Customer_idCustomer,
          "PAYMENT",
          Type_Id,
          0, // Credit is 0 for payments
          chequeAmount,
          startBalance.toFixed(2),
          Payment_Type,
          "cheque",
          cheque.Cheque_Type || null,
          cheque.Cheque_No || null,
          cheque.Cheque_Date || null,
          cheque.Cheque_Name || null,
          0, // Cheque_Status
          Branch_idBranch,
          null,
          null,
          null,
          null,
          null,
          null,
          finalNote,
          receipt_number,
          null,
          Date_Time,
        );
      }

      // Add "Change Given Back (Cash)" credit entry if the user selected "balance"
      // and the cheques total is greater than the allocated Paid_Amount
      const totalChequeAmt = cheques.reduce((acc, c) => acc + parseFloat(c.Amount || 0), 0);
      const excessAmount = totalChequeAmt - (parseFloat(Paid_Amount) || 0);
      if (excessAmount > 0.01 && Overpayment_Option === "balance") {
        startBalance += excessAmount; // Bring the running balance back up
        await dbService.insertCustomerCreditLog(
          Customer_idCustomer,
          "PAYMENT",
          Type_Id || 0,
          excessAmount, // Credit amount (adds back to customer credit ledger)
          0, // Debit amount
          startBalance.toFixed(2), // Final running balance back to 0.00
          Payment_Type,
          "Change Given Back (Cash)", // Note in Payment Method column
          null, null, null, null,
          0,
          Branch_idBranch,
          null, null, null, null, null, null,
          finalNote,
          receipt_number,
          null,
          Date_Time,
        );
      }
    } else {
      insertResult = await dbService.insertCustomerCreditLog(
        Customer_idCustomer,
        "PAYMENT",
        Type_Id,
        0, // Credit is 0 for payments
        Paid_Amount,
        Total_Credit_Balance,
        Payment_Type,
        Payment_Method,
        Cheque_Type,
        Cheque_No,
        Cheque_Date,
        Cheque_Name,
        0, // Cheque_Status
        Branch_idBranch,
        Card_Type || null,
        Card_Number || null,
        Transaction_Id || null,
        receiptBuffer, // Pass the binary data or null
        Bank_Name,
        Bank_No,
        finalNote,
        receipt_number,
        null,
        Date_Time,
        Bank_Account_Id || null,
      );
    }

    // Handle installment payment update if applicable
    if (Payment_Type === 2 && idInstallment_Payment) {
      const installmentsResult = await new Promise((resolve, reject) => {
        db.query(
          `SELECT * FROM installment_payment 
           WHERE idInstallment_Payment = ?`,
          [idInstallment_Payment],
          (err, results) => {
            if (err) return reject(err);
            resolve(results);
          },
        );
      });

      if (installmentsResult.length > 0) {
        const inst = installmentsResult[0];
        const balance = parseFloat(inst.Balance_Amount || 0);
        const toPay = Math.min(balance, parseFloat(Paid_Amount || 0));

        await new Promise((resolve, reject) => {
          db.query(
            `UPDATE installment_payment
             SET Paid_Amount = Paid_Amount + ?, 
                 Balance_Amount = Balance_Amount - ?, 
                 Status = ?
             WHERE idInstallment_Payment = ?`,
            [toPay, toPay, balance - toPay <= 0 ? 1 : 0, idInstallment_Payment],
            (err, result) => {
              if (err) return reject(err);
              resolve(result);
            },
          );
        });
      }
    }

    // Helper function to round to 2 decimal places
    const roundTo2 = (num) => Math.round(parseFloat(num) * 100) / 100;

    let invoiceNumberForDesc = null;

    // Update the parent invoice's Paid_Amount, Balance_Amount, and Credit_Balance
    if (Type_Id && Paid_Amount && !isManualCredit) {
      // Get current invoice data
      const invoiceResult = await new Promise((resolve, reject) => {
        db.query(
          `SELECT * FROM invoice WHERE idInvoice = ? AND Customer_idCustomer = ?`,
          [Type_Id, Customer_idCustomer],
          (err, results) => {
            if (err) return reject(err);
            resolve(results);
          },
        );
      });

      if (invoiceResult.length > 0) {
        const invoice = invoiceResult[0];
        invoiceNumberForDesc = invoice.Invoice_Number || Type_Id;
        const Invoice_Number = invoice.Invoice_Number || Type_Id;
        const invoiceTotal = roundTo2((parseFloat(invoice.Net_Amount) || 0) + (parseFloat(invoice.Interest_Amount) || 0));
        let newPaidAmount = roundTo2(
          Math.min(invoiceTotal, parseFloat(invoice.Paid_Amount || 0) + parseFloat(Paid_Amount))
        );
        let newBalanceAmount = roundTo2(
          Math.max(0, invoiceTotal - newPaidAmount)
        );
        let newCreditBalance = newBalanceAmount;

        // If Payment_Type is 2 (installment), check if all installments are paid
        if (Payment_Type === 2) {
          const allInstallments = await new Promise((resolve, reject) => {
            db.query(
              `SELECT * FROM installment_payment WHERE Invoice_idInvoice = ?`,
              [Type_Id],
              (err, results) => {
                if (err) return reject(err);
                resolve(results);
              },
            );
          });

          // Check if all installments are now paid (with tolerance)
          const TOLERANCE = 1.0; // Tolerance for floating-point precision issues
          const allPaid = allInstallments.every((inst) => {
            // The current installment being processed might not reflect the update yet
            if (
              inst.idInstallment_Payment === parseInt(idInstallment_Payment)
            ) {
              const instBalance = parseFloat(inst.Balance_Amount || 0);
              const toPay = Math.min(instBalance, parseFloat(Paid_Amount || 0));
              return instBalance - toPay < TOLERANCE;
            }
            return (
              inst.Status === 1 ||
              parseFloat(inst.Balance_Amount || 0) < TOLERANCE
            );
          });

          // If all installments are paid, force balance to exactly zero
          if (allPaid) {
            newBalanceAmount = 0;
            newCreditBalance = 0;
          }
        }

        // TOLERANCE CHECK: If remaining balance is very small (less than 1.00),
        // consider it fully paid and force to zero
        const BALANCE_TOLERANCE = 1.0;
        if (newBalanceAmount > 0 && newBalanceAmount < BALANCE_TOLERANCE) {
          newBalanceAmount = 0;
        }
        if (newCreditBalance > 0 && newCreditBalance < BALANCE_TOLERANCE) {
          newCreditBalance = 0;
        }

        // Ensure no negative balances
        if (newBalanceAmount < 0) newBalanceAmount = 0;
        if (newCreditBalance < 0) newCreditBalance = 0;

        // Update the invoice
        await new Promise((resolve, reject) => {
          db.query(
            `UPDATE invoice 
             SET Paid_Amount = ?, 
                 Balance_Amount = ?, 
                 Credit_Balance = ?
             WHERE idInvoice = ?`,
            [newPaidAmount, newBalanceAmount, newCreditBalance, Type_Id],
            (err, result) => {
              if (err) return reject(err);
              resolve(result);
            },
          );
        });
      }
    }

    // --- ACCOUNTING DOUBLE ENTRY START ---
    try {
      const invoiceCompanyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
      const paidAmt = parseFloat(Paid_Amount) || 0;

      if (paidAmt > 0 && invoiceCompanyId) {
        let paymentAccountName = "Cash in Hand";
        let paymentAccountGroup = "Assets";
        const pMethodLower = Payment_Method ? Payment_Method.toLowerCase() : "";

        if (pMethodLower === "cash") {
          paymentAccountName = "Cash in Hand";
        } else if (pMethodLower === "card" || pMethodLower === "online transfer" || pMethodLower.includes("online") || pMethodLower === "direct bank" || pMethodLower.includes("bank")) {
          paymentAccountName = "Bank Account";
        } else if (pMethodLower === "cheque") {
          paymentAccountName = "Cheque Clearing Account";
        } else if (pMethodLower === "koko" || pMethodLower === "mintpay") {
          paymentAccountName = "Receivable from Provider";
        } else if (pMethodLower === "applied overpayment") {
          paymentAccountName = "Customer Advance";
          paymentAccountGroup = "Liabilities";
        }

        const Payment_AccountId = await findAccountByNameAndGroup(
          paymentAccountName, paymentAccountGroup, invoiceCompanyId, Branch_idBranch, null
        );

        const AR_AccountId = await findAccountByNameAndGroup(
          "Accounts Receivable (Debtors)", "Assets", invoiceCompanyId, Branch_idBranch, null
        );

        const userId = req.user?.id || req.body?.User_idUser || 1;

        if (Payment_AccountId && AR_AccountId) {
          const itemDesc = isManualCredit 
            ? `Manual Credit #${Type_Id}` 
            : (Type_Id === 0 ? "Direct Credit Payment" : `Invoice ${invoiceNumberForDesc || Type_Id}`);

          // Debit the payment account (Cash/Bank/Cheque/Customer Advance)
          await creditDebitLogHelper({
            accountType: "Chartered Account",
            group: paymentAccountGroup,
            amount: paidAmt,
            description: `Payment received for ${itemDesc}`,
            type: "Due Payment",
            accountId: Payment_AccountId,
            branchId: Branch_idBranch,
            userId: userId,
            companyId: invoiceCompanyId,
            transactionType: "debit",
            connection: null
          });

          // Credit the AR account
          await creditDebitLogHelper({
            accountType: "Chartered Account",
            group: "Assets",
            amount: paidAmt,
            description: `Payment applied to ${itemDesc}`,
            type: "Due Payment",
            accountId: AR_AccountId,
            branchId: Branch_idBranch,
            userId: userId,
            companyId: invoiceCompanyId,
            transactionType: "credit",
            connection: null
          });
        }
      }
    } catch (accErr) {
      console.error("Error creating accounting entries for due payment:", accErr);
    }
    // --- ACCOUNTING DOUBLE ENTRY END ---

    // Handle Applied Overpayment (Using previous overpayment)
    if (Applied_Overpayment && parseFloat(Applied_Overpayment) > 0) {
      const appliedOverpaymentVal = parseFloat(Applied_Overpayment);
      await new Promise((resolve, reject) => {
        db.query(
          "UPDATE customer SET overpayment = overpayment - ? WHERE idCustomer = ?",
          [appliedOverpaymentVal, Customer_idCustomer],
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
      });
    }

    // Handle overpayment if provided
    if (Overpayment_Option === "overpayment" && Overpayment_Amount && parseFloat(Overpayment_Amount) > 0) {
      const overpaymentVal = parseFloat(Overpayment_Amount);
      // 1. Update customer overpayment balance
      await new Promise((resolve, reject) => {
        db.query(
          "UPDATE customer SET overpayment = overpayment + ? WHERE idCustomer = ?",
          [overpaymentVal, Customer_idCustomer],
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
      });

      // 2. Insert into customer_credit_log table as overpayment PAYMENT
      const lastLog = await dbService.fetchLastLog(Customer_idCustomer);
      let runningBalance = 0;
      if (lastLog && lastLog.length > 0) {
        runningBalance = parseFloat(lastLog[0].Total_Credit_Balance || 0);
      }
      
      const isMultiChequeOverpayment = Payment_Method === "cheque" && cheques && cheques.length > 0;
      const debitVal = isMultiChequeOverpayment ? 0 : overpaymentVal;
      const newBalance = isMultiChequeOverpayment ? runningBalance : (runningBalance - overpaymentVal);

      await dbService.insertCustomerCreditLog(
        Customer_idCustomer,
        "PAYMENT",
        Type_Id || 0,
        0, // Credit
        debitVal, // Debit (Debit is Paid Amount/payment)
        newBalance.toFixed(2), // Total_Credit_Balance
        Payment_Type,
        "Excess Payment (Overpayment Created)", // Payment_Method as custom note
        Cheque_Type || null,
        Cheque_No || null,
        Cheque_Date || null,
        Cheque_Name || null,
        0, // Cheque_Status
        Branch_idBranch,
        Card_Type || null,
        Card_Number || null,
        Transaction_Id || null,
        receiptBuffer,
        Bank_Name || null,
        Bank_No || null,
        Note,
        receipt_number,
        null,
        Date_Time,
      );
    }

    if (Payment_Method === "bank" && parseFloat(Paid_Amount) > 0 && Bank_Account_Id) {
      try {
        const accountDetails = await bankAccountDBService.getAccountById(
          Bank_Account_Id,
          Branch_idBranch,
        );
        if (accountDetails && accountDetails.length > 0) {
          const currentBal = parseFloat(accountDetails[0].account_balance || 0);
          const payment = currentBal + parseFloat(Paid_Amount);
          await bankAccountDBService.updateCompanyBankAccountBalance(
            Bank_Account_Id,
            payment,
            Branch_idBranch,
          );

          const bank_acc_id = Bank_Account_Id;
          const type = "Due Payment";
          const description = `Payment received from Customer Credit/Due Payment for Customer ID: ${Customer_idCustomer}`;
          const note = `Paid Amount: ${Paid_Amount}`;
          const debit = Paid_Amount;
          const credit = "0.00";
          const balance = currentBal + parseFloat(Paid_Amount);
          const user = accountDetails[0].user;
          const updated_status = "paid";
          const updated_note = `Payment of ${Paid_Amount} received from Customer ID: ${Customer_idCustomer}`;
          const updated_date_time = new Date();
          const updated_user = req.user?.id || 1;
          const payment_id = insertResult ? insertResult.insertId : 0;
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
          );
        }
      } catch (error) {
        console.error(
          "Error updating bank account balance after customer credit log payment:",
          error,
        );
      }
    }

    // Trigger SMS Notifications for Payment received (Event 7)
    if (Type_Id && parseFloat(Paid_Amount) > 0) {
      try {
        const customerDb = require("../services/customerDBService");
        const smsService = require("../services/smsService");
        
        Promise.all([
          customerDb.fetchCustomerById(Customer_idCustomer),
          new Promise((resolve) => {
            db.query("SELECT Invoice_Number, Balance_Amount FROM invoice WHERE idInvoice = ?", [Type_Id], (err, res) => {
              resolve(res && res.length > 0 ? res[0] : null);
            });
          })
        ]).then(async ([customerList, invoice]) => {
          if (customerList && customerList.length > 0 && invoice) {
            const customer = customerList[0];
            const recipientPhone = customer.phoneNumber || customer.Tp;
            const customerName = `${customer.First_Name || ""} ${customer.lastName || ""}`.trim() || customer.displayName;
            
            const smsData = {
              name: customerName,
              invoice_no: invoice.Invoice_Number,
              amount: parseFloat(Paid_Amount).toFixed(2),
              balance: parseFloat(invoice.Balance_Amount).toFixed(2),
              date: new Date().toISOString().split("T")[0]
            };
            
            let resolvedUserId = req.body.User_idUser || req.body.userId || req.userId || req.user?.id || req.user?.userId;
            if (!resolvedUserId && req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
              try {
                const jwt = require("jsonwebtoken");
                const token = req.headers.authorization.substring(7);
                const decoded = jwt.decode(token);
                if (decoded && (decoded.userId || decoded.id || decoded.idAsipiya_User)) {
                  resolvedUserId = decoded.userId || decoded.id || decoded.idAsipiya_User;
                }
              } catch (jwtErr) {}
            }
            
            await smsService.triggerSMSNotification(Branch_idBranch, "invoice_payment", recipientPhone, smsData, resolvedUserId || null);
          }
        }).catch(err => console.error("[SMS-Trigger] Payment SMS failed to fetch info:", err));
      } catch (smsErr) {
        console.error("[SMS-Trigger] Payment SMS failed:", smsErr);
      }
    }

    await dbService.recalculateCustomerCreditLogs(Customer_idCustomer);

    res.status(200).json({ 
      message: "Customer Log added successfully", 
      insertId: insertResult ? insertResult.insertId : null 
    });
  } catch (err) {
    console.error("Error in createCustomerLog:", err);
    res.status(500).json({
      message: "Error creating customer log",
      error: err.message,
      stack: err.stack,
    });
  }
};

const getCustomerCreditLog = async (req, res) => {
  try {
    const { Customer_idCustomer } = req.params;

    const customerLog = await dbService.fetchLogs(Customer_idCustomer);

    if (customerLog.length === 0) {
      return res.status(404).json({ message: "Customer Log not found" });
    }
    res.json(customerLog);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res.status(500).json({
      message: "Error fetching customer credit log",
      error: err.message,
    });
  }
};

const getCustomerPastpayments = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const customerLog = await dbService.fetchpastpayment(Branch_idBranch);

    if (customerLog.length === 0) {
      return res.status(404).json({ message: "Customer Log not found" });
    }
    res.json(customerLog);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res.status(500).json({
      message: "Error fetching customer credit log",
      error: err.message,
    });
  }
};

const getCustomerCreditSummary = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT 
        c.displayName,
        COUNT(DISTINCT cc.Type_Id) AS totalInvoices,
        SUM(CASE 
              WHEN cc.Credit IS NOT NULL AND cc.Credit != '' 
              THEN CAST(cc.Credit AS DECIMAL(10,2)) 
              ELSE 0 
            END) AS totalCredit
      FROM 
        customer_credit_log cc
      JOIN 
        customer c ON c.idCustomer = cc.Customer_idCustomer
      GROUP BY 
        cc.Customer_idCustomer
      ORDER BY 
        totalCredit DESC
    `);

    console.log("✅ Query success:", rows); // 🟢 Add this
    res.status(200).json(rows);
  } catch (error) {
    console.error("❌ SQL error:", error); // 🔥 You'll now see the real SQL/db issue
    res.status(500).json({ message: "Server error", error });
  }
};

const addManualCredit = async (req, res) => {
  try {
    const Customer_idCustomer = req.body.Customer_idCustomer || req.body.customerId;
    const Amount = req.body.Amount || req.body.amount;
    const Description = req.body.Description || req.body.description;
    const Branch_idBranch = req.body.Branch_idBranch || req.body.branchId || (req.body.branch && (req.body.branch.idBranch || req.body.branch));
    const User_idUser = req.body.User_idUser || req.body.userId || req.body.idAsipiya_User || req.body.idUser || req.body.id;

    if (!Customer_idCustomer || !Amount || !Branch_idBranch || !User_idUser) {
      console.error("❌ Missing required fields in manual credit:", {
        Customer_idCustomer,
        Amount,
        Branch_idBranch,
        User_idUser,
        body: req.body
      });
      return res.status(400).json({ 
        message: "Missing required fields",
        details: {
          Customer_idCustomer: !Customer_idCustomer,
          Amount: !Amount,
          Branch_idBranch: !Branch_idBranch,
          User_idUser: !User_idUser
        }
      });
    }

    // Fetch last log to get current running balance
    const lastLog = await dbService.fetchLastLog(Customer_idCustomer);
    let runningBalance = 0;
    if (lastLog && lastLog.length > 0) {
      runningBalance = parseFloat(lastLog[0].Total_Credit_Balance || 0);
    } else {
      const customerDbService = require("../services/customerDBService");
      const custData = await customerDbService.fetchCustomerById(Customer_idCustomer);
      if (custData && custData.length > 0) {
        runningBalance = parseFloat(custData[0].Total_Credit_Balance || 0);
      }
    }

    const newBalance = runningBalance + parseFloat(Amount);

    // Insert manual credit log entry
    await dbService.insertCustomerCreditLog(
      Customer_idCustomer,
      "MANUAL_CREDIT",
      0, // Type_Id = 0
      parseFloat(Amount), // Credit
      0, // Debit
      newBalance.toFixed(2), // Total_Credit_Balance
      0, // Payment_Type
      Description || "Manual Credit Addition", // Payment_Method (description)
      null, // Cheque_Type
      null, // Cheque_No
      null, // Cheque_Date
      null, // Cheque_Name
      0, // Cheque_Status
      Branch_idBranch
    );

    await dbService.recalculateCustomerCreditLogs(Customer_idCustomer);

    const updatedLastLog = await dbService.fetchLastLog(Customer_idCustomer);
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
      "Customer",
      Customer_idCustomer,
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

const getInvoicePayments = async (req, res) => {
  try {
    const { idInvoice } = req.params;
    const payments = await dbService.fetchLogsByInvoiceId(idInvoice);
    res.json(payments);
  } catch (err) {
    console.error("Error fetching invoice payments:", err);
    res.status(500).json({
      message: "Error fetching invoice payments",
      error: err.message,
    });
  }
};

const deleteCustomerCreditLog = async (req, res) => {
  const { idCustomer_Credit_Log } = req.params;
  const userId = req.user?.id || req.user?.userId || 1;

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
            "SELECT * FROM customer_credit_log WHERE idCustomer_Credit_Log = ?",
            [idCustomer_Credit_Log],
            (err, results) => err ? reject(err) : resolve(results)
          );
        });

        if (logResult.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ message: "Credit log not found" });
          });
        }

        const log = logResult[0];
        const Customer_idCustomer = log.Customer_idCustomer;
        const Branch_idBranch = log.Branch_idBranch;
        const Type_Id = log.Type_Id; // Invoice ID
        const Debit = parseFloat(log.Debit) || 0;
        const Credit = parseFloat(log.Credit) || 0;
        const Payment_Method = log.Payment_Method;
        const idInstallment_Payment = log.idInstallment_Payment;

        // Only allow deleting PAYMENT or MANUAL_CREDIT to preserve invoice and other system records
        if (log.Type !== "PAYMENT" && log.Type !== "MANUAL_CREDIT") {
          return connection.rollback(() => {
            connection.release();
            res.status(400).json({ message: "Only manual credit entries or payments can be deleted" });
          });
        }

        // Only reverse if Type is PAYMENT
        if (log.Type === "PAYMENT") {

          // A. Revert customer overpayment if applicable
          if (Payment_Method === "Excess Payment (Overpayment Created)") {
            // This was an excess payment that increased customer's overpayment balance, so decrease it
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE customer SET overpayment = overpayment - ? WHERE idCustomer = ?",
                [Debit, Customer_idCustomer],
                (err, result) => err ? reject(err) : resolve(result)
              );
            });
          } else if (Payment_Method === "Applied Overpayment") {
            // This was an applied overpayment that decreased customer's overpayment balance, so increase it back
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE customer SET overpayment = overpayment + ? WHERE idCustomer = ?",
                [Debit, Customer_idCustomer],
                (err, result) => err ? reject(err) : resolve(result)
              );
            });
          }

          // B. Revert Invoice Balance if Type_Id (Invoice ID) is present and Debit > 0 (it was a payment)
          if (Type_Id && Debit > 0 && Payment_Method !== "Excess Payment (Overpayment Created)") {
            const invoiceResult = await new Promise((resolve, reject) => {
              connection.query(
                "SELECT * FROM invoice WHERE idInvoice = ?",
                [Type_Id],
                (err, results) => err ? reject(err) : resolve(results)
              );
            });

            if (invoiceResult.length > 0) {
              const invoice = invoiceResult[0];
              const Invoice_Number = invoice.Invoice_Number || Type_Id;
              const newPaidAmount = Math.max(0, parseFloat(invoice.Paid_Amount || 0) - Debit);
              const newBalanceAmount = parseFloat(invoice.Balance_Amount || 0) + Debit;
              const newCreditBalance = parseFloat(invoice.Credit_Balance || 0) + Debit;
              await new Promise((resolve, reject) => {
                connection.query(
                  `UPDATE invoice 
                   SET Paid_Amount = ?, 
                       Balance_Amount = ?, 
                       Credit_Balance = ?
                   WHERE idInvoice = ?`,
                  [newPaidAmount, newBalanceAmount, newCreditBalance, Type_Id],
                  (err, result) => err ? reject(err) : resolve(result)
                );
              });

              // C. Revert Installment if idInstallment_Payment is present
              if (idInstallment_Payment) {
                const installmentResult = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT * FROM installment_payment WHERE idInstallment_Payment = ?",
                    [idInstallment_Payment],
                    (err, results) => err ? reject(err) : resolve(results)
                  );
                });

                if (installmentResult.length > 0) {
                  const inst = installmentResult[0];
                  const instPaid = Math.max(0, parseFloat(inst.Paid_Amount || 0) - Debit);
                  const instBal = parseFloat(inst.Balance_Amount || 0) + Debit;
                  
                  await new Promise((resolve, reject) => {
                    connection.query(
                      `UPDATE installment_payment 
                       SET Paid_Amount = ?, 
                           Balance_Amount = ?, 
                           Status = 0
                       WHERE idInstallment_Payment = ?`,
                      [instPaid, instBal, idInstallment_Payment],
                      (err, result) => err ? reject(err) : resolve(result)
                    );
                  });
                }
              }

              // D. Revert Double Entry Accounting Log
              try {
                const invoiceCompanyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
                if (invoiceCompanyId) {
                  let paymentAccountName = "Cash in Hand";
                  const pMethodLower = Payment_Method ? Payment_Method.toLowerCase() : "";

                  if (pMethodLower === "cash") {
                    paymentAccountName = "Cash in Hand";
                  } else if (pMethodLower === "card" || pMethodLower === "online transfer" || pMethodLower.includes("online") || pMethodLower === "direct bank" || pMethodLower.includes("bank")) {
                    paymentAccountName = "Bank Account";
                  } else if (pMethodLower === "cheque") {
                    paymentAccountName = "Cheque Clearing Account";
                  } else if (pMethodLower === "koko" || pMethodLower === "mintpay") {
                    paymentAccountName = "Receivable from Provider";
                  }

                  const Payment_AccountId = await findAccountByNameAndGroup(
                    paymentAccountName, "Assets", invoiceCompanyId, Branch_idBranch, connection
                  );

                  const AR_AccountId = await findAccountByNameAndGroup(
                    "Accounts Receivable (Debtors)", "Assets", invoiceCompanyId, Branch_idBranch, connection
                  );

                  if (Payment_AccountId && AR_AccountId) {
                    // Reversal: Credit the payment account (reducing it)
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Assets",
                      amount: Debit,
                      description: `Reversal of payment received for Invoice ${Invoice_Number}`,
                      type: "Due Payment Reversal",
                      accountId: Payment_AccountId,
                      branchId: Branch_idBranch,
                      userId: userId,
                      companyId: invoiceCompanyId,
                      transactionType: "credit",
                      connection: connection
                    });

                    // Reversal: Debit the AR account (increasing it back)
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Assets",
                      amount: Debit,
                      description: `Reversal of payment applied to Invoice ${Invoice_Number}`,
                      type: "Due Payment Reversal",
                      accountId: AR_AccountId,
                      branchId: Branch_idBranch,
                      userId: userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection: connection
                    });
                  }
                }
              } catch (accErr) {
                console.error("Error reverting accounting entries for payment deletion:", accErr);
              }
            }
          }
        }

        // E. Finally delete the log entry itself
        await dbService.deleteCustomerLogById(idCustomer_Credit_Log, connection);

        await dbService.recalculateCustomerCreditLogs(Customer_idCustomer, connection);

        // F. Log the activity in user activity log
        try {
          const userLogDbService = require("../services/userLogDBService");
          const pad = (n) => (n < 10 ? "0" + n : n);
          const dateObj = new Date();
          const formattedNow = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
          await userLogDbService.insertLog(
            userId,
            formattedNow,
            "Customer",
            Customer_idCustomer,
            log.Type === "MANUAL_CREDIT" ? "delete-manual-credit" : "delete-customer-payment",
            Branch_idBranch
          );
        } catch (uErr) {
          console.error("Error logging user activity for customer log deletion:", uErr);
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
          res.status(200).json({
            message: log.Type === "MANUAL_CREDIT"
              ? "Manual credit deleted successfully"
              : "Payment reversed and deleted successfully",
          });
        });
      } catch (error) {
        connection.rollback(() => {
          connection.release();
          console.error("Error in deleteCustomerCreditLog:", error);
          res.status(500).json({
            message: "Error deleting customer log",
            error: error.message,
          });
        });
      }
    });
  });
};

module.exports = {
  getCustomerCreditLog,
  createCustomerLog,
  getCustomerCreditSummary,
  getCustomerPastpayments,
  addManualCredit,
  getInvoicePayments,
  deleteCustomerCreditLog,
};
