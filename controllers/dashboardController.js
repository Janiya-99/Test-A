const dbService = require("../services/dashboardDBService");
const { getSubscriptionNotifications } = require("./notificationController");
const db = require("../db/db");

const getDashboardData = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);
    console.log(
      "Dashboard - Branch_idBranch:",
      Branch_idBranch,
      "Type:",
      typeof Branch_idBranch
    );
    const currentDate = new Date();
    const fromDate = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000); // Subtracting 7 days
    const formattedCurrentDate = currentDate.toISOString().split("T")[0]; // Formatting to YYYY-MM-DD
    const formattedFromDate = fromDate.toISOString().split("T")[0]; // Formatting to YYYY-MM-DD

    let invoiceCount;
    try {
      invoiceCount = await dbService.getInvoiceCount(
        formattedCurrentDate,
        Branch_idBranch
      );
    } catch (err) {
      console.error("Error in getInvoiceCount:", err.message);
      throw err;
    }

    let grnCount;
    try {
      grnCount = await dbService.getGRNCount(
        formattedCurrentDate,
        Branch_idBranch
      );
    } catch (err) {
      console.error("Error in getGRNCount:", err.message);
      throw err;
    }

    let poCount;
    try {
      poCount = await dbService.getPurchaseOrderCount(
        formattedCurrentDate,
        Branch_idBranch
      );
    } catch (err) {
      console.error("Error in getPurchaseOrderCount:", err.message);
      throw err;
    }

    let customerCount, supplierCount;
    try {
      customerCount = await dbService.getCustomerCount(Branch_idBranch);
    } catch (err) {
      console.error("Error in getCustomerCount:", err.message);
      throw err;
    }
    try {
      supplierCount = await dbService.getSupplierCount(Branch_idBranch);
    } catch (err) {
      console.error("Error in getSupplierCount:", err.message);
      throw err;
    }

    let customer_credit_logs, supplier_credit_logs;
    try {
      customer_credit_logs = await dbService.getCustomerLog(Branch_idBranch);
    } catch (err) {
      console.error("Error in getCustomerLog:", err.message);
      throw err;
    }
    try {
      supplier_credit_logs = await dbService.getSupplierLog(Branch_idBranch);
    } catch (err) {
      console.error("Error in getSupplierLog:", err.message);
      throw err;
    }

    const [rule] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT profit_loss_by_paid_amount, vat_enabled, vat_percentage, vat_type FROM rules WHERE Branch_idBranch = ?",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });
    const profitLossByPaidAmount = rule?.profit_loss_by_paid_amount || 0;
    const vatEnabled = rule?.vat_enabled === "1" || rule?.vat_enabled === 1;
    const vatPercentage = parseFloat(rule?.vat_percentage || 0);
    const vatType = rule?.vat_type || "exclusive";

    let daliy_sales, monthly_sales;
    try {
      daliy_sales = await dbService.getDaliySales(
        formattedCurrentDate,
        Branch_idBranch,
        profitLossByPaidAmount
      );
    } catch (err) {
      console.error("Error in getDaliySales:", err.message);
      throw err;
    }
    try {
      monthly_sales = await dbService.getMonthlySales(
        formattedCurrentDate,
        Branch_idBranch,
        profitLossByPaidAmount
      );
    } catch (err) {
      console.error("Error in getMonthlySales:", err.message);
      throw err;
    }

    let cheques = [];
    let customer_cheques;
    try {
      customer_cheques = await dbService.getCustomerCheques(
        formattedCurrentDate,
        Branch_idBranch
      );
    } catch (err) {
      console.error("Error in getCustomerCheques:", err.message);
      throw err;
    }
    for (const customer_cheque of customer_cheques) {
      let cusData = {
        Customer_Name: customer_cheque.customer_name,
        Cheque_Date: customer_cheque.Cheque_Date,
        Cheque_No: customer_cheque.Cheque_No,
        Amount: customer_cheque.Debit,
        type: customer_cheque.type,
      };
      cheques.push(cusData);
    }

    let supplier_cheques;
    try {
      supplier_cheques = await dbService.getSupplierCheques(
        formattedCurrentDate,
        Branch_idBranch
      );
    } catch (err) {
      console.error("Error in getSupplierCheques:", err.message);
      throw err;
    }

    for (const suppplier_cheque of supplier_cheques) {
      let supData = {
        Customer_Name: suppplier_cheque.supplier_name,
        Cheque_Date: suppplier_cheque.Cheque_Date,
        Cheque_No: suppplier_cheque.Cheque_No,
        Amount: suppplier_cheque.Debit,
        type: suppplier_cheque.type,
      };
      cheques.push(supData);
    }

    let duePayments;
    try {
      duePayments = await dbService.getDuePayments(
        formattedCurrentDate,
        Branch_idBranch
      );
    } catch (err) {
      console.error("Error in getDuePayments:", err.message);
      throw err;
    }

    // Compute VAT-adjusted invoice total value
    const rawInvoiceTotal = parseFloat(invoiceCount[0].total_value || 0);
    const rawVatAmount = parseFloat(invoiceCount[0].total_vat_amount || 0);
    let invoiceTotalExVat = rawInvoiceTotal;
    if (vatEnabled) {
      if (vatType === "exclusive") {
        // VAT is added on top — Net_Amount already includes VAT in the total, Vat_Amount is stored
        invoiceTotalExVat = rawInvoiceTotal - rawVatAmount;
      } else if (vatType === "inclusive") {
        // VAT is baked in — extract it
        invoiceTotalExVat = rawInvoiceTotal - rawVatAmount;
      } else if (vatType === "inclusive_portion") {
        // Prices are base; VAT is informational — no adjustment needed
        invoiceTotalExVat = rawInvoiceTotal;
      }
    }

    const data = {
      customer_count: customerCount[0].customers,
      supplier_count: supplierCount[0].supplier,
      invoice_count: invoiceCount[0].invoices,
      invoice_total_value: rawInvoiceTotal,
      invoice_total_value_ex_vat: invoiceTotalExVat,
      invoice_total_vat: rawVatAmount,
      vat_enabled: vatEnabled,
      vat_type: vatType,
      vat_percentage: vatPercentage,
      grn_count: grnCount[0].grn_count,
      grn_total_net: grnCount[0].total_grn_net_total, // <-- add this line
      po_count: poCount[0].po_count,
      po_total_net: poCount[0].total_po_net_total,
      customer_credit_logs: customer_credit_logs,
      supplier_credit_logs: supplier_credit_logs,
      daliy_sales: daliy_sales,
      monthly_sales: monthly_sales,
      near_by_cheques: cheques,
      duePayments: duePayments,
    };
    // console.log(invoiceCount[0]);

    res.json(data);
  } catch (err) {
    console.error("Dashboard Error:", err);
    res
      .status(500)
      .json({ message: "Error fetching branch by ID", error: err.message });
  }
};

const getNotifications = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);
    const companyId = req.query.companyId;

    const currentDate = new Date();
    const toDate = new Date(currentDate.getTime() + 2 * 24 * 60 * 60 * 1000); // Subtracting 7 days
    const formattedCurrentDate = currentDate.toISOString().split("T")[0]; // Formatting to YYYY-MM-DD
    const formattedToDate = toDate.toISOString().split("T")[0]; // Formatting to YYYY-MM-DD

    let notifications = [];

    // 1. Subscription notifications from account center
    if (companyId) {
      try {
        const subNotifs = await getSubscriptionNotifications(companyId);
        notifications = [...notifications, ...subNotifs];
      } catch (subErr) {
        console.error("Error fetching subscription notifications:", subErr);
      }
    }

    // 2. Local stock expiry notifications
    if (Branch_idBranch) {
      try {
        const expiring = await dbService.getExpiringBatches(Branch_idBranch);
        expiring.forEach((batch) => {
          const expDate = new Date(batch.expiry_date);
          const today = new Date();
          today.setHours(0,0,0,0);
          const diffTime = expDate - today;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          let msg = "";
          let severity = "info";
          if (diffDays < 0) {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' has expired!`;
            severity = "error";
          } else if (diffDays === 0) {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' expires today!`;
            severity = "error";
          } else if (diffDays === 1) {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' expires tomorrow!`;
            severity = "warning";
          } else {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' is expiring in ${diffDays} days!`;
            severity = diffDays <= 15 ? "warning" : "info";
          }

          notifications.push({
            id: `expiry-${batch.id}`,
            message: msg,
            type: "expiry",
            severity: severity,
            route: "/batches",
            batch_code: batch.batch_code,
            item_id: batch.item_id,
            expiry_date: batch.expiry_date,
            item_name: batch.Item_Name
          });
        });
      } catch (expErr) {
        console.error("Error fetching expiring batches:", expErr);
      }
    }

    // 3. Due payments notifications
    try {
      const due_payments = await dbService.duePaymentNotifications(
        formattedCurrentDate,
        formattedToDate,
        Branch_idBranch
      );
      due_payments.forEach((payment, idx) => {
        const invNo = payment.invoice_number ? `#${payment.invoice_number}` : `for Customer '${payment.customer || "Unknown"}'`;
        const termStr = payment.Term ? `(${payment.Term})` : "";
        notifications.push({
          id: `due-${payment.idInstallment_Payment || idx}`,
          message: `Invoice ${invNo} ${termStr} term amount of ${parseFloat((payment.Amount || 0).toFixed(2))} is overdue by ${payment.Date ? new Date(payment.Date).toLocaleDateString() : "N/A"}`,
          type: "due_payment",
          route: "/duepayment",
          severity: "warning",
          invoice_number: payment.invoice_number,
          customer_name: payment.customer,
          amount: payment.Amount
        });
      });
    } catch (dueErr) {
      console.error("Error fetching due payments notifications:", dueErr);
    }

    // 4. Cheque notifications
    try {
      const cheques = await dbService.chequeNoifications(
        "Cheque",
        formattedCurrentDate,
        formattedToDate,
        Branch_idBranch
      );
      cheques.forEach((cheque, idx) => {
        notifications.push({
          id: `cheque-${cheque.idCustomer_Credit_Log || idx}`,
          message: `Cheque #${cheque.Cheque_No} by '${cheque.Cheque_Name || cheque.Customer}' amount of ${parseFloat(cheque.Debit || 0).toFixed(2)} is dated to ${cheque.Cheque_Date ? new Date(cheque.Cheque_Date).toLocaleDateString() : "N/A"}`,
          type: "cheque",
          route: "/cheque-management",
          severity: "info",
          cheque_no: cheque.Cheque_No,
          cheque_name: cheque.Cheque_Name,
          amount: cheque.Debit
        });
      });
    } catch (chequeErr) {
      console.error("Error fetching cheque notifications:", chequeErr);
    }

    res.json(notifications);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching notifications", error: err.message });
  }
};

/**
 * Get Top Products by Revenue
 * Route: GET /api/dashboard/top-products/:Branch_idBranch
 */
const getTopProducts = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);

    // Validate branch ID
    if (isNaN(Branch_idBranch) || Branch_idBranch < 1) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Invalid branch ID",
      });
    }

    console.log("Top Products - Branch_idBranch:", Branch_idBranch);

    const topProducts = await dbService.getTopProducts(Branch_idBranch);

    res.json(topProducts);
  } catch (err) {
    console.error("Top Products Error:", err);
    res.status(500).json({
      error: "Failed to fetch top products",
      message: err.message,
    });
  }
};

/**
 * Get Customer Analytics (New, Returning, VIP)
 * Route: GET /api/dashboard/customer-analytics/:Branch_idBranch
 */
const getCustomerAnalytics = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);

    // Validate branch ID
    if (isNaN(Branch_idBranch) || Branch_idBranch < 1) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Invalid branch ID",
      });
    }

    console.log("Customer Analytics - Branch_idBranch:", Branch_idBranch);

    const analytics = await dbService.getCustomerAnalytics(Branch_idBranch);

    res.json(analytics);
  } catch (err) {
    console.error("Customer Analytics Error:", err);
    res.status(500).json({
      error: "Failed to fetch customer analytics",
      message: err.message,
    });
  }
};

/**
 * Get Revenue & Expenses (Monthly data for charts)
 * Route: GET /api/dashboard/revenue-expenses/:Branch_idBranch
 */
const getRevenueExpenses = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);

    // Validate branch ID
    if (isNaN(Branch_idBranch) || Branch_idBranch < 1) {
      return res.status(400).json({
        error: "Validation Error",
        message: "Invalid branch ID",
      });
    }

    console.log("Revenue & Expenses - Branch_idBranch:", Branch_idBranch);

    const data = await dbService.getRevenueExpenses(Branch_idBranch);

    res.json(data);
  } catch (err) {
    console.error("Revenue & Expenses Error:", err);
    res.status(500).json({
      error: "Failed to fetch revenue and expenses",
      message: err.message,
    });
  }
};

const getLowStockItems = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);
    if (isNaN(Branch_idBranch)) {
      return res.status(400).json({ message: "Invalid branch ID" });
    }
    const lowStockItems = await dbService.getLowStockItems(Branch_idBranch);
    res.json(lowStockItems);
  } catch (err) {
    console.error("Low Stock Items Error:", err);
    res.status(500).json({
      message: "Error fetching low stock items",
      error: err.message,
    });
  }
};

const creditExceededCache = new Map();
const CREDIT_EXCEEDED_CACHE_TTL = 60 * 1000; // 60 seconds

const getCreditExceededCustomers = async (req, res) => {
  try {
    const Branch_idBranch = parseInt(req.params.Branch_idBranch, 10);
    if (isNaN(Branch_idBranch)) {
      return res.status(400).json({ message: "Invalid branch ID" });
    }

    const now = Date.now();
    const cached = creditExceededCache.get(Branch_idBranch);
    if (cached && (now - cached.timestamp < CREDIT_EXCEEDED_CACHE_TTL)) {
      return res.json(cached.data);
    }

    const candidates = await dbService.getCreditLimitCandidates(Branch_idBranch);
    const exceeded = [];

    for (const customer of candidates) {
      let limitExceeded = false;
      let periodExceeded = false;
      let oldestUnpaidDate = null;
      let daysOverdue = 0;

      // 1. Check if credit limit amount is exceeded
      if (customer.credit_limit > 0 && customer.current_balance > customer.credit_limit) {
        limitExceeded = true;
      }

      // 2. Check if credit period is exceeded
      if (customer.credit_period > 0) {
        const logs = await dbService.getCustomerLogsForCalculation(customer.idCustomer, Branch_idBranch);
        let rem = customer.current_balance;
        let oldestUnpaidLog = null;

        for (const log of logs) {
          if (log.Credit > 0) {
            if (rem > 0) {
              oldestUnpaidLog = log;
              rem -= log.Credit;
            }
          }
        }

        if (oldestUnpaidLog) {
          oldestUnpaidDate = oldestUnpaidLog.Date_Time;
          const oldestDate = new Date(oldestUnpaidDate);
          const currentDate = new Date();
          const diffTime = currentDate - oldestDate;
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays > customer.credit_period) {
            periodExceeded = true;
            daysOverdue = diffDays - customer.credit_period;
          }
        }
      }

      if (limitExceeded || periodExceeded) {
        exceeded.push({
          idCustomer: customer.idCustomer,
          displayName: customer.displayName,
          phoneNumber: customer.phoneNumber,
          credit_limit: customer.credit_limit,
          credit_period: customer.credit_period,
          current_balance: customer.current_balance,
          limitExceeded,
          periodExceeded,
          oldestUnpaidDate,
          daysOverdue
        });
      }
    }
    creditExceededCache.set(Branch_idBranch, { timestamp: now, data: exceeded });
    res.json(exceeded);
  } catch (err) {
    console.error("Credit Exceeded Customers Error:", err);
    res.status(500).json({
      message: "Error fetching credit exceeded customers",
      error: err.message,
    });
  }
};

module.exports = {
  getDashboardData,
  getNotifications,
  // New dashboard endpoints
  getTopProducts,
  getCustomerAnalytics,
  getRevenueExpenses,
  getLowStockItems,
  getCreditExceededCustomers,
};

