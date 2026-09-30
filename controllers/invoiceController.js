const dbService = require("../services/invoiceDBService");
const rulesDbService = require("../services/rulesDBService");
const materialIssueDBService = require("../services/materialIssueDBService");
const itemDbService = require("../services/productDBService");
const customerLogDbService = require("../services/customerCreditLogDBService");
const stockCardDbService = require("../services/stockCardDBService");
const quotationDbService = require("../services/quotaionDBService");
const userLogDbService = require("../services/userLogDBService");
const installmentLogDbService = require("../services/installmentDBService");
const bankAccountDBService = require("../services/bankAccountDBService");
const bankAccountLogDBService = require("../services/bankAccountLogDBService");
const branchDBService = require("../services/branchDBService");
const employeeDbService = require("../services/employeeDBService");
const customerDbService = require("../services/customerDBService");
const approvalService = require("../services/approvalService");
const { currentDate, currentDateTime, resolveDateTime } = require("../utils/currentData");
const { checkPlanLimit } = require("../utils/planLimits");
const {
  findAccountByNameAndGroup,
  creditDebitLogHelper,
  ensureAccountExists,
} = require("./accountingController");
const { productHistoryLogHelper } = itemDbService;
const db = require("../db/db");
const promisePool = db.promise();

// Resolves a readable customer name from the customer table record (which uses displayName/companyName/First_Name) or request body fallback.
const resolveCustomerName = (custRow, fallbackBodyName = null) => {
  if (fallbackBodyName && typeof fallbackBodyName === 'string' && fallbackBodyName.trim() && fallbackBodyName.trim() !== 'Unknown Customer') {
    return fallbackBodyName.trim();
  }
  if (!custRow) return fallbackBodyName || 'Walk-in Customer';
  const name =
    custRow.displayName ||
    custRow.companyName ||
    (custRow.First_Name ? `${custRow.First_Name} ${custRow.lastName || ''}`.trim() : null) ||
    custRow.Customer_Name ||
    custRow.FirstName ||
    custRow.Name;
  return name && name.trim() ? name.trim() : (fallbackBodyName || 'Walk-in Customer');
};

// Resolves the double-entry Assets account name for one payment method string.
// Used to generalize the single-account debit into a per-split-item debit for split payments.
const resolvePaymentAccountName = (method) => {
  const m = (method || "").toLowerCase();
  if (m === "cash") return "Cash in Hand";
  if (m === "cheque") return "Cheque Clearing Account";
  if (m === "koko" || m === "mintpay") return "Receivable from Provider";
  return "Bank Account"; // card, online, bank
};
const generateAdvancedInvoiceNumber = (format, sequenceNumber, businessName) => {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const monthNamesMMM = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthMMM = monthNamesMMM[now.getMonth()];

  const bizShort = (businessName || "ASIP").replace(/\s+/g, "").substring(0, 4).toUpperCase();

  let result = format || "";
  result = result.replace(/YYYY/g, yyyy);
  result = result.replace(/YY/g, yy);
  result = result.replace(/MMMM/g, monthMMM);
  result = result.replace(/MMM/g, monthMMM);
  result = result.replace(/MM/g, mm);
  result = result.replace(/DD/g, dd);
  result = result.replace(/QQQQ/g, bizShort);

  const matchX = result.match(/X+/);
  if (matchX) {
    const xLength = matchX[0].length;
    const paddedSeq = String(sequenceNumber).padStart(xLength, "0");
    result = result.replace(/X+/, paddedSeq);
  } else {
    result = result + sequenceNumber;
  }
  return result;
};

const saveBase64Receipt = (base64String) => {
  if (!base64String) return null;

  try {
    // Check if it's already a path or URL
    if (
      !base64String.startsWith("data:") &&
      (base64String.startsWith("uploads/") || base64String.startsWith("http"))
    ) {
      return base64String;
    }

    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }

    const type = matches[1];
    const data = matches[2];
    const buffer = Buffer.from(data, "base64");

    // Handle common extensions
    let extension = type.split("/")[1];
    if (extension === "jpeg") extension = "jpg";
    if (extension === "svg+xml") extension = "svg";

    const fileName = `receipt_${Date.now()}_${Math.floor(
      Math.random() * 1000,
    )}.${extension}`;
    const uploadDir = path.join(__dirname, "../uploads/receipts");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return `uploads/receipts/${fileName}`;
  } catch (error) {
    console.error("Error saving receipt:", error);
    return null;
  }
};

const sanitizeValue = (value) => {
  if (
    value === "" ||
    value === undefined ||
    value === "undefined" ||
    value === null
  ) {
    return null;
  }
  return value;
};

const recalculateCustomerCreditLogs = customerLogDbService.recalculateCustomerCreditLogs;

const revertInvoiceSideEffects = async (idInvoice, connection) => {
  // 1. Fetch Invoice
  const invoiceResults = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT * FROM invoice WHERE idInvoice = ?",
      [idInvoice],
      (err, results) => err ? reject(err) : resolve(results)
    );
  });

  if (!invoiceResults || invoiceResults.length === 0) {
    return; // Invoice not found, nothing to revert
  }

  const invoice = invoiceResults[0];
  const Customer_idCustomer = invoice.Customer_idCustomer;
  const Branch_idBranch = invoice.Branch_idBranch;
  const Invoice_Number = invoice.Invoice_Number;

  console.log(`[revertInvoiceSideEffects] Reverting invoice side effects for Invoice ID: ${idInvoice}, No: ${Invoice_Number}, Customer: ${Customer_idCustomer}`);

  // 2. Fetch all customer credit logs associated with this invoice
  const customerLogs = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT idCustomer_Credit_Log, Debit, Credit, Payment_Method FROM customer_credit_log WHERE Type_Id = ? AND Type IN ('INVOICE', 'PAYMENT')",
      [idInvoice],
      (err, results) => err ? reject(err) : resolve(results)
    );
  });

  let newOverpaymentAmount = 0;
  let oldAppliedOverpayment = 0;
  const creditLogIds = [];

  for (const log of customerLogs) {
    creditLogIds.push(log.idCustomer_Credit_Log);
    if (log.Payment_Method === "Excess Payment (Overpayment Created)") {
      newOverpaymentAmount += parseFloat(log.Debit) || 0;
    } else if (log.Payment_Method && log.Payment_Method.startsWith("Overpayment Applied: LKR")) {
      const match = log.Payment_Method.match(/Overpayment Applied: LKR ([\d.]+)/);
      if (match) {
        oldAppliedOverpayment += parseFloat(match[1]) || 0;
      }
    }
  }

  // Revert customer overpayment balance
  const overpaymentChange = oldAppliedOverpayment - newOverpaymentAmount;
  if (overpaymentChange !== 0) {
    console.log(`[revertInvoiceSideEffects] Reverting customer overpayment balance by: ${overpaymentChange} (Old Applied: ${oldAppliedOverpayment}, New Created: ${newOverpaymentAmount})`);
    await customerDbService.updateCustomerOverpayment(Customer_idCustomer, overpaymentChange, connection);
  }

  // 3. Delete customer credit logs for this invoice
  await new Promise((resolve, reject) => {
    connection.query(
      "DELETE FROM customer_credit_log WHERE Type_Id = ? AND Type IN ('INVOICE', 'PAYMENT')",
      [idInvoice],
      (err, results) => err ? reject(err) : resolve(results)
    );
  });

  // Recalculate customer credit logs running balance
  await recalculateCustomerCreditLogs(Customer_idCustomer, connection);

  // 4. Revert Bank Account updates and delete bank logs
  const bankLogs = await new Promise((resolve, reject) => {
    const query = creditLogIds.length > 0
      ? "SELECT * FROM company_bank_has_log WHERE (payment_id = ? OR payment_id IN (?)) AND branch_id = ?"
      : "SELECT * FROM company_bank_has_log WHERE payment_id = ? AND branch_id = ?";
    const params = creditLogIds.length > 0
      ? [idInvoice, creditLogIds, Branch_idBranch]
      : [idInvoice, Branch_idBranch];
    connection.query(query, params, (err, results) => err ? reject(err) : resolve(results));
  });

  for (const blog of bankLogs) {
    const debitAmt = parseFloat(blog.debit) || 0;
    const creditAmt = parseFloat(blog.credit) || 0;
    const netChange = debitAmt - creditAmt;

    if (netChange !== 0) {
      console.log(`[revertInvoiceSideEffects] Reverting Bank Account ID ${blog.bank_acc_id} balance by -${netChange}`);
      // Revert balance (subtract the netChange)
      await new Promise((resolve, reject) => {
        connection.query(
          "UPDATE company_bank_accounts SET account_balance = account_balance - ? WHERE idbank = ? AND branch_id = ?",
          [netChange, blog.bank_acc_id, Branch_idBranch],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Adjust subsequent bank logs' running balance
      await new Promise((resolve, reject) => {
        connection.query(
          "UPDATE company_bank_has_log SET balance = balance - ? WHERE bank_acc_id = ? AND branch_id = ? AND idbank_log > ?",
          [netChange, blog.bank_acc_id, Branch_idBranch, blog.idbank_log],
          (err) => err ? reject(err) : resolve()
        );
      });
    }
  }

  // Delete bank logs
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

  // 5. Revert Accounting log entries and balances
  const accountingLogs = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT * FROM accounting_accounts_log WHERE Description LIKE ? AND branchId = ?",
      [`%Invoice ${Invoice_Number}%`, Branch_idBranch],
      (err, results) => err ? reject(err) : resolve(JSON.parse(JSON.stringify(results)))
    );
  });

  for (const alog of accountingLogs) {
    const debitAmt = parseFloat(alog.Debit) || 0;
    const creditAmt = parseFloat(alog.Credit) || 0;

    // Fetch account Group_Of_Type
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

      // Revert the amount:
      // If it increased by Debit, subtract Debit. If it decreased by Credit, add Credit.
      // E.g. Asset: newBalance = currentBalance - Debit + Credit
      // If Liability: newBalance = currentBalance + Debit - Credit
      const revertAmount = isAssetOrExpense
        ? creditAmt - debitAmt
        : debitAmt - creditAmt;

      console.log(`[revertInvoiceSideEffects] Reverting account ID ${alog.Accounting_Accounts_idAccounting_Accounts} (${account.Group_Of_Type}) balance by ${revertAmount}`);

      await new Promise((resolve, reject) => {
        connection.query(
          "UPDATE accounting_accounts SET Account_Balance = Account_Balance + ? WHERE idAccounting_Accounts = ?",
          [revertAmount, alog.Accounting_Accounts_idAccounting_Accounts],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Shift subsequent ledger log balances
      await new Promise((resolve, reject) => {
        connection.query(
          "UPDATE accounting_accounts_log SET Balance = Balance + ? WHERE Accounting_Accounts_idAccounting_Accounts = ? AND idAccounting_Accounts_Log > ?",
          [revertAmount, alog.Accounting_Accounts_idAccounting_Accounts, alog.idAccounting_Accounts_Log],
          (err) => err ? reject(err) : resolve()
        );
      });
    }
  }

  // Delete accounting logs
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

  // 6. Revert Material Issue Mappings
  const materialMaps = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT * FROM material_issue_invoice_map WHERE invoice_id = ?",
      [idInvoice],
      (err, results) => err ? reject(err) : resolve(results)
    );
  });

  for (const map of materialMaps) {
    const qty = parseFloat(map.qty_invoiced) || 0;
    // Revert billing qty on material_issue_items
    await new Promise((resolve, reject) => {
      connection.query(
        `UPDATE material_issue_items
         SET qty_invoiced = qty_invoiced - ?,
             billing_status = CASE
               WHEN qty_invoiced - ? >= qty_issued THEN 'invoiced'
               WHEN qty_invoiced - ? > 0 THEN 'partial'
               ELSE 'pending'
             END
         WHERE id = ?`,
        [qty, qty, qty, map.issue_item_id],
        (err) => err ? reject(err) : resolve()
      );
    });

    // Recalculate parent note status
    await materialIssueDBService.recalcNoteStatus(map.issue_note_id, connection);
  }

  // Delete mapping rows
  await new Promise((resolve, reject) => {
    connection.query(
      "DELETE FROM material_issue_invoice_map WHERE invoice_id = ?",
      [idInvoice],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 7. Reset Service Jobs
  await new Promise((resolve, reject) => {
    connection.query(
      "UPDATE service_jobs SET status = 'Pending', invoice_id = NULL WHERE invoice_id = ?",
      [idInvoice],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 8. Reset Estimates
  await new Promise((resolve, reject) => {
    connection.query(
      "UPDATE estimates SET status = 'Pending', invoice_no = NULL WHERE invoice_no = ?",
      [Invoice_Number],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 9. Delete Follow-up Appointments
  await new Promise((resolve, reject) => {
    connection.query(
      "DELETE FROM appointments WHERE invoice_id = ?",
      [idInvoice],
      (err) => err ? reject(err) : resolve()
    );
  });

  // 10. Revert Customer Loyalty Points if any were awarded
  try {
    const customerLoyaltyService = require("../services/customerLoyaltyService");
    await customerLoyaltyService.revertPointsForInvoice(idInvoice);
  } catch (loyaltyRevErr) {
    console.error("[CustomerLoyalty] Error reverting points for invoice in revertInvoiceSideEffects:", loyaltyRevErr);
  }

  // 11. Revert Gift Voucher Redemption if any was redeemed
  try {
    const giftVoucherService = require("../services/giftVoucherService");
    await giftVoucherService.revertVoucherRedemption(idInvoice, connection);
  } catch (gvRevErr) {
    console.error("[GiftVoucher] Error reverting voucher in revertInvoiceSideEffects:", gvRevErr);
  }
};


const createInvoice = async (req, res) => {
  const {
    Quotation_idQuotation,
    service_job_id,
    estimate_id,
    Invoice_Date,
    Customer_idCustomer,
    Address,
    Employee_idEmployee,
    Total,
    Discount_Presentage,
    Discount_Amount,
    Discount_Type,
    Discount2_Type,
    Discount2_Presentage,
    Discount2_Amount,
    Net_Amount,
    Note,
    Payment_Type,
    Interest_Amount,
    Interest_Presentage,
    Interest_Type,
    Paid_Amount,
    Balance_Amount,
    Credit_Balance,
    Branch_idBranch,
    User_idUser,
    items,
    Installment_Count,
    Applied_Overpayment,
    Payment_Method,
    Card_Type,
    Card_Number,
    Transaction_Id,
    Receipt,
    Cheque_Type,
    Cheque_No,
    Cheque_Date,
    Cheque_Name,
    Bank_Account_Id,
    Vat_Amount,
    Vat_Type,
    Extra_Charge_Label,
    Extra_Charge,
    user,
    cheques,
    split_payments,
    Overpayment_Option,
    Warehouse_Id,
    place_of_supply,
    custom_fields_data,
    gift_voucher_code,
    gift_voucher_codes,
    gift_voucher_amount,
    applied_vouchers,
    invoiced_voucher_ids,
    redeemed_loyalty_points,
    loyalty_discount_amount,
    loyalty_redemption_token,
  } = req.body;

  // Proactive Staging for Invoice Creation
  if (!req.is_approved_webhook && !req.body?.is_approved_webhook) {
    try {
      const branchId = parseInt(Branch_idBranch, 10) || 1;
      let companyId = req.headers["company_id"] || req.user?.company_id || req.body?.companyId;
      if (!companyId || companyId === branchId) {
        companyId = await branchDBService.getCompanyIdByBranch(branchId);
      }
      companyId = parseInt(companyId, 10) || 1;

      const completedApprovals = req.body.completed_approvals || [];
      let actionToApprove = null;

      let parsedItems = [];
      try {
        parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
      } catch (e) { }

      // 1. Check Discount (Invoice discount or item-level discount)
      const hasDiscount = (
        (parseFloat(Discount_Amount) || 0) > 0 ||
        (parseFloat(Discount2_Amount) || 0) > 0 ||
        (parseFloat(Discount_Presentage) || 0) > 0 ||
        (parseFloat(Discount2_Presentage) || 0) > 0 ||
        (Array.isArray(parsedItems) && parsedItems.some(i => (parseFloat(i.Discount) || 0) > 0 || (parseFloat(i.Discount_Amount) || 0) > 0))
      );

      if (hasDiscount) {
        if (!completedApprovals.includes('APPLY_INVOICE_DISCOUNT') && await approvalService.isApprovalRequired(companyId, branchId, 'APPLY_INVOICE_DISCOUNT')) {
          actionToApprove = 'APPLY_INVOICE_DISCOUNT';
        }
      }
      
      // 2. Check Cheque Payment
      const hasCheque = (
        Payment_Type === "Cheque" ||
        Payment_Method === "cheque" ||
        (cheques && cheques.length > 0) ||
        Cheque_No ||
        (split_payments && split_payments.some(sp => sp.method === "cheque" || sp.Payment_Method === "cheque"))
      );

      if (!actionToApprove && hasCheque) {
        if (!completedApprovals.includes('MAKE_CHEQUE_PAYMENT') && await approvalService.isApprovalRequired(companyId, branchId, 'MAKE_CHEQUE_PAYMENT')) {
          actionToApprove = 'MAKE_CHEQUE_PAYMENT';
        }
      }

      let limitInfo = 0;
      let currentBalance = 0;
      let invoiceCreditBalance = 0;
      let newCreditBalance = 0;

      // 3. Check Credit Limit Override
      const isCreditPayment = (
        parseInt(Payment_Type, 10) === 3 ||
        String(Payment_Type).toLowerCase() === "credit" ||
        String(Payment_Method).toLowerCase() === "credit"
      );

      if (!actionToApprove && isCreditPayment) {
        // Check if limit is exceeded
        limitInfo = await new Promise((resolve) => {
          const dbQuery = require("../db/db");
          dbQuery.query(
            "SELECT credit_limit FROM customer WHERE idCustomer = ?",
            [Customer_idCustomer],
            (err, results) => {
              if (err || !results || results.length === 0) resolve(0);
              else resolve(parseFloat(results[0].credit_limit) || 0);
            }
          );
        });
        
        let customerName = resolveCustomerName(null, req.body.customer_name || req.body.customerName || req.body.Customer_Name);
        try {
          const custResults = await customerDbService.fetchCustomerById(Customer_idCustomer);
          if (custResults && custResults.length > 0) {
            currentBalance = parseFloat(custResults[0].Total_Credit_Balance) || 0;
            customerName = resolveCustomerName(custResults[0], req.body.customer_name || req.body.customerName || req.body.Customer_Name);
          }
        } catch (err) {
          currentBalance = 0;
        }
        
        invoiceCreditBalance = parseFloat(Credit_Balance) || 0;
        newCreditBalance = currentBalance + invoiceCreditBalance;

        if (limitInfo > 0 && newCreditBalance > limitInfo) {
          if (!completedApprovals.includes('CREDIT_LIMIT_OVERRIDE') && await approvalService.isApprovalRequired(companyId, branchId, 'CREDIT_LIMIT_OVERRIDE')) {
            actionToApprove = 'CREDIT_LIMIT_OVERRIDE';
          }
        }
      }

      // 4. Default: Check CREATE_INVOICE
      if (!actionToApprove) {
        if (!completedApprovals.includes('CREATE_INVOICE') && await approvalService.isApprovalRequired(companyId, branchId, 'CREATE_INVOICE')) {
          actionToApprove = 'CREATE_INVOICE';
        }
      }

      if (actionToApprove) {
        let customerName = resolveCustomerName(null, req.body.customer_name || req.body.customerName || req.body.Customer_Name);
        try {
          const custResults = await customerDbService.fetchCustomerById(Customer_idCustomer);
          if (custResults && custResults.length > 0) {
            customerName = resolveCustomerName(custResults[0], req.body.customer_name || req.body.customerName || req.body.Customer_Name);
          }
        } catch (err) {}

        await approvalService.triggerApprovalRequest({
          action_type: actionToApprove,
          module_name: 'Invoice',
          erp_record_id: null,
          company_id: companyId,
          branch_id: branchId,
          initiated_by: User_idUser || Employee_idEmployee,
          payload_summary: {
            Total, Net_Amount, Note, Customer_idCustomer,
            customer_name: customerName,
            amount: Net_Amount || Total,
            Discount_Amount, Discount2_Amount, Vat_Amount, Extra_Charge,
            creditLimitInfo: {
              limitInfo, currentBalance, invoiceCreditBalance, newCreditBalance
            },
            action: actionToApprove,
            invoice_items: parsedItems.map(i => ({ name: i.Item_Name || i.Long_Description || 'Unknown', qty: i.Qty, price: i.Rate || i.Price || i.Selling_Price || 0 })),
            pending_updates: {
               req_body: req.body,
               req_params: req.params,
               req_user: req.user,
               req_headers: req.headers,
               req_userId: req.userId || User_idUser,
               req_userRole: req.userRole
            }
          }
        });
        return res.status(202).json({
          message: `${actionToApprove.replace(/_/g, ' ')} submitted for approval. It will take effect once approved.`,
          approval_required: true,
          requires_approval: true,
          approval_name: actionToApprove.replace(/_/g, ' ')
        });
      }
    } catch (err) {
      console.error("Approval Check Error:", err);
      return res.status(500).json({ error: "Approval trigger failed" });
    }
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
        const savedReceipt = saveBase64Receipt(Receipt);

        // 1. Handle Applied Overpayment (Using previous overpayment)
        if (Applied_Overpayment && parseFloat(Applied_Overpayment) > 0) {
          await customerDbService.updateCustomerOverpayment(
            Customer_idCustomer,
            -parseFloat(Applied_Overpayment),
            connection,
          );

          // Record the usage of overpayment in the credit log as a payment (Debit)
          // We'll do this after inserting the invoice so we have an Invoice_idInvoice
        }

        // 2. Handle New Overpayment (Creating new overpayment from current excess)
        // Ensure applied overpayment, gift voucher, and loyalty discount are factored into the invoice's total paid amount
        let actualPaidAmount =
          (parseFloat(Paid_Amount) || 0) +
          (parseFloat(Applied_Overpayment) || 0) +
          (parseFloat(gift_voucher_amount) || 0) +
          (parseFloat(loyalty_discount_amount) || 0);
        let newOverpaymentAmount = 0;
        let finalPaidAmount = actualPaidAmount;

        if (actualPaidAmount > parseFloat(Net_Amount)) {
          newOverpaymentAmount = actualPaidAmount - parseFloat(Net_Amount);
          if (Overpayment_Option === "balance") {
            newOverpaymentAmount = 0;
            finalPaidAmount = actualPaidAmount;
          } else {
            finalPaidAmount = parseFloat(Net_Amount); // Only record up to Net_Amount on the invoice
            await customerDbService.updateCustomerOverpayment(
              Customer_idCustomer,
              newOverpaymentAmount,
              connection,
            );
          }
        }

        // Strict Route-based scoping for Field Driver/Salesperson (Owner/Admin is NEVER restricted)
        if (req.userId) {
          const isOwnerAdmin = await branchDBService.isOwnerOrAdminUser(
            req.userId,
            Branch_idBranch,
            req.userRole || req.headers["x-user-role"]
          );
          if (!isOwnerAdmin) {
            const privRows = await new Promise((res) => {
              connection.query(
                "SELECT Route_Management, Daily_Route_View FROM user_privilages WHERE User_idUser = ? AND (Branch_idBranch = ? OR Branch_idBranch = 0 OR Branch_idBranch IS NULL) ORDER BY Branch_idBranch DESC LIMIT 1",
                [req.userId, Branch_idBranch],
                (err, rows) => res(rows || [])
              );
            });
            if (privRows.length > 0 && privRows[0].Daily_Route_View === 1 && privRows[0].Route_Management === 0) {
              const ruleRows = await new Promise((res) => {
                connection.query(
                  "SELECT enable_route_management FROM rules WHERE Branch_idBranch = ? LIMIT 1",
                  [Branch_idBranch],
                  (err, rows) => res(rows || [])
                );
              });
              if (ruleRows.length > 0 && ruleRows[0].enable_route_management === 1) {
                const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
                const routeDBService = require("../services/routeDBService");
                const todayCustIds = await routeDBService.getAssignedCustomerIdsForUserToday(req.userId, Branch_idBranch, todayDate);
                const allUserCustIds = await routeDBService.getAllCustomerIdsForUser(req.userId, Branch_idBranch);
                const allowedCustIds = Array.from(new Set([...todayCustIds, ...allUserCustIds])).map(Number);
                if (!allowedCustIds.includes(Number(Customer_idCustomer))) {
                  connection.rollback(() => {
                    connection.release();
                    return res.status(403).json({
                      success: false,
                      message: "You are not authorized to invoice this customer. This customer is not scheduled on your active route for today.",
                    });
                  });
                  return;
                }
              }
            }
          }
        }

        let companyId = null;
        // Check plan limits for Free plan
        try {
          companyId =
            await branchDBService.getCompanyIdByBranch(Branch_idBranch);
          if (companyId) {
            const limitCheck = await checkPlanLimit(
              companyId,
              "invoice",
              Branch_idBranch,
            );
            if (!limitCheck.allowed) {
              connection.rollback(() => {
                connection.release();
                res.status(403).json({
                  success: false,
                  limitExceeded: true,
                  title: "📊 Free Plan Limit Reached",
                  message: `You've reached your ${limitCheck.plan} plan limit of ${limitCheck.limit} invoices for this month.`,
                  description: `You have created ${limitCheck.current} out of ${limitCheck.limit} invoices available in Month ${limitCheck.month} of your Free plan.`,
                  upgradeMessage:
                    "Want to create unlimited invoices? Upgrade to our Professional plan for unlimited access and premium features!",
                  callToAction: "Upgrade to Pro",
                  limit: limitCheck.limit,
                  current: limitCheck.current,
                  remaining: 0,
                  plan: limitCheck.plan,
                  month: limitCheck.month,
                });
              });
              return;
            }
          }
        } catch (limitError) {
          console.error("Error checking invoice limit:", limitError);
          // Continue with invoice creation if limit check fails
        }

        const rules =
          await rulesDbService.getInvoiceNumberDetails(Branch_idBranch);

        const base_letter_part = rules[0].Invoice_No_Start_With;
        const starting_number = rules[0].Invoice_No_Strat_From;
        const salesman_enabled = parseInt(rules[0].salesman_enabled) === 1;
        const salesman_invoice_update =
          parseInt(rules[0].salesman_invoice_update) === 1;

        let letter_part = base_letter_part;

        // If salesman is enabled, salesman_invoice_update is enabled, and an employee is assigned, prefix with first 3 chars of salesman name
        if (
          salesman_enabled &&
          salesman_invoice_update &&
          Employee_idEmployee
        ) {
          try {
            const employee =
              await employeeDbService.fetchEmployeeById(Employee_idEmployee);
            if (employee && employee.length > 0) {
              const salesmanPrefix = employee[0].Employee_Name.replace(
                /\s+/g,
                "",
              )
                .substring(0, 3)
                .toUpperCase();
              letter_part = `${salesmanPrefix}${base_letter_part}`;
              console.log(
                `[CREATE-INVOICE] Salesman prefix applied: ${letter_part}`,
              );
            }
          } catch (empErr) {
            console.error(
              `[CREATE-INVOICE] Error fetching employee, using default prefix:`,
              empErr,
            );
          }
        }

        let next_invoice_number;

        if (parseInt(rules[0].advanced_invoice_number) === 1) {
          let branchName = "";
          try {
            const branchDetails = await branchDBService.fetchBranch(Branch_idBranch);
            if (branchDetails && branchDetails.length > 0) {
              branchName = branchDetails[0].Company || branchDetails[0].Name || "";
            }
          } catch (branchErr) {
            console.error("Error fetching branch details:", branchErr);
          }

          const prefixPart = generateAdvancedInvoiceNumber(letter_part, "", branchName).replace(/X+/g, "");
          let last_invoice_adv = await dbService.getLastInvoiceBySalesmanPrefix(
            Branch_idBranch,
            prefixPart
          );

          let sequence = parseInt(starting_number, 10) || 1;
          if (last_invoice_adv && last_invoice_adv.length > 0) {
            const last_num = last_invoice_adv[0].Invoice_Number;
            const match = last_num.match(/(\d+)$/);
            if (match) {
              sequence = parseInt(match[1], 10) + 1;
            }
          } else {
            const overall_last = await dbService.getLastInvoice(Branch_idBranch);
            if (overall_last && overall_last.length > 0) {
              const last_num = overall_last[0].Invoice_Number;
              const match = last_num.match(/(\d+)$/);
              if (match) {
                sequence = parseInt(match[1], 10) + 1;
              }
            }
          }
          next_invoice_number = generateAdvancedInvoiceNumber(letter_part, sequence, branchName);
        } else {
          next_invoice_number = `${letter_part}${starting_number}`;

          let last_invoice = [];
          if (salesman_enabled && Employee_idEmployee && salesman_invoice_update) {
            last_invoice = await dbService.getLastInvoiceBySalesman(
              Branch_idBranch,
              Employee_idEmployee,
            );
          }

          // Fall back to prefix matching if no invoice exists for this salesman yet, or no salesman selected
          if (!last_invoice || last_invoice.length === 0) {
            last_invoice = await dbService.getLastInvoiceBySalesmanPrefix(
              Branch_idBranch,
              letter_part,
            );
          }

          if (last_invoice?.length !== 0) {
            const last_invoice_number = last_invoice[0].Invoice_Number;

            // Extract the non-digit prefix and trailing digit sequence to preserve format (e.g. leading zeros, hyphens)
            const match = last_invoice_number.match(/^(.*?)(\d+)$/);
            if (match) {
              const prefixPart = match[1];
              const numericStr = match[2];
              const numericPart = parseInt(numericStr, 10);
              const nextNumericPart = numericPart + 1;
              const nextNumericStr = nextNumericPart.toString().padStart(numericStr.length, "0");
              next_invoice_number = `${prefixPart}${nextNumericStr}`;
            } else {
              const matchOld = last_invoice_number.match(/\d/);
              if (matchOld) {
                const digitPosition = matchOld.index;
                const numericPart = parseInt(last_invoice_number.slice(digitPosition), 10);
                const nextNumericPart = numericPart + 1;
                next_invoice_number = `${letter_part}${nextNumericPart}`;
              }
            }
          }
        }
        let Invoice_Number = next_invoice_number;

        if (req.body.isInvoiceNoEditable && req.body.Invoice_Number) {
          // Double check if the manual invoice number already exists
          const existingInvoices = await dbService.checkInvoice(req.body.Invoice_Number, Branch_idBranch);
          if (existingInvoices && existingInvoices.length > 0) {
            connection.rollback(() => {
              connection.release();
              res.status(400).json({
                message: `Invoice number ${req.body.Invoice_Number} already exists.`,
              });
            });
            return;
          }
          Invoice_Number = req.body.Invoice_Number;
        }

        const applied_credit = parseFloat(Applied_Overpayment) || 0;
        const voucher_amount = parseFloat(gift_voucher_amount) || 0;
        const loyalty_amount = parseFloat(loyalty_discount_amount) || 0;
        const net_due = parseFloat(Credit_Balance) || 0;
        const gross_due = net_due + applied_credit + voucher_amount + loyalty_amount;

        const lastCustomerLog =
          await customerLogDbService.fetchLastLog(Customer_idCustomer);

        let runningTotalBalance =
          lastCustomerLog?.length === 0
            ? 0
            : parseFloat(lastCustomerLog[0].Total_Credit_Balance);

        // Calculate initial balance for the invoice entry
        // The invoice entry adds gross_due to the current balance.
        const balanceAfterInvoice = runningTotalBalance + gross_due;

        const invoiceResolvedDateTime = resolveDateTime(Invoice_Date);
        const Created_Date = invoiceResolvedDateTime.substring(0, 16);
        const created_at_db = invoiceResolvedDateTime;

        //change the cheque date to null it it is empty
        const safeChequeDate =
          !Cheque_Date || Cheque_Date.trim() === "" ? null : Cheque_Date;

        // Ensure gift voucher details are present in invoice Note
        let finalInvoiceNote = Note || "";
        if (Array.isArray(applied_vouchers) && applied_vouchers.length > 0) {
          applied_vouchers.forEach((av) => {
            const code = av.voucher_code || av.code;
            if (code && !finalInvoiceNote.includes(code)) {
              const val = Number(av.amount || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
              const gvStr = `Gift Voucher: ${code} (Val: ${val} LKR)`;
              finalInvoiceNote = finalInvoiceNote ? `${finalInvoiceNote} [${gvStr}]` : `[${gvStr}]`;
            }
          });
        } else if (gift_voucher_code && !finalInvoiceNote.includes(gift_voucher_code)) {
          const vAmtFormatted = parseFloat(gift_voucher_amount || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const gvStr = `Gift Voucher: ${gift_voucher_code} (Val: ${vAmtFormatted} LKR)`;
          finalInvoiceNote = finalInvoiceNote ? `${finalInvoiceNote} [${gvStr}]` : `[${gvStr}]`;
        }

        // Append Loyalty Points Redeemed notation
        if (redeemed_loyalty_points && Number(redeemed_loyalty_points) > 0 && !finalInvoiceNote.includes("Loyalty Points Redeemed")) {
          const lValFormatted = parseFloat(loyalty_discount_amount || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const loyaltyStr = `Loyalty Points Redeemed: ${redeemed_loyalty_points} pts (Val: ${lValFormatted} LKR)`;
          finalInvoiceNote = finalInvoiceNote ? `${finalInvoiceNote} [${loyaltyStr}]` : `[${loyaltyStr}]`;
        }

        // Bank Account ID is optional for bank payments now

        const invoice = await dbService.insertInvoice(
          Invoice_Number,
          Quotation_idQuotation || 0,
          Invoice_Date,
          Customer_idCustomer,
          Address,
          Employee_idEmployee || User_idUser,
          Total,
          Discount_Type || "percentage",
          parseFloat(Discount_Presentage) || 0,
          parseFloat(Discount_Amount) || 0,
          Discount2_Type || "percentage",
          parseFloat(Discount2_Presentage) || 0,
          parseFloat(Discount2_Amount) || 0,
          Net_Amount,
          items.length,
          finalInvoiceNote,
          Payment_Type || 1,
          parseFloat(Interest_Amount) || 0,
          parseFloat(Interest_Presentage) || 0,
          Interest_Type || "Amount",
          finalPaidAmount, // Using capped paid amount
          Balance_Amount,
          Credit_Balance,
          balanceAfterInvoice - applied_credit - voucher_amount - loyalty_amount, // Matches gross_due - applied_credit - voucher_amount - loyalty_amount = net_due
          Created_Date,
          created_at_db, // Passing the new timestamp
          Branch_idBranch,
          Payment_Method,
          sanitizeValue(Card_Type),
          sanitizeValue(Card_Number),
          sanitizeValue(Transaction_Id),
          savedReceipt,
          cheques && cheques.length > 0 ? null : sanitizeValue(Cheque_Type),
          cheques && cheques.length > 0 ? null : sanitizeValue(Cheque_No),
          cheques && cheques.length > 0 ? null : safeChequeDate,
          cheques && cheques.length > 0 ? null : sanitizeValue(Cheque_Name),
          sanitizeValue(Bank_Account_Id),
          parseFloat(Vat_Amount) || 0,
          Vat_Type || "exclusive",
          Extra_Charge_Label || "Extra Charge",
          Extra_Charge || 0,
          user,
          place_of_supply,
          custom_fields_data,
          connection,
        );
        if (Quotation_idQuotation !== 0) {
          await quotationDbService.statusUpdate(
            Quotation_idQuotation,
            connection,
          );
        }

        const Invoice_idInvoice = invoice.insertId;

        // Tag Route to Invoice
        try {
          let resolvedRouteId = req.body.Route_idRoute || null;
          if (!resolvedRouteId && Customer_idCustomer) {
            const custRouteRows = await new Promise((resolve) => {
              connection.query(
                "SELECT Route_idRoute FROM customer WHERE idCustomer = ? LIMIT 1",
                [Customer_idCustomer],
                (err, rows) => resolve(rows || [])
              );
            });
            resolvedRouteId = custRouteRows?.[0]?.Route_idRoute || null;
          }

          if (resolvedRouteId) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE invoice SET Route_idRoute = ? WHERE idInvoice = ?",
                [resolvedRouteId, Invoice_idInvoice],
                (err) => (err ? reject(err) : resolve())
              );
            });
          }

          // Link with Daily Route Customer Stop if provided
          if (req.body.Daily_Route_Customer_id) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE daily_route_customer SET Invoice_idInvoice = ?, Visit_Status = 'Invoiced' WHERE idDaily_Route_Customer = ?",
                [Invoice_idInvoice, req.body.Daily_Route_Customer_id],
                (err) => (err ? reject(err) : resolve())
              );
            });
          }
        } catch (routeTagErr) {
          console.error("Error tagging route to invoice:", routeTagErr);
        }

        const Customer_Return_idCustomer_Return = req.body.Customer_Return_idCustomer_Return;
        if (Customer_Return_idCustomer_Return) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE customer_return SET Status = 1, Invoice_idInvoice = ? WHERE idCustomer_Return = ?",
              [Invoice_idInvoice, Customer_Return_idCustomer_Return],
              (err, result) => {
                if (err) return reject(err);
                resolve(result);
              }
            );
          });
          console.log(`[CREATE-INVOICE] Linked and marked Customer Return #${Customer_Return_idCustomer_Return} as Complete with Invoice ID #${Invoice_idInvoice}`);
        }

        if (service_job_id) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE service_jobs SET status = 'Completed', invoice_id = ? WHERE id = ?",
              [Invoice_idInvoice, service_job_id],
              (err) => {
                if (err) return reject(err);
                resolve();
              }
            );
          });
        }

        if (estimate_id) {
          await new Promise((resolve, reject) => {
            connection.query(
              "SELECT id, parent_estimate_id FROM estimates WHERE id = ?",
              [estimate_id],
              (err, results) => {
                if (err) return reject(err);
                if (results.length === 0) return resolve();

                const rootParentId = results[0].parent_estimate_id || results[0].id;

                connection.query(
                  "UPDATE estimates SET status = 'Completed', invoice_no = ? WHERE id = ? OR parent_estimate_id = ?",
                  [Invoice_Number, rootParentId, rootParentId],
                  (err2) => {
                    if (err2) return reject(err2);
                    resolve();
                  }
                );
              }
            );
          });
        }

        if (Payment_Type === 2) {
          // If explicit installments provided (from frontend with interest), use them
          if (
            items.some((item) => item.installments) ||
            req.body.installments
          ) {
            const installmentsToSave = req.body.installments || [];

            if (installmentsToSave.length > 0) {
              for (const inst of installmentsToSave) {
                await installmentLogDbService.insertInstallment(
                  Invoice_idInvoice,
                  Customer_idCustomer,
                  inst.Date,
                  inst.Term,
                  inst.Amount, // Amount with interest
                  0, // Penalty Amount
                  inst.Amount, // Total Pending Amount
                  0, // Paid Amount
                  inst.Amount, // Balance Amount
                  0, // Status
                  Branch_idBranch,
                  connection,
                );
              }
            } else {
              // Fallback if array is empty but type is 2 (should not happen if frontend sends correctly)
              // Use existing logic
              let installment_amount = parseFloat(Credit_Balance);
              const current_invoice_Date = new Date(Invoice_Date)
                .toISOString()
                .split("T")[0];

              let single_installment_amount =
                Math.round((installment_amount / Installment_Count) * 100) /
                100;

              let total_of_regular_installments =
                single_installment_amount * (Installment_Count - 1);

              let last_installment_amount =
                Math.round(
                  (installment_amount - total_of_regular_installments) * 100,
                ) / 100;

              for (let i = 1; i <= Installment_Count; i++) {
                const [year, month, day] = current_invoice_Date
                  .split("-")
                  .map(Number);
                const date = new Date(year, month - 1 + i, day);
                const add_date = `${date.getFullYear()}-${(date.getMonth() + 1)
                  .toString()
                  .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

                const current_amount =
                  i === Installment_Count
                    ? last_installment_amount
                    : single_installment_amount;

                await installmentLogDbService.insertInstallment(
                  Invoice_idInvoice,
                  Customer_idCustomer,
                  add_date,
                  i,
                  current_amount,
                  0,
                  current_amount,
                  0,
                  current_amount,
                  0,
                  Branch_idBranch,
                  connection,
                );
              }
            }
          } else {
            // Legacy logic (calculates from Credit_Balance, likely missing interest if frontend didn't send it)
            let installment_amount = parseFloat(Credit_Balance);
            const current_invoice_Date = new Date(Invoice_Date)
              .toISOString()
              .split("T")[0];

            let single_installment_amount =
              Math.round((installment_amount / Installment_Count) * 100) / 100;

            let total_of_regular_installments =
              single_installment_amount * (Installment_Count - 1);

            let last_installment_amount =
              Math.round(
                (installment_amount - total_of_regular_installments) * 100,
              ) / 100;

            for (let i = 1; i <= Installment_Count; i++) {
              const [year, month, day] = current_invoice_Date
                .split("-")
                .map(Number);
              const date = new Date(year, month - 1 + i, day);
              const add_date = `${date.getFullYear()}-${(date.getMonth() + 1)
                .toString()
                .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

              const current_amount =
                i === Installment_Count
                  ? last_installment_amount
                  : single_installment_amount;

              await installmentLogDbService.insertInstallment(
                Invoice_idInvoice,
                Customer_idCustomer,
                add_date,
                i,
                current_amount,
                0,
                current_amount,
                0,
                current_amount,
                0,
                Branch_idBranch,
                connection,
              );
            }
          }
        }


        const invoicePaidCash = (parseFloat(Paid_Amount) || 0) - (parseFloat(newOverpaymentAmount) || 0);
        let logGrossDue = gross_due + invoicePaidCash;
        const hasMultiCheques = Payment_Method === "cheque" && cheques && cheques.length > 0;
        const hasSplitPayments =
          Payment_Method === "split" &&
          Array.isArray(split_payments) &&
          split_payments.length > 0;

        if (logGrossDue !== 0 || hasMultiCheques || hasSplitPayments) {
          runningTotalBalance += logGrossDue;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "INVOICE",
            Invoice_idInvoice,
            logGrossDue,
            0,
            runningTotalBalance,
            Payment_Type,
            Payment_Method,
            !hasMultiCheques && Payment_Method === "cheque" ? Cheque_Type : null,
            !hasMultiCheques && Payment_Method === "cheque" ? Cheque_No : null,
            !hasMultiCheques && Payment_Method === "cheque" ? safeChequeDate : null,
            !hasMultiCheques && Payment_Method === "cheque" ? Cheque_Name : null,
            0, // Cheque_Status (default pending)
            Branch_idBranch,
            Payment_Method === "card" ? Card_Type : null,
            Payment_Method === "card" ? Card_Number : null,
            Payment_Method === "card" ? Transaction_Id : null,
            Payment_Method === "bank" || Payment_Method === "online"
              ? savedReceipt
              : null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle Gift Voucher payment in customer credit log
        if (voucher_amount > 0) {
          runningTotalBalance -= voucher_amount;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            voucher_amount, // Debit (reduces debt)
            runningTotalBalance,
            Payment_Type,
            "Gift Voucher",
            null,
            null,
            null,
            null,
            0, // Cheque_Status
            Branch_idBranch,
            null,
            null,
            null,
            null,
            null,
            null,
            `Voucher Applied: ${gift_voucher_code || ""}`,
            null,
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle Customer Loyalty redemption in customer credit log
        if (loyalty_amount > 0) {
          runningTotalBalance -= loyalty_amount;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            loyalty_amount, // Debit (reduces debt)
            runningTotalBalance,
            Payment_Type,
            "Loyalty Redemption",
            null,
            null,
            null,
            null,
            0, // Cheque_Status
            Branch_idBranch,
            null,
            null,
            null,
            null,
            null,
            null,
            `Loyalty Points Redeemed: ${redeemed_loyalty_points || 0} pts`,
            null,
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle spot payment if invoicePaidCash > 0 and NOT multi-cheques and NOT split payments
        if (invoicePaidCash > 0 && !hasMultiCheques && !hasSplitPayments) {
          runningTotalBalance -= invoicePaidCash;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            invoicePaidCash, // Debit
            runningTotalBalance,
            Payment_Type,
            Payment_Method,
            Payment_Method === "cheque" ? Cheque_Type : null,
            Payment_Method === "cheque" ? Cheque_No : null,
            Payment_Method === "cheque" ? safeChequeDate : null,
            Payment_Method === "cheque" ? Cheque_Name : null,
            0, // Cheque_Status
            Branch_idBranch,
            Payment_Method === "card" ? Card_Type : null,
            Payment_Method === "card" ? Card_Number : null,
            Payment_Method === "card" ? Transaction_Id : null,
            Payment_Method === "bank" || Payment_Method === "online"
              ? savedReceipt
              : null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle Multi-Cheques
        if (hasMultiCheques) {
          for (const cheque of cheques) {
            const chequeAmount = parseFloat(cheque.Amount) || 0;
            runningTotalBalance -= chequeAmount;
            await customerLogDbService.insertCustomerCreditLog(
              Customer_idCustomer,
              "PAYMENT",
              Invoice_idInvoice,
              0, // Credit
              chequeAmount, // Debit
              runningTotalBalance,
              Payment_Type,
              "cheque",
              cheque.Cheque_Type,
              cheque.Cheque_No,
              cheque.Cheque_Date,
              cheque.Cheque_Name,
              0, // Pending
              Branch_idBranch,
              null, null, null, null, null, null,
              null, // Note
              null, // receipt_number
              connection,
              invoiceResolvedDateTime,
            );
          }
        }

        // Handle Split Payments - one PAYMENT credit-log row per split item,
        // plus a per-item bank balance update for bank/online rows with a bank_account_id.
        if (hasSplitPayments) {
          for (const sp of split_payments) {
            const spAmount = parseFloat(sp.amount) || 0;
            if (spAmount <= 0) continue;
            runningTotalBalance -= spAmount;
            const spMethod = (sp.method || "").toLowerCase();
            const safeSpChequeDate =
              !sp.cheque_date || String(sp.cheque_date).trim() === ""
                ? null
                : sp.cheque_date;
            await customerLogDbService.insertCustomerCreditLog(
              Customer_idCustomer,
              "PAYMENT",
              Invoice_idInvoice,
              0, // Credit
              spAmount, // Debit
              runningTotalBalance,
              Payment_Type,
              spMethod,
              spMethod === "cheque" ? sp.cheque_type || null : null,
              spMethod === "cheque" ? sp.cheque_no || null : null,
              spMethod === "cheque" ? safeSpChequeDate : null,
              spMethod === "cheque" ? sp.cheque_name || null : null,
              0, // Cheque_Status (pending) - surfaces in Cheque Management
              Branch_idBranch,
              spMethod === "card" ? sp.card_type || null : null,
              spMethod === "card" ? sp.card_number || null : null,
              ["card", "bank", "online", "koko", "mintpay"].includes(spMethod)
                ? sp.transaction_id || null
                : null,
              null,
              null,
              null,
              sp.note || null, // Note
              null, // receipt_number
              connection,
              invoiceResolvedDateTime, // Date_Time
              spMethod === "bank" || spMethod === "online"
                ? sp.bank_account_id || null
                : null,
            );

            if (
              (spMethod === "bank" || spMethod === "online") &&
              sp.bank_account_id
            ) {
              try {
                const spAccountDetails = await bankAccountDBService.getAccountById(
                  sp.bank_account_id,
                  Branch_idBranch,
                );
                const spCurrentBal = parseFloat(
                  spAccountDetails?.[0]?.account_balance || 0,
                );
                const spNewBal = spCurrentBal + spAmount;
                const spBalanceUpdated =
                  await bankAccountDBService.updateCompanyBankAccountBalance(
                    sp.bank_account_id,
                    spNewBal,
                    Branch_idBranch,
                    connection,
                  );
                if (spBalanceUpdated) {
                  await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
                    sp.bank_account_id,
                    "Invoice Payment (Split)",
                    `Split payment (${spMethod}) received for Invoice ID: ${Invoice_idInvoice}`,
                    `Paid Amount: ${spAmount}`,
                    spAmount,
                    "0.00",
                    spNewBal,
                    spAccountDetails?.[0]?.user,
                    "paid",
                    `Split payment of ${spAmount} received for Invoice ID: ${Invoice_idInvoice}`,
                    new Date(),
                    User_idUser,
                    Invoice_idInvoice,
                    "-",
                    "0",
                    Branch_idBranch,
                    connection,
                  );
                }
              } catch (error) {
                console.error(
                  "Error updating bank account balance for split payment row:",
                  error,
                );
              }
            }
          }
        }

        // 3. Record Applied Overpayment in Customer Log (as a PAYMENT reference)
        if (applied_credit > 0) {
          // Note: We do NOT subtract applied_credit from runningTotalBalance here
          // because the balance was already reduced when the overpayment was first created.
          // The INVOICE entry above already increased the balance (using up the credit).
          // We log this entry with 0 amounts just as a reference note.
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            0, // Debit (Log 0 so it doesn't affect the balance twice)
            runningTotalBalance,
            Payment_Type,
            `Overpayment Applied: LKR ${applied_credit.toFixed(2)}`,
            null,
            null,
            null,
            null,
            0,
            Branch_idBranch,
            null,
            null,
            null,
            null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // 4. Record New Overpayment (Excess Payment) in Customer Log
        if (newOverpaymentAmount > 0) {
          runningTotalBalance -= newOverpaymentAmount;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            newOverpaymentAmount, // Debit
            runningTotalBalance,
            Payment_Type,
            "Excess Payment (Overpayment Created)",
            null,
            null,
            null,
            null,
            0,
            Branch_idBranch,
            null,
            null,
            null,
            null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // 🔍 DEBUGGING: Log invoice type and items to process
        const invoiceType =
          Quotation_idQuotation !== 0 ? "QUOTATION-CONVERTED" : "DIRECT";
        console.log(`\n========================================`);
        console.log(`[INVOICE-${invoiceType}] Starting invoice creation`);
        console.log(`Invoice ID: ${Invoice_idInvoice}`);
        console.log(`Quotation ID: ${Quotation_idQuotation}`);
        console.log(`Items to process: ${items.length}`);
        console.log(`========================================\n`);

        let totalCOGS = 0;
        const warehouseLogsMap = {}; // { warehouseId: { items: [], branchId } }

        for (let index = 0; index < items.length; index++) {
          const invItem = items[index];
          console.log(
            `[INVOICE-${invoiceType}] Processing item ${index + 1}/${items.length
            }: Item ID ${invItem.Item_idItem}`,
          );

          let item;
          if (invItem.Item_idItem <= 0) {
            console.log(`[INVOICE-${invoiceType}] Manual item detected (ID: ${invItem.Item_idItem}). Mocking item record.`);
            item = [{
              idItem: invItem.Item_idItem,
              Description: invItem.Description || "Manual Item",
              Long_Description: invItem.Long_Description || invItem.Description || "Manual Item",
              Type: "2", // Non-physical / service
              Qty: 0,
              Qty_Type: invItem.Qty_Type || 1, // Default qty type
              Cost: 0,
              Real_Cost: 0,
              Rate: invItem.Rate || 0
            }];
          } else {
            item = await itemDbService.fetchItem(invItem.Item_idItem, connection);
            // 🔍 DEBUGGING: Verify item fetch
            if (!item || item.length === 0) {
              console.error(
                `[INVOICE-${invoiceType}] ❌ ERROR: Failed to fetch item ${invItem.Item_idItem}`,
              );
              throw new Error(
                `Item ${invItem.Item_idItem} not found in database`,
              );
            }
          }
          console.log(
            `[INVOICE-${invoiceType}] ✓ Item fetched/mocked: ${item[0].Description}, Type: ${item[0].Type}, Current Qty: ${item[0].Qty}`,
          );

          // Use the provided long description or fall back to the item's long description
          const itemDescription =
            invItem.Long_Description ||
            item[0].Long_Description ||
            item[0].Description;

          if (
            Number(invItem.Serial_No) === 1 &&
            invItem.SelectedSerials?.length > 0 &&
            invItem.Item_idItem > 0
          ) {
            const serial_discount =
              invItem.Discount / invItem.SelectedSerials?.length;
            await Promise.all(
              invItem.SelectedSerials.map(async (serial_number) => {
                let serial_no_id = 0;

                switch (serial_number.exists) {
                  case 1:
                    serial_no_id = await dbService.updateSerials(
                      serial_number.Serial_No,
                      connection,
                    );
                    serial_no_id = serial_no_id.ID;
                    break;
                  case 0:
                    const insertSerial = await dbService.insertSerialNumbers(
                      0,
                      invItem.Item_idItem,
                      0,
                      serial_number.Serial_No,
                      Branch_idBranch,
                      connection,
                      invItem.Variation_Id || null,
                    );
                    serial_no_id = insertSerial.insertId;
                    break;
                }

                const itemResult = await dbService.insertInvoiceItem(
                  Invoice_idInvoice,
                  invItem.Item_idItem,
                  1,
                  serial_no_id,
                  item[0].Description,
                  itemDescription, // Using the determined description
                  item[0].Qty_Type,
                  1,
                  invItem.Rate,
                  invItem.Amount,
                  invItem.Discount_Type || "percentage",
                  parseFloat(serial_discount) || 0,
                  invItem.Total_Amount,
                  Branch_idBranch,
                  invItem.Variation_Id, // Pass Variation_Id
                  invItem.Remarks, // Pass Remarks
                  connection,
                  invItem.is_bonus_line ? 1 : 0,
                  invItem.promo_rule_id || null,
                  invItem.Detailed_Description || null,
                );
                if (invItem.is_net_item) {
                  const insertedItemId = itemResult.insertId;
                  await new Promise((resolve, reject) => {
                    connection.query("UPDATE invoice_has_item SET is_net_item = 1 WHERE ID = ?", [insertedItemId], (err) => (err ? reject(err) : resolve()));
                  });
                }
              }),
            );
          } else {
            const itemResult = await dbService.insertInvoiceItem(
              Invoice_idInvoice,
              invItem.Item_idItem,
              0,
              0,
              item[0].Description,
              itemDescription, // Using the determined description
              item[0].Qty_Type,
              invItem.Qty,
              invItem.Rate,
              invItem.Amount,
              invItem.Discount_Type || "percentage",
              parseFloat(invItem.Discount) || 0,
              invItem.Total_Amount,
              Branch_idBranch,
              invItem.Variation_Id || null, // Pass Variation_Id
              invItem.Remarks, // Pass Remarks
              connection,
              invItem.is_bonus_line ? 1 : 0,
              invItem.promo_rule_id || null,
              invItem.Detailed_Description || null,
            );
            if (invItem.is_net_item) {
              const insertedItemId = itemResult.insertId;
              await new Promise((resolve, reject) => {
                connection.query("UPDATE invoice_has_item SET is_net_item = 1 WHERE ID = ?", [insertedItemId], (err) => (err ? reject(err) : resolve()));
              });
            }

            if (invItem.Item_idItem <= 0 && (invItem.manual_supplier_name || invItem.manual_cost)) {
              const insertedItemId = itemResult.insertId;
              const manualSql = `
                INSERT INTO invoice_has_item_manual_details (invoice_has_item_id, Branch_idBranch, supplier_name, cost)
                VALUES (?, ?, ?, ?)
              `;
              await new Promise((resolve, reject) => {
                connection.query(
                  manualSql,
                  [insertedItemId, Branch_idBranch, invItem.manual_supplier_name || null, invItem.manual_cost || null],
                  (err) => (err ? reject(err) : resolve())
                );
              });
            }
          }

          if (invItem.is_material_issue && invItem.issue_item_id) {
            console.log(`[INVOICE-${invoiceType}] Processing Material Issue billing for item_id: ${invItem.Item_idItem}, issue_item_id: ${invItem.issue_item_id}`);

            // Update issue item billing qty
            await materialIssueDBService.updateIssueItemBillingQty(
              invItem.issue_item_id,
              invItem.Qty,
              connection
            );

            // Insert mapping record
            await materialIssueDBService.insertIssueInvoiceMap(
              {
                issue_item_id: invItem.issue_item_id,
                issue_note_id: invItem.issue_note_id,
                invoice_id: Invoice_idInvoice,
                qty_invoiced: invItem.Qty,
                project_id: req.body.project_id || null,
                branch_id: Branch_idBranch,
              },
              connection
            );

            // Recalc parent note status
            await materialIssueDBService.recalcNoteStatus(invItem.issue_note_id, connection);
          }

          // 🔍 DEBUGGING: Check inventory reduction condition
          console.log(
            `[INVOICE-${invoiceType}] Checking if item requires inventory reduction...`,
          );
          console.log(
            `[INVOICE-${invoiceType}] Item Type: "${item[0].Type}" (Should be "1" for physical products)`,
          );

          if (item[0].Type === "1" && !invItem.is_material_issue) {
            console.log(
              `[INVOICE-${invoiceType}] ✓ Item is physical product - WILL reduce inventory`,
            );

            const cost = parseFloat(item[0].Cost) || 0;
            const qty = parseFloat(invItem.Qty) || 0;
            if (invItem.Discount_Type === "RTN") {
              totalCOGS -= cost * qty;
            } else {
              totalCOGS += cost * qty;
            }

            let new_qty = 0;
            let in_qty = 0;
            let out_qty = 0;
            let sih_qty = 0;

            // 🔍 DEBUGGING: Log variation ID from request
            console.log(
              `[INVOICE-${invoiceType}] Variation_Id from request: ${invItem.Variation_Id
              } (type: ${typeof invItem.Variation_Id})`,
            );

            // Case A: Variation Product
            if (invItem.Variation_Id && invItem.Variation_Id > 0) {
              console.log(
                `[INVOICE-${invoiceType}] Item has variation ID: ${invItem.Variation_Id}`,
              );

              try {
                if (invItem.Discount_Type === "RTN") {
                  console.log(
                    `[INVOICE-${invoiceType}] Return transaction - adding back to variation stock: ${invItem.Qty}`,
                  );
                  // For returns, we add back to variation stock
                  const result = await itemDbService.processInvoiceVariation(
                    invItem.Variation_Id,
                    -parseFloat(invItem.Qty),
                    connection,
                  );
                  console.log(
                    `[INVOICE-${invoiceType}] Database result - Rows affected: ${result.affectedRows || 0
                    }`,
                  );
                  if (result.affectedRows === 0) {
                    throw new Error(
                      `Variation ID ${invItem.Variation_Id} not found or update failed`,
                    );
                  }
                  in_qty = parseFloat(invItem.Qty);
                } else {
                  console.log(
                    `[INVOICE-${invoiceType}] Sale transaction - deducting from variation stock: ${invItem.Qty}`,
                  );
                  // For sales, we deduct from variation stock
                  const result = await itemDbService.processInvoiceVariation(
                    invItem.Variation_Id,
                    parseFloat(invItem.Qty),
                    connection,
                  );
                  console.log(
                    `[INVOICE-${invoiceType}] Database result - Rows affected: ${result.affectedRows || 0
                    }`,
                  );
                  if (result.affectedRows === 0) {
                    throw new Error(
                      `Variation ID ${invItem.Variation_Id} not found or update failed`,
                    );
                  }
                  out_qty = parseFloat(invItem.Qty);
                }
                // Main item quantity remains unchanged
                new_qty = parseFloat(item[0].Qty);
                console.log(
                  `[INVOICE-${invoiceType}] ✓ Variation inventory updated successfully`,
                );

                // Log variation history
                const isReturn = invItem.Discount_Type === "RTN";
                // Get current variation qty for log (since it changed)
                const [vData] = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT qty FROM item_variations WHERE id = ?",
                    [invItem.Variation_Id],
                    (err, results) =>
                      err ? reject(err) : resolve([results]),
                  );
                });
                const vNewQty = parseFloat(vData[0]?.qty || 0);
                sih_qty = vNewQty;
                const vOldQty = isReturn
                  ? vNewQty - parseFloat(invItem.Qty)
                  : vNewQty + parseFloat(invItem.Qty);

                await productHistoryLogHelper({
                  productId: invItem.Item_idItem,
                  variationId: invItem.Variation_Id,
                  quantityChange: isReturn
                    ? parseFloat(invItem.Qty)
                    : -parseFloat(invItem.Qty),
                  oldQty: vOldQty,
                  newQty: vNewQty,
                  type: isReturn ? "Invoice Return" : "Invoice Sale",
                  description: `${isReturn ? "Stock returned" : "Stock sold"} via Invoice ID: ${Invoice_idInvoice} (No: ${Invoice_Number})`,
                  branchId: Branch_idBranch,
                  companyId,
                  userId: User_idUser,
                  referenceId: Invoice_idInvoice,
                  connection,
                });
              } catch (variationError) {
                console.error(
                  `[INVOICE-${invoiceType}] ❌ ERROR updating variation inventory:`,
                  variationError.message,
                );
                throw new Error(
                  `Failed to update variation ${invItem.Variation_Id}: ${variationError.message}`,
                );
              }
            }
            // Case B: Standard Product
            else {
              console.log(
                `[INVOICE-${invoiceType}] Standard product (no variation)`,
              );

              try {
                if (invItem.Discount_Type === "RTN") {
                  console.log(
                    `[INVOICE-${invoiceType}] Return transaction - adding back to stock: ${invItem.Qty}`,
                  );
                  in_qty = parseFloat(invItem.Qty);
                  new_qty = parseFloat(item[0].Qty) + parseFloat(invItem.Qty);
                } else {
                  console.log(
                    `[INVOICE-${invoiceType}] Sale transaction - deducting from stock: ${invItem.Qty}`,
                  );
                  out_qty = parseFloat(invItem.Qty);
                  new_qty = parseFloat(item[0].Qty) - parseFloat(invItem.Qty);
                }

                console.log(
                  `[INVOICE-${invoiceType}] Current Qty: ${item[0].Qty} → New Qty: ${new_qty}`,
                );

                await itemDbService.itemProcess(
                  item[0].Cost,
                  item[0].Real_Cost,
                  new_qty,
                  invItem.Item_idItem,
                  connection,
                );
                console.log(
                  `[INVOICE-${invoiceType}] ✓ Standard inventory updated in database`,
                );

                // Log history
                const isReturn = invItem.Discount_Type === "RTN";
                await productHistoryLogHelper({
                  productId: invItem.Item_idItem,
                  variationId: null,
                  quantityChange: isReturn
                    ? parseFloat(invItem.Qty)
                    : -parseFloat(invItem.Qty),
                  oldQty: parseFloat(item[0].Qty),
                  newQty: new_qty,
                  type: isReturn ? "Invoice Return" : "Invoice Sale",
                  description: `${isReturn ? "Stock returned" : "Stock sold"} via Invoice ID: ${Invoice_idInvoice} (No: ${Invoice_Number})`,
                  branchId: Branch_idBranch,
                  companyId,
                  userId: User_idUser,
                  referenceId: Invoice_idInvoice,
                  connection,
                });
              } catch (standardError) {
                console.error(
                  `[INVOICE-${invoiceType}] ❌ ERROR updating standard inventory:`,
                  standardError.message,
                );
                throw new Error(
                  `Failed to update standard product ${invItem.Item_idItem}: ${standardError.message}`,
                );
              }
              sih_qty = new_qty;
            }

            // Deduct from batches (direct or automatic FIFO fallback)
            try {
              if (out_qty > 0) {
                console.log(`[INVOICE-${invoiceType}] Deducting ${out_qty} from batches for item: ${invItem.Item_idItem}`);
                const batchResult = await itemDbService.deductStockFromBatches(
                  invItem.Item_idItem,
                  invItem.Variation_Id || null,
                  out_qty,
                  invItem.Batch_Id || null,
                  Branch_idBranch,
                  connection,
                  invItem.Warehouse_Id || Warehouse_Id || null
                );

                if (batchResult && Array.isArray(batchResult.deductions)) {
                  for (const d of batchResult.deductions) {
                    if (d.warehouseId && d.deductedQty > 0) {
                      const whId = d.warehouseId;
                      if (!warehouseLogsMap[whId]) {
                        warehouseLogsMap[whId] = {
                          items: [],
                          branchId: Branch_idBranch,
                        };
                      }
                      const existing = warehouseLogsMap[whId].items.find(
                        (it) => it.id === invItem.Item_idItem
                      );
                      const itemName =
                        invItem.Item_Name ||
                        invItem.Description ||
                        invItem.Item_Description ||
                        item[0]?.Description ||
                        "Product";
                      if (existing) {
                        existing.qty += d.deductedQty;
                      } else {
                        warehouseLogsMap[whId].items.push({
                          id: invItem.Item_idItem,
                          name: itemName,
                          qty: d.deductedQty,
                        });
                      }
                    }
                  }
                }
              }
            } catch (batchDeductErr) {
              console.error(`[INVOICE-${invoiceType}] Error during batch stock deduction:`, batchDeductErr);
            }

            console.log(
              `[INVOICE-${invoiceType}] Creating stock card entry...`,
            );
            await stockCardDbService.insertStockCard(
              item[0].idItem,
              item[0].Description,
              "INVOICE",
              Invoice_idInvoice,
              item[0].Cost,
              item[0].Real_Cost,
              item[0].Rate,
              in_qty,
              out_qty,
              sih_qty,
              Branch_idBranch,
              connection,
              invItem.Variation_Id || null,
            );
            console.log(
              `[INVOICE-${invoiceType}] ✓ Stock card entry created`,
            );
          } else {
            console.log(
              `[INVOICE-${invoiceType}] ⚠️ Item is NOT a physical product (Type: ${item[0].Type}) - Skipping inventory reduction`,
            );
          }

          // Check if this is a service item
          if (item[0].Type === "2" || item[0].Type === "Service") {
            if (invItem.appointment) {
              const appt = invItem.appointment;
              const startDateTime = appt.start_datetime ? new Date(appt.start_datetime) : new Date();
              const endDateTime = appt.end_datetime ? new Date(appt.end_datetime) : new Date(startDateTime.getTime() + 3600000);
              const recurrenceEnd = appt.recurrence_end_date ? new Date(appt.recurrence_end_date) : null;

              // Generate date series for recurring appointments
              const instances = [];
              const durationMs = endDateTime.getTime() - startDateTime.getTime();

              if (appt.is_recurring === 1 && appt.recurrence_pattern && recurrenceEnd) {
                let currentStart = new Date(startDateTime);
                let currentEnd = new Date(endDateTime);
                recurrenceEnd.setHours(23, 59, 59, 999);

                let occurrences = 0;
                while (currentStart <= recurrenceEnd && occurrences < 100) {
                  instances.push({
                    start: new Date(currentStart),
                    end: new Date(currentEnd),
                  });

                  if (appt.recurrence_pattern === "daily") {
                    currentStart.setDate(currentStart.getDate() + (parseInt(appt.recurrence_interval) || 1));
                  } else if (appt.recurrence_pattern === "weekly") {
                    currentStart.setDate(currentStart.getDate() + (parseInt(appt.recurrence_interval) || 1) * 7);
                  } else if (appt.recurrence_pattern === "monthly") {
                    currentStart.setMonth(currentStart.getMonth() + (parseInt(appt.recurrence_interval) || 1));
                  } else if (appt.recurrence_pattern === "yearly") {
                    currentStart.setFullYear(currentStart.getFullYear() + (parseInt(appt.recurrence_interval) || 1));
                  } else {
                    break;
                  }
                  currentEnd = new Date(currentStart.getTime() + durationMs);
                  occurrences++;
                }
              } else {
                instances.push({
                  start: startDateTime,
                  end: endDateTime,
                });
              }

              // Bulk insert instances
              for (const inst of instances) {
                const apptQuery = `INSERT INTO appointments 
                  (title, start_datetime, end_datetime, location, description, 
                   participant_type, participant_id, participant_name, branch_id, user_id, 
                   is_service_followup, invoice_id, service_job_id, service_due_date,
                   is_recurring, recurrence_pattern, recurrence_interval, recurrence_end_date, notify_person_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                await new Promise((resolve, reject) => {
                  connection.query(
                    apptQuery,
                    [
                      appt.title || `Service: ${item[0].Description || invItem.Item_Name}`,
                      inst.start,
                      inst.end,
                      appt.location || "Client Location",
                      appt.description || `Service appointment from Invoice #${Invoice_idInvoice}`,
                      appt.participant_type || "customer",
                      appt.participant_id || Customer_idCustomer,
                      appt.participant_name || null,
                      Branch_idBranch,
                      User_idUser || 1,
                      1, // is_service_followup
                      Invoice_idInvoice,
                      service_job_id || null,
                      inst.start, // service_due_date
                      appt.is_recurring || 0,
                      appt.recurrence_pattern || null,
                      appt.recurrence_interval || 1,
                      recurrenceEnd,
                      appt.notify_person_id || null,
                    ],
                    (apptErr, apptRes) => {
                      if (apptErr) console.error("Error creating custom follow-up appointment instance:", apptErr);
                      resolve();
                    }
                  );
                });
              }
            } else {
              // Fallback to follow-up period (default to 1m if none specified)
              const followPeriod = invItem.followup_period || "1m";
              let followMonths = 0;
              if (followPeriod === "1m") followMonths = 1;
              else if (followPeriod === "2m") followMonths = 2;
              else if (followPeriod === "3m") followMonths = 3;
              else if (followPeriod === "6m") followMonths = 6;
              else if (followPeriod === "1y") followMonths = 12;
              else if (followPeriod === "2y") followMonths = 24;

              if (followMonths > 0) {
                const baseDate = Invoice_Date ? new Date(Invoice_Date) : new Date();
                const dueDate = new Date(baseDate);
                dueDate.setMonth(dueDate.getMonth() + followMonths);

                const startDateTime = new Date(dueDate);
                startDateTime.setHours(9, 0, 0, 0);
                const endDateTime = new Date(startDateTime);
                endDateTime.setHours(10, 0, 0, 0);

                const title = `Service Follow-up: ${item[0].Description || invItem.Item_Name}`;
                const desc = `Automatically scheduled follow-up for ${item[0].Description || invItem.Item_Name} from Invoice #${Invoice_idInvoice}. Remarks: ${invItem.Remarks || 'N/A'}`;

                const apptQuery = `INSERT INTO appointments 
                  (title, start_datetime, end_datetime, location, description, 
                   participant_type, participant_id, participant_name, branch_id, user_id, 
                   is_service_followup, invoice_id, service_job_id, service_due_date)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                await new Promise((resolve, reject) => {
                  connection.query(
                    apptQuery,
                    [
                      title,
                      startDateTime,
                      endDateTime,
                      "Client Location",
                      desc,
                      "customer",
                      Customer_idCustomer,
                      null,
                      Branch_idBranch,
                      User_idUser || 1,
                      1, // is_service_followup
                      Invoice_idInvoice,
                      service_job_id || null,
                      dueDate, // service_due_date
                    ],
                    (apptErr, apptRes) => {
                      if (apptErr) {
                        console.error("Error creating default follow-up appointment:", apptErr);
                      } else {
                        console.log(`[INVOICE-${invoiceType}] Successfully created default service follow-up appointment with ID: ${apptRes.insertId}`);
                      }
                      resolve();
                    }
                  );
                });
              }
            }
          }

          console.log(
            `[INVOICE-${invoiceType}] ✓ Completed processing item ${index + 1}/${items.length
            }\n`,
          );
        }

        // ✅ Log to Warehouse Audit (STOCK_SALE)
        // If an explicit Warehouse_Id was supplied for this invoice/branch, ensure any items
        // not already accounted for by batch-level warehouse tracking are logged under it.
        if (Warehouse_Id) {
          const [whCheck] = await new Promise((resolve) => {
            connection.query(
              "SELECT id FROM warehouses WHERE id = ? AND branch_id = ? LIMIT 1",
              [Warehouse_Id, Branch_idBranch],
              (err, rows) => resolve([rows || []])
            );
          });
          if (whCheck && whCheck.length > 0) {
            if (!warehouseLogsMap[Warehouse_Id]) {
              warehouseLogsMap[Warehouse_Id] = {
                items: [],
                branchId: Branch_idBranch,
              };
            }
            for (const invItem of items) {
              if (invItem.Item_idItem && !invItem.is_material_issue) {
                const alreadyLogged = warehouseLogsMap[Warehouse_Id].items.some(
                  (it) => it.id === invItem.Item_idItem
                );
                if (!alreadyLogged) {
                  warehouseLogsMap[Warehouse_Id].items.push({
                    id: invItem.Item_idItem,
                    name:
                      invItem.Item_Name ||
                      invItem.Description ||
                      invItem.Item_Description ||
                      "Product",
                    qty: parseFloat(invItem.Qty || 0),
                  });
                }
              }
            }
          }
        }

        for (const [whId, data] of Object.entries(warehouseLogsMap)) {
          if (!data.items || data.items.length === 0) continue;
          const details = {
            type: "STOCK_SALE",
            reference: `Invoice ID: ${Invoice_idInvoice}`,
            invoiceNo: Invoice_Number,
            items: data.items,
          };
          const ip =
            req.headers["x-forwarded-for"] ||
            req.socket.remoteAddress ||
            "0.0.0.0";
          const ua = req.headers["user-agent"] || "unknown";

          const sqlLog = `
            INSERT INTO warehouse_audit_logs 
              (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
            VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
          `;
          await new Promise((resolve) => {
            connection.query(
              sqlLog,
              [
                whId,
                data.branchId,
                User_idUser,
                JSON.stringify(details),
                ip,
                ua,
              ],
              (err) => {
                if (err) console.error("Warehouse sale audit log failed:", err);
                resolve();
              },
            );
          });
        }

        console.log(`[INVOICE-${invoiceType}] ✅ All items processed successfully`);
        console.log(`========================================\n`);

        //inser the paid amount to the bank account if the payment method is bank
        if (Payment_Method === "bank" && Paid_Amount > 0 && Bank_Account_Id) {
          try {
            //get the current balance and ...etc
            const accountDetails = await bankAccountDBService.getAccountById(
              Bank_Account_Id,
              Branch_idBranch,
            );
            const currentBal = parseFloat(accountDetails[0].account_balance || 0);
            const payment = currentBal + parseFloat(Paid_Amount);
            const updateCompanyBankAccountBalance =
              await bankAccountDBService.updateCompanyBankAccountBalance(
                Bank_Account_Id,
                payment,
                Branch_idBranch,
                connection,
              );

            if (updateCompanyBankAccountBalance) {
              //add a log for the bank account update

              const bank_acc_id = Bank_Account_Id;
              const type = "Invoice Payment";
              const description = `Payment received for Invoice ID: ${Invoice_idInvoice}`;
              const note = `Paid Amount: ${Paid_Amount}`;
              const debit = Paid_Amount;
              const credit = "0.00";
              const balance = currentBal + parseFloat(Paid_Amount);
              const user = accountDetails[0].user;
              const updated_status = "paid";
              const updated_note = `Payment of ${Paid_Amount} received for Invoice ID: ${Invoice_idInvoice}`;
              const updated_date_time = new Date();
              const updated_user = User_idUser;
              const payment_id = Invoice_idInvoice;
              const contra_account = "-";
              const reconcilation_status = "0";
              const branch_id = Branch_idBranch;

              const bankAccountLog =
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
            console.error(
              "Error updating bank account balance after invoice creation:",
              error,
            );
          }
        }

        // --- ACCOUNTING DOUBLE ENTRY START ---
        try {
          const invoiceCompanyId =
            await branchDBService.getCompanyIdByBranch(Branch_idBranch);

          const netAmt = parseFloat(Net_Amount) || 0;
          const paidAmt = parseFloat(Paid_Amount) || 0;
          const discountAmt = parseFloat(Discount_Amount) || 0;
          const vatAmt = parseFloat(Vat_Amount) || 0;
          const revenueAmt = netAmt + discountAmt - vatAmt;
          const voucherAmt = parseFloat(gift_voucher_amount) || 0;
          const loyaltyAmt = parseFloat(loyalty_discount_amount) || 0;
          const totalEffectivePaid = paidAmt + voucherAmt + loyaltyAmt;

          let invoicedVouchersTotal = 0;
          if (Array.isArray(invoiced_voucher_ids) && invoiced_voucher_ids.length > 0) {
            try {
              const [vRows] = await new Promise((res, rej) => {
                connection.query(
                  `SELECT COALESCE(SUM(amount), 0) as total FROM gift_vouchers WHERE id IN (?)`,
                  [invoiced_voucher_ids],
                  (err, r) => err ? rej(err) : res([r])
                );
              });
              invoicedVouchersTotal = parseFloat(vRows[0]?.total || 0);
            } catch (vErr) {
              console.error("[Invoice] Error calculating invoiced voucher total:", vErr);
            }
          }

          const AR_AccountId = await findAccountByNameAndGroup(
            "Accounts Receivable (Debtors)",
            "Assets",
            invoiceCompanyId,
            Branch_idBranch,
            connection,
          );
          const Sales_AccountId = await findAccountByNameAndGroup(
            "Sales Revenue",
            "Income",
            invoiceCompanyId,
            Branch_idBranch,
            connection,
          );

          let Discount_AccountId = null;
          if (discountAmt > 0) {
            Discount_AccountId = await findAccountByNameAndGroup(
              "Sales Discounts",
              "Contra Accounts",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          let Vat_AccountId = null;
          if (vatAmt > 0) {
            Vat_AccountId = await findAccountByNameAndGroup(
              "VAT Payable",
              "Liabilities",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          let Voucher_AccountId = null;
          if (voucherAmt > 0) {
            Voucher_AccountId = await ensureAccountExists(
              "Gift Voucher Liability",
              "Liabilities",
              "Liabilities",
              "2000-004",
              "Gift Voucher Liability account",
              invoiceCompanyId,
              Branch_idBranch,
              User_idUser || Employee_idEmployee || 1,
              connection,
            );
          }

          let Loyalty_AccountId = null;
          if (loyaltyAmt > 0) {
            Loyalty_AccountId = await ensureAccountExists(
              "Customer Loyalty Discounts",
              "Contra Accounts",
              "Contra Accounts",
              "5000-003",
              "Customer Loyalty Points Redemption Discount account",
              invoiceCompanyId,
              Branch_idBranch,
              User_idUser || Employee_idEmployee || 1,
              connection,
            );
          }

          let paymentAccountName = "Cash in Hand";
          const pMethodLower = Payment_Method
            ? Payment_Method.toLowerCase()
            : "";

          if (pMethodLower === "cash") {
            paymentAccountName = "Cash in Hand";
          } else if (
            pMethodLower === "card" ||
            pMethodLower === "online transfer" ||
            pMethodLower.includes("online") ||
            pMethodLower === "direct bank" ||
            pMethodLower.includes("bank")
          ) {
            paymentAccountName = "Bank Account";
          } else if (pMethodLower === "cheque") {
            paymentAccountName = "Cheque Clearing Account";
          } else if (pMethodLower === "koko" || pMethodLower === "mintpay") {
            paymentAccountName = "Receivable from Provider";
          }

          let Payment_AccountId = null;
          if (paidAmt > 0) {
            Payment_AccountId = await findAccountByNameAndGroup(
              paymentAccountName,
              "Assets",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          let Advance_AccountId = null;
          if (totalEffectivePaid > netAmt) {
            Advance_AccountId = await findAccountByNameAndGroup(
              "Customer Advance",
              "Liabilities",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          const userId = User_idUser || Employee_idEmployee;

          if (
            totalEffectivePaid === netAmt &&
            (paidAmt === 0 || Payment_AccountId) &&
            (voucherAmt === 0 || Voucher_AccountId) &&
            (loyaltyAmt === 0 || Loyalty_AccountId)
          ) {
            // Case A: FULL PAYMENT (Settled via Cash, Voucher, Loyalty, or combination)
            if (paidAmt > 0 && Payment_AccountId) {
              if (
                Payment_Method === "split" &&
                Array.isArray(split_payments) &&
                split_payments.length > 0
              ) {
                for (const sp of split_payments) {
                  const spAmt = parseFloat(sp.amount) || 0;
                  if (spAmt <= 0) continue;
                  const spAccountId = await findAccountByNameAndGroup(
                    resolvePaymentAccountName(sp.method),
                    "Assets",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  );
                  if (spAccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Assets",
                      amount: spAmt,
                      description: `${(sp.method || "").toUpperCase()} portion of Full Payment for Invoice ${Invoice_Number}`,
                      type: "Invoice Creation",
                      accountId: spAccountId,
                      branchId: Branch_idBranch,
                      userId: userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }
              } else {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: paidAmt,
                  description: `Full Payment for Invoice ${Invoice_Number}`,
                  type: "Invoice Creation",
                  accountId: Payment_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "debit",
                  connection,
                });
              }
            }

            if (voucherAmt > 0 && Voucher_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: voucherAmt,
                description: `Gift Voucher ${gift_voucher_code || ""} redeemed for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Voucher_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }

            if (loyaltyAmt > 0 && Loyalty_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: loyaltyAmt,
                description: `Customer Loyalty Points Redeemed (${redeemed_loyalty_points || ""} pts) for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Loyalty_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }

            if (Discount_AccountId && discountAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: discountAmt,
                description: `Discount applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Discount_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }
            const goodsRevenue = Math.max(0, revenueAmt - invoicedVouchersTotal);
            if (Sales_AccountId && goodsRevenue > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Income",
                amount: goodsRevenue,
                description: `Revenue for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Sales_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }
            if (invoicedVouchersTotal > 0) {
              const Voucher_Liability_AccountId = await ensureAccountExists(
                "Gift Voucher Liability",
                "Liabilities",
                "Liabilities",
                "2000-004",
                "Gift Voucher Liability account",
                invoiceCompanyId,
                Branch_idBranch,
                userId || 1,
                connection
              );
              if (Voucher_Liability_AccountId) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Liabilities",
                  amount: invoicedVouchersTotal,
                  description: `Gift Voucher Sale for Invoice ${Invoice_Number}`,
                  type: "Invoice Creation",
                  accountId: Voucher_Liability_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }
            if (Vat_AccountId && vatAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: vatAmt,
                description: `VAT applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Vat_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }
          } else {
            // Case B (CREDIT), Case C (INSTALLMENT), Case D (OVERPAYMENT) or Partial Payment
            if (AR_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: netAmt,
                description: `Invoice ${Invoice_Number} generated`,
                type: "Invoice Creation",
                accountId: AR_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }
            if (Discount_AccountId && discountAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: discountAmt,
                description: `Discount applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Discount_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }
            const goodsRevenue = Math.max(0, revenueAmt - invoicedVouchersTotal);
            if (Sales_AccountId && goodsRevenue > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Income",
                amount: goodsRevenue,
                description: `Revenue for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Sales_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }
            if (invoicedVouchersTotal > 0) {
              const Voucher_Liability_AccountId = await ensureAccountExists(
                "Gift Voucher Liability",
                "Liabilities",
                "Liabilities",
                "2000-004",
                "Gift Voucher Liability account",
                invoiceCompanyId,
                Branch_idBranch,
                userId || 1,
                connection
              );
              if (Voucher_Liability_AccountId) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Liabilities",
                  amount: invoicedVouchersTotal,
                  description: `Gift Voucher Sale for Invoice ${Invoice_Number}`,
                  type: "Invoice Creation",
                  accountId: Voucher_Liability_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }
            if (Vat_AccountId && vatAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: vatAmt,
                description: `VAT applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Vat_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }

            // Handle Gift Voucher redemption against AR
            if (voucherAmt > 0 && Voucher_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: voucherAmt,
                description: `Gift Voucher ${gift_voucher_code || ""} redeemed for Invoice ${Invoice_Number}`,
                type: "Invoice Payment",
                accountId: Voucher_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });

              if (AR_AccountId) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: voucherAmt,
                  description: `Gift Voucher applied to Invoice ${Invoice_Number}`,
                  type: "Invoice Payment",
                  accountId: AR_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }

            // Handle Customer Loyalty redemption against AR
            if (loyaltyAmt > 0 && Loyalty_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: loyaltyAmt,
                description: `Customer Loyalty Points Redeemed (${redeemed_loyalty_points || ""} pts) for Invoice ${Invoice_Number}`,
                type: "Invoice Payment",
                accountId: Loyalty_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });

              if (AR_AccountId) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: loyaltyAmt,
                  description: `Loyalty Points Redemption applied to Invoice ${Invoice_Number}`,
                  type: "Invoice Payment",
                  accountId: AR_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }

            // Handle payment if any
            if (paidAmt > 0 && Payment_AccountId) {
              if (
                Payment_Method === "split" &&
                Array.isArray(split_payments) &&
                split_payments.length > 0
              ) {
                for (const sp of split_payments) {
                  const spAmt = parseFloat(sp.amount) || 0;
                  if (spAmt <= 0) continue;
                  const spAccountId = await findAccountByNameAndGroup(
                    resolvePaymentAccountName(sp.method),
                    "Assets",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  );
                  if (spAccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Assets",
                      amount: spAmt,
                      description: `${(sp.method || "").toUpperCase()} portion of payment received for Invoice ${Invoice_Number}`,
                      type: "Invoice Payment",
                      accountId: spAccountId,
                      branchId: Branch_idBranch,
                      userId: userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }
              } else {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: paidAmt,
                  description: `Payment received for Invoice ${Invoice_Number}`,
                  type: "Invoice Payment",
                  accountId: Payment_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "debit",
                  connection,
                });
              }

              if (totalEffectivePaid > netAmt) {
                // Case D: OVERPAYMENT
                const cashForInvoice = Math.max(0, netAmt - voucherAmt - loyaltyAmt);
                if (AR_AccountId && cashForInvoice > 0) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Assets",
                    amount: cashForInvoice,
                    description: `Payment applied to Invoice ${Invoice_Number}`,
                    type: "Invoice Payment",
                    accountId: AR_AccountId,
                    branchId: Branch_idBranch,
                    userId: userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }
                if (Advance_AccountId) {
                  const advanceAmt = totalEffectivePaid - netAmt;
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Liabilities",
                    amount: advanceAmt,
                    description: `Overpayment for Invoice ${Invoice_Number}`,
                    type: "Invoice Payment",
                    accountId: Advance_AccountId,
                    branchId: Branch_idBranch,
                    userId: userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }
              } else {
                // Partial payment
                if (AR_AccountId) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Assets",
                    amount: paidAmt,
                    description: `Payment applied to Invoice ${Invoice_Number}`,
                    type: "Invoice Payment",
                    accountId: AR_AccountId,
                    branchId: Branch_idBranch,
                    userId: userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }
              }
            }
          }

          let Cogs_AccountId = null;
          let Inventory_AccountId = null;
          if (totalCOGS !== 0) {
            Cogs_AccountId = await findAccountByNameAndGroup(
              "Cost of Goods Sold (COGS)",
              "Expenses",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
            Inventory_AccountId = await findAccountByNameAndGroup(
              "Inventory",
              "Assets",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          if (totalCOGS > 0 && Cogs_AccountId && Inventory_AccountId) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: totalCOGS,
              description: `COGS for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Cogs_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "debit",
              connection: connection,
            });
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Assets",
              amount: totalCOGS,
              description: `Inventory reduction for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Inventory_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "credit",
              connection: connection,
            });
          } else if (totalCOGS < 0 && Cogs_AccountId && Inventory_AccountId) {
            const absCOGS = Math.abs(totalCOGS);
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Assets",
              amount: absCOGS,
              description: `Inventory return for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Inventory_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "debit",
              connection: connection,
            });
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: absCOGS,
              description: `COGS reversal for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Cogs_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "credit",
              connection: connection,
            });
          }
        } catch (accErr) {
          console.error(
            "Error creating accounting entries for invoice:",
            accErr,
          );
        }
        // --- ACCOUNTING DOUBLE ENTRY END ---

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Invoice",
          Invoice_idInvoice,
          "create",
          Branch_idBranch,
          connection,
        );

        // Automatically link invoiced gift vouchers to this invoice
        if (Array.isArray(invoiced_voucher_ids) && invoiced_voucher_ids.length > 0 && Invoice_idInvoice) {
          try {
            await new Promise((res, rej) => {
              connection.query(
                `UPDATE gift_vouchers SET issue_type = 'INVOICED', created_invoice_id = ? WHERE id IN (?)`,
                [Invoice_idInvoice, invoiced_voucher_ids],
                (err) => (err ? rej(err) : res())
              );
            });
          } catch (invVoucherErr) {
            console.error("[GiftVoucher] Error linking invoiced vouchers to Invoice:", invVoucherErr);
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

          // Trigger SMS Notifications
          try {
            const customerDb = require("../services/customerDBService");
            const smsService = require("../services/smsService");

            customerDb.fetchCustomerById(Customer_idCustomer)
              .then(async (customerList) => {
                if (customerList && customerList.length > 0) {
                  const customer = customerList[0];
                  const recipientPhone = customer.phoneNumber || customer.Tp;
                  const customerName = `${customer.First_Name || ""} ${customer.lastName || ""}`.trim() || customer.displayName;

                  // Compute dynamic invoice public URL
                  const origin = req.headers.origin || "https://invoice.asipbook.com";
                  const salt = Math.random().toString(36).substring(2, 8);
                  const rawToken = `inv_${Invoice_idInvoice}_${salt}`;
                  const token = Buffer.from(rawToken).toString("base64").replace(/=+$/, "");
                  const publicUrl = `${origin}/public/invoice/${token}`;

                  const smsData = {
                    name: customerName,
                    invoice_no: Invoice_Number,
                    amount: parseFloat(Net_Amount).toFixed(2),
                    url: publicUrl,
                    date: Invoice_Date || new Date().toISOString().split("T")[0],
                  };

                  // Trigger Event 1: Invoice Generation
                  await smsService.triggerSMSNotification(Branch_idBranch, "invoice_generation", recipientPhone, smsData, User_idUser);

                  // Trigger Event 11: Service job converted to invoice (if service_job_id is present)
                  if (service_job_id) {
                    const dbQuery = require("../db/db");
                    dbQuery.query("SELECT job_no FROM service_jobs WHERE id = ?", [service_job_id], async (sjErr, sjResults) => {
                      if (!sjErr && sjResults && sjResults.length > 0) {
                        const convertedData = {
                          ...smsData,
                          job_no: sjResults[0].job_no,
                        };
                        await smsService.triggerSMSNotification(Branch_idBranch, "service_job_converted", recipientPhone, convertedData, User_idUser);
                      }
                    });
                  }
                }
              })
              .catch(err => console.error("[SMS-Trigger] Error fetching customer for SMS:", err));
          } catch (smsErr) {
            console.error("[SMS-Trigger] Error triggering SMS notification:", smsErr);
          }

          // Automatically award Invoice Creation XP upon successful invoice creation
          try {
            const loyaltyService = require("../services/loyaltyService");
            loyaltyService.awardUserXp(User_idUser, "INVOICE_CREATION")
              .then(() => console.log(`[Loyalty] Successfully awarded invoice creation XP to user ${User_idUser}`))
              .catch((xpErr) => console.error("[Loyalty] Failed to award invoice XP:", xpErr));
          } catch (xpErr) {
            console.error("[Loyalty] Failed to load loyaltyService:", xpErr);
          }

          // Customer Loyalty: Execute redemption first (if token provided), then award points
          if (Customer_idCustomer && Number(Customer_idCustomer) > 0) {
            (async () => {
              try {
                const customerLoyaltyService = require("../services/customerLoyaltyService");

                // 1. Redeem points if token provided
                if (loyalty_redemption_token) {
                  try {
                    await customerLoyaltyService.redeemPointsForInvoice({
                      customerId: Customer_idCustomer,
                      branchId: Branch_idBranch,
                      invoiceId: Invoice_idInvoice,
                      invoiceNumber: Invoice_Number,
                      pointsToRedeem: redeemed_loyalty_points,
                      discountAmount: loyalty_discount_amount,
                      redemptionToken: loyalty_redemption_token,
                      userId: User_idUser,
                    });
                  } catch (loyaltyRedeemErr) {
                    console.error("[CustomerLoyalty] Error redeeming loyalty points for invoice:", loyaltyRedeemErr);
                  }
                }

                // 2. Award points for this purchase
                await customerLoyaltyService.awardPointsForInvoice({
                  customerId: Customer_idCustomer,
                  invoiceId: Invoice_idInvoice,
                  invoiceNumber: Invoice_Number,
                  totalAmount: Net_Amount,
                  branchId: Branch_idBranch,
                  userId: User_idUser,
                });
              } catch (loyaltyErr) {
                console.error("[CustomerLoyalty] Error processing customer loyalty for invoice:", loyaltyErr);
              }
            })();
          }

          // Automatically claim Gift Vouchers if applied
          const rawCodes = gift_voucher_codes || gift_voucher_code;
          const codesToClaim = Array.isArray(rawCodes)
            ? rawCodes
            : typeof rawCodes === "string"
              ? rawCodes.split(",").map((s) => s.trim()).filter(Boolean)
              : [];

          if (codesToClaim.length > 0 && Invoice_idInvoice) {
            try {
              const giftVoucherService = require("../services/giftVoucherService");
              for (const code of codesToClaim) {
                giftVoucherService
                  .claimVoucherForInvoice({
                    voucherCode: code,
                    invoiceId: Invoice_idInvoice,
                    invoiceNumber: Invoice_Number,
                    customerId: Customer_idCustomer,
                    branchId: Branch_idBranch,
                    userId: User_idUser,
                  })
                  .catch((gvErr) =>
                    console.error(`[GiftVoucher] Error claiming voucher ${code} in Invoice:`, gvErr)
                  );
              }
            } catch (gvLoadErr) {
              console.error("[GiftVoucher] Failed to load giftVoucherService in Invoice:", gvLoadErr);
            }
          }



          const io = req.app?.get ? req.app.get("io") : null;
          if (io) {
            if (Branch_idBranch) {
              io.to(`branch_${Branch_idBranch}`).emit("refreshNotifications");
              io.to(`branch_${Branch_idBranch}`).emit("newInvoiceCreated", {
                branchId: Branch_idBranch,
                invoiceNumber: Invoice_Number,
                netAmount: parseFloat(Net_Amount) || 0,
                createdBy: user || `User #${User_idUser}`,
              });
            } else {
              io.emit("refreshNotifications");
            }
          }
          // Notify CRM if dealId is provided
          const dealIdParam = req.body.deal_id || req.body.dealId;
          if (dealIdParam) {
            try {
              const { notifyCrmDocumentCreated } = require("../services/crmWebhookService");
              const origin = req.headers.origin || "http://localhost:3000";
              notifyCrmDocumentCreated({
                type: "INVOICE",
                asipBookDocumentId: Invoice_idInvoice,
                documentNumber: Invoice_Number,
                amount: parseFloat(Net_Amount) || 0,
                currency: "LKR",
                status: parseFloat(Balance_Amount || 0) <= 0 ? "paid" : "unpaid",
                dealId: dealIdParam,
                branchId: Branch_idBranch,
                documentDate: Invoice_Date || new Date().toISOString().split("T")[0],
                viewUrl: `${origin}/invoices/view/${Invoice_idInvoice}`,
              });
            } catch (notifyErr) {
              console.warn("[CRM Webhook] Error calling notifyCrmDocumentCreated:", notifyErr);
            }
          }
          res.json({
            message: "Invoice added successfully",
            invoice_id: Invoice_idInvoice,
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error in createInvoice:", err);
          res.status(500).json({
            message: "Error creating invoice",
            error: err.message,
            stack:
              process.env.NODE_ENV === "development" ? err.stack : undefined,
          });
        });
      }
    });
  });
};

const updateInvoice = async (req, res) => {
  const {
    Quotation_idQuotation,
    Customer_idCustomer,
    Invoice_Date,
    Employee_idEmployee,
    Invoice_Number,
    Total,
    Discount_Presentage,
    Discount_Amount,
    Discount_Type,
    Discount2_Type,
    Discount2_Presentage,
    Discount2_Amount,
    Net_Amount,
    Note,
    Payment_Type,
    Paid_Amount,
    Balance_Amount,
    Credit_Balance,
    User_idUser,
    items,
    Installment_Count,
    Branch_idBranch,
    Payment_Method,
    Card_Type,
    Card_Number,
    Transaction_Id,
    Receipt,
    Cheque_Type,
    Cheque_No,
    Cheque_Date,
    Cheque_Name,
    Vat_Amount,
    Extra_Charge_Label,
    Extra_Charge,
    Interest_Amount,
    Interest_Presentage,
    Interest_Type,
    Bank_Account_Id,
    cheques,
    split_payments,
    Overpayment_Option,
    Applied_Overpayment,
    Warehouse_Id,
    service_job_id,
    estimate_id,
    installments,
    place_of_supply,
    custom_fields_data,
    gift_voucher_code,
    gift_voucher_codes,
    gift_voucher_amount,
    applied_vouchers,
    redeemed_loyalty_points,
    loyalty_discount_amount,
    loyalty_redemption_token,
  } = req.body;
  const { idInvoice } = req.params;

  // Proactive Staging for EDIT_INVOICE
  if (!req.is_approved_webhook) {
    try {
      let targetBranchId = Branch_idBranch;
      if (!targetBranchId && idInvoice) {
        const [invRows] = await promisePool.query("SELECT Branch_idBranch FROM invoice WHERE idInvoice = ? LIMIT 1", [idInvoice]);
        if (invRows.length > 0) targetBranchId = invRows[0].Branch_idBranch;
      }
      targetBranchId = parseInt(targetBranchId, 10) || 1;

      let companyId = req.headers["company_id"] || req.user?.company_id || req.body?.companyId;
      if (!companyId || companyId === targetBranchId) {
        companyId = await branchDBService.getCompanyIdByBranch(targetBranchId);
      }
      companyId = parseInt(companyId, 10) || 1;

      const approvalNeeded = await approvalService.isApprovalRequired(
        companyId, 
        targetBranchId, 
        'EDIT_INVOICE'
      );
      if (approvalNeeded) {
        await promisePool.query(
          "UPDATE invoice SET approval_status = 'PENDING_APPROVAL' WHERE idInvoice = ?",
          [idInvoice]
        );

        const [invRows] = await promisePool.query(
          "SELECT Invoice_Number, Customer_idCustomer, Total, Net_Amount FROM invoice WHERE idInvoice = ? LIMIT 1",
          [idInvoice]
        );
        const invInfo = invRows[0] || {};

        let customerName = resolveCustomerName(null, req.body.customer_name || req.body.customerName || req.body.Customer_Name);
        try {
          const custResults = await customerDbService.fetchCustomerById(Customer_idCustomer || invInfo.Customer_idCustomer);
          if (custResults && custResults.length > 0) {
            customerName = resolveCustomerName(custResults[0], req.body.customer_name || req.body.customerName || req.body.Customer_Name);
          }
        } catch (e) {}

        await approvalService.triggerApprovalRequest({
          action_type: 'EDIT_INVOICE',
          module_name: 'Invoice',
          erp_record_id: idInvoice,
          company_id: companyId,
          branch_id: targetBranchId,
          initiated_by: User_idUser || req.userId || req.user?.id || 1,
          payload_summary: {
            action: 'EDIT_INVOICE',
            invoice_number: Invoice_Number || invInfo.Invoice_Number,
            customer_name: customerName,
            Customer_idCustomer: Customer_idCustomer || invInfo.Customer_idCustomer,
            amount: Net_Amount !== undefined ? Net_Amount : invInfo.Net_Amount,
            Total: Total !== undefined ? Total : invInfo.Total,
            Net_Amount: Net_Amount !== undefined ? Net_Amount : invInfo.Net_Amount,
            Note,
            pending_updates: {
               req_body: req.body,
               req_params: { ...req.params, idInvoice },
               req_user: req.user,
               req_headers: req.headers,
               req_userId: req.userId || User_idUser,
               req_userRole: req.userRole
            }
          }
        });
        return res.status(202).json({
          success: true,
          message: "Invoice update submitted for approval. Changes will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Edit Invoice"
        });
      }
    } catch (err) {
      console.error("Approval Check Error for Edit Invoice:", err);
      return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
    }
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
        const existingInvoiceList = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT * FROM invoice WHERE idInvoice = ?",
            [idInvoice],
            (err, results) => err ? reject(err) : resolve(results)
          );
        });

        if (!existingInvoiceList || existingInvoiceList.length === 0) {
          connection.rollback(() => connection.release());
          return res.status(404).json({ message: "Invoice not found" });
        }
        const existingInvoice = existingInvoiceList[0];

        // Safe resolution of all invoice fields against existing values
        const resolvedInvoiceNumber = Invoice_Number || req.body.Invoice_No || existingInvoice.Invoice_Number || '';
        const resolvedQuotationId = Quotation_idQuotation !== undefined && Quotation_idQuotation !== null ? Quotation_idQuotation : (existingInvoice.Quotation_IdQuotation || 0);
        const resolvedCustomerId = Customer_idCustomer || existingInvoice.Customer_idCustomer || 1;
        const resolvedInvoiceDate = Invoice_Date || existingInvoice.Date || existingInvoice.Invoice_Date || currentDate();
        const resolvedEmployeeId = Employee_idEmployee || req.body.Salesman || existingInvoice.Employee_idEmployee || 1;
        const resolvedBranchId = parseInt(Branch_idBranch || req.user?.branch || existingInvoice.Branch_idBranch, 10) || 1;
        const resolvedUserId = parseInt(User_idUser || req.userId || req.user?.id || existingInvoice.Employee_idEmployee, 10) || 1;

        const resolvedDiscountType = Discount_Type || existingInvoice.Discount_Type || 'percentage';
        const resolvedDiscountPresentage = Discount_Presentage !== undefined && Discount_Presentage !== null ? Discount_Presentage : (existingInvoice.Discount_Presentage || 0);
        const resolvedDiscountAmount = Discount_Amount !== undefined && Discount_Amount !== null ? Discount_Amount : (existingInvoice.Discount_Amount || 0);

        const resolvedDiscount2Type = Discount2_Type || existingInvoice.Discount2_Type || 'percentage';
        const resolvedDiscount2Presentage = Discount2_Presentage !== undefined && Discount2_Presentage !== null ? Discount2_Presentage : (existingInvoice.Discount2_Presentage || 0);
        const resolvedDiscount2Amount = Discount2_Amount !== undefined && Discount2_Amount !== null ? Discount2_Amount : (existingInvoice.Discount2_Amount || 0);

        const resolvedTotal = Total !== undefined && Total !== null ? parseFloat(Total) : (parseFloat(existingInvoice.Total) || 0);
        const resolvedNetAmount = Net_Amount !== undefined && Net_Amount !== null ? parseFloat(Net_Amount) : (parseFloat(existingInvoice.Net_Amount) || 0);
        const resolvedPaidAmount = Paid_Amount !== undefined && Paid_Amount !== null ? parseFloat(Paid_Amount) : (parseFloat(existingInvoice.Paid_Amount) || 0);
        const resolvedBalanceAmount = Balance_Amount !== undefined && Balance_Amount !== null ? parseFloat(Balance_Amount) : (parseFloat(existingInvoice.Balance_Amount) || 0);
        const resolvedCreditBalance = Credit_Balance !== undefined && Credit_Balance !== null ? parseFloat(Credit_Balance) : (parseFloat(existingInvoice.Credit_Balance) || 0);

        const resolvedPaymentType = Payment_Type !== undefined && Payment_Type !== null ? Payment_Type : (existingInvoice.Payment_Type !== undefined && existingInvoice.Payment_Type !== null ? existingInvoice.Payment_Type : 1);
        const resolvedPaymentMethod = Payment_Method || existingInvoice.Payment_Method || 'cash';
        const resolvedVatAmount = Vat_Amount !== undefined && Vat_Amount !== null ? parseFloat(Vat_Amount) : (parseFloat(existingInvoice.Vat_Amount) || 0);
        const resolvedNote = Note !== undefined ? Note : (existingInvoice.Note || '');
        const resolvedPlaceOfSupply = place_of_supply !== undefined ? place_of_supply : (existingInvoice.place_of_supply || null);
        const resolvedCustomFields = custom_fields_data !== undefined ? custom_fields_data : (existingInvoice.custom_fields_data || null);

        // Fetch existing items if not provided or empty
        const finalItems = (Array.isArray(items) && items.length > 0)
          ? items
          : await dbService.fetchInvoiceItems(idInvoice, connection);

        // Retrieve original linked service job and estimate before reverting
        const origServiceJobs = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT id FROM service_jobs WHERE invoice_id = ?",
            [idInvoice],
            (err, results) => err ? reject(err) : resolve(results)
          );
        });
        const origEstimates = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT id FROM estimates WHERE invoice_no = ?",
            [resolvedInvoiceNumber],
            (err, results) => err ? reject(err) : resolve(results)
          );
        });

        const finalServiceJobId = service_job_id || (origServiceJobs && origServiceJobs.length > 0 ? origServiceJobs[0].id : null);
        const finalEstimateId = estimate_id || (origEstimates && origEstimates.length > 0 ? origEstimates[0].id : null);

        await revertInvoiceSideEffects(idInvoice, connection);

        const savedReceipt = saveBase64Receipt(Receipt);

        // 1. Handle Applied Overpayment (Using previous overpayment)
        if (Applied_Overpayment && parseFloat(Applied_Overpayment) > 0) {
          await customerDbService.updateCustomerOverpayment(
            resolvedCustomerId,
            -parseFloat(Applied_Overpayment),
            connection,
          );
        }

        // 2. Handle New Overpayment (Creating new overpayment from current excess)
        let actualPaidAmount =
          (parseFloat(resolvedPaidAmount) || 0) +
          (parseFloat(Applied_Overpayment) || 0) +
          (parseFloat(gift_voucher_amount) || 0) +
          (parseFloat(loyalty_discount_amount) || 0);
        let newOverpaymentAmount = 0;
        let finalPaidAmount = actualPaidAmount;

        if (actualPaidAmount > parseFloat(resolvedNetAmount)) {
          newOverpaymentAmount = actualPaidAmount - parseFloat(resolvedNetAmount);
          if (Overpayment_Option === "balance") {
            newOverpaymentAmount = 0;
            finalPaidAmount = actualPaidAmount;
          } else {
            finalPaidAmount = parseFloat(resolvedNetAmount); // Only record up to Net_Amount on the invoice
            await customerDbService.updateCustomerOverpayment(
              resolvedCustomerId,
              newOverpaymentAmount,
              connection,
            );
          }
        }

        const lastCustomerLog =
          await customerLogDbService.fetchLastLog(resolvedCustomerId, connection);

        let runningTotalBalance =
          lastCustomerLog?.length === 0
            ? 0
            : parseFloat(lastCustomerLog[0].Total_Credit_Balance);

        const applied_credit = parseFloat(Applied_Overpayment) || 0;
        const voucher_amount = parseFloat(gift_voucher_amount) || 0;
        const loyalty_amount = parseFloat(loyalty_discount_amount) || 0;
        const net_due = parseFloat(resolvedCreditBalance) || 0;
        const gross_due = net_due + applied_credit + voucher_amount + loyalty_amount;
        const balanceAfterInvoice = runningTotalBalance + gross_due;
        const invoiceResolvedDateTime = resolveDateTime(resolvedInvoiceDate);

        // Ensure Cheque_Date is null when empty
        const safeChequeDate =
          !Cheque_Date ||
            (typeof Cheque_Date === "string" && Cheque_Date.trim() === "")
            ? null
            : Cheque_Date;

        // Ensure gift voucher details are present in invoice Note
        let finalInvoiceNote = resolvedNote || "";
        if (Array.isArray(applied_vouchers) && applied_vouchers.length > 0) {
          applied_vouchers.forEach((av) => {
            const code = av.voucher_code || av.code;
            if (code && !finalInvoiceNote.includes(code)) {
              const val = Number(av.amount || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
              const gvStr = `Gift Voucher: ${code} (Val: ${val} LKR)`;
              finalInvoiceNote = finalInvoiceNote ? `${finalInvoiceNote} [${gvStr}]` : `[${gvStr}]`;
            }
          });
        } else if (gift_voucher_code && !finalInvoiceNote.includes(gift_voucher_code)) {
          const vAmtFormatted = parseFloat(gift_voucher_amount || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const gvStr = `Gift Voucher: ${gift_voucher_code} (Val: ${vAmtFormatted} LKR)`;
          finalInvoiceNote = finalInvoiceNote ? `${finalInvoiceNote} [${gvStr}]` : `[${gvStr}]`;
        }

        // Append Loyalty Points Redeemed notation
        if (redeemed_loyalty_points && Number(redeemed_loyalty_points) > 0 && !finalInvoiceNote.includes("Loyalty Points Redeemed")) {
          const lValFormatted = parseFloat(loyalty_discount_amount || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          const loyaltyStr = `Loyalty Points Redeemed: ${redeemed_loyalty_points} pts (Val: ${lValFormatted} LKR)`;
          finalInvoiceNote = finalInvoiceNote ? `${finalInvoiceNote} [${loyaltyStr}]` : `[${loyaltyStr}]`;
        }

        const invoice = await dbService.updateInvoice(
          idInvoice,
          resolvedInvoiceNumber,
          resolvedQuotationId,
          resolvedCustomerId,
          resolvedInvoiceDate,
          resolvedEmployeeId,
          resolvedTotal,
          resolvedDiscountType,
          resolvedDiscountPresentage,
          resolvedDiscountAmount,
          resolvedDiscount2Type,
          resolvedDiscount2Presentage,
          resolvedDiscount2Amount,
          resolvedNetAmount,
          finalItems.length,
          finalInvoiceNote,
          resolvedPaymentType,
          finalPaidAmount,
          resolvedBalanceAmount,
          resolvedCreditBalance,
          balanceAfterInvoice - applied_credit - voucher_amount, // Total_Credit_Balance
          resolvedPaymentMethod,
          sanitizeValue(Card_Type),
          sanitizeValue(Card_Number),
          sanitizeValue(Transaction_Id),
          savedReceipt,
          cheques && cheques.length > 0 ? null : sanitizeValue(Cheque_Type),
          cheques && cheques.length > 0 ? null : sanitizeValue(Cheque_No),
          cheques && cheques.length > 0 ? null : safeChequeDate,
          cheques && cheques.length > 0 ? null : sanitizeValue(Cheque_Name),
          resolvedVatAmount,
          Extra_Charge_Label,
          Extra_Charge,
          Interest_Amount,
          Interest_Presentage,
          Interest_Type,
          Bank_Account_Id,
          resolvedPlaceOfSupply,
          resolvedCustomFields,
          connection,
        );

        if (resolvedQuotationId !== 0) {
          await quotationDbService.statusUpdate(
            resolvedQuotationId,
            connection,
          );
        }

        const Invoice_idInvoice = idInvoice;

        if (finalServiceJobId) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE service_jobs SET status = 'Completed', invoice_id = ? WHERE id = ?",
              [Invoice_idInvoice, finalServiceJobId],
              (err) => {
                if (err) return reject(err);
                resolve();
              }
            );
          });
        }

        if (finalEstimateId) {
          await new Promise((resolve, reject) => {
            connection.query(
              "SELECT id, parent_estimate_id FROM estimates WHERE id = ?",
              [finalEstimateId],
              (err, results) => {
                if (err) return reject(err);
                if (results.length === 0) return resolve();

                const rootParentId = results[0].parent_estimate_id || results[0].id;

                connection.query(
                  "UPDATE estimates SET status = 'Completed', invoice_no = ? WHERE id = ? OR parent_estimate_id = ?",
                  [Invoice_Number, rootParentId, rootParentId],
                  (err2) => {
                    if (err2) return reject(err2);
                    resolve();
                  }
                );
              }
            );
          });
        }

        await installmentLogDbService.deleteInstallment(
          Invoice_idInvoice,
          connection,
        );

        if (Payment_Type === 2) {
          // If explicit installments provided (from frontend with interest), use them
          if (
            (finalItems || []).some((item) => item.installments) ||
            req.body.installments ||
            installments
          ) {
            const installmentsToSave = installments || req.body.installments || [];

            if (installmentsToSave.length > 0) {
              for (const inst of installmentsToSave) {
                await installmentLogDbService.insertInstallment(
                  Invoice_idInvoice,
                  resolvedCustomerId,
                  inst.Date,
                  inst.Term,
                  inst.Amount, // Amount with interest
                  0, // Penalty Amount
                  inst.Amount, // Total Pending Amount
                  0, // Paid Amount
                  inst.Amount, // Balance Amount
                  0, // Status
                  resolvedBranchId,
                  connection,
                );
              }
            } else {
              // Fallback if array is empty but type is 2 (should not happen if frontend sends correctly)
              // Use existing logic
              let installment_amount = parseFloat(Credit_Balance);
              let parsedDate = new Date(Invoice_Date);
              if (isNaN(parsedDate.getTime())) {
                if (typeof Invoice_Date === "string") {
                  const m = Invoice_Date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                  if (m) {
                    const y = parseInt(m[1]);
                    const mo = parseInt(m[2]);
                    const d = parseInt(m[3]);
                    parsedDate = new Date(y, mo - 1, d);
                  } else {
                    parsedDate = new Date();
                  }
                } else {
                  parsedDate = new Date();
                }
              }
              const current_invoice_Date = parsedDate.toISOString().split("T")[0];

              let single_installment_amount =
                Math.round((installment_amount / Installment_Count) * 100) /
                100;

              let total_of_regular_installments =
                single_installment_amount * (Installment_Count - 1);

              let last_installment_amount =
                Math.round(
                  (installment_amount - total_of_regular_installments) * 100,
                ) / 100;

              for (let i = 1; i <= Installment_Count; i++) {
                const [year, month, day] = current_invoice_Date
                  .split("-")
                  .map(Number);
                const date = new Date(year, month - 1 + i, day);
                const add_date = `${date.getFullYear()}-${(date.getMonth() + 1)
                  .toString()
                  .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

                const current_amount =
                  i === Installment_Count
                    ? last_installment_amount
                    : single_installment_amount;

                await installmentLogDbService.insertInstallment(
                  Invoice_idInvoice,
                  resolvedCustomerId,
                  add_date,
                  i,
                  current_amount,
                  0,
                  current_amount,
                  0,
                  current_amount,
                  0,
                  resolvedBranchId,
                  connection,
                );
              }
            }
          } else {
            // Legacy logic (calculates from Credit_Balance, likely missing interest if frontend didn't send it)
            let installment_amount = parseFloat(Credit_Balance);
            let parsedDate = new Date(Invoice_Date);
            if (isNaN(parsedDate.getTime())) {
              if (typeof Invoice_Date === "string") {
                const m = Invoice_Date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (m) {
                  const y = parseInt(m[1]);
                  const mo = parseInt(m[2]);
                  const d = parseInt(m[3]);
                  parsedDate = new Date(y, mo - 1, d);
                } else {
                  parsedDate = new Date();
                }
              } else {
                parsedDate = new Date();
              }
            }
            const current_invoice_Date = parsedDate.toISOString().split("T")[0];

            let single_installment_amount =
              Math.round((installment_amount / Installment_Count) * 100) / 100;

            let total_of_regular_installments =
              single_installment_amount * (Installment_Count - 1);

            let last_installment_amount =
              Math.round(
                (installment_amount - total_of_regular_installments) * 100,
              ) / 100;

            for (let i = 1; i <= Installment_Count; i++) {
              const [year, month, day] = current_invoice_Date
                .split("-")
                .map(Number);
              const date = new Date(year, month - 1 + i, day);
              const add_date = `${date.getFullYear()}-${(date.getMonth() + 1)
                .toString()
                .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

              const current_amount =
                i === Installment_Count
                  ? last_installment_amount
                  : single_installment_amount;

              await installmentLogDbService.insertInstallment(
                Invoice_idInvoice,
                resolvedCustomerId,
                add_date,
                i,
                current_amount,
                0,
                current_amount,
                0,
                current_amount,
                0,
                resolvedBranchId,
                connection,
              );
            }
          }
        }

        const invoicePaidCash = (parseFloat(Paid_Amount) || 0) - (parseFloat(newOverpaymentAmount) || 0);
        let logGrossDue = gross_due + invoicePaidCash;
        const hasMultiCheques = Payment_Method === "cheque" && cheques && cheques.length > 0;
        const hasSplitPayments =
          Payment_Method === "split" &&
          Array.isArray(split_payments) &&
          split_payments.length > 0;

        if (logGrossDue !== 0 || hasMultiCheques || hasSplitPayments) {
          runningTotalBalance += logGrossDue;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "INVOICE",
            Invoice_idInvoice,
            logGrossDue,
            0,
            runningTotalBalance,
            Payment_Type,
            Payment_Method,
            !hasMultiCheques && Payment_Method === "cheque" ? Cheque_Type : null,
            !hasMultiCheques && Payment_Method === "cheque" ? Cheque_No : null,
            !hasMultiCheques && Payment_Method === "cheque" ? safeChequeDate : null,
            !hasMultiCheques && Payment_Method === "cheque" ? Cheque_Name : null,
            0, // Cheque_Status (default pending)
            Branch_idBranch,
            Payment_Method === "card" ? Card_Type : null,
            Payment_Method === "card" ? Card_Number : null,
            Payment_Method === "card" ? Transaction_Id : null,
            Payment_Method === "bank" || Payment_Method === "online"
              ? savedReceipt
              : null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle Gift Voucher payment in customer credit log
        if (voucher_amount > 0) {
          runningTotalBalance -= voucher_amount;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            voucher_amount, // Debit (reduces debt)
            runningTotalBalance,
            Payment_Type,
            "Gift Voucher",
            null,
            null,
            null,
            null,
            0, // Cheque_Status
            Branch_idBranch,
            null,
            null,
            null,
            null,
            null,
            null,
            `Voucher Applied: ${gift_voucher_code || ""}`,
            null,
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle Customer Loyalty redemption in customer credit log
        if (loyalty_amount > 0) {
          runningTotalBalance -= loyalty_amount;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            loyalty_amount, // Debit (reduces debt)
            runningTotalBalance,
            Payment_Type,
            "Loyalty Redemption",
            null,
            null,
            null,
            null,
            0, // Cheque_Status
            Branch_idBranch,
            null,
            null,
            null,
            null,
            null,
            null,
            `Loyalty Points Redeemed: ${redeemed_loyalty_points || 0} pts`,
            null,
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle spot payment if invoicePaidCash > 0 and NOT multi-cheques and NOT split payments
        if (invoicePaidCash > 0 && !hasMultiCheques && !hasSplitPayments) {
          runningTotalBalance -= invoicePaidCash;
          await customerLogDbService.insertCustomerCreditLog(
            Customer_idCustomer,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            invoicePaidCash, // Debit
            runningTotalBalance,
            Payment_Type,
            Payment_Method,
            Payment_Method === "cheque" ? Cheque_Type : null,
            Payment_Method === "cheque" ? Cheque_No : null,
            Payment_Method === "cheque" ? safeChequeDate : null,
            Payment_Method === "cheque" ? Cheque_Name : null,
            0, // Cheque_Status
            Branch_idBranch,
            Payment_Method === "card" ? Card_Type : null,
            Payment_Method === "card" ? Card_Number : null,
            Payment_Method === "card" ? Transaction_Id : null,
            Payment_Method === "bank" || Payment_Method === "online"
              ? savedReceipt
              : null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // Handle Multi-Cheques
        if (hasMultiCheques) {
          for (const cheque of cheques) {
            const chequeAmount = parseFloat(cheque.Amount) || 0;
            runningTotalBalance -= chequeAmount;
            await customerLogDbService.insertCustomerCreditLog(
              Customer_idCustomer,
              "PAYMENT",
              Invoice_idInvoice,
              0, // Credit
              chequeAmount, // Debit
              runningTotalBalance,
              Payment_Type,
              "cheque",
              cheque.Cheque_Type,
              cheque.Cheque_No,
              cheque.Cheque_Date,
              cheque.Cheque_Name,
              0, // Pending
              Branch_idBranch,
              null, null, null, null, null, null,
              null, // Note
              null, // receipt_number
              connection,
              invoiceResolvedDateTime,
            );
          }
        }

        // Handle Split Payments - one PAYMENT credit-log row per split item,
        // plus a per-item bank balance update for bank/online rows with a bank_account_id.
        if (hasSplitPayments) {
          for (const sp of split_payments) {
            const spAmount = parseFloat(sp.amount) || 0;
            if (spAmount <= 0) continue;
            runningTotalBalance -= spAmount;
            const spMethod = (sp.method || "").toLowerCase();
            const safeSpChequeDate =
              !sp.cheque_date || String(sp.cheque_date).trim() === ""
                ? null
                : sp.cheque_date;
            await customerLogDbService.insertCustomerCreditLog(
              Customer_idCustomer,
              "PAYMENT",
              Invoice_idInvoice,
              0, // Credit
              spAmount, // Debit
              runningTotalBalance,
              Payment_Type,
              spMethod,
              spMethod === "cheque" ? sp.cheque_type || null : null,
              spMethod === "cheque" ? sp.cheque_no || null : null,
              spMethod === "cheque" ? safeSpChequeDate : null,
              spMethod === "cheque" ? sp.cheque_name || null : null,
              0, // Cheque_Status (pending) - surfaces in Cheque Management
              Branch_idBranch,
              spMethod === "card" ? sp.card_type || null : null,
              spMethod === "card" ? sp.card_number || null : null,
              ["card", "bank", "online", "koko", "mintpay"].includes(spMethod)
                ? sp.transaction_id || null
                : null,
              null,
              null,
              null,
              sp.note || null, // Note
              null, // receipt_number
              connection,
              invoiceResolvedDateTime, // Date_Time
              spMethod === "bank" || spMethod === "online"
                ? sp.bank_account_id || null
                : null,
            );

            if (
              (spMethod === "bank" || spMethod === "online") &&
              sp.bank_account_id
            ) {
              try {
                const spAccountDetails = await bankAccountDBService.getAccountById(
                  sp.bank_account_id,
                  resolvedBranchId,
                );
                const spCurrentBal = parseFloat(
                  spAccountDetails?.[0]?.account_balance || 0,
                );
                const spNewBal = spCurrentBal + spAmount;
                const spBalanceUpdated =
                  await bankAccountDBService.updateCompanyBankAccountBalance(
                    sp.bank_account_id,
                    spNewBal,
                    resolvedBranchId,
                    connection,
                  );
                if (spBalanceUpdated) {
                  await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
                    sp.bank_account_id,
                    "Invoice Payment (Split)",
                    `Split payment (${spMethod}) received for Invoice ID: ${Invoice_idInvoice}`,
                    `Paid Amount: ${spAmount}`,
                    spAmount,
                    "0.00",
                    spNewBal,
                    spAccountDetails?.[0]?.user,
                    "paid",
                    `Split payment of ${spAmount} received for Invoice ID: ${Invoice_idInvoice}`,
                    new Date(),
                    resolvedUserId,
                    Invoice_idInvoice,
                    "-",
                    "0",
                    resolvedBranchId,
                    connection,
                  );
                }
              } catch (error) {
                console.error(
                  "Error updating bank account balance for split payment row:",
                  error,
                );
              }
            }
          }
        }

        // 3. Record Applied Overpayment in Customer Log (as a PAYMENT reference)
        if (applied_credit > 0) {
          await customerLogDbService.insertCustomerCreditLog(
            resolvedCustomerId,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            0, // Debit (Log 0 so it doesn't affect the balance twice)
            runningTotalBalance,
            Payment_Type,
            `Overpayment Applied: LKR ${applied_credit.toFixed(2)}`,
            null,
            null,
            null,
            null,
            0,
            resolvedBranchId,
            null,
            null,
            null,
            null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }

        // 4. Record New Overpayment (Excess Payment) in Customer Log
        if (newOverpaymentAmount > 0) {
          runningTotalBalance -= newOverpaymentAmount;
          await customerLogDbService.insertCustomerCreditLog(
            resolvedCustomerId,
            "PAYMENT",
            Invoice_idInvoice,
            0, // Credit
            newOverpaymentAmount, // Debit
            runningTotalBalance,
            Payment_Type,
            "Excess Payment (Overpayment Created)",
            null,
            null,
            null,
            null,
            0,
            resolvedBranchId,
            null,
            null,
            null,
            null,
            null,
            null,
            null, // Note
            null, // receipt_number
            connection,
            invoiceResolvedDateTime,
          );
        }
        // Revert old items stock before deleting them
        const oldItemsForRevert = await dbService.fetchInvoiceItems(Invoice_idInvoice, connection);
        for (const oldItem of oldItemsForRevert) {
          // Revert Serial Status if applicable
          if (oldItem.Serial_No_Id) {
            await dbService.updateSerialQty(oldItem.Serial_No_Id, connection);
          }
        }
        await dbService.deleteInvoiceItem(Invoice_idInvoice, connection);

        let totalCOGS = 0;
        const companyId = await branchDBService.getCompanyIdByBranch(resolvedBranchId);

        for (const [index, invItem] of (finalItems || []).entries()) {
          let item;
          if (invItem.Item_idItem <= 0) {
            console.log(`[INVOICE-UPDATE] Manual item detected (ID: ${invItem.Item_idItem}). Mocking item record.`);
            item = [{
              idItem: invItem.Item_idItem,
              Description: invItem.Description || "Manual Item",
              Long_Description: invItem.Long_Description || invItem.Description || "Manual Item",
              Type: "2", // Non-physical / service
              Qty: 0,
              Qty_Type: invItem.Qty_Type || 1, // Default qty type
              Cost: 0,
              Real_Cost: 0,
              Rate: invItem.Rate || 0
            }];
          } else {
            item = await itemDbService.fetchItem(invItem.Item_idItem, connection);
          }

          // Use the provided long description or fall back to the item's long description
          const itemDescription =
            invItem.Long_Description ||
            item[0].Long_Description ||
            item[0].Description;

          if (
            Number(invItem.Serial_No) === 1 &&
            invItem.SelectedSerials?.length > 0 &&
            invItem.Item_idItem > 0
          ) {
            const serial_discount =
              invItem.Discount / invItem.SelectedSerials?.length;

            for (const serial_number of invItem.SelectedSerials) {
              let serial_no_id = 0;

              switch (serial_number.exists) {
                case 1:
                  serial_no_id = await dbService.updateSerials(
                    serial_number.Serial_No,
                    connection,
                  );
                  serial_no_id = serial_no_id.ID;
                  break;
                case 0:
                  const insertSerial = await dbService.insertSerialNumbers(
                    0,
                    invItem.Item_idItem,
                    0,
                    serial_number.Serial_No,
                    resolvedBranchId,
                    connection,
                    invItem.Variation_Id || null,
                  );
                  serial_no_id = insertSerial.insertId;
                  break;
              }

              const itemResult = await dbService.insertInvoiceItem(
                Invoice_idInvoice,
                invItem.Item_idItem,
                1,
                serial_no_id,
                item[0].Description,
                itemDescription,
                item[0].Qty_Type,
                1,
                invItem.Rate,
                invItem.Amount,
                invItem.Discount_Type,
                serial_discount,
                invItem.Total_Amount,
                resolvedBranchId,
                invItem.Variation_Id, // Pass Variation_Id
                invItem.Remarks, // Pass Remarks
                connection,
                invItem.is_bonus_line ? 1 : 0,
                invItem.promo_rule_id || null,
                invItem.Detailed_Description || null,
              );
              if (invItem.is_net_item) {
                const insertedItemId = itemResult.insertId;
                await new Promise((resolve, reject) => {
                  connection.query("UPDATE invoice_has_item SET is_net_item = 1 WHERE ID = ?", [insertedItemId], (err) => (err ? reject(err) : resolve()));
                });
              }
            }
          } else {
            const itemResult = await dbService.insertInvoiceItem(
              Invoice_idInvoice,
              invItem.Item_idItem,
              0,
              0,
              item[0].Description,
              itemDescription,
              item[0].Qty_Type,
              invItem.Qty,
              invItem.Rate,
              invItem.Amount,
              invItem.Discount_Type,
              invItem.Discount,
              invItem.Total_Amount,
              resolvedBranchId,
              invItem.Variation_Id || null, // Pass Variation_Id
              invItem.Remarks, // Pass Remarks
              connection,
              invItem.is_bonus_line ? 1 : 0,
              invItem.promo_rule_id || null,
              invItem.Detailed_Description || null,
            );
            if (invItem.is_net_item) {
              const insertedItemId = itemResult.insertId;
              await new Promise((resolve, reject) => {
                connection.query("UPDATE invoice_has_item SET is_net_item = 1 WHERE ID = ?", [insertedItemId], (err) => (err ? reject(err) : resolve()));
              });
            }

            if (invItem.Item_idItem <= 0 && (invItem.manual_supplier_name || invItem.manual_cost)) {
              const insertedItemId = itemResult.insertId;
              const manualSql = `
                INSERT INTO invoice_has_item_manual_details (invoice_has_item_id, Branch_idBranch, supplier_name, cost)
                VALUES (?, ?, ?, ?)
              `;
              await new Promise((resolve, reject) => {
                connection.query(
                  manualSql,
                  [insertedItemId, resolvedBranchId, invItem.manual_supplier_name || null, invItem.manual_cost || null],
                  (err) => (err ? reject(err) : resolve())
                );
              });
            }
          }

          if (invItem.is_material_issue && invItem.issue_item_id) {
            // Update issue item billing qty
            await materialIssueDBService.updateIssueItemBillingQty(
              invItem.issue_item_id,
              invItem.Qty,
              connection
            );

            // Insert mapping record
            await materialIssueDBService.insertIssueInvoiceMap(
              {
                issue_item_id: invItem.issue_item_id,
                issue_note_id: invItem.issue_note_id,
                invoice_id: Invoice_idInvoice,
                qty_invoiced: invItem.Qty,
                project_id: req.body.project_id || null,
                branch_id: resolvedBranchId,
              },
              connection
            );

            // Recalc parent note status
            await materialIssueDBService.recalcNoteStatus(invItem.issue_note_id, connection);
          }

          if (item[0].Type === "1" && !invItem.is_material_issue) {
            const cost = parseFloat(item[0].Cost) || 0;
            const qty = parseFloat(invItem.Qty) || 0;
            if (invItem.Discount_Type === "RTN") {
              totalCOGS -= cost * qty;
            } else {
              totalCOGS += cost * qty;
            }
          }

          // Check if this is a service item
          if (item[0].Type === "2" || item[0].Type === "Service") {
            if (invItem.appointment) {
              const appt = invItem.appointment;
              const startDateTime = appt.start_datetime ? new Date(appt.start_datetime) : new Date();
              const endDateTime = appt.end_datetime ? new Date(appt.end_datetime) : new Date(startDateTime.getTime() + 3600000);
              const recurrenceEnd = appt.recurrence_end_date ? new Date(appt.recurrence_end_date) : null;

              // Generate date series for recurring appointments
              const instances = [];
              const durationMs = endDateTime.getTime() - startDateTime.getTime();

              if (appt.is_recurring === 1 && appt.recurrence_pattern && recurrenceEnd) {
                let currentStart = new Date(startDateTime);
                let currentEnd = new Date(endDateTime);
                recurrenceEnd.setHours(23, 59, 59, 999);

                let occurrences = 0;
                while (currentStart <= recurrenceEnd && occurrences < 100) {
                  instances.push({
                    start: new Date(currentStart),
                    end: new Date(currentEnd),
                  });

                  if (appt.recurrence_pattern === "daily") {
                    currentStart.setDate(currentStart.getDate() + (parseInt(appt.recurrence_interval) || 1));
                  } else if (appt.recurrence_pattern === "weekly") {
                    currentStart.setDate(currentStart.getDate() + (parseInt(appt.recurrence_interval) || 1) * 7);
                  } else if (appt.recurrence_pattern === "monthly") {
                    currentStart.setMonth(currentStart.getMonth() + (parseInt(appt.recurrence_interval) || 1));
                  } else if (appt.recurrence_pattern === "yearly") {
                    currentStart.setFullYear(currentStart.getFullYear() + (parseInt(appt.recurrence_interval) || 1));
                  } else {
                    break;
                  }
                  currentEnd = new Date(currentStart.getTime() + durationMs);
                  occurrences++;
                }
              } else {
                instances.push({
                  start: startDateTime,
                  end: endDateTime,
                });
              }

              // Bulk insert instances
              for (const inst of instances) {
                const apptQuery = `INSERT INTO appointments 
                  (title, start_datetime, end_datetime, location, description, 
                   participant_type, participant_id, participant_name, branch_id, user_id, 
                   is_service_followup, invoice_id, service_job_id, service_due_date,
                   is_recurring, recurrence_pattern, recurrence_interval, recurrence_end_date, notify_person_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                await new Promise((resolve, reject) => {
                  connection.query(
                    apptQuery,
                    [
                      appt.title || `Service: ${item[0].Description || invItem.Item_Name}`,
                      inst.start,
                      inst.end,
                      appt.location || "Client Location",
                      appt.description || `Service appointment from Invoice #${Invoice_idInvoice}`,
                      appt.participant_type || "customer",
                      appt.participant_id || resolvedCustomerId,
                      appt.participant_name || null,
                      resolvedBranchId,
                      resolvedUserId,
                      1, // is_service_followup
                      Invoice_idInvoice,
                      null, // service_job_id
                      inst.start, // service_due_date
                      appt.is_recurring || 0,
                      appt.recurrence_pattern || null,
                      appt.recurrence_interval || 1,
                      recurrenceEnd,
                      appt.notify_person_id || null,
                    ],
                    (apptErr, apptRes) => {
                      if (apptErr) console.error("Error creating custom follow-up appointment instance:", apptErr);
                      resolve();
                    }
                  );
                });
              }
            } else {
              // Fallback to follow-up period (default to 1m if none specified)
              const followPeriod = invItem.followup_period || "1m";
              let followMonths = 0;
              if (followPeriod === "1m") followMonths = 1;
              else if (followPeriod === "2m") followMonths = 2;
              else if (followPeriod === "3m") followMonths = 3;
              else if (followPeriod === "6m") followMonths = 6;
              else if (followPeriod === "1y") followMonths = 12;
              else if (followPeriod === "2y") followMonths = 24;

              if (followMonths > 0) {
                const baseDate = Invoice_Date ? new Date(Invoice_Date) : new Date();
                const dueDate = new Date(baseDate);
                dueDate.setMonth(dueDate.getMonth() + followMonths);

                const startDateTime = new Date(dueDate);
                startDateTime.setHours(9, 0, 0, 0);
                const endDateTime = new Date(startDateTime);
                endDateTime.setHours(10, 0, 0, 0);

                const title = `Service Follow-up: ${item[0].Description || invItem.Item_Name}`;
                const desc = `Automatically scheduled follow-up for ${item[0].Description || invItem.Item_Name} from Invoice #${Invoice_idInvoice}. Remarks: ${invItem.Remarks || 'N/A'}`;

                const apptQuery = `INSERT INTO appointments 
                  (title, start_datetime, end_datetime, location, description, 
                   participant_type, participant_id, participant_name, branch_id, user_id, 
                   is_service_followup, invoice_id, service_job_id, service_due_date)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                await new Promise((resolve, reject) => {
                  connection.query(
                    apptQuery,
                    [
                      title,
                      startDateTime,
                      endDateTime,
                      "Client Location",
                      desc,
                      "customer",
                      resolvedCustomerId,
                      null,
                      resolvedBranchId,
                      resolvedUserId,
                      1, // is_service_followup
                      Invoice_idInvoice,
                      null, // service_job_id
                      dueDate, // service_due_date
                    ],
                    (apptErr, apptRes) => {
                      if (apptErr) {
                        console.error("Error creating default follow-up appointment:", apptErr);
                      } else {
                        console.log(`[INVOICE-UPDATE] Successfully created default service follow-up appointment with ID: ${apptRes.insertId}`);
                      }
                      resolve();
                    }
                  );
                });
              }
            }
          }
        }

        // Calculate net stock changes for physical items (Type === "1") and update stock/history/cards
        const netStockChanges = {};

        // Populate old items stock changes
        if (oldItemsForRevert && oldItemsForRevert.length > 0) {
          for (const oldItem of oldItemsForRevert) {
            if (String(oldItem.Type) === "1") {
              const key = `${oldItem.Item_idItem}_${oldItem.Variation_Id || 'null'}`;
              if (!netStockChanges[key]) {
                netStockChanges[key] = {
                  productId: oldItem.Item_idItem,
                  variationId: oldItem.Variation_Id || null,
                  oldChange: 0,
                  newChange: 0,
                  itemName: oldItem.Item_Name || "Physical Item",
                  cost: oldItem.Cost || 0,
                  realCost: oldItem.Real_Cost || 0,
                  rate: oldItem.Rate || 0
                };
              }
              const qty = parseFloat(oldItem.Qty || 0);
              netStockChanges[key].oldChange += (oldItem.Discount_Type === "RTN" ? qty : -qty);
            }
          }
        }

        // Populate new items stock changes
        if (items && items.length > 0) {
          for (const newItem of items) {
            if (newItem.Item_idItem > 0) {
              const itemData = await itemDbService.fetchItem(newItem.Item_idItem, connection);
              if (itemData && itemData.length > 0 && String(itemData[0].Type) === "1") {
                const key = `${newItem.Item_idItem}_${newItem.Variation_Id || 'null'}`;
                if (!netStockChanges[key]) {
                  netStockChanges[key] = {
                    productId: newItem.Item_idItem,
                    variationId: newItem.Variation_Id || null,
                    oldChange: 0,
                    newChange: 0,
                    itemName: itemData[0].Description,
                    cost: itemData[0].Cost || 0,
                    realCost: itemData[0].Real_Cost || 0,
                    rate: newItem.Rate || 0
                  };
                }
                const qty = parseFloat(newItem.Qty || 0);
                netStockChanges[key].newChange += (newItem.Discount_Type === "RTN" ? qty : -qty);
              }
            }
          }
        }

        // Process net changes
        for (const info of Object.values(netStockChanges)) {
          const netStockChange = info.newChange - info.oldChange;
          if (netStockChange === 0) continue; // Skip if no net quantity difference

          const isVariation = info.variationId && info.variationId > 0;
          let currentStock = 0;
          let newStock = 0;

          if (isVariation) {
            const varResults = await new Promise((resolve, reject) => {
              connection.query(
                "SELECT qty FROM item_variations WHERE id = ?",
                [info.variationId],
                (err, results) => err ? reject(err) : resolve(results)
              );
            });
            currentStock = varResults && varResults.length > 0 ? parseFloat(varResults[0].qty || 0) : 0;
            newStock = currentStock + netStockChange;

            // Update variation stock
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item_variations SET qty = ? WHERE id = ?",
                [newStock, info.variationId],
                (err, result) => err ? reject(err) : resolve(result)
              );
            });

            // Log variation history
            await productHistoryLogHelper({
              productId: info.productId,
              variationId: info.variationId,
              quantityChange: netStockChange,
              oldQty: currentStock,
              newQty: newStock,
              type: netStockChange > 0 ? "Invoice Return" : "Invoice Sale",
              description: `Stock adjusted (Invoice updated) via Invoice ID: ${idInvoice} (No: ${Invoice_Number})`,
              branchId: resolvedBranchId,
              companyId: companyId || 1,
              userId: resolvedUserId,
              referenceId: idInvoice,
              connection,
            });
          } else {
            const itemData = await itemDbService.fetchItem(info.productId, connection);
            currentStock = itemData && itemData.length > 0 ? parseFloat(itemData[0].Qty || 0) : 0;
            newStock = currentStock + netStockChange;

            // Update main item stock
            await itemDbService.itemProcess(
              info.cost,
              info.realCost,
              newStock,
              info.productId,
              connection
            );

            // Log standard item history
            await productHistoryLogHelper({
              productId: info.productId,
              variationId: null,
              quantityChange: netStockChange,
              oldQty: currentStock,
              newQty: newStock,
              type: netStockChange > 0 ? "Invoice Return" : "Invoice Sale",
              description: `Stock adjusted (Invoice updated) via Invoice ID: ${idInvoice} (No: ${Invoice_Number})`,
              branchId: resolvedBranchId,
              companyId: companyId || 1,
              userId: resolvedUserId,
              referenceId: idInvoice,
              connection,
            });
          }

          // Log stock card
          const in_qty = netStockChange > 0 ? netStockChange : 0;
          const out_qty = netStockChange < 0 ? Math.abs(netStockChange) : 0;

          await stockCardDbService.insertStockCard(
            info.productId,
            info.itemName + " (Invoice Update)",
            "INVOICE-UPDATE",
            idInvoice,
            info.cost,
            info.realCost,
            info.rate,
            in_qty,
            out_qty,
            newStock,
            resolvedBranchId,
            connection,
            info.variationId || null,
          );

          // Deduct from batches if net stock change is negative (meaning we sold more items)
          if (netStockChange < 0) {
            const newItemForBatch = (finalItems || []).find(
              (newItem) =>
                newItem.Item_idItem === info.productId &&
                (newItem.Variation_Id || null) === (info.variationId || null)
            );
            const batchId = newItemForBatch ? newItemForBatch.Batch_Id : null;

            try {
              const batchResult = await itemDbService.deductStockFromBatches(
                info.productId,
                info.variationId || null,
                Math.abs(netStockChange),
                batchId || null,
                resolvedBranchId,
                connection,
                Warehouse_Id || null
              );

              if (batchResult && Array.isArray(batchResult.deductions)) {
                for (const d of batchResult.deductions) {
                  if (d.warehouseId && d.deductedQty > 0) {
                    const details = {
                      type: "STOCK_SALE",
                      reference: `Invoice Update ID: ${Invoice_idInvoice}`,
                      invoiceNo: Invoice_Number || `Invoice #${Invoice_idInvoice}`,
                      items: [
                        {
                          id: info.productId,
                          name:
                            newItemForBatch?.Item_Name ||
                            newItemForBatch?.Description ||
                            "Product",
                          qty: d.deductedQty,
                        },
                      ],
                    };
                    const ip =
                      req.headers["x-forwarded-for"] ||
                      req.socket.remoteAddress ||
                      "0.0.0.0";
                    const ua = req.headers["user-agent"] || "unknown";
                    const sqlLog = `
                      INSERT INTO warehouse_audit_logs 
                        (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
                      VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
                    `;
                    await new Promise((resolveLog) => {
                      connection.query(
                        sqlLog,
                        [
                          d.warehouseId,
                          resolvedBranchId,
                          resolvedUserId,
                          JSON.stringify(details),
                          ip,
                          ua,
                        ],
                        (errLog) => {
                          if (errLog) console.error("Warehouse sale audit log on update failed:", errLog);
                          resolveLog();
                        }
                      );
                    });
                  }
                }
              }
            } catch (batchDeductErr) {
              console.error(`[INVOICE-UPDATE] Error during batch stock deduction:`, batchDeductErr);
            }
          }
        }

        // Update bank account logic
        if (Payment_Method === "bank" && Paid_Amount > 0 && Bank_Account_Id) {
          try {
            const accountDetails = await bankAccountDBService.getAccountById(
              Bank_Account_Id,
              resolvedBranchId,
            );
            const currentBal = parseFloat(accountDetails[0].account_balance || 0);
            const payment = currentBal + parseFloat(Paid_Amount);

            const updateCompanyBankAccountBalance =
              await bankAccountDBService.updateCompanyBankAccountBalance(
                Bank_Account_Id,
                payment,
                resolvedBranchId,
                connection,
              );

            if (updateCompanyBankAccountBalance) {
              const bank_acc_id = Bank_Account_Id;
              const type = "Invoice Payment (Update)";
              const description = `Payment update for Invoice ID: ${Invoice_idInvoice}`;
              const note = `Paid Amount: ${Paid_Amount}`;
              const debit = Paid_Amount;
              const credit = "0.00";
              const balance = payment;
              const user = accountDetails[0].user;
              const updated_status = "paid";
              const updated_note = `Payment of ${Paid_Amount} received for Invoice ID: ${Invoice_idInvoice}`;
              const updated_date_time = new Date();
              const updated_user = resolvedUserId;
              const payment_id = Invoice_idInvoice;
              const contra_account = "-";
              const reconcilation_status = "0";
              const branch_id = resolvedBranchId;

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
            console.error(
              "Error updating bank account balance after invoice update:",
              error,
            );
          }
        }

        // --- ACCOUNTING DOUBLE ENTRY START ---
        try {
          const invoiceCompanyId =
            await branchDBService.getCompanyIdByBranch(Branch_idBranch);

          const netAmt = parseFloat(Net_Amount) || 0;
          const paidAmt = parseFloat(Paid_Amount) || 0;
          const discountAmt = parseFloat(Discount_Amount) || 0;
          const vatAmt = parseFloat(Vat_Amount) || 0;
          const revenueAmt = netAmt + discountAmt - vatAmt;
          const voucherAmt = parseFloat(gift_voucher_amount) || 0;
          const loyaltyAmt = parseFloat(loyalty_discount_amount) || 0;
          const totalEffectivePaid = paidAmt + voucherAmt + loyaltyAmt;

          const AR_AccountId = await findAccountByNameAndGroup(
            "Accounts Receivable (Debtors)",
            "Assets",
            invoiceCompanyId,
            Branch_idBranch,
            connection,
          );
          const Sales_AccountId = await findAccountByNameAndGroup(
            "Sales Revenue",
            "Income",
            invoiceCompanyId,
            Branch_idBranch,
            connection,
          );

          let Discount_AccountId = null;
          if (discountAmt > 0) {
            Discount_AccountId = await findAccountByNameAndGroup(
              "Sales Discounts",
              "Contra Accounts",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          let Vat_AccountId = null;
          if (vatAmt > 0) {
            Vat_AccountId = await findAccountByNameAndGroup(
              "VAT Payable",
              "Liabilities",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          let Voucher_AccountId = null;
          if (voucherAmt > 0) {
            Voucher_AccountId = await ensureAccountExists(
              "Gift Voucher Liability",
              "Liabilities",
              "Liabilities",
              "2000-004",
              "Gift Voucher Liability account",
              invoiceCompanyId,
              Branch_idBranch,
              User_idUser || Employee_idEmployee || 1,
              connection,
            );
          }

          let Loyalty_AccountId = null;
          if (loyaltyAmt > 0) {
            Loyalty_AccountId = await ensureAccountExists(
              "Customer Loyalty Discounts",
              "Contra Accounts",
              "Contra Accounts",
              "5000-003",
              "Customer Loyalty Points Redemption Discount account",
              invoiceCompanyId,
              Branch_idBranch,
              User_idUser || Employee_idEmployee || 1,
              connection,
            );
          }

          let paymentAccountName = "Cash in Hand";
          const pMethodLower = Payment_Method
            ? Payment_Method.toLowerCase()
            : "";

          if (pMethodLower === "cash") {
            paymentAccountName = "Cash in Hand";
          } else if (
            pMethodLower === "card" ||
            pMethodLower === "online transfer" ||
            pMethodLower.includes("online") ||
            pMethodLower === "direct bank" ||
            pMethodLower.includes("bank")
          ) {
            paymentAccountName = "Bank Account";
          } else if (pMethodLower === "cheque") {
            paymentAccountName = "Cheque Clearing Account";
          } else if (pMethodLower === "koko" || pMethodLower === "mintpay") {
            paymentAccountName = "Receivable from Provider";
          }

          let Payment_AccountId = null;
          if (paidAmt > 0) {
            Payment_AccountId = await findAccountByNameAndGroup(
              paymentAccountName,
              "Assets",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          let Advance_AccountId = null;
          if (totalEffectivePaid > netAmt) {
            Advance_AccountId = await findAccountByNameAndGroup(
              "Customer Advance",
              "Liabilities",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          const userId = User_idUser || Employee_idEmployee;

          if (
            totalEffectivePaid === netAmt &&
            (paidAmt === 0 || Payment_AccountId) &&
            (voucherAmt === 0 || Voucher_AccountId) &&
            (loyaltyAmt === 0 || Loyalty_AccountId)
          ) {
            // Case A: FULL PAYMENT (Settled via Cash, Voucher, Loyalty, or combination)
            if (paidAmt > 0 && Payment_AccountId) {
              if (
                Payment_Method === "split" &&
                Array.isArray(split_payments) &&
                split_payments.length > 0
              ) {
                for (const sp of split_payments) {
                  const spAmt = parseFloat(sp.amount) || 0;
                  if (spAmt <= 0) continue;
                  const spAccountId = await findAccountByNameAndGroup(
                    resolvePaymentAccountName(sp.method),
                    "Assets",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  );
                  if (spAccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Assets",
                      amount: spAmt,
                      description: `${(sp.method || "").toUpperCase()} portion of Full Payment for Invoice ${Invoice_Number}`,
                      type: "Invoice Creation",
                      accountId: spAccountId,
                      branchId: Branch_idBranch,
                      userId: userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }
              } else {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: paidAmt,
                  description: `Full Payment for Invoice ${Invoice_Number}`,
                  type: "Invoice Creation",
                  accountId: Payment_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "debit",
                  connection,
                });
              }
            }

            if (voucherAmt > 0 && Voucher_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: voucherAmt,
                description: `Gift Voucher ${gift_voucher_code || ""} redeemed for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Voucher_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }

            if (loyaltyAmt > 0 && Loyalty_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: loyaltyAmt,
                description: `Customer Loyalty Points Redeemed (${redeemed_loyalty_points || ""} pts) for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Loyalty_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }

            if (Discount_AccountId && discountAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: discountAmt,
                description: `Discount applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Discount_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }
            if (Sales_AccountId && revenueAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Income",
                amount: revenueAmt,
                description: `Revenue for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Sales_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }
            if (Vat_AccountId && vatAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: vatAmt,
                description: `VAT applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Vat_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }
          } else {
            // Case B (CREDIT), Case C (INSTALLMENT), Case D (OVERPAYMENT) or Partial Payment
            if (AR_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: netAmt,
                description: `Invoice ${Invoice_Number} generated`,
                type: "Invoice Creation",
                accountId: AR_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }
            if (Discount_AccountId && discountAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: discountAmt,
                description: `Discount applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Discount_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });
            }
            if (Sales_AccountId && revenueAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Income",
                amount: revenueAmt,
                description: `Revenue for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Sales_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }
            if (Vat_AccountId && vatAmt > 0) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: vatAmt,
                description: `VAT applied for Invoice ${Invoice_Number}`,
                type: "Invoice Creation",
                accountId: Vat_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "credit",
                connection,
              });
            }

            // Handle Gift Voucher redemption against AR
            if (voucherAmt > 0 && Voucher_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: voucherAmt,
                description: `Gift Voucher ${gift_voucher_code || ""} redeemed for Invoice ${Invoice_Number}`,
                type: "Invoice Payment",
                accountId: Voucher_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });

              if (AR_AccountId) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: voucherAmt,
                  description: `Gift Voucher applied to Invoice ${Invoice_Number}`,
                  type: "Invoice Payment",
                  accountId: AR_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }

            // Handle Customer Loyalty redemption against AR
            if (loyaltyAmt > 0 && Loyalty_AccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Contra Accounts",
                amount: loyaltyAmt,
                description: `Customer Loyalty Points Redeemed (${redeemed_loyalty_points || ""} pts) for Invoice ${Invoice_Number}`,
                type: "Invoice Payment",
                accountId: Loyalty_AccountId,
                branchId: Branch_idBranch,
                userId: userId,
                companyId: invoiceCompanyId,
                transactionType: "debit",
                connection,
              });

              if (AR_AccountId) {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: loyaltyAmt,
                  description: `Loyalty Points Redemption applied to Invoice ${Invoice_Number}`,
                  type: "Invoice Payment",
                  accountId: AR_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "credit",
                  connection,
                });
              }
            }

            // Handle payment if any
            if (paidAmt > 0 && Payment_AccountId) {
              if (
                Payment_Method === "split" &&
                Array.isArray(split_payments) &&
                split_payments.length > 0
              ) {
                for (const sp of split_payments) {
                  const spAmt = parseFloat(sp.amount) || 0;
                  if (spAmt <= 0) continue;
                  const spAccountId = await findAccountByNameAndGroup(
                    resolvePaymentAccountName(sp.method),
                    "Assets",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  );
                  if (spAccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Assets",
                      amount: spAmt,
                      description: `${(sp.method || "").toUpperCase()} portion of payment received for Invoice ${Invoice_Number}`,
                      type: "Invoice Payment",
                      accountId: spAccountId,
                      branchId: Branch_idBranch,
                      userId: userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }
              } else {
                await creditDebitLogHelper({
                  accountType: "Chartered Account",
                  group: "Assets",
                  amount: paidAmt,
                  description: `Payment received for Invoice ${Invoice_Number}`,
                  type: "Invoice Payment",
                  accountId: Payment_AccountId,
                  branchId: Branch_idBranch,
                  userId: userId,
                  companyId: invoiceCompanyId,
                  transactionType: "debit",
                  connection,
                });
              }

              if (totalEffectivePaid > netAmt) {
                // Case D: OVERPAYMENT
                const cashForInvoice = Math.max(0, netAmt - voucherAmt - loyaltyAmt);
                if (AR_AccountId && cashForInvoice > 0) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Assets",
                    amount: cashForInvoice,
                    description: `Payment applied to Invoice ${Invoice_Number}`,
                    type: "Invoice Payment",
                    accountId: AR_AccountId,
                    branchId: Branch_idBranch,
                    userId: userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }
                if (Advance_AccountId) {
                  const advanceAmt = totalEffectivePaid - netAmt;
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Liabilities",
                    amount: advanceAmt,
                    description: `Overpayment for Invoice ${Invoice_Number}`,
                    type: "Invoice Payment",
                    accountId: Advance_AccountId,
                    branchId: Branch_idBranch,
                    userId: userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }
              } else {
                // Partial payment
                if (AR_AccountId) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Assets",
                    amount: paidAmt,
                    description: `Payment applied to Invoice ${Invoice_Number}`,
                    type: "Invoice Payment",
                    accountId: AR_AccountId,
                    branchId: Branch_idBranch,
                    userId: userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }
              }
            }
          }

          let Cogs_AccountId = null;
          let Inventory_AccountId = null;
          if (totalCOGS !== 0) {
            Cogs_AccountId = await findAccountByNameAndGroup(
              "Cost of Goods Sold (COGS)",
              "Expenses",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
            Inventory_AccountId = await findAccountByNameAndGroup(
              "Inventory",
              "Assets",
              invoiceCompanyId,
              Branch_idBranch,
              connection,
            );
          }

          if (totalCOGS > 0 && Cogs_AccountId && Inventory_AccountId) {
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: totalCOGS,
              description: `COGS for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Cogs_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "debit",
              connection: connection,
            });
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Assets",
              amount: totalCOGS,
              description: `Inventory reduction for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Inventory_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "credit",
              connection: connection,
            });
          } else if (totalCOGS < 0 && Cogs_AccountId && Inventory_AccountId) {
            const absCOGS = Math.abs(totalCOGS);
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Assets",
              amount: absCOGS,
              description: `Inventory return for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Inventory_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "debit",
              connection: connection,
            });
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: absCOGS,
              description: `COGS reversal for Invoice ${Invoice_Number}`,
              type: "Invoice Creation",
              accountId: Cogs_AccountId,
              branchId: Branch_idBranch,
              userId: userId,
              companyId: invoiceCompanyId,
              transactionType: "credit",
              connection: connection,
            });
          }
        } catch (accErr) {
          console.error(
            "Error creating accounting entries for invoice:",
            accErr,
          );
        }
        // --- ACCOUNTING DOUBLE ENTRY END ---

        await recalculateCustomerCreditLogs(resolvedCustomerId, connection);

        await userLogDbService.insertLog(
          resolvedUserId,
          currentDate(),
          "Invoice",
          Invoice_idInvoice,
          "update",
          resolvedBranchId,
          connection,
        );

        // Automatically redeem Customer Loyalty Points if token is provided
        if (loyalty_redemption_token && resolvedCustomerId && Number(resolvedCustomerId) > 0) {
          try {
            const customerLoyaltyService = require("../services/customerLoyaltyService");
            await customerLoyaltyService.redeemPointsForInvoice({
              customerId: resolvedCustomerId,
              branchId: resolvedBranchId,
              invoiceId: Invoice_idInvoice,
              invoiceNumber: resolvedInvoiceNumber,
              pointsToRedeem: redeemed_loyalty_points,
              discountAmount: loyalty_discount_amount,
              redemptionToken: loyalty_redemption_token,
              userId: resolvedUserId,
              connection,
            });
          } catch (loyaltyRedeemErr) {
            console.error("[CustomerLoyalty] Error redeeming loyalty points in updateInvoice:", loyaltyRedeemErr);
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
          const io = req.app?.get ? req.app.get("io") : null;
          if (io) {
            if (resolvedBranchId) {
              io.to(`branch_${resolvedBranchId}`).emit("refreshNotifications");
            } else {
              io.emit("refreshNotifications");
            }
          }
          res.json({
            message: "Invoice updated successfully",
            invoice_id: Invoice_idInvoice,
          });
        });
      } catch (err) {
        try {
          fs.writeFileSync(path.join(__dirname, "../error_log.txt"), "ERROR IN UPDATE_INVOICE:\n" + err.stack);
        } catch (fsErr) {
          console.error("Failed to write to error_log.txt:", fsErr);
        }
        connection.rollback(() => {
          connection.release();
          console.error("Error in updateInvoice:", err);
          res.status(500).json({
            message: "Error updating invoice",
            error: err.message,
            stack:
              process.env.NODE_ENV === "development" ? err.stack : undefined,
          });
        });
      }
    });
  });
};

const checkInvoice = async (req, res) => {
  try {
    const { invoice_id, Branch_idBranch } = req.params;
    const invoices = await dbService.checkInvoice(invoice_id, Branch_idBranch);

    if (invoices?.length !== 0) {
      return res.status(201).json({ message: "Invoice is already exist" });
    } else {
      return res.status(200).json({ message: "Invoice is not exist" });
    }
  } catch (err) {
    res.status(500).json({
      message: "Error fetching invoices",
      error: err.message,
    });
  }
};

const getNextInvoiceId = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const employeeId = req.query.employeeId;

    // 🔍 DEBUG
    console.log(
      `[GET-NEXT-INVOICE-ID] Request received for Branch ID: ${Branch_idBranch}, Employee ID: ${employeeId || "none"}`,
    );

    const rules = await rulesDbService.getInvoiceNumberDetails(Branch_idBranch);

    if (!rules || rules.length === 0) {
      console.error(
        `[GET-NEXT-INVOICE-ID] ❌ No invoice number rules found for branch ${Branch_idBranch}`,
      );
      throw new Error("Invoice number rules not found");
    }

    const base_letter_part = rules[0].Invoice_No_Start_With;
    const starting_number = rules[0].Invoice_No_Strat_From;
    const salesman_enabled = parseInt(rules[0].salesman_enabled) === 1;
    const salesman_invoice_update =
      parseInt(rules[0].salesman_invoice_update) === 1;

    let letter_part = base_letter_part;

    // If salesman is enabled and an employee ID is provided, prefix with first 3 chars of salesman name
    if (salesman_enabled && employeeId && salesman_invoice_update) {
      try {
        const employee = await employeeDbService.fetchEmployeeById(employeeId);
        if (employee && employee.length > 0) {
          const salesmanPrefix = employee[0].Employee_Name.replace(/\s+/g, "")
            .substring(0, 3)
            .toUpperCase();
          letter_part = `${salesmanPrefix}${base_letter_part}`;
          console.log(
            `[GET-NEXT-INVOICE-ID] Salesman prefix applied: ${letter_part}`,
          );
        }
      } catch (empErr) {
        console.error(
          `[GET-NEXT-INVOICE-ID] Error fetching employee, using default prefix:`,
          empErr,
        );
      }
    }

    let next_invoice_number;

    if (parseInt(rules[0].advanced_invoice_number) === 1) {
      let branchName = "";
      try {
        const branchDetails = await branchDBService.fetchBranch(Branch_idBranch);
        if (branchDetails && branchDetails.length > 0) {
          branchName = branchDetails[0].Company || branchDetails[0].Name || "";
        }
      } catch (branchErr) {
        console.error("Error fetching branch details:", branchErr);
      }

      const prefixPart = generateAdvancedInvoiceNumber(letter_part, "", branchName).replace(/X+/g, "");
      let last_invoice_adv = await dbService.getLastInvoiceBySalesmanPrefix(
        Branch_idBranch,
        prefixPart
      );

      let sequence = parseInt(starting_number, 10) || 1;
      if (last_invoice_adv && last_invoice_adv.length > 0) {
        const last_num = last_invoice_adv[0].Invoice_Number;
        const match = last_num.match(/(\d+)$/);
        if (match) {
          sequence = parseInt(match[1], 10) + 1;
        }
      } else {
        const overall_last = await dbService.getLastInvoice(Branch_idBranch);
        if (overall_last && overall_last.length > 0) {
          const last_num = overall_last[0].Invoice_Number;
          const match = last_num.match(/(\d+)$/);
          if (match) {
            sequence = parseInt(match[1], 10) + 1;
          }
        }
      }
      next_invoice_number = generateAdvancedInvoiceNumber(letter_part, sequence, branchName);
    } else {
      next_invoice_number = `${letter_part}${starting_number}`;

      let last_invoice = [];
      if (salesman_enabled && employeeId && salesman_invoice_update) {
        last_invoice = await dbService.getLastInvoiceBySalesman(
          Branch_idBranch,
          employeeId,
        );
      }

      // Fall back to prefix matching if no invoice exists for this salesman yet, or no salesman selected
      if (!last_invoice || last_invoice.length === 0) {
        last_invoice = await dbService.getLastInvoiceBySalesmanPrefix(
          Branch_idBranch,
          letter_part,
        );
      }

      if (last_invoice?.length !== 0) {
        const last_invoice_number = last_invoice[0].Invoice_Number;

        // Extract the non-digit prefix and trailing digit sequence to preserve format (e.g. leading zeros, hyphens)
        const match = last_invoice_number.match(/^(.*?)(\d+)$/);
        if (match) {
          const prefixPart = match[1];
          const numericStr = match[2];
          const numericPart = parseInt(numericStr, 10);
          const nextNumericPart = numericPart + 1;
          const nextNumericStr = nextNumericPart.toString().padStart(numericStr.length, "0");
          next_invoice_number = `${prefixPart}${nextNumericStr}`;
        } else {
          const matchOld = last_invoice_number.match(/\d/);
          if (matchOld) {
            const digitPosition = matchOld.index;
            const numericPart = parseInt(last_invoice_number.slice(digitPosition), 10);
            const nextNumericPart = numericPart + 1;
            next_invoice_number = `${letter_part}${nextNumericPart}`;
          }
        }
      }
    }

    console.log(
      `[GET-NEXT-INVOICE-ID] ✅ Generated Next Invoice Number: ${next_invoice_number}`,
    );
    res.json(next_invoice_number);
  } catch (err) {
    console.error(
      `[GET-NEXT-INVOICE-ID] ❌ Error generating invoice number:`,
      err,
    );
    res
      .status(500)
      .json({ message: "Error getting invoice number", error: err.message });
  }
};

const getAllInvoices = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { page, limit, search, customer, salesman, date, user, custom_filters } = req.query;
  const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
  const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];

  try {
    let scopedUserId = null;
    if (currentUserId) {
      try {
        const userScope = await branchDBService.getUserDataScope(currentUserId, Branch_idBranch, currentUserRole);
        if (userScope.isRestricted) {
          scopedUserId = currentUserId;
        }
      } catch (scopeErr) {
        console.error("Error checking user scope for invoices:", scopeErr);
      }
    }

    if (page && limit) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const { invoices, total } = await dbService.fetchInvoicesPaginated(
        Branch_idBranch,
        limitNum,
        offset,
        search,
        customer,
        salesman,
        date,
        user,
        custom_filters,
        scopedUserId,
      );

      res.status(200).json({
        invoices,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } else {
      const invoices = await dbService.fetchInvoices(Branch_idBranch, scopedUserId);
      if (invoices?.length === 0) {
        return res.status(404).json({ message: "Invoices not found" });
      }
      res.json(invoices);
    }
  } catch (err) {
    res.status(500).json({
      message: "Error fetching invoices",
      error: err.message,
    });
  }
};

const getAllSerials = async (req, res) => {
  try {
    const { Item_idItem } = req.params;

    const serials = await dbService.fetchSerials(Item_idItem);
    if (serials?.length === 0) {
      return res.status(404).json({ message: "No Serial Number are found" });
    }
    res.json(serials);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching serials",
      error: err.message,
    });
  }
};

const getInvoiceById = async (req, res) => {
  try {
    const { idInvoice } = req.params;

    const invoice = await dbService.fetchInvoice(idInvoice);
    if (invoice?.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    let items = await dbService.fetchInvoiceItems(idInvoice);

    items = await Promise.all(
      items.map(async (item) => {
        if (item.Item_Service === 1) {
          const dates = await dbService.fetchServiceDateInvoices(
            idInvoice,
            item.Item_idItem,
          );
          item.dates = dates;
        }
        return item; // Return the modified item
      }),
    );
    if (items?.length === 0) {
      return res.status(404).json({ message: "Invoice items not found" });
    }
    let installments = [];
    if (invoice[0].Payment_Type === 2) {
      installments =
        await installmentLogDbService.fetchInstallmentByInvoice(idInvoice);
    }

    const customerId = invoice[0].Customer_idCustomer;
    let customFields = [];
    if (customerId) {
      customFields = await new Promise((resolve) => {
        const sql = `
          SELECT cfd.field_id, cfd.value, cf.field_name 
          FROM customer_field_data cfd 
          JOIN customer_fields cf ON cf.id = cfd.field_id 
          WHERE cfd.customer_id = ? AND cf.show_in_invoice = 1
        `;
        db.query(sql, [customerId], (err, results) => {
          if (err) {
            console.error("Error fetching custom fields for invoice detail:", err);
            resolve([]);
          } else {
            resolve(results || []);
          }
        });
      });
    }

    // Fetch associated estimate if it exists
    let estimate = null;
    if (invoice[0].Invoice_Number) {
      estimate = await new Promise((resolve) => {
        const queryEst = `
          SELECT est.*, c.displayName as Customer_Name, c.billingAddress1 as Customer_Address,
                 c.phoneNumber as Customer_Phone, ic.name as Insurance_Company_Name,
                 pest.estimate_no as parent_estimate_no
          FROM estimates est
          LEFT JOIN customer c ON est.customer_id = c.idCustomer
          LEFT JOIN estimate_insurance_companies ic ON est.insurance_company_id = ic.id
          LEFT JOIN estimates pest ON est.parent_estimate_id = pest.id
          WHERE est.invoice_no = ?
          LIMIT 1
        `;
        db.query(queryEst, [invoice[0].Invoice_Number], (err, estResults) => {
          if (err || estResults.length === 0) {
            resolve(null);
          } else {
            const est = estResults[0];
            try {
              est.custom_fields_data = est.custom_fields_data
                ? JSON.parse(est.custom_fields_data)
                : {};
            } catch (_) {
              est.custom_fields_data = {};
            }

            // Fetch items and photos for this estimate too
            db.query("SELECT * FROM estimate_items WHERE estimate_id = ?", [est.id], (err, itemsResult) => {
              if (!err) est.items = itemsResult || [];

              db.query("SELECT * FROM estimate_photos WHERE estimate_id = ?", [est.id], (err, photosResult) => {
                if (!err) est.photos = photosResult || [];
                resolve(est);
              });
            });
          }
        });
      });
    }

    let customFieldsData = {};
    try {
      customFieldsData = invoice[0].custom_fields_data
        ? (typeof invoice[0].custom_fields_data === "string" ? JSON.parse(invoice[0].custom_fields_data) : invoice[0].custom_fields_data)
        : {};
    } catch (_) {
      customFieldsData = {};
    }

    let split_payments = [];
    if (invoice[0].Payment_Method === "split") {
      split_payments = await dbService.fetchSplitPayments(idInvoice);
    }

    res.json({
      invoice: {
        ...invoice[0],
        custom_fields_data: customFieldsData,
        custom_fields: customFields,
        split_payments,
      },
      items: items,
      installments,
      estimate,
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching invoice",
      error: err.message,
    });
  }
};

const getInvoiceforEdit = async (req, res) => {
  try {
    const { idInvoice } = req.params;

    const invoice = await dbService.fetchInvoice(idInvoice);
    if (invoice?.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    let items = await dbService.fetchInvoiceItems(idInvoice);

    items = await Promise.all(
      items.map(async (item) => {
        if (item.Item_Service === 1) {
          const dates = await dbService.fetchServiceDateInvoices(
            idInvoice,
            item.Item_idItem,
          );
          item.dates = dates;
        }
        return item; // Return the modified item
      }),
    );

    // Group items by Item_idItem, Variation_Id (for catalog items) and ID (for manual items) to preserve insertion order
    const itemOrder = [];
    const groupedItems = items.reduce((acc, item) => {
      const {
        Item_idItem,
        Serial_Number,
        Serial_No_Id,
        Rate,
        Discount,
        Qty,
        idItem,
        Variation_Id,
      } = item;

      // Grouping key: manual items are never grouped, catalog items with variations are grouped by variant, standard items by Item_idItem.
      const isManual = item.is_manual_item === 1 || !Item_idItem || Item_idItem <= 0;
      const key = isManual
        ? `manual_${item.ID}`
        : (Variation_Id ? `catalog_${Item_idItem}_var_${Variation_Id}` : `catalog_${Item_idItem}`);

      if (!acc[key]) {
        itemOrder.push(key);
        acc[key] = {
          ...item,
          SelectedSerials: [],
          Total_Amount: 0,
          Total_Discount: 0,
          Total_Qty: 0,
          Serial_No: 0,
        };
      }

      if (item.Item_Has_Serial) {
        acc[key].SelectedSerials.push({
          value: Serial_No_Id, // Assuming idItem is the unique ID of the serial number
          label: Serial_Number,
          exists: 1,
          Serial_No: Serial_Number,
        });
        acc[key].Serial_No = 1; // Assign Serial_No as 1 if the item has serial numbers
      }

      acc[key].Total_Qty += parseFloat(Qty);
      acc[key].Total_Amount += parseFloat(item.Total_Amount || 0);
      acc[key].Total_Discount += parseFloat(Discount);

      return acc;
    }, {});

    // Convert the grouped items object back to an array in the original order of insertion
    const processedItems = itemOrder.map((key) => {
      const item = groupedItems[key];
      return {
        ...item,
        Amount: item.Total_Amount.toString(),
        Total_Amount: item.Total_Amount,
        Discount: item.Total_Discount.toString(),
        Qty: item.Total_Qty.toString(),
        SelectedSerials:
          item.SelectedSerials?.length > 0 ? item.SelectedSerials : undefined,
      };
    });

    let installments = [];
    if (invoice[0].Payment_Type === 2) {
      installments =
        await installmentLogDbService.fetchInstallmentByInvoice(idInvoice);
    }

    const inv = invoice[0];
    try {
      inv.custom_fields_data = inv.custom_fields_data
        ? (typeof inv.custom_fields_data === "string" ? JSON.parse(inv.custom_fields_data) : inv.custom_fields_data)
        : {};
    } catch (_) {
      inv.custom_fields_data = {};
    }

    res.json({
      invoice: inv,
      items: processedItems,
      installments,
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching invoice",
      error: err.message,
    });
  }
};

const deleteInvoice = async (req, res) => {
  const { idInvoice } = req.params;
  const { User_idUser, Branch_idBranch } = req.body;

  // Proactive Staging for DELETE_INVOICE
  if (!req.is_approved_webhook) {
    try {
      let targetBranchId = Branch_idBranch;
      if (!targetBranchId && idInvoice) {
        const [invRows] = await promisePool.query("SELECT Branch_idBranch FROM invoice WHERE idInvoice = ? LIMIT 1", [idInvoice]);
        if (invRows.length > 0) targetBranchId = invRows[0].Branch_idBranch;
      }
      targetBranchId = parseInt(targetBranchId, 10) || 1;

      let companyId = req.headers["company_id"] || req.user?.company_id || req.body?.companyId;
      if (!companyId || companyId === targetBranchId) {
        companyId = await branchDBService.getCompanyIdByBranch(targetBranchId);
      }
      companyId = parseInt(companyId, 10) || 1;

      const approvalNeeded = await approvalService.isApprovalRequired(
        companyId, 
        targetBranchId, 
        'DELETE_INVOICE'
      );
      if (approvalNeeded) {
        await promisePool.query(
          "UPDATE invoice SET approval_status = 'PENDING_APPROVAL' WHERE idInvoice = ?",
          [idInvoice]
        );

        const [invRows] = await promisePool.query(
          "SELECT Invoice_Number, Customer_idCustomer, Total, Net_Amount FROM invoice WHERE idInvoice = ? LIMIT 1",
          [idInvoice]
        );
        const invInfo = invRows[0] || {};

        let customerName = resolveCustomerName(null, req.body.customer_name);
        try {
          if (invInfo.Customer_idCustomer) {
            const custResults = await customerDbService.fetchCustomerById(invInfo.Customer_idCustomer);
            if (custResults && custResults.length > 0) {
              customerName = resolveCustomerName(custResults[0], req.body.customer_name);
            }
          }
        } catch (e) {}

        await approvalService.triggerApprovalRequest({
          action_type: 'DELETE_INVOICE',
          module_name: 'Invoice',
          erp_record_id: idInvoice,
          company_id: companyId,
          branch_id: targetBranchId,
          initiated_by: User_idUser || req.userId || req.user?.id || 1,
          payload_summary: {
            action: 'DELETE_INVOICE',
            invoice_number: invInfo.Invoice_Number,
            customer_name: customerName,
            Customer_idCustomer: invInfo.Customer_idCustomer,
            amount: invInfo.Net_Amount || invInfo.Total,
            Total: invInfo.Total,
            Net_Amount: invInfo.Net_Amount,
            pending_updates: {
               req_body: req.body,
               req_params: { ...req.params, idInvoice },
               req_user: req.user,
               req_headers: req.headers,
               req_userId: req.userId || User_idUser,
               req_userRole: req.userRole
            }
          }
        });
        return res.status(202).json({
          success: true,
          message: "Invoice deletion submitted for approval. Record will be deleted once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Delete Invoice"
        });
      }
    } catch (err) {
      console.error("Approval Check Error for Delete Invoice:", err);
      return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
    }
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
        await revertInvoiceSideEffects(idInvoice, connection);

        const invoice = await dbService.fetchInvoice(idInvoice);

        if (!invoice || invoice.length === 0) {
          connection.rollback(() => connection.release());
          return res.status(404).json({ message: "Invoice not found" });
        }
        const checkedInvoice = invoice[0];
        const resolvedBranchId = parseInt(Branch_idBranch || req.user?.branch || checkedInvoice.Branch_idBranch, 10) || 1;
        const resolvedUserId = parseInt(User_idUser || req.userId || req.user?.id || checkedInvoice.Employee_idEmployee, 10) || 1;

        // Fetch items with expanded details (Type, Cost, Qty/Current_Stock)
        const items = await dbService.fetchInvoiceItems(idInvoice, connection);

        for (const invItem of items) {
          // Revert Serial Status
          // Check if item has serial numbers (Logic: Invoice Item has Serial_No_Id if it was satisfied by a serial)
          if (invItem.Serial_No_Id) {
            await dbService.updateSerialQty(invItem.Serial_No_Id, connection);
          }

          // Revert Stock Logic
          if (invItem.Type === "1") {
            let revertQty = 0;
            let in_qty = 0;
            let out_qty = 0;

            const soldQty = parseFloat(invItem.Qty || 0);

            if (invItem.Discount_Type === "RTN") {
              // Was a return (stock added), so revert means remove from stock
              revertQty = -soldQty;
              in_qty = -soldQty;
              out_qty = 0;
            } else {
              // Was a sale (stock removed), so revert means add to stock
              revertQty = soldQty;
              in_qty = 0;
              out_qty = -soldQty;
            }

            const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);

            if (invItem.Variation_Id && invItem.Variation_Id > 0) {
              // Since processInvoiceVariation subtracts the quantity:
              // For sale (revertQty is positive soldQty), we want to ADD stock, so we pass -soldQty.
              // For return (revertQty is negative -soldQty), we want to REMOVE stock, so we pass soldQty.
              const varResults = await new Promise((resolve, reject) => {
                connection.query(
                  "SELECT qty FROM item_variations WHERE id = ?",
                  [invItem.Variation_Id],
                  (err, results) => err ? reject(err) : resolve(results)
                );
              });
              const oldVarQty = varResults && varResults.length > 0 ? parseFloat(varResults[0].qty || 0) : 0;
              const variationParam = invItem.Discount_Type === "RTN" ? soldQty : -soldQty;
              const newVarQty = oldVarQty - variationParam;

              await itemDbService.processInvoiceVariation(
                invItem.Variation_Id,
                variationParam,
                connection,
              );

              // Log history
              await productHistoryLogHelper({
                productId: invItem.Item_idItem,
                variationId: invItem.Variation_Id,
                quantityChange: -variationParam,
                oldQty: oldVarQty,
                newQty: newVarQty,
                type: "Invoice Delete",
                description: `Stock restored (Invoice deleted) via Invoice ID: ${idInvoice} (No: ${checkedInvoice.Invoice_Number})`,
                branchId: Branch_idBranch,
                companyId: companyId || 1,
                userId: User_idUser,
                referenceId: idInvoice,
                connection,
              });

              // Log stock card entry for variation delete revert
              await stockCardDbService.insertStockCard(
                invItem.Item_idItem,
                invItem.Item_Name + " (Delete Revert)",
                "INVOICE-DELETE",
                idInvoice,
                invItem.Cost,
                invItem.Real_Cost,
                invItem.Rate, // sold rate
                in_qty,
                out_qty,
                newVarQty,
                resolvedBranchId,
                connection,
                invItem.Variation_Id,
              );
            } else {
              // Standard Product
              const currentStock = parseFloat(invItem.Current_Stock || 0);
              const newStock = currentStock + revertQty;

              await itemDbService.itemProcess(
                invItem.Cost,
                invItem.Real_Cost,
                newStock,
                invItem.Item_idItem,
                connection,
              );

              await stockCardDbService.insertStockCard(
                invItem.Item_idItem,
                invItem.Item_Name + " (Delete Revert)",
                "INVOICE-DELETE",
                idInvoice,
                invItem.Cost,
                invItem.Real_Cost,
                invItem.Rate, // sold rate
                in_qty,
                out_qty,
                newStock,
                resolvedBranchId,
                connection,
              );

              // Log history
              await productHistoryLogHelper({
                productId: invItem.Item_idItem,
                variationId: null,
                quantityChange: revertQty,
                oldQty: currentStock,
                newQty: newStock,
                type: "Invoice Delete",
                description: `Stock restored (Invoice deleted) via Invoice ID: ${idInvoice} (No: ${checkedInvoice.Invoice_Number})`,
                branchId: resolvedBranchId,
                companyId: companyId || 1,
                userId: resolvedUserId,
                referenceId: idInvoice,
                connection,
              });
            }
          }
        }

        // Delete dependencies
        await dbService.deleteInvoiceItem(idInvoice, connection);

        if (checkedInvoice.Payment_Type === 2) {
          await installmentLogDbService.deleteInstallment(
            idInvoice,
            connection,
          );
        }

        await userLogDbService.insertLog(
          resolvedUserId,
          currentDate(),
          "Invoice",
          idInvoice,
          "delete",
          resolvedBranchId,
          connection,
        );

        // Delete the Main Invoice Record
        await dbService.deleteInvoice(idInvoice, connection);

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          const io = req.app?.get ? req.app.get("io") : null;
          if (io) {
            if (resolvedBranchId) {
              io.to(`branch_${resolvedBranchId}`).emit("refreshNotifications");
            } else {
              io.emit("refreshNotifications");
            }
          }
          res.json({
            message: "Invoice deleted successfully",
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error in deleteInvoice:", err);
          res.status(500).json({
            message: "Error deleting invoice",
            error: err.message,
          });
        });
      }
    });
  });
};

// controllers/invoiceController.js

const getInvoiceForPrint = async (req, res) => {
  try {
    const { idInvoice } = req.params;
    // Use your dbService for consistency
    const invoice = await dbService.fetchInvoice(idInvoice);
    if (!invoice || invoice.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    const items = await dbService.fetchInvoiceItems(idInvoice);

    const customerId = invoice[0].Customer_idCustomer;
    let customFields = [];
    if (customerId) {
      customFields = await new Promise((resolve) => {
        const sql = `
          SELECT cfd.field_id, cfd.value, cf.field_name 
          FROM customer_field_data cfd 
          JOIN customer_fields cf ON cf.id = cfd.field_id 
          WHERE cfd.customer_id = ? AND cf.show_in_invoice = 1
        `;
        db.query(sql, [customerId], (err, results) => {
          if (err) {
            console.error("Error fetching custom fields for printed invoice:", err);
            resolve([]);
          } else {
            resolve(results || []);
          }
        });
      });
    }

    // Fetch associated estimate if it exists
    let estimate = null;
    if (invoice[0].Invoice_Number) {
      estimate = await new Promise((resolve) => {
        const queryEst = `
          SELECT est.*, c.displayName as Customer_Name, c.billingAddress1 as Customer_Address,
                 c.phoneNumber as Customer_Phone, ic.name as Insurance_Company_Name,
                 pest.estimate_no as parent_estimate_no
          FROM estimates est
          LEFT JOIN customer c ON est.customer_id = c.idCustomer
          LEFT JOIN estimate_insurance_companies ic ON est.insurance_company_id = ic.id
          LEFT JOIN estimates pest ON est.parent_estimate_id = pest.id
          WHERE est.invoice_no = ?
          LIMIT 1
        `;
        db.query(queryEst, [invoice[0].Invoice_Number], (err, estResults) => {
          if (err || estResults.length === 0) {
            resolve(null);
          } else {
            const est = estResults[0];
            try {
              est.custom_fields_data = est.custom_fields_data
                ? JSON.parse(est.custom_fields_data)
                : {};
            } catch (_) {
              est.custom_fields_data = {};
            }

            // Fetch items and photos for this estimate too
            db.query("SELECT * FROM estimate_items WHERE estimate_id = ?", [est.id], (err, itemsResult) => {
              if (!err) est.items = itemsResult || [];

              db.query("SELECT * FROM estimate_photos WHERE estimate_id = ?", [est.id], (err, photosResult) => {
                if (!err) est.photos = photosResult || [];
                resolve(est);
              });
            });
          }
        });
      });
    }

    return res.status(200).json({
      invoice: {
        ...invoice[0],
        custom_fields: customFields,
      },
      items,
      estimate,
    });
  } catch (err) {
    console.error("Error fetching invoice for print:", err);
    return res.status(500).json({ message: "Server error fetching invoice" });
  }
};

const getInstallmentInvoicesByCustomer = async (req, res) => {
  try {
    const { customerId, Branch_idBranch } = req.params;
    const invoices = await dbService.fetchInstallmentInvoicesByCustomer(
      customerId,
      Branch_idBranch,
    );
    res.json(invoices);
  } catch (err) {
    console.error("Error fetching installment invoices:", err);
    res.status(500).json({
      message: "Error fetching installment invoices",
      error: err.message,
    });
  }
};

// ---- BULK IMPORT FROM EXCEL ----
const importExcelInvoices = async (req, res) => {
  try {
    const { rows, Branch_idBranch, User_idUser } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No rows provided" });
    }

    // ========== STEP 1: Find or create unique EMPLOYEES (Sales Reps) ==========
    const uniqueSalesReps = [
      ...new Set(
        rows.map((r) => (r.Sales_Rep || "").toString().trim()).filter(Boolean),
      ),
    ];

    const existingEmployees = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idEmployee, Employee_Name FROM employee WHERE Branch_idBranch = ? AND Status = 1`,
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results || [])));
        },
      );
    });

    const employeeMap = {};
    existingEmployees.forEach((e) => {
      if (e.Employee_Name) {
        employeeMap[e.Employee_Name.trim().toLowerCase()] = e.idEmployee;
      }
    });

    for (const name of uniqueSalesReps) {
      const key = name.toLowerCase();
      if (!employeeMap[key]) {
        const result = await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO employee (Employee_Name, Status, Branch_idBranch) VALUES (?, 1, ?)`,
            [name, Branch_idBranch],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            },
          );
        });
        employeeMap[key] = result.insertId;
      }
    }

    // ========== STEP 2: Find or create unique CUSTOMERS ==========
    // Build a mapping of customer name to their first found Sales Rep in the rows
    const customerToAgentNameMap = {};
    rows.forEach((r) => {
      const cName = (r.Customer || "").toString().trim().toLowerCase();
      const aName = (r.Sales_Rep || "").toString().trim();
      if (cName && aName && !customerToAgentNameMap[cName]) {
        customerToAgentNameMap[cName] = aName;
      }
    });

    const uniqueCustomerNames = [
      ...new Set(
        rows.map((r) => (r.Customer || "").toString().trim()).filter(Boolean),
      ),
    ];

    const existingCustomers = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idCustomer, displayName FROM customer WHERE Branch_idBranch = ? AND displayName IS NOT NULL`,
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results || [])));
        },
      );
    });

    const customerMap = {};
    existingCustomers.forEach((c) => {
      if (c.displayName) {
        customerMap[c.displayName.trim().toLowerCase()] = c.idCustomer;
      }
    });

    for (const name of uniqueCustomerNames) {
      const key = name.toLowerCase();
      if (!customerMap[key]) {
        // Find associated agent ID for this new customer
        const agentName = customerToAgentNameMap[key];
        const agentId = agentName
          ? employeeMap[agentName.toLowerCase()] || null
          : null;

        const result = await new Promise((resolve, reject) => {
          db.query(
            `INSERT INTO customer (Title, First_Name, displayName, Agent_idEmployee, Branch_idBranch) VALUES (?, ?, ?, ?, ?)`,
            ["Mr.", name, name, agentId, Branch_idBranch],
            (err, results) => {
              if (err) reject(err);
              else resolve(results);
            },
          );
        });
        customerMap[key] = result.insertId;
      }
    }

    // ========== STEP 3: Fetch existing running balances per customer ==========
    // Build a running total credit balance per customer (from existing logs)
    const customerRunningBalance = {};
    for (const custKey of Object.keys(customerMap)) {
      const custId = customerMap[custKey];
      const lastLog = await customerLogDbService.fetchLastLog(custId);
      customerRunningBalance[custId] =
        lastLog.length > 0
          ? parseFloat(lastLog[0].Total_Credit_Balance) || 0
          : 0;
    }

    // ========== STEP 4: Process ALL rows ==========
    let invoicesOk = 0;
    let paymentsOk = 0;
    let creditNotesOk = 0;
    let fail = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const transactionType = (row.Transaction_Type || "")
          .toString()
          .trim()
          .toLowerCase();
        const customerName = (row.Customer || "").toString().trim();
        const salesRepName = (row.Sales_Rep || "").toString().trim();
        const transactionNumber = (row.Transaction_Number || "")
          .toString()
          .trim();
        const transactionDate = (row.Transaction_Date || "").toString().trim();
        const debitAmount = parseFloat(row.Debit_Amount) || 0;
        const creditAmount = parseFloat(row.Credit_Amount) || 0;
        const balance = parseFloat(row.Balance) || 0;

        if (!customerName) {
          fail++;
          errors.push(`Row skipped: missing Customer`);
          continue;
        }

        const customerId = customerMap[customerName.toLowerCase()] || 0;
        const employeeId = employeeMap[salesRepName.toLowerCase()] || 0;

        // Format date — handle "2026-01-12 00:00:00" → "2026-01-12"
        let formattedDate = transactionDate;
        if (formattedDate.includes(" ")) {
          formattedDate = formattedDate.split(" ")[0];
        }

        // ===== INVOICE =====
        if (transactionType === "invoice") {
          if (!transactionNumber) {
            fail++;
            errors.push(`Row skipped: missing Transaction_Number for invoice`);
            continue;
          }

          const total = debitAmount;
          const netAmount = debitAmount;
          const rawBalance = Math.min(balance, total);
          const balanceAmount = Math.max(0, rawBalance);
          const paidAmount = Math.min(total, Math.max(0, total - balanceAmount));

          // Insert invoice
          const invoiceResult = await dbService.insertInvoice(
            transactionNumber, // Invoice_Number
            0, // Quotation_idQuotation
            formattedDate, // Date
            customerId, // Customer_idCustomer
            null, // Address
            employeeId, // Employee_idEmployee
            total, // Total
            "None", // Discount_Type
            0, // Discount_Presentage
            0, // Discount_Amount
            "None", // Discount2_Type
            0, // Discount2_Presentage
            0, // Discount2_Amount
            netAmount, // Net_Amount
            0, // Item_Count
            "Imported from Excel", // Note
            3, // Payment_Type (3 = credit)
            0, // Interest_Amount
            0, // Interest_Presentage
            "Amount", // Interest_Type
            paidAmount, // Paid_Amount
            balanceAmount, // Balance_Amount
            balanceAmount, // Credit_Balance
            balanceAmount, // Total_Credit_Balance
            formattedDate, // Created_Date
            currentDateTime(), // created_at
            Branch_idBranch, // Branch_idBranch
            null, // Payment_Method
            null, // Card_Type
            null, // Card_Number
            null, // Transaction_Id
            null, // Receipt
            null, // Cheque_Type
            null, // Cheque_No
            null, // Cheque_Date
            null, // Cheque_Name
            null, // Bank_Account_Id
            0, // Vat_Amount
            "exclusive", // Vat_Type
            "Extra Charge", // Extra_Charge_Label
            0, // Extra_Charge
            null, // user
            null, // connection
          );

          const newInvoiceId = invoiceResult.insertId;

          // Update running balance: invoice adds debit (increases outstanding)
          customerRunningBalance[customerId] =
            (customerRunningBalance[customerId] || 0) + balanceAmount;

          // Insert customer credit log — DEBIT entry for the invoice
          await customerLogDbService.insertCustomerCreditLog(
            customerId, // Customer_idCustomer
            "INVOICE", // Type
            newInvoiceId, // Type_Id
            balanceAmount, // Credit
            0, // Debit
            customerRunningBalance[customerId], // Total_Credit_Balance (running total)
            null, // Payment_Type
            null, // Payment_Method
            null, // Cheque_Type
            null, // Cheque_No
            null, // Cheque_Date
            null, // Cheque_Name
            0, // Cheque_Status
            Branch_idBranch, // Branch_idBranch
            null, // Card_Type
            null, // Card_Number
            null, // Transaction_Id
            null, // Receipt
            null, // Bank_Name
            null, // Bank_No
          );

          invoicesOk++;
        }
        // ===== PAYMENT =====
        else if (transactionType === "payment") {
          // Payments reduce the outstanding balance — recorded as CREDIT
          const paymentAmount = creditAmount || debitAmount;

          // Update running balance: payment reduces outstanding
          customerRunningBalance[customerId] =
            (customerRunningBalance[customerId] || 0) - paymentAmount;

          // Insert customer credit log — CREDIT entry for payment
          await customerLogDbService.insertCustomerCreditLog(
            customerId, // Customer_idCustomer
            "PAYMENT", // Type
            transactionNumber || 0, // Type_Id (payment ref number)
            0, // Credit
            paymentAmount, // Debit
            customerRunningBalance[customerId], // Total_Credit_Balance
            null, // Payment_Type
            "cash", // Payment_Method
            null, // Cheque_Type
            null, // Cheque_No
            null, // Cheque_Date
            null, // Cheque_Name
            0, // Cheque_Status
            Branch_idBranch, // Branch_idBranch
            null, // Card_Type
            null, // Card_Number
            null, // Transaction_Id
            null, // Receipt
            null, // Bank_Name
            null, // Bank_No
          );

          paymentsOk++;
        }
        // ===== CREDIT NOTE =====
        else if (transactionType === "credit note") {
          const creditNoteAmount = creditAmount || debitAmount;

          // Update running balance: credit note reduces outstanding
          customerRunningBalance[customerId] =
            (customerRunningBalance[customerId] || 0) - creditNoteAmount;

          // Insert customer credit log — CREDIT entry for credit note
          await customerLogDbService.insertCustomerCreditLog(
            customerId, // Customer_idCustomer
            "CREDIT_NOTE", // Type
            transactionNumber || 0, // Type_Id
            0, // Credit
            creditNoteAmount, // Debit
            customerRunningBalance[customerId], // Total_Credit_Balance
            null, // Payment_Type
            null, // Payment_Method
            null, // Cheque_Type
            null, // Cheque_No
            null, // Cheque_Date
            null, // Cheque_Name
            0, // Cheque_Status
            Branch_idBranch, // Branch_idBranch
            null, // Card_Type
            null, // Card_Number
            null, // Transaction_Id
            null, // Receipt
            null, // Bank_Name
            null, // Bank_No
          );

          creditNotesOk++;
        }
        // Unknown type — skip silently
        else {
          continue;
        }
      } catch (rowErr) {
        fail++;
        console.error(`Import failed for row ${row.Transaction_Number || "?"}:`, rowErr);
        errors.push(`Row ${row.Transaction_Number || "?"}: ${rowErr.message}`);
      }
    }

    res.json({
      message: "Import completed",
      total: rows.length,
      invoicesProcessed: invoicesOk,
      paymentsProcessed: paymentsOk,
      creditNotesProcessed: creditNotesOk,
      failed: fail,
      skippedOther:
        rows.length - invoicesOk - paymentsOk - creditNotesOk - fail,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    console.error("Error in importExcelInvoices:", err);
    res.status(500).json({
      message: "Error importing invoices",
      error: err.message,
    });
  }
};

const searchSerial = async (req, res) => {
  try {
    const { serialNo, Branch_idBranch } = req.params;

    // 1. Find the available serial in database including GRN status
    const query = `
      SELECT sn.*, g.Status AS grn_status, g.Bill_no AS grn_bill_no, g.grn_no
      FROM item_has_serial_no sn
      LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
      WHERE sn.Serial_No = ? AND sn.Branch_idBranch = ? AND sn.Qty = 1
    `;
    db.query(query, [serialNo, Branch_idBranch], async (err, results) => {
      if (err) {
        console.error("Error querying serial number:", err);
        return res.status(500).json({ message: "Database query error", error: err.message });
      }

      if (!results || results.length === 0) {
        return res.status(404).json({ message: "Serial number not found or already sold" });
      }

      const serialData = results[0];

      // Block serial if associated GRN is not yet processed
      if (serialData.GRN_idGRN && Number(serialData.GRN_idGRN) > 0 && String(serialData.grn_status) !== "1") {
        return res.status(400).json({
          message: `Serial number belongs to unprocessed GRN (${serialData.grn_no || serialData.grn_bill_no || serialData.GRN_idGRN}). Please process the GRN before invoicing.`,
        });
      }

      const Item_idItem = serialData.Item_idItem;

      // 2. Fetch the item details
      try {
        const itemResult = await itemDbService.fetchItem(Item_idItem);
        if (!itemResult || itemResult.length === 0) {
          return res.status(404).json({ message: "Product details not found for this serial" });
        }

        // Fetch variation details if variation_id is present
        let variation = null;
        if (serialData.variation_id) {
          try {
            const varResult = await itemDbService.fetchVariation(serialData.variation_id);
            if (varResult && varResult.length > 0) {
              variation = varResult[0];
            }
          } catch (varErr) {
            console.error("Error fetching variation details in searchSerial:", varErr);
          }
        }

        return res.json({
          serial: {
            ID: serialData.ID,
            Serial_No: serialData.Serial_No,
            Item_idItem: serialData.Item_idItem,
            variation_id: serialData.variation_id,
          },
          product: itemResult[0],
          variation: variation
        });
      } catch (itemErr) {
        console.error("Error fetching product details for serial:", itemErr);
        return res.status(500).json({ message: "Error fetching product details", error: itemErr.message });
      }
    });
  } catch (err) {
    console.error("Error in searchSerial:", err);
    res.status(500).json({
      message: "Error searching serial number",
      error: err.message,
    });
  }
};

const queryAsync = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getInvoiceHistory = async (req, res) => {
  try {
    const { idInvoice } = req.params;

    // 1. Fetch Invoice
    const invoiceQuery = `
      SELECT i.*, 
             c.displayName AS Customer_Name, 
             c.phoneNumber AS Customer_Phone,
             emp.Employee_Name AS Salesman_Name
      FROM invoice i
      LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
      LEFT JOIN employee emp ON i.Employee_idEmployee = emp.idEmployee
      WHERE i.idInvoice = ?
    `;
    const invoiceRows = await queryAsync(invoiceQuery, [idInvoice]);
    if (!invoiceRows || invoiceRows.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    const invoice = invoiceRows[0];

    // 2. Fetch Invoice Items
    const itemsQuery = `
      SELECT ihi.*, i.Description AS Item_Name, i.Item_Code 
      FROM invoice_has_item ihi
      INNER JOIN item i ON ihi.Item_idItem = i.idItem
      WHERE ihi.Invoice_idInvoice = ?
    `;
    const items = await queryAsync(itemsQuery, [idInvoice]);

    // 3. Fetch Installments if applicable
    let installments = [];
    if (invoice.Payment_Type === 2) {
      const instQuery = `
        SELECT * FROM installment_payment 
        WHERE Invoice_idInvoice = ?
        ORDER BY Term ASC
      `;
      installments = await queryAsync(instQuery, [idInvoice]);
    }

    // 4. Fetch Payments / Customer Credit Logs for this invoice
    const logsQuery = `
      SELECT * FROM customer_credit_log 
      WHERE Type_Id = ? AND Type IN ('INVOICE', 'PAYMENT', 'CUSTOMER RETURN - INVOICE CREDIT', 'Cheque Rejected', 'Cheque Accepted')
      ORDER BY idCustomer_Credit_Log ASC
    `;
    const logs = await queryAsync(logsQuery, [idInvoice]);

    // 5. Fetch Customer Returns for this invoice
    const returnsQuery = `
      SELECT cr.*, emp.Employee_Name AS Salesman_Name 
      FROM customer_return cr
      LEFT JOIN employee emp ON cr.Employee_idEmployee = emp.idEmployee
      WHERE cr.Invoice_idInvoice = ?
      ORDER BY cr.idCustomer_Return ASC
    `;
    const returnsList = await queryAsync(returnsQuery, [idInvoice]);

    // Fetch return items for each customer return
    for (let ret of returnsList) {
      const retItemsQuery = `
        SELECT crhi.* 
        FROM customer_return_has_item crhi
        WHERE crhi.Customer_Return_idCustomer_Return = ?
      `;
      ret.items = await queryAsync(retItemsQuery, [ret.idCustomer_Return]);
    }

    // 6. Build chronological timeline
    const timeline = [];

    // A. Creation Event (from invoice)
    timeline.push({
      date: invoice.Created_Date || invoice.created_at || invoice.Date,
      type: "Creation",
      title: "Invoice Created",
      description: `Invoice #${invoice.Invoice_Number} was created for LKR ${parseFloat(invoice.Net_Amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} with ${items.length} items.`,
      amount: parseFloat(invoice.Net_Amount),
      user: invoice.user || "System",
      details: items.map(it => `${it.Item_Name} (Qty: ${it.Qty} @ LKR ${parseFloat(it.Rate).toLocaleString("en-US", { minimumFractionDigits: 2 })})`).join(", ")
    });

    // B. Logs events (Payments, Cheque updates, Returns credits)
    logs.forEach((log) => {
      // Skip the initial invoice record in credit logs to avoid duplicating the creation event
      if (log.Type === 'INVOICE') return;

      let title = "Log Record";
      let desc = log.Note || "";
      let amt = parseFloat(log.Debit || log.Credit || 0);

      if (log.Type === 'PAYMENT') {
        title = "Payment Received";
        if (log.Payment_Method === "Applied Overpayment") {
          title = "Overpayment Applied";
          desc = `LKR ${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} applied from customer overpayment.`;
        } else {
          desc = `Payment of LKR ${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} received via ${log.Payment_Method}${log.receipt_number ? ` (Receipt: ${log.receipt_number})` : ""}.`;
        }
      } else if (log.Type === 'CUSTOMER RETURN - INVOICE CREDIT') {
        title = "Return Credit Applied";
        desc = `Credit of LKR ${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} applied from Customer Return.`;
      } else if (log.Type === 'Cheque Rejected') {
        title = "Cheque Rejected";
        desc = `Cheque No. ${log.Cheque_No} for LKR ${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} was rejected.`;
      } else if (log.Type === 'Cheque Accepted') {
        title = "Cheque Cleared";
        desc = `Cheque No. ${log.Cheque_No} for LKR ${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} has been accepted and cleared.`;
      }

      timeline.push({
        date: log.Date_Time,
        type: log.Type,
        title,
        description: desc,
        amount: amt,
        user: log.user || "System"
      });
    });

    // C. Customer Returns directly
    returnsList.forEach((ret) => {
      const itemsDetail = ret.items && ret.items.length > 0
        ? ret.items.map(it => `${it.Item_Description} (Qty: ${it.Qty} @ LKR ${parseFloat(it.Cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })})`).join(", ")
        : "";

      timeline.push({
        date: ret.Date,
        type: "Return",
        title: ret.Return_Type === "exchange" ? "Customer Exchange Return" : "Customer Return Created",
        description: `Customer Return #${ret.Return_Receipt_No || ret.idCustomer_Return} created. Reason: ${ret.Reason || "None"}. Total Amount: LKR ${parseFloat(ret.Total_Amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}. Status: ${ret.Status === 1 ? "Processed" : "Pending"}.`,
        amount: parseFloat(ret.Total_Amount),
        user: ret.Salesman_Name || "System",
        details: itemsDetail
      });
    });

    // Sort timeline chronologically (oldest first)
    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      invoice,
      items,
      installments,
      timeline
    });
  } catch (err) {
    console.error("Error in getInvoiceHistory:", err);
    res.status(500).json({
      message: "Error fetching invoice history",
      error: err.message,
    });
  }
};

const getCODInvoices = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const query = `
      SELECT i.idInvoice, i.Invoice_Number, i.Date, i.Net_Amount, i.Paid_Amount, i.Balance_Amount, DATE_FORMAT(i.cod_collection_deadline, '%Y-%m-%d') AS cod_collection_deadline, i.cod_status,
             c.idCustomer, c.displayName AS Customer_Name, c.phoneNumber AS Customer_Phone, c.companyEmail AS Customer_Email
      FROM invoice i
      LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
      WHERE i.Branch_idBranch = ? AND i.Payment_Method = 'cod'
      ORDER BY i.Date DESC
    `;

    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Error fetching COD invoices:", err);
        return res.status(500).json({ success: false, message: "Error fetching COD invoices", error: err.message });
      }
      res.json({ success: true, data: results });
    });
  } catch (error) {
    console.error("Error fetching COD invoices:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

const updateCODDeadline = async (req, res) => {
  const { idInvoice, cod_collection_deadline, cod_status, customerId, customerName, invoiceNumber, amount } = req.body;
  const branchId = req.query.branch_id || req.body.branchId || 1;
  const userId = req.body.userId || 1;

  try {
    let formattedDeadline = null;
    if (cod_collection_deadline) {
      if (typeof cod_collection_deadline === 'string') {
        formattedDeadline = cod_collection_deadline.split("T")[0];
      } else {
        const d = new Date(cod_collection_deadline);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        formattedDeadline = `${year}-${month}-${day}`;
      }
    }

    const updateInvoiceSql = `UPDATE invoice SET cod_collection_deadline = ?, cod_status = ? WHERE idInvoice = ?`;
    await new Promise((resolve, reject) => {
      db.query(updateInvoiceSql, [formattedDeadline, cod_status || 'Pending', idInvoice], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    const deleteApptSql = `DELETE FROM appointments WHERE invoice_id = ? AND is_cod_reminder = 1`;
    await new Promise((resolve, reject) => {
      db.query(deleteApptSql, [idInvoice], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    if (formattedDeadline && cod_status !== 'Collected') {
      const dueDate = new Date(formattedDeadline);
      const startDateTime = new Date(dueDate);
      startDateTime.setHours(9, 0, 0, 0);
      const endDateTime = new Date(startDateTime);
      endDateTime.setHours(10, 0, 0, 0);

      const title = `COD Collection: ${customerName || 'Customer'} - Inv #${invoiceNumber || idInvoice}`;
      const desc = `Reminder to collect outstanding COD payment of LKR ${parseFloat(amount || 0).toFixed(2)} for Invoice #${invoiceNumber || idInvoice}`;

      const apptQuery = `INSERT INTO appointments 
        (title, start_datetime, end_datetime, location, description, 
         participant_type, participant_id, participant_name, branch_id, user_id, 
         is_cod_reminder, invoice_id, service_due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`;

      await new Promise((resolve, reject) => {
        db.query(
          apptQuery,
          [
            title,
            startDateTime,
            endDateTime,
            "Client Location",
            desc,
            "customer",
            customerId || null,
            customerName || null,
            branchId,
            userId,
            idInvoice,
            dueDate,
          ],
          (apptErr) => {
            if (apptErr) return reject(apptErr);
            resolve();
          }
        );
      });
    }

    res.status(200).json({ success: true, message: "COD collection details updated successfully" });
  } catch (error) {
    console.error("Error updating COD deadline:", error);
    res.status(500).json({ success: false, message: "Failed to update COD collection details", error: error.message });
  }
};


const applyPendingInvoiceCreate = async (pending_updates, action_type_approved) => {
  return new Promise(async (resolve, reject) => {
    try {
      let updates = pending_updates;
      while (typeof updates === 'string') {
        try { updates = JSON.parse(updates); } catch (e) { break; }
      }
      updates = updates || {};

      const reqBody = updates.req_body || {};
      const completedApprovals = [...(reqBody.completed_approvals || [])];
      if (action_type_approved && !completedApprovals.includes(action_type_approved)) {
        completedApprovals.push(action_type_approved);
      }

      const req = {
        body: {
          ...reqBody,
          completed_approvals: completedApprovals,
          is_approved_webhook: true
        },
        params: updates.req_params || {},
        user: updates.req_user || {},
        headers: updates.req_headers || {},
        userId: updates.req_userId || (updates.req_user ? updates.req_user.id : null),
        userRole: updates.req_userRole || null,
        is_approved_webhook: true,
        app: {
          get: () => null
        }
      };

      const res = {
        statusCode: 200,
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) {
          console.log("[WEBHOOK] applyPendingInvoiceCreate json result:", data);
          if (this.statusCode >= 400) {
            reject(new Error(data.message || data.error || 'Failed to create invoice'));
          } else {
            resolve(data);
          }
          return data;
        },
        send: function(data) {
          console.log("[WEBHOOK] applyPendingInvoiceCreate send result:", data);
          if (this.statusCode >= 400) {
            reject(new Error('Failed to create invoice'));
          } else {
            resolve(data);
          }
          return data;
        }
      };

      await createInvoice(req, res);
    } catch (e) {
      console.error("[WEBHOOK] Exception in applyPendingInvoiceCreate:", e);
      reject(e);
    }
  });
};

const applyPendingInvoiceUpdate = async (erp_record_id, pending_updates) => {
  return new Promise(async (resolve, reject) => {
    try {
      let updates = pending_updates;
      while (typeof updates === 'string') {
        try { updates = JSON.parse(updates); } catch (e) { break; }
      }
      updates = updates || {};

      const req = {
        body: updates.req_body || {},
        params: updates.req_params || { idInvoice: erp_record_id },
        user: updates.req_user || {},
        headers: updates.req_headers || {},
        userId: updates.req_userId || (updates.req_user ? updates.req_user.id : null),
        userRole: updates.req_userRole || null,
        is_approved_webhook: true,
        app: {
          get: () => null
        }
      };
      if (!req.params.idInvoice) {
        req.params.idInvoice = erp_record_id;
      }

      const res = {
        statusCode: 200,
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) {
          console.log("[WEBHOOK] applyPendingInvoiceUpdate json result:", data);
          if (this.statusCode >= 400) {
            reject(new Error(data.message || data.error || 'Failed to update invoice'));
          } else {
            resolve(data);
          }
          return data;
        },
        send: function(data) {
          console.log("[WEBHOOK] applyPendingInvoiceUpdate send result:", data);
          if (this.statusCode >= 400) {
            reject(new Error('Failed to update invoice'));
          } else {
            resolve(data);
          }
          return data;
        }
      };

      await updateInvoice(req, res);
    } catch (e) {
      console.error("[WEBHOOK] Exception in applyPendingInvoiceUpdate:", e);
      reject(e);
    }
  });
};

const applyPendingInvoiceDeletion = async (erp_record_id, pending_updates) => {
  return new Promise(async (resolve, reject) => {
    try {
      let updates = pending_updates;
      while (typeof updates === 'string') {
        try { updates = JSON.parse(updates); } catch (e) { break; }
      }
      updates = updates || {};

      const req = {
        body: updates.req_body || {},
        params: updates.req_params || { idInvoice: erp_record_id },
        user: updates.req_user || {},
        headers: updates.req_headers || {},
        userId: updates.req_userId || (updates.req_user ? updates.req_user.id : null),
        userRole: updates.req_userRole || null,
        is_approved_webhook: true,
        app: {
          get: () => null
        }
      };
      if (!req.params.idInvoice) {
        req.params.idInvoice = erp_record_id;
      }

      const res = {
        statusCode: 200,
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) {
          console.log("[WEBHOOK] applyPendingInvoiceDeletion json result:", data);
          if (this.statusCode >= 400) {
            reject(new Error(data.message || data.error || 'Failed to delete invoice'));
          } else {
            resolve(data);
          }
          return data;
        },
        send: function(data) {
          console.log("[WEBHOOK] applyPendingInvoiceDeletion send result:", data);
          if (this.statusCode >= 400) {
            reject(new Error('Failed to delete invoice'));
          } else {
            resolve(data);
          }
          return data;
        }
      };

      await deleteInvoice(req, res);
    } catch (e) {
      console.error("[WEBHOOK] Exception in applyPendingInvoiceDeletion:", e);
      reject(e);
    }
  });
};

module.exports = {
  createInvoice,
  getNextInvoiceId,
  getAllInvoices,
  getInvoiceById,
  getAllSerials,
  checkInvoice,
  getInvoiceforEdit,
  updateInvoice,
  deleteInvoice,
  getInvoiceForPrint,
  getInstallmentInvoicesByCustomer,
  importExcelInvoices,
  searchSerial,
  getInvoiceHistory,
  getCODInvoices,
  getCODInvoices,
  updateCODDeadline,
  applyPendingInvoiceCreate,
  applyPendingInvoiceUpdate,
  applyPendingInvoiceDeletion,
};
