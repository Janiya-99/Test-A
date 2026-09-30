const db = require("../db/db");

/**
 * Mapping of data sources to their primary tables and relations
 */
const getInvoiceSubquery = (showOutstandingOnly = true, includeInvoices = true, includeReturns = true, includeOverpayments = true) => {
  const parts = [];
  const incInvoices = includeInvoices !== false;
  const incReturns = includeReturns !== false;
  const incOverpayments = includeOverpayments !== false;
  const showOutOnly = showOutstandingOnly !== false;

  if (incInvoices) {
    parts.push(`
      SELECT 
        idInvoice,
        Invoice_Number,
        COALESCE(
          DATE_FORMAT(
            CASE
              WHEN Date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(Date, 1, 10), '%Y-%m-%d')
              WHEN Date REGEXP '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(Date, 1, 10), '%Y/%m/%d')
              WHEN Date REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}' THEN STR_TO_DATE(Date, '%d-%m-%Y')
              WHEN Date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' THEN STR_TO_DATE(Date, '%d/%m/%Y')
              WHEN Date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}' THEN STR_TO_DATE(Date, '%m/%d/%y')
              WHEN Date REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{2}' THEN STR_TO_DATE(Date, '%d-%m-%y')
              WHEN Date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}' THEN STR_TO_DATE(SUBSTRING(Date, 1, 11), '%d-%b-%Y')
              WHEN Date REGEXP '^[A-Za-z]{3} [0-9]{1,2}, [0-9]{4}' THEN STR_TO_DATE(SUBSTRING(Date, 1, 12), '%b %d, %Y')
            END,
            '%Y-%m-%d'
          ),
          DATE_FORMAT(
            CASE
              WHEN Created_Date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(Created_Date, 1, 10), '%Y-%m-%d')
              WHEN Created_Date REGEXP '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(Created_Date, 1, 10), '%Y/%m/%d')
              WHEN Created_Date REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}' THEN STR_TO_DATE(Created_Date, '%d-%m-%Y')
              WHEN Created_Date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' THEN STR_TO_DATE(Created_Date, '%d/%m/%Y')
              WHEN Created_Date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}' THEN STR_TO_DATE(Created_Date, '%m/%d/%y')
              WHEN Created_Date REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{2}' THEN STR_TO_DATE(Created_Date, '%d-%m-%y')
              WHEN Created_Date REGEXP '^[0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}' THEN STR_TO_DATE(SUBSTRING(Created_Date, 1, 11), '%d-%b-%Y')
              WHEN Created_Date REGEXP '^[A-Za-z]{3} [0-9]{1,2}, [0-9]{4}' THEN STR_TO_DATE(SUBSTRING(Created_Date, 1, 12), '%b %d, %Y')
            END,
            '%Y-%m-%d'
          ),
          SUBSTRING(Date, 1, 10),
          SUBSTRING(Created_Date, 1, 10),
          'N/A'
        ) AS Date,
        Customer_idCustomer,
        Employee_idEmployee,
        CAST(Total AS DECIMAL(15,2)) AS Total,
        CAST(Net_Amount AS DECIMAL(15,2)) AS Net_Amount,
        CAST(COALESCE(Paid_Amount, 0) AS DECIMAL(15,2)) AS Paid_Amount,
        CAST((CAST(Net_Amount AS DECIMAL(15,2)) - CAST(COALESCE(Paid_Amount, 0) AS DECIMAL(15,2))) AS DECIMAL(15,2)) AS Balance_Amount,
        'Invoice' AS Description,
        Branch_idBranch
      FROM invoice
      ${showOutOnly ? `WHERE CAST((CAST(Net_Amount AS DECIMAL(15,2)) - CAST(COALESCE(Paid_Amount, 0) AS DECIMAL(15,2))) AS DECIMAL(15,2)) > 0` : ''}
    `);
  }

  if (incReturns) {
    parts.push(`
      SELECT
        idCustomer_Return AS idInvoice,
        Return_Receipt_No AS Invoice_Number,
        COALESCE(
          DATE_FORMAT(Date, '%Y-%m-%d'),
          DATE_FORMAT(
            CASE 
              WHEN Date LIKE '__-%' THEN STR_TO_DATE(SUBSTRING(Date, 1, 10), '%d-%m-%Y')
              WHEN Date LIKE '__/%' THEN STR_TO_DATE(SUBSTRING(Date, 1, 10), '%d/%m/%Y')
              WHEN Date LIKE '____-%' THEN STR_TO_DATE(SUBSTRING(Date, 1, 10), '%Y-%m-%d')
              WHEN Date LIKE '____/%' THEN STR_TO_DATE(SUBSTRING(Date, 1, 10), '%Y/%m/%d')
            END, 
            '%Y-%m-%d'
          ),
          SUBSTRING(Date, 1, 10),
          'N/A'
        ) AS Date,
        Customer_idCustomer,
        Employee_idEmployee,
        -CAST(Total_Amount AS DECIMAL(15,2)) AS Total,
        -CAST(Total_Amount AS DECIMAL(15,2)) AS Net_Amount,
        0 AS Paid_Amount,
        -CAST(Total_Amount AS DECIMAL(15,2)) AS Balance_Amount,
        'Return' AS Description,
        Branch_idBranch
      FROM customer_return
      WHERE Status = 0
    `);
  }

  if (incOverpayments) {
    parts.push(`
      SELECT
        idCustomer AS idInvoice,
        'OVERPAYMENT' AS Invoice_Number,
        DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS Date,
        idCustomer AS Customer_idCustomer,
        Agent_idEmployee AS Employee_idEmployee,
        -CAST(overpayment AS DECIMAL(15,2)) AS Total,
        -CAST(overpayment AS DECIMAL(15,2)) AS Net_Amount,
        0 AS Paid_Amount,
        -CAST(overpayment AS DECIMAL(15,2)) AS Balance_Amount,
        'Payment Overpayment' AS Description,
        Branch_idBranch
      FROM customer
      WHERE overpayment > 0
    `);
  }

  if (parts.length === 0) {
    return `(
      SELECT 
        0 AS idInvoice, 
        '' AS Invoice_Number, 
        '' AS Date, 
        0 AS Customer_idCustomer, 
        0 AS Employee_idEmployee, 
        0.00 AS Total, 
        0.00 AS Net_Amount, 
        0.00 AS Paid_Amount, 
        0.00 AS Balance_Amount, 
        '' AS Description, 
        0 AS Branch_idBranch 
      FROM dual WHERE 1=0
    )`;
  }

  return `(${parts.join(" UNION ALL ")})`;
};

const INVOICE_SUBQUERY = "";

const EXPENSES_SUBQUERY = `(
  SELECT 
    w.idWallet,
    w.Date,
    w.Note AS Reason,
    w.Amount,
    wc.Description AS Category,
    w.Branch_idBranch
  FROM wallet w
  LEFT JOIN wallet_category wc ON w.Wallet_Category_idWallet_Category = wc.idWallet_Category
  WHERE w.Type = 2 AND w.Status = 1
)`;

const PAYMENT_SUBQUERY = `(
  SELECT 
    ccl.idCustomer_Credit_Log,
    ccl.Customer_idCustomer,
    COALESCE(
      DATE_FORMAT(ccl.Date_Time, '%Y-%m-%d'),
      DATE_FORMAT(
        CASE 
          WHEN ccl.Date_Time REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(ccl.Date_Time, 1, 10), '%Y-%m-%d')
          WHEN ccl.Date_Time REGEXP '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(ccl.Date_Time, 1, 10), '%Y/%m/%d')
          WHEN ccl.Date_Time REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}' THEN STR_TO_DATE(ccl.Date_Time, '%d-%m-%Y')
          WHEN ccl.Date_Time REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' THEN STR_TO_DATE(ccl.Date_Time, '%d/%m/%Y')
        END, 
        '%Y-%m-%d'
      ),
      SUBSTRING(ccl.Date_Time, 1, 10),
      'N/A'
    ) AS Date_Time,
    ccl.Type,
    ccl.Payment_Method,
    CAST(ccl.Debit AS DECIMAL(15,2)) AS Amount,
    COALESCE(ccl.receipt_number, ccl.Cheque_No, ccl.Transaction_Id, '') AS Num,
    ccl.Cheque_No,
    DATE_FORMAT(
      CASE 
        WHEN ccl.Cheque_Date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(ccl.Cheque_Date, 1, 10), '%Y-%m-%d')
        WHEN ccl.Cheque_Date REGEXP '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN STR_TO_DATE(SUBSTRING(ccl.Cheque_Date, 1, 10), '%Y/%m/%d')
        WHEN ccl.Cheque_Date REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}' THEN STR_TO_DATE(ccl.Cheque_Date, '%d-%m-%Y')
        WHEN ccl.Cheque_Date REGEXP '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' THEN STR_TO_DATE(ccl.Cheque_Date, '%d/%m/%Y')
        ELSE STR_TO_DATE(ccl.Cheque_Date, '%Y-%m-%d')
      END, 
      '%Y-%m-%d'
    ) AS Cheque_Date,
    ccl.Branch_idBranch
  FROM customer_credit_log ccl
  WHERE ccl.Type = 'PAYMENT' AND CAST(ccl.Debit AS DECIMAL(15,2)) > 0
)`;

const SOURCE_MAP = {
  invoices: {
    table: INVOICE_SUBQUERY,
    alias: "i",
    branchCol: "Branch_idBranch",
    dateCol: "i.Date",
    joins: [
      {
        table: "customer",
        alias: "c",
        on: "i.Customer_idCustomer = c.idCustomer",
        type: "LEFT",
      },
      {
        table: "employee",
        alias: "e",
        on: "i.Employee_idEmployee = e.idEmployee",
        type: "LEFT", // Salesman
      },
      {
        table: "branch",
        alias: "b",
        on: "i.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "i.idInvoice", label: "Invoice ID", type: "number" },
      { value: "i.Invoice_Number", label: "Invoice Number", type: "string" },
      { value: "i.Date", label: "Date", type: "string" },
      { value: "c.displayName", label: "Customer Name", type: "string" },
      { value: "c.billingAddress1", label: "Customer Address", type: "string" },
      { value: "e.Employee_Name", label: "Salesman", type: "string" },
      { value: "i.Total", label: "Total", type: "number" },
      { value: "i.Net_Amount", label: "Net Amount", type: "number" },
      { value: "i.Paid_Amount", label: "Paid Amount", type: "number" },
      { value: "i.Balance_Amount", label: "Balance", type: "number" },
      { value: "i.Description", label: "Type", type: "string" },
      { value: "c.other", label: "Discount Limit", type: "string" },
      { value: "DATEDIFF(CURDATE(), i.Date)", label: "Age (Days)", type: "string" },
    ],
  },
  grns: {
    table: "grn",
    alias: "g",
    branchCol: "Branch_idBranch",
    dateCol: "g.Date",
    joins: [
      {
        table: "supplier",
        alias: "s",
        on: "g.Supplier_idSupplier = s.idSupplier",
        type: "INNER",
      },
      {
        table: "branch",
        alias: "b",
        on: "g.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "g.idGRN", label: "GRN ID", type: "number" },
      { value: "g.GRN_Number", label: "GRN Number", type: "string" },
      { value: "g.Date", label: "Date", type: "string" },
      { value: "s.Company_Name", label: "Supplier", type: "string" },
      { value: "g.Net_Amount", label: "Net Amount", type: "number" },
    ],
  },
  customers: {
    table: "customer",
    alias: "c",
    branchCol: "Branch_idBranch",
    joins: [
      {
        table: "employee",
        alias: "e",
        on: "c.Agent_idEmployee = e.idEmployee",
        type: "LEFT",
      },
      {
        table: "branch",
        alias: "b",
        on: "c.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "c.idCustomer", label: "Customer ID", type: "number" },
      { value: "c.displayName", label: "Customer Name", type: "string" },
      { value: "c.billingAddress1", label: "Customer Address", type: "string" },
      { value: "e.Employee_Name", label: "Agent", type: "string" },
      { value: "c.phoneNumber", label: "Phone", type: "string" },
      { value: "c.billingCity", label: "City", type: "string" },
      { value: "c.other", label: "Discount Limit", type: "string" },
    ],
  },
  products: {
    table: "item",
    alias: "p",
    branchCol: "Branch_idBranch",
    joins: [
      {
        table: "item_category",
        alias: "ic",
        on: "p.Item_Category_idItem_Category = ic.idItem_Category",
        type: "LEFT",
      },
      {
        table: "branch",
        alias: "b",
        on: "p.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "p.idItem", label: "Product ID", type: "number" },
      { value: "p.Item_Code", label: "Item Code", type: "string" },
      { value: "p.Description", label: "Description", type: "string" },
      { value: "ic.Description", label: "Category", type: "string" },
      { value: "p.Cost", label: "Cost", type: "number" },
      { value: "p.Real_Cost", label: "Real Cost", type: "number" },
      { value: "p.Qty", label: "Quantity", type: "number" },
    ],
  },
  suppliers: {
    table: "supplier",
    alias: "s",
    branchCol: "Branch_idBranch",
    joins: [
      {
        table: "branch",
        alias: "b",
        on: "s.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "s.idSupplier", label: "Supplier ID", type: "number" },
      { value: "s.Company_Name", label: "Company Name", type: "string" },
      { value: "s.Agent_Name", label: "Agent Name", type: "string" },
      { value: "s.Contact_No", label: "Contact No", type: "string" },
      { value: "s.Email", label: "Email", type: "string" },
    ],
  },
  expenses: {
    table: EXPENSES_SUBQUERY,
    alias: "ex",
    branchCol: "Branch_idBranch",
    dateCol: "ex.Date",
    joins: [
      {
        table: "branch",
        alias: "b",
        on: "ex.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "ex.idWallet", label: "Expense ID", type: "number" },
      { value: "ex.Date", label: "Date", type: "string" },
      { value: "ex.Category", label: "Category", type: "string" },
      { value: "ex.Reason", label: "Reason", type: "string" },
      { value: "ex.Amount", label: "Amount", type: "number" },
    ],
  },
  payments: {
    table: PAYMENT_SUBQUERY,
    alias: "pay",
    branchCol: "Branch_idBranch",
    dateCol: "pay.Date_Time",
    joins: [
      {
        table: "customer",
        alias: "c",
        on: "pay.Customer_idCustomer = c.idCustomer",
        type: "LEFT",
      },
      {
        table: "employee",
        alias: "e",
        on: "c.Agent_idEmployee = e.idEmployee",
        type: "LEFT",
      },
      {
        table: "branch",
        alias: "b",
        on: "pay.Branch_idBranch = b.idBranch",
        type: "LEFT",
      },
    ],
    columns: [
      { value: "pay.idCustomer_Credit_Log", label: "Payment ID", type: "number" },
      { value: "pay.Type", label: "Type", type: "string" },
      { value: "pay.Payment_Method", label: "Pay Meth", type: "string" },
      { value: "pay.Date_Time", label: "Date", type: "string" },
      { value: "pay.Num", label: "Num", type: "string" },
      { value: "pay.Amount", label: "Amount", type: "number" },
      { value: "pay.Cheque_Date", label: "Cheque Date", type: "string" },
      { value: "pay.Cheque_No", label: "Cheque Number", type: "string" },
      { value: "c.displayName", label: "Customer Name", type: "string" },
      { value: "c.billingAddress1", label: "Customer Address", type: "string" },
      { value: "e.Employee_Name", label: "Salesman", type: "string" },
      { value: "c.other", label: "Discount Limit", type: "string" },
    ],
  },
};

/**
 * Fetch available columns for specified sources
 */
const getAvailableColumns = (sources) => {
  const result = [];
  sources.forEach((sourceKey) => {
    const config = SOURCE_MAP[sourceKey];
    if (config) {
      config.columns.forEach((col) => {
        result.push({
          ...col,
          source: sourceKey,
          label: `${sourceKey.charAt(0).toUpperCase() + sourceKey.slice(1, -1)}: ${col.label}`,
        });
      });
    }
  });
  return result;
};

/**
 * Generate report data based on dynamic configuration
 */
const generateAdvancedReport = async ({
  sources,
  groupingColumns,
  displayColumns,
  filters,
  branchId,
  showOutstandingOnly,
  includeInvoices,
  includeReturns,
  includeOverpayments,
  startDate,
  endDate,
}) => {
  if (!sources || sources.length === 0 || !branchId) {
    return [];
  }

  // Enforce strict single-branch filtering as requested
  const primarySourceKey = sources[0];
  const sourceConfig = SOURCE_MAP[primarySourceKey];

  if (!sourceConfig) {
    throw new Error("Invalid data source");
  }

  // Create a copy of the config so we don't mutate the global SOURCE_MAP
  const config = { ...sourceConfig };

  if (primarySourceKey === "invoices") {
    config.table = getInvoiceSubquery(showOutstandingOnly, includeInvoices, includeReturns, includeOverpayments);
  }

  // 1. Build SELECT clause
  const allRequestedColumns = [...new Set([...groupingColumns, ...displayColumns])];
  let selectClause = allRequestedColumns.map((col) => {
    if (col.value === "c.billingAddress1") {
      return `CONCAT_WS(', ', NULLIF(TRIM(c.billingAddress1), ''), NULLIF(TRIM(c.billingAddress2), ''), NULLIF(TRIM(c.billingAddress3), '')) AS 'c.billingAddress1'`;
    }
    return `${col.value} AS '${col.value}'`;
  }).join(", ");

  const hasCustomerName = allRequestedColumns.some((col) => col.value === "c.displayName");
  const hasCustomerAddress = allRequestedColumns.some((col) => col.value === "c.billingAddress1");
  if (hasCustomerName && !hasCustomerAddress) {
    if (config.columns.some((col) => col.value === "c.billingAddress1")) {
      selectClause += `, CONCAT_WS(', ', NULLIF(TRIM(c.billingAddress1), ''), NULLIF(TRIM(c.billingAddress2), ''), NULLIF(TRIM(c.billingAddress3), '')) AS 'c.billingAddress1'`;
    }
  }

  // 2. Build FROM and JOIN clauses
  let fromClause = `FROM ${config.table} ${config.alias}`;
  config.joins.forEach((join) => {
    fromClause += ` ${join.type} JOIN ${join.table} ${join.alias} ON ${join.on}`;
  });

  // 3. Build WHERE clause (Strict Single Branch filter using dynamic branchCol)
  const branchColumn = config.branchCol || "Branch_idBranch";
  let whereClause = `WHERE ${config.alias}.${branchColumn} = ?`;
  const queryParams = [branchId];

  if (primarySourceKey === "payments") {
    if (startDate) {
      whereClause += ` AND pay.Date_Time >= ?`;
      queryParams.push(startDate);
    }
    if (endDate) {
      whereClause += ` AND pay.Date_Time <= ?`;
      queryParams.push(endDate);
    }
  }

  if (filters && filters.length > 0) {
    filters.forEach((f) => {
      if (f.column && f.operator && f.value) {
        let op = "=";
        let val = f.value;
        if (f.operator === "contains") {
          op = "LIKE";
          val = `%${f.value}%`;
        } else if (f.operator === "gt") {
          op = ">";
        } else if (f.operator === "lt") {
          op = "<";
        }
        whereClause += ` AND ${f.column.value} ${op} ?`;
        queryParams.push(val);
      }
    });
  }

  // 4. Build ORDER BY clause
  let orderByClause = "";
  const orderByFields = [];
  if (groupingColumns && groupingColumns.length > 0) {
    groupingColumns.forEach((col) => orderByFields.push(col.value));
  }
  if (config.dateCol) {
    orderByFields.push(config.dateCol);
  }
  if (orderByFields.length > 0) {
    orderByClause = `ORDER BY ${orderByFields.join(", ")}`;
  }

  const finalQuery = `SELECT ${selectClause} ${fromClause} ${whereClause} ${orderByClause}`;

  // Log to a file we can read later
  const fs = require('fs');
  const util = require('util');
  const logMsg = `\n--- ${new Date().toISOString()} ---\nBRANCH_ID: ${branchId}\nSQL: ${finalQuery}\nPARAMS: ${JSON.stringify(queryParams)}\nTYPES: ${JSON.stringify(queryParams.map(p => typeof p))}\n`;
  fs.appendFileSync('advance_report_debug.log', logMsg);

  // Deep inspection for objects
  queryParams.forEach((p, i) => {
    if (typeof p === 'object' && p !== null) {
      fs.appendFileSync('advance_report_debug.log', `PARAM[${i}] is OBJECT: ${util.inspect(p, { depth: null })}\n`);
    }
  });

  return new Promise((resolve, reject) => {
    db.query(finalQuery, queryParams, (err, results) => {
      if (err) {
        fs.appendFileSync('advance_report_debug.log', `ERROR: ${err.message}\n`);
        reject(err);
      } else {
        fs.appendFileSync('advance_report_debug.log', `RESULTS: ${results?.length || 0}\n`);
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};



const saveReportConfiguration = async ({ name, branchId, configJson }) => {
  const query = `
    INSERT INTO saved_report_configurations (name, branch_id, config_json)
    VALUES (?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [name, branchId, configJson], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve({ id: result.insertId, name, branch_id: branchId, config_json: configJson });
      }
    });
  });
};

const getSavedReportConfigurations = async (branchId) => {
  const query = `
    SELECT id, name, branch_id, config_json, created_at, updated_at
    FROM saved_report_configurations
    WHERE branch_id = ?
    ORDER BY created_at DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branchId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteSavedReportConfiguration = async (id, branchId) => {
  const query = `
    DELETE FROM saved_report_configurations
    WHERE id = ? AND branch_id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [id, branchId], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result.affectedRows > 0);
      }
    });
  });
};

module.exports = {
  getAvailableColumns,
  generateAdvancedReport,
  saveReportConfiguration,
  getSavedReportConfigurations,
  deleteSavedReportConfiguration,
};
