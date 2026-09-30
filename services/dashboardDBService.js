const db = require("../db/db");

const getInvoiceCount = (date, Branch_idBranch) => {
  const query = `
    SELECT 
      COUNT(*) AS invoices,
      COALESCE(SUM(CAST(Net_Amount AS DECIMAL(10,2))), 0) AS total_value,
      COALESCE(SUM(CAST(IFNULL(Vat_Amount, 0) AS DECIMAL(10,2))), 0) AS total_vat_amount
    FROM invoice 
    WHERE (Date LIKE ? OR (Date >= ? AND Date <= ?)) AND Branch_idBranch = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [`${date}%`, `${date} 00:00:00`, `${date} 23:59:59`, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getInvoiceCount:", err);
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getGRNCount = (date, Branch_idBranch) => {
  const query = `
    SELECT 
      COUNT(*) AS grn_count,
      IFNULL(SUM(CAST(Net_Total AS DECIMAL(15,2))), 0) AS total_grn_net_total
    FROM grn 
    WHERE (Date LIKE ? OR (Date >= ? AND Date <= ?)) AND Branch_idBranch = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [`${date}%`, `${date} 00:00:00`, `${date} 23:59:59`, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getGRNCount:", err);
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getPurchaseOrderCount = (date, Branch_idBranch) => {
  const query = `
    SELECT 
      COUNT(*) AS po_count,
      IFNULL(SUM(CAST(Net_Total AS DECIMAL(15,2))), 0) AS total_po_net_total
    FROM purchase_orders 
    WHERE (Date LIKE ? OR (Date >= ? AND Date <= ?)) AND Branch_idBranch = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [`${date}%`, `${date} 00:00:00`, `${date} 23:59:59`, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getPurchaseOrderCount:", err);
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getCustomerCount = (Branch_idBranch) => {
  const query =
    "SELECT COUNT(*) AS customers FROM customer WHERE Branch_idBranch = ?";

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
const getSupplierCount = (Branch_idBranch) => {
  const query =
    "SELECT COUNT(*) AS supplier FROM supplier WHERE Branch_idBranch = ? AND isDeleted = 0";

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

const getCustomerLog = (Branch_idBranch) => {
  const query = `SELECT l.*, c.displayName AS customer FROM customer_credit_log l LEFT JOIN customer c ON c.idCustomer = l.Customer_idCustomer WHERE l.idCustomer_Credit_Log IN (SELECT MAX(idCustomer_Credit_Log) FROM customer_credit_log WHERE Branch_idBranch = ? AND Total_Credit_Balance != '0' GROUP BY Customer_idCustomer) AND l.Branch_idBranch = ? ORDER BY l.idCustomer_Credit_Log DESC`;

  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getSupplierLog = (Branch_idBranch) => {
  const query = `
    SELECT l.*, s.Company_Name AS supplier 
    FROM supplier_log l 
    LEFT JOIN supplier s ON s.idSupplier = l.Supplier_idSupplier 
    WHERE (
      l.Date_Time >= DATE_SUB(NOW(), INTERVAL 7 DAY) 
      OR 
      l.idSupplier_Log IN (
        SELECT MAX(idSupplier_Log) 
        FROM supplier_log 
        WHERE Branch_idBranch = ? AND Total_Credit_Balance != '0' 
        GROUP BY Supplier_idSupplier
      )
    ) 
    AND l.Branch_idBranch = ? 
    ORDER BY l.idSupplier_Log DESC`;

  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getDuePayments = (date, Branch_idBranch) => {
  let query = `SELECT ip.*, c.displayName AS customer, inv.Invoice_Number AS invoice_number 
  FROM installment_payment ip
  LEFT JOIN customer c ON ip.Customer_idCustomer = c.idCustomer
  LEFT JOIN invoice inv ON ip.Invoice_idInvoice = inv.idInvoice
  WHERE ip.Date < (?)
  AND ip.Branch_idBranch = ? `;

  return new Promise((resolve, reject) => {
    db.query(query, [date, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const duePaymentNotifications = (from_date, to_date, Branch_idBranch) => {
  let query = `SELECT ip.*, c.displayName AS customer, inv.Invoice_Number AS invoice_number 
  FROM installment_payment ip
  LEFT JOIN customer c ON ip.Customer_idCustomer = c.idCustomer
  LEFT JOIN invoice inv ON ip.Invoice_idInvoice = inv.idInvoice
  WHERE ip.Date BETWEEN (?) AND (?) 
  AND ip.Branch_idBranch = ? `;

  return new Promise((resolve, reject) => {
    db.query(query, [from_date, to_date, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const chequeNoifications = (
  Payment_Method,
  from_date,
  to_date,
  Branch_idBranch
) => {
  let query = `
  SELECT cl.*,
  c.displayName AS Customer,
  c.phoneNumber AS Telepnone
  FROM customer_credit_log cl
  INNER JOIN customer c ON c.idCustomer = cl.Customer_idCustomer 
  WHERE cl.Payment_Method = ?
  AND cl.Cheque_Date BETWEEN (?) AND (?)
  AND cl.Branch_idBranch = ? `;

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [Payment_Method, from_date, to_date, Branch_idBranch],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      }
    );
  });
};

const getDaliySales = (date, Branch_idBranch, profitLossByPaidAmount = 0) => {
  let dates = [];
  const startDate = new Date(date);
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() - 7);

  const startStr = endDate.toISOString().split("T")[0];
  const endStr = startDate.toISOString().split("T")[0];

  while (endDate <= startDate) {
    dates.push(endDate.toISOString().split("T")[0]);
    endDate.setDate(endDate.getDate() + 1);
  }

  const query = profitLossByPaidAmount === 1
    ? `SELECT DATE(Date_Time) AS saleDate, COUNT(DISTINCT Type_Id) AS invoiceCount 
       FROM customer_credit_log 
       WHERE Date_Time >= ? AND Date_Time <= ? AND Branch_idBranch = ? AND Type = 'PAYMENT'
       GROUP BY DATE(Date_Time)`
    : `SELECT DATE(Date) AS saleDate, COUNT(*) AS invoiceCount 
       FROM invoice 
       WHERE Date >= ? AND Date <= ? AND Branch_idBranch = ?
       GROUP BY DATE(Date)`;

  return new Promise((resolve, reject) => {
    db.query(query, [`${startStr} 00:00:00`, `${endStr} 23:59:59`, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getDaliySales:", err);
        return reject(err);
      }
      const countMap = {};
      (results || []).forEach((r) => {
        if (r.saleDate) {
          const dStr = r.saleDate instanceof Date 
            ? r.saleDate.toISOString().split("T")[0]
            : String(r.saleDate).split("T")[0].split(" ")[0];
          countMap[dStr] = r.invoiceCount;
        }
      });
      const counts = dates.map((d) => countMap[d] || 0);
      resolve(counts);
    });
  });
};

const getMonthlySales = (date, Branch_idBranch, profitLossByPaidAmount = 0) => {
  let months = [];
  const startDate = new Date(date);

  for (let i = 0; i < 12; i++) {
    let currentDate = new Date(startDate);
    currentDate.setMonth(startDate.getMonth() - i);
    let year = currentDate.getFullYear();
    let month = currentDate.getMonth() + 1;
    let formattedMonth = month < 10 ? "0" + month : month;
    months.push(`${year}-${formattedMonth}`);
  }

  const earliestMonth = months[months.length - 1];
  const latestMonth = months[0];
  const startBound = `${earliestMonth}-01 00:00:00`;
  const endBound = `${latestMonth}-31 23:59:59`;

  const query = profitLossByPaidAmount === 1
    ? `SELECT DATE_FORMAT(Date_Time, '%Y-%m') AS saleMonth, COUNT(DISTINCT Type_Id) AS invoiceCount 
       FROM customer_credit_log 
       WHERE Date_Time >= ? AND Date_Time <= ? AND Branch_idBranch = ? AND Type = 'PAYMENT'
       GROUP BY DATE_FORMAT(Date_Time, '%Y-%m')`
    : `SELECT DATE_FORMAT(Date, '%Y-%m') AS saleMonth, COUNT(*) AS invoiceCount 
       FROM invoice 
       WHERE Date >= ? AND Date <= ? AND Branch_idBranch = ?
       GROUP BY DATE_FORMAT(Date, '%Y-%m')`;

  return new Promise((resolve, reject) => {
    db.query(query, [startBound, endBound, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getMonthlySales:", err);
        return reject(err);
      }
      const countMap = {};
      (results || []).forEach((r) => {
        if (r.saleMonth) {
          countMap[r.saleMonth] = r.invoiceCount;
        }
      });
      const counts = months.map((m) => countMap[m] || 0);
      resolve(counts.reverse());
    });
  });
};

const getCustomerCheques = (date, Branch_idBranch) => {
  const customerQuery = `
    SELECT cl.*, c.displayName AS customer_name 
    FROM customer_credit_log cl
    INNER JOIN customer c ON c.idCustomer = cl.Customer_idCustomer 
    WHERE cl.Branch_idBranch = ? 
    AND cl.Payment_Method = 'cheque' 
    AND cl.Cheque_Status = 0
    AND cl.Cheque_Date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`;

  return new Promise((resolve, reject) => {
    db.query(customerQuery, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        const modifiedResults = results.map((result) => ({
          ...result,
          type: "recieved",
        }));
        resolve(JSON.parse(JSON.stringify(modifiedResults)));
      }
    });
  });
};

const getSupplierCheques = (date, Branch_idBranch) => {
  const supplierQuery = `
    SELECT sl.*, s.Company_Name AS supplier_name 
    FROM supplier_log sl
    INNER JOIN supplier s ON s.idSupplier = sl.Supplier_idSupplier 
    WHERE sl.Branch_idBranch = ? 
    AND sl.Payment_Method = 'cheque' 
    AND sl.Cheque_Status = 0
    AND sl.Cheque_Date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`;

  return new Promise((resolve, reject) => {
    db.query(supplierQuery, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        const modifiedResults = results.map((result) => ({
          ...result,
          type: "issued",
        }));
        resolve(JSON.parse(JSON.stringify(modifiedResults)));
      }
    });
  });
};

// New Dashboard API Functions

/**
 * Get top products by revenue for a specific branch
 * @param {number} branchId - Branch ID to filter products
 * @param {number} limit - Number of top products to return (default: 10)
 * @returns {Promise<Array>} Array of top products with revenue, quantity, and price data
 */
const getTopProducts = (branchId, limit = 10) => {
  const query = `
    SELECT 
      i.idItem,
      i.Description AS name,
      i.Item_Code AS sku,
      COALESCE(c.Description, 'Uncategorized') AS category,
      COALESCE(SUM(ii.Total_Amount), 0) AS revenue,
      COALESCE(SUM(ii.Qty), 0) AS quantity,
      COALESCE(AVG(ii.Rate), 0) AS averagePrice
    FROM invoice_has_item ii
    INNER JOIN invoice inv ON ii.Invoice_idInvoice = inv.idInvoice
    INNER JOIN item i ON ii.Item_idItem = i.idItem
    LEFT JOIN item_category c ON i.Item_Category_idItem_Category = c.idItem_Category
    WHERE inv.Branch_idBranch = ? 
      AND inv.Date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
    GROUP BY i.idItem, i.Description, i.Item_Code, c.Description
    ORDER BY revenue DESC
    LIMIT ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [branchId, limit], (err, results) => {
      if (err) {
        console.error("Database error in getTopProducts:", err);
        reject(err);
      } else {
        // Format the results with proper number formatting
        const formattedResults = results.map((product) => ({
          idItem: product.idItem,
          name: product.name,
          sku: product.sku,
          category: product.category,
          revenue: parseFloat(parseFloat(product.revenue).toFixed(2)),
          quantity: parseInt(product.quantity),
          averagePrice: parseFloat(parseFloat(product.averagePrice).toFixed(2)),
        }));
        resolve(formattedResults);
      }
    });
  });
};

/**
 * Get customer analytics with segmentation (new, returning, VIP)
 * @param {number} branchId - Branch ID to filter customers
 * @returns {Promise<Object>} Object with new, returning, and vip customer counts
 */
const getCustomerAnalytics = (branchId) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Query for new customers (first purchase within last 30 days)
      const newCustomersQuery = `
        SELECT COUNT(DISTINCT c.idCustomer) AS new_customers,
               COALESCE(SUM(i.Net_Amount), 0) AS total_revenue
        FROM customer c
        INNER JOIN invoice i ON c.idCustomer = i.Customer_idCustomer
        WHERE i.Branch_idBranch = ?
        GROUP BY c.idCustomer
        HAVING MIN(i.Date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`;

      // Query for VIP customers (total purchases > 500000 OR 10+ invoices)
      const vipCustomersQuery = `
        SELECT COUNT(*) AS vip_customers,
               COALESCE(SUM(total_spent), 0) AS total_revenue
        FROM (
          SELECT c.idCustomer, 
                 SUM(CAST(i.Net_Amount AS DECIMAL(15,2))) AS total_spent,
                 COUNT(i.idInvoice) AS invoice_count
          FROM customer c
          INNER JOIN invoice i ON c.idCustomer = i.Customer_idCustomer
          WHERE i.Branch_idBranch = ?
          GROUP BY c.idCustomer
          HAVING total_spent > 500000 OR invoice_count >= 10
        ) AS vip`;

      // Query for returning customers (not new, not VIP, 2+ purchases)
      const returningCustomersQuery = `
        SELECT 
            COUNT(*) AS returning_customers,
            COALESCE(SUM(total_spent), 0) AS total_revenue
        FROM (
            SELECT 
                c.idCustomer,
                SUM(CAST(i.Net_Amount AS DECIMAL(15,2))) AS total_spent,
                COUNT(i.idInvoice) AS invoice_count,
                MIN(i.Date) AS first_purchase_date
            FROM customer c
            INNER JOIN invoice i 
                ON c.idCustomer = i.Customer_idCustomer
            WHERE i.Branch_idBranch = ?
            GROUP BY c.idCustomer
            HAVING invoice_count >= 2
              AND first_purchase_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
              AND total_spent <= 500000
              AND invoice_count < 10
        ) AS returning_customers_sub`;

      // Execute all queries
      const [newResults] = await new Promise((res, rej) => {
        db.query(newCustomersQuery, [branchId], (err, results) => {
          if (err) rej(err);
          else res([results]);
        });
      });

      const [vipResults] = await new Promise((res, rej) => {
        db.query(vipCustomersQuery, [branchId], (err, results) => {
          if (err) rej(err);
          else res([results]);
        });
      });

      const [returningResults] = await new Promise((res, rej) => {
        db.query(returningCustomersQuery, [branchId], (err, results) => {
          if (err) rej(err);
          else res([results]);
        });
      });

      // Calculate totals
      const newCount = newResults.length || 0;
      const newRevenue = newResults.reduce(
        (sum, r) => sum + parseFloat(r.total_revenue || 0),
        0
      );

      const vipCount = parseInt(vipResults[0]?.vip_customers || 0);
      const vipRevenue = parseFloat(vipResults[0]?.total_revenue || 0);

      const returningCount = parseInt(
        returningResults[0]?.returning_customers || 0
      );
      const returningRevenue = parseFloat(
        returningResults[0]?.total_revenue || 0
      );

      const totalCustomers = newCount + vipCount + returningCount;

      const response = {
        new: newCount,
        returning: returningCount,
        vip: vipCount,
        total: totalCustomers,
        breakdown: {
          new: {
            count: newCount,
            percentage:
              totalCustomers > 0
                ? parseFloat(((newCount / totalCustomers) * 100).toFixed(2))
                : 0,
            totalRevenue: parseFloat(newRevenue.toFixed(2)),
          },
          returning: {
            count: returningCount,
            percentage:
              totalCustomers > 0
                ? parseFloat(
                    ((returningCount / totalCustomers) * 100).toFixed(2)
                  )
                : 0,
            totalRevenue: parseFloat(returningRevenue.toFixed(2)),
          },
          vip: {
            count: vipCount,
            percentage:
              totalCustomers > 0
                ? parseFloat(((vipCount / totalCustomers) * 100).toFixed(2))
                : 0,
            totalRevenue: parseFloat(vipRevenue.toFixed(2)),
          },
        },
      };

      resolve(response);
    } catch (err) {
      console.error("Database error in getCustomerAnalytics:", err);
      reject(err);
    }
  });
};

/**
 * Get monthly revenue and expenses data for the last N months
 * Expenses = GRN purchases + earnings_expenses
 * @param {number} branchId - Branch ID to filter data
 * @param {number} months - Number of months to return (default: 12)
 * @returns {Promise<Object>} Object with categories, revenue, expenses arrays and summary
 */
const getRevenueExpenses = (branchId, months = 12) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get revenue by month
      const revenueQuery = `
        SELECT 
          DATE_FORMAT(Date, '%Y-%m') AS month,
          DATE_FORMAT(Date, '%b') AS month_label,
          COALESCE(SUM(CAST(Net_Amount AS DECIMAL(15,2))), 0) AS revenue
        FROM invoice
        WHERE Branch_idBranch = ?
          AND Date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        GROUP BY DATE_FORMAT(Date, '%Y-%m'), DATE_FORMAT(Date, '%b')
        ORDER BY month ASC`;

      // Get GRN expenses by month (using as primary expense source)
      // Note: earnings_expenses table not found in schema, so using GRN only
      const grnExpensesQuery = `
        SELECT 
          DATE_FORMAT(Date, '%Y-%m') AS month,
          COALESCE(SUM(CAST(Net_Total AS DECIMAL(15,2))), 0) AS expenses
        FROM grn
        WHERE Branch_idBranch = ?
          AND Date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        GROUP BY DATE_FORMAT(Date, '%Y-%m')
        ORDER BY month ASC`;

      // Execute queries
      const [revenueResults] = await new Promise((res, rej) => {
        db.query(revenueQuery, [branchId, months], (err, results) => {
          if (err) rej(err);
          else res([results]);
        });
      });

      const [grnResults] = await new Promise((res, rej) => {
        db.query(grnExpensesQuery, [branchId, months], (err, results) => {
          if (err) rej(err);
          else res([results]);
        });
      });

      // Create a map of all months with data
      const monthMap = new Map();

      // Initialize with last N months
      const currentDate = new Date();
      const monthLabels = [];
      for (let i = months - 1; i >= 0; i--) {
        const date = new Date(currentDate);
        date.setMonth(currentDate.getMonth() - i);
        const monthKey = `${date.getFullYear()}-${String(
          date.getMonth() + 1
        ).padStart(2, "0")}`;
        const monthLabel = date.toLocaleString("en-US", { month: "short" });
        monthLabels.push(monthLabel);
        monthMap.set(monthKey, { revenue: 0, expenses: 0 });
      }

      // Populate revenue data
      revenueResults.forEach((row) => {
        if (monthMap.has(row.month)) {
          monthMap.get(row.month).revenue = parseFloat(row.revenue);
        }
      });

      // Populate GRN expenses
      grnResults.forEach((row) => {
        if (monthMap.has(row.month)) {
          monthMap.get(row.month).expenses += parseFloat(row.expenses);
        }
      });

      // Convert to arrays
      const revenueArray = [];
      const expensesArray = [];
      let totalRevenue = 0;
      let totalExpenses = 0;

      monthMap.forEach((data) => {
        revenueArray.push(parseFloat(data.revenue.toFixed(2)));
        expensesArray.push(parseFloat(data.expenses.toFixed(2)));
        totalRevenue += data.revenue;
        totalExpenses += data.expenses;
      });

      const netProfit = totalRevenue - totalExpenses;
      const profitMargin =
        totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

      const response = {
        categories: monthLabels,
        revenue: revenueArray,
        expenses: expensesArray,
        summary: {
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          totalExpenses: parseFloat(totalExpenses.toFixed(2)),
          netProfit: parseFloat(netProfit.toFixed(2)),
          profitMargin: parseFloat(profitMargin.toFixed(2)),
        },
      };

      resolve(response);
    } catch (err) {
      console.error("Database error in getRevenueExpenses:", err);
      reject(err);
    }
  });
};

const batchCache = new Map();
const BATCH_CACHE_TTL = 60 * 1000; // 60 seconds

const getExpiringBatches = (Branch_idBranch) => {
  const nowMs = Date.now();
  const cached = batchCache.get(Branch_idBranch);
  if (cached && (nowMs - cached.timestamp < BATCH_CACHE_TTL)) {
    return Promise.resolve(cached.data);
  }

  const query = `
    SELECT 
      ib.batch_id AS id,
      ib.batch_code,
      ib.expiry_date,
      ib.qty AS batch_qty,
      i.idItem AS item_id,
      i.Item_Code,
      i.Description AS Item_Name,
      i.Qty AS item_qty,
      iv.id AS variation_id,
      iv.description AS variation_name,
      iv.qty AS variation_qty
    FROM item_batch ib
    JOIN item i ON ib.item_id = i.idItem
    JOIN grn g ON ib.grn_id = g.idGRN
    LEFT JOIN item_variations iv ON ib.variation_id = iv.id
    WHERE g.Branch_idBranch = ?
      AND (g.Status = 1 OR g.Status = '1')
      AND ib.expiry_date IS NOT NULL
      AND ib.expiry_date > '1970-01-01'
      AND ib.qty > 0
      -- Expiry is within 30 days, or already expired
      AND ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
    ORDER BY ib.expiry_date ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getExpiringBatches:", err);
        reject(err);
      } else {
        const parsed = JSON.parse(JSON.stringify(results));
        batchCache.set(Branch_idBranch, { timestamp: nowMs, data: parsed });
        resolve(parsed);
      }
    });
  });
};

const getLowStockItems = (Branch_idBranch) => {
  const query = `
    SELECT 
      idItem, 
      Description, 
      Qty, 
      low_stock_level,
      Item_Code
    FROM item 
    WHERE Branch_idBranch = ? 
      AND low_stock_level IS NOT NULL 
      AND low_stock_level != '0' 
      AND CAST(Qty AS DECIMAL(10,2)) <= CAST(low_stock_level AS DECIMAL(10,2))
      AND Status = 1
    ORDER BY Description ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getLowStockItems:", err);
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getCreditLimitCandidates = (Branch_idBranch) => {
  const query = `
    SELECT 
      c.idCustomer,
      c.displayName,
      c.First_Name,
      c.lastName,
      c.phoneNumber,
      c.credit_limit,
      c.credit_period,
      COALESCE(log.Total_Credit_Balance, 0) AS current_balance
    FROM customer c
    INNER JOIN (
      SELECT Customer_idCustomer, MAX(idCustomer_Credit_Log) AS max_log_id
      FROM customer_credit_log
      WHERE Branch_idBranch = ?
      GROUP BY Customer_idCustomer
    ) latest ON c.idCustomer = latest.Customer_idCustomer
    INNER JOIN customer_credit_log log ON log.idCustomer_Credit_Log = latest.max_log_id
    WHERE c.Branch_idBranch = ?
      AND log.Total_Credit_Balance > 0
      AND (c.credit_limit > 0 OR c.credit_period > 0)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getCreditLimitCandidates:", err);
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getCustomerLogsForCalculation = (Customer_idCustomer, Branch_idBranch) => {
  const query = `
    SELECT idCustomer_Credit_Log, Date_Time, Credit, Debit, Total_Credit_Balance
    FROM customer_credit_log
    WHERE Customer_idCustomer = ? AND Branch_idBranch = ?
    ORDER BY idCustomer_Credit_Log DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_idCustomer, Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Database error in getCustomerLogsForCalculation:", err);
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  getInvoiceCount,
  getCustomerCount,
  getCustomerLog,
  getSupplierLog,
  getDaliySales,
  getCustomerCheques,
  getSupplierCheques,
  getMonthlySales,
  getSupplierCount,
  getDuePayments,
  duePaymentNotifications,
  chequeNoifications,
  getGRNCount,
  getPurchaseOrderCount,
  // New dashboard endpoints
  getTopProducts,
  getCustomerAnalytics,
  getRevenueExpenses,
  getExpiringBatches,
  getLowStockItems,
  getCreditLimitCandidates,
  getCustomerLogsForCalculation,
};


