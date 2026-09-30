const db = require('../db/db');
const db2 = require('../db/db2');

// Helper for error handling
const errorHandler = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// Returns 'increase' if Debit increases the account, 'decrease' if Debit decreases it.
const amountDescreaseOrIncreaseStatusByAccountGroupType = (groupOfType) => {
  const increaseOnDebit = ["Assets", "Expenses"];
  const decreaseOnDebit = ["Liabilities", "Income", "Revenue", "Equity", "Contra Accounts"];

  if (increaseOnDebit.includes(groupOfType)) {
    return 'increase';
  } else if (decreaseOnDebit.includes(groupOfType)) {
    return 'decrease';
  }
  return null;
};

// Universal helper that handles both DEBIT and CREDIT
const calculateNewAccountBalance = (
  currentBalance,
  amount,
  groupOfType,
  transactionType // "debit" or "credit"
) => {
  const debitEffect = amountDescreaseOrIncreaseStatusByAccountGroupType(groupOfType);

  if (!debitEffect) {
    throw new Error(`Invalid account group type: ${groupOfType}`);
  }

  let shouldIncrease;

  if (transactionType === "debit") {
    shouldIncrease = debitEffect === "increase";
  } else if (transactionType === "credit") {
    shouldIncrease = debitEffect === "decrease";
  } else {
    throw new Error(`Invalid transaction type: ${transactionType}. Use "debit" or "credit"`);
  }

  const newBalance = shouldIncrease
    ? Math.round((parseFloat(currentBalance) + parseFloat(amount)) * 100) / 100
    : Math.round((parseFloat(currentBalance) - parseFloat(amount)) * 100) / 100;

  return newBalance;
};

// Determines debit/credit amounts based on account group type and transaction direction
const getDebitCreditAmounts = (
  groupOfType,
  amount,
  transactionType // "debit" or "credit"
) => {
  let debitAmount = 0;
  let creditAmount = 0;

  const debitEffect = amountDescreaseOrIncreaseStatusByAccountGroupType(groupOfType);

  if (!debitEffect) {
    throw new Error(`Invalid account group type: ${groupOfType}`);
  }

  if (debitEffect === "increase") {
    // For Assets and Expenses: Debit increases, Credit decreases
    if (transactionType === "debit") {
      debitAmount = amount;
    } else if (transactionType === "credit") {
      creditAmount = amount;
    }
  } else {
    // For Liabilities, Revenue, Equity, Contra Accounts: Credit increases, Debit decreases
    if (transactionType === "credit") {
      creditAmount = amount;
    } else if (transactionType === "debit") {
      debitAmount = amount;
    }
  }

  return {
    debitAmount: parseFloat(debitAmount),
    creditAmount: parseFloat(creditAmount),
  };
};

// Helper to create credit and debit logs and update balances
const creditDebitLogHelper = async ({
  accountType,
  group,
  amount,
  description,
  type,
  accountId,
  branchId,
  userId,
  companyId,
  transactionType,
  companySoftwareId,
  connection,
  next,
}) => {
  try {
    if (!amount || amount <= 0) {
      return;
    }

    if (!accountId) {
      console.log(`[creditDebitLogHelper] Skipped: accountId is empty. (Accounting module not initialized/enabled for company ${companyId}, branch ${branchId})`);
      return;
    }

    // Fallback to pool if no transaction connection provided
    const conn = connection || db;

    const [accountData] = await new Promise((resolve, reject) => {
      conn.query(
        "SELECT idAccounting_Accounts, Account_Balance, Group_Of_Type FROM accounting_accounts WHERE Branch_idBranch = ? AND idAccounting_Accounts = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) LIMIT 1",
        [branchId, accountId, companyId],
        (err, results) => {
          if (err) return reject(err);
          // Return nested to match the array destructuring const [accountData]
          resolve([results]);
        }
      );
    });

    console.log(
      `[creditDebitLogHelper] Checking Acc: Type=${accountType}, Group=${group}, Branch=${branchId}, ID=${accountId}, Company=${companyId}`
    );

    if (!accountData || accountData.length === 0) {
      const err = errorHandler(
        404,
        `Account is not found. accountType: ${accountType}, group: ${group}, branchId: ${branchId}, accountId: ${accountId}, companyId: ${companyId}`
      );
      if (next) return next(err);
      throw err;
    }

    // get the debit and credit amounts
    const { debitAmount, creditAmount } = getDebitCreditAmounts(
      accountData[0].Group_Of_Type,
      amount,
      transactionType
    );

    // calculate the new acc balance
    const newBalance = calculateNewAccountBalance(
      accountData[0].Account_Balance,
      amount,
      accountData[0].Group_Of_Type,
      transactionType
    );

    // update the account balance
    const updateAccountBalance = await new Promise((resolve, reject) => {
      conn.query(
        "UPDATE accounting_accounts SET Account_Balance = ? WHERE idAccounting_Accounts = ?",
        [newBalance, accountData[0].idAccounting_Accounts],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    if (updateAccountBalance.affectedRows === 0) {
      const err = errorHandler(400, "Failed to update the balance in to account");
      if (next) return next(err);
      throw err;
    }

    // log for the operation
    const accountLog = await new Promise((resolve, reject) => {
      conn.query(
        "INSERT INTO accounting_accounts_log (Accounting_Accounts_idAccounting_Accounts, Date_Time, Type, Description, Debit, Credit, Balance, User_idUser, branchId, companyId, CompanySoftware_IdCompanySoftware) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          accountData[0].idAccounting_Accounts,
          new Date(),
          type,
          description,
          debitAmount,
          creditAmount,
          newBalance,
          userId,
          branchId,
          companyId,
          companySoftwareId || null
        ],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    if (accountLog.affectedRows === 0) {
      const err = errorHandler(400, "Failed to log the operation in to account log");
      if (next) return next(err);
      throw err;
    }

    return true;
  } catch (error) {
    if (next) return next(error);
    throw error;
  }
};

// Helper to look up an account ID by its name and group
const findAccountByNameAndGroup = async (accountName, group, companyId, branchId, connection) => {
  const conn = connection || db;
  const [accountData] = await new Promise((resolve, reject) => {
    // If branchId is not provided, try querying only by companyId
    let query = "SELECT idAccounting_Accounts FROM accounting_accounts WHERE Account_Name = ? AND Group_Of_Type = ? AND companyId = ?";
    const params = [accountName, group, companyId];
    
    if (branchId) {
      query += " AND Branch_idBranch = ?";
      params.push(branchId);
    }
    query += " LIMIT 1";

    conn.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve([results]);
    });
  });
  return accountData.length > 0 ? accountData[0].idAccounting_Accounts : null;
};

// Helper to find an account or automatically create it if missing
const ensureAccountExists = async (
  accountName,
  type,
  group,
  code,
  description,
  companyId,
  branchId,
  userId = 1,
  connection = null
) => {
  const existingId = await findAccountByNameAndGroup(
    accountName,
    group,
    companyId,
    branchId,
    connection
  );
  if (existingId) return existingId;

  const conn = connection || db;
  const [existingAcc] = await new Promise((resolve, reject) => {
    conn.query(
      "SELECT idAccounting_Accounts FROM accounting_accounts WHERE Account_Name = ? AND Branch_idBranch = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) AND Status = 1 LIMIT 1",
      [accountName, branchId, companyId],
      (err, rows) => (err ? reject(err) : resolve([rows]))
    );
  });

  if (existingAcc && existingAcc.length > 0) {
    return existingAcc[0].idAccounting_Accounts;
  }

  const insertResult = await new Promise((resolve, reject) => {
    conn.query(
      "INSERT INTO accounting_accounts (Account_Name, Account_Type, Type, Group_Of_Type, Branch_idBranch, Account_Balance, Status, User_idUser, Account_Code, Description, companyId) VALUES (?, 'Chartered Account', ?, ?, ?, 0, 1, ?, ?, ?, ?)",
      [accountName, type, group, branchId, userId || 1, code, description, companyId],
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });

  const newAccId = insertResult.insertId;
  const logSql = `INSERT INTO accounting_accounts_log 
    (Accounting_Accounts_idAccounting_Accounts, Type, Description, Debit, Credit, Balance, User_idUser, branchId, companyId) 
    VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?)`;

  await new Promise((resolve) => {
    conn.query(
      logSql,
      [
        newAccId,
        "Chartered Account creation",
        `${accountName} - ${type}`,
        userId || 1,
        branchId,
        companyId,
      ],
      () => resolve()
    );
  });

  return newAccId;
};

// Get all chart of accounts (Analytics view)
const getAllChartAccounts = async (req, res, next) => {
  try {
    const { code, name, group, type, page: reqPage, limit: reqLimit, branchId, companyId } = req.query;
    const page = parseInt(reqPage) || 1;
    const limit = parseInt(reqLimit) || 20;
    const offset = (page - 1) * limit;

    if (!branchId || !companyId) {
      console.warn("Enforcement: getAllChartAccounts called without branchId or companyId", { branchId, companyId });
      return res.status(400).json({ success: false, message: "branchId and companyId are required" });
    }

    // Auto-provision standard accounts (Opening Balance Equity & Inventory Adjustment) for already initialized branches
    try {
      const [initCheck] = await new Promise((resolve, reject) => {
        db.query(
          "SELECT COUNT(*) as count FROM accounting_accounts WHERE Branch_idBranch = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) AND Status = 1",
          [branchId, companyId],
          (err, results) => (err ? reject(err) : resolve([results]))
        );
      });

      if (initCheck?.[0]?.count > 0) {
        await ensureAccountExists(
          "Opening Balance Equity",
          "Equity",
          "Equity",
          "6000-001",
          "Opening Balance Equity account",
          companyId,
          branchId,
          1
        );
        await ensureAccountExists(
          "Inventory Adjustment",
          "Expenses",
          "Expenses",
          "4000-005",
          "Inventory Adjustment / Stock Variance account",
          companyId,
          branchId,
          1
        );
      }
    } catch (e) {
      console.warn("[getAllChartAccounts] Auto-provisioning check skipped:", e.message);
    }

    let filter = "a.Status = '1' AND (a.companyId = ? OR a.companyId IS NULL OR a.companyId = 0) AND a.Branch_idBranch = ?";
    const params = [companyId, branchId];

    if (code) {
      filter += " AND a.Account_Code LIKE ?";
      params.push(`%${code}%`);
    }

    if (name) {
      filter += " AND a.Account_Name LIKE ?";
      params.push(`%${name}%`);
    }

    if (group) {
        filter += " AND a.Group_Of_Type = ?";
        params.push(group);
    }

    if (type) {
        filter += " AND a.Type = ?";
        params.push(type);
    }

    const countQuery = `SELECT COUNT(*) as count FROM accounting_accounts a WHERE ${filter}`;
    const [countResult] = await new Promise((resolve, reject) => {
        db.query(countQuery, params, (err, results) => {
            if (err) return reject(err);
            resolve([results]);
        });
    });
    
    const totalRecords = countResult[0].count;
    const totalPages = Math.ceil(totalRecords / limit);

    const query = `SELECT a.*, 
      (SELECT Account_Name FROM accounting_accounts WHERE idAccounting_Accounts = a.Parent_Account) AS Parent_Account_Name,
      (SELECT CONCAT(First_Name, ' ', Last_Name) FROM user WHERE idUser = a.User_idUser) AS Created_by
      FROM accounting_accounts a 
      WHERE ${filter} ORDER BY a.Account_Name ASC LIMIT ? OFFSET ?`;

    const queryParams = [...params, limit, offset];

    const [accounts] = await new Promise((resolve, reject) => {
        db.query(query, queryParams, (err, results) => {
            if (err) return reject(err);
            resolve([results]);
        });
    });

    const formattedAccounts = accounts.map(acc => {
      if (!acc.Account_Code && acc.Account_Number) {
        acc.Account_Code = String(acc.Account_Number).trim().slice(-8);
      }
      return acc;
    });

    res.status(200).json({
      success: true,
      message: "Chart of accounts fetched successfully",
      accounts: formattedAccounts,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalCount: totalRecords,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      }
    });

  } catch (error) {
    console.error("Error fetching chart of accounts:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get logs for an account (Analytics view)
const getChartAccountLogs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { branchId, companyId, page: reqPage, limit: reqLimit, startDate, endDate } = req.query;
    const page = parseInt(reqPage) || 1;
    const limit = parseInt(reqLimit) || 20;
    const offset = (page - 1) * limit;

    if (!branchId || !companyId) {
       return res.status(400).json({ success: false, message: "branchId and companyId are required" });
    }

    // Security check: Verify the account belongs to the branch/company
    const [accountCheck] = await new Promise((resolve, reject) => {
        db.query(
            "SELECT idAccounting_Accounts FROM accounting_accounts WHERE idAccounting_Accounts = ? AND Branch_idBranch = ? AND companyId = ?",
            [id, branchId, companyId],
            (err, res) => (err ? reject(err) : resolve([res]))
        );
    });

    if (!accountCheck || accountCheck.length === 0) {
        return res.status(403).json({ success: false, message: "Unauthorized access to account logs" });
    }

    let filter = "Accounting_Accounts_idAccounting_Accounts = ? AND branchId = ? AND companyId = ?";
    const params = [id, branchId, companyId];

    if (startDate) {
        filter += " AND Date_Time >= ?";
        params.push(`${startDate} 00:00:00`);
    }

    if (endDate) {
        filter += " AND Date_Time <= ?";
        params.push(`${endDate} 23:59:59`);
    }

    const countQuery = `SELECT COUNT(*) as count FROM accounting_accounts_log WHERE ${filter}`;
    const [countResult] = await new Promise((resolve, reject) => {
        db.query(countQuery, params, (err, results) => {
            if (err) return reject(err);
            resolve([results]);
        });
    });

    const totalRecords = countResult[0].count;
    const totalPages = Math.ceil(totalRecords / limit);

    const query = `SELECT l.*, CONCAT(u.First_Name, ' ', u.Last_Name) AS User_Name
      FROM accounting_accounts_log l
      LEFT JOIN user u ON l.User_idUser = u.idUser
      WHERE l.${filter}
      ORDER BY l.Date_Time DESC, l.idAccounting_Accounts_Log DESC LIMIT ? OFFSET ?`;

    const [logs] = await new Promise((resolve, reject) => {
        db.query(query, [...params, limit, offset], (err, results) => {
            if (err) return reject(err);
            resolve([results]);
        });
    });

    res.status(200).json({
      success: true,
      message: "Account logs fetched successfully",
      logs,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalCount: totalRecords,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      }
    });

  } catch (error) {
    console.error("Error fetching account logs:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get Accounting Summary for Dashboard
const getAccountingSummary = async (req, res, next) => {
  try {
    const { branchId, companyId } = req.query;

    if (!branchId || !companyId) {
       return res.status(400).json({ success: false, message: "branchId and companyId are required" });
    }
    
    let filter = "Status = '1' AND companyId = ? AND Branch_idBranch = ?";
    const params = [companyId, branchId];

    const [existing] = await new Promise((resolve, reject) => {
        db.query(`SELECT COUNT(*) as count FROM accounting_accounts WHERE companyId = ? AND Branch_idBranch = ?`, [companyId, branchId], (err, res) => {
            if(err) return reject(err);
            resolve([res]);
        });
    });

    let summary = { Assets: 0, Liabilities: 0, Equity: 0, Revenue: 0, Expenses: 0 };

    if (existing[0].count === 0) {
       return res.status(200).json({ success: true, isInitialized: false, summary });
    }

    const query = `
      SELECT Group_Of_Type, SUM(Account_Balance) as Total 
      FROM accounting_accounts 
      WHERE ${filter} 
      GROUP BY Group_Of_Type`;

    const [results] = await new Promise((resolve, reject) => {
        db.query(query, params, (err, res) => {
            if(err) return reject(err);
            resolve([res]);
        });
    });

    results.forEach(row => {
      let key = row.Group_Of_Type;
      if (key === "Income") key = "Revenue";
      if (summary[key] !== undefined) {
        summary[key] = row.Total || 0;
      }
    });

    res.status(200).json({ success: true, isInitialized: true, summary });
  } catch (error) {
    console.error("Error fetching accounting summary:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get Trial Balance
const getTrialBalance = async (req, res, next) => {
  try {
    const { startDate, endDate, branchId, companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required" });
    }

    // 1. Fetch Branches from Account Center (db2)
    // The logs refer to Branch IDs and Company IDs from the Account Center.
    let branchQuery = "SELECT idBranch, Name, isMainBranch FROM branch WHERE Company_idCompany = ? AND status = 1";
    let branchParams = [companyId];

    if (branchId && branchId !== "all") {
        const parsedBranchIds = branchId.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (parsedBranchIds.length > 0) {
            branchQuery += " AND idBranch IN (?)";
            branchParams.push(parsedBranchIds);
        }
    }

    const [accountCenterBranches] = await new Promise((resolve, reject) => {
        db2.query(branchQuery, branchParams, (err, rows) => {
            if (err) return reject(err);
            resolve([rows]);
        });
    });

    if (accountCenterBranches.length === 0) {
        return res.status(404).json({ success: false, message: "No branches found in Account Center for this ID/Company" });
    }

    const targetBranchIds = accountCenterBranches.map(b => b.idBranch);

    // 2. Query Logs from Local DB (db) using the Account Center IDs
    let dateFilter = "";
    const queryParams = [companyId, targetBranchIds];
    
    if (startDate && endDate) {
        dateFilter = " AND l.Date_Time >= ? AND l.Date_Time <= ?";
        queryParams.splice(1, 0, `${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    const query = `
      SELECT 
        l.branchId,
        a.Account_Code,
        a.Account_Number,
        MAX(a.Account_Name) as Account_Name,
        MAX(a.Group_Of_Type) as Group_Of_Type,
        SUM(l.Debit) as totalDebit,
        SUM(l.Credit) as totalCredit
      FROM accounting_accounts_log l
      JOIN accounting_accounts a ON l.Accounting_Accounts_idAccounting_Accounts = a.idAccounting_Accounts
      WHERE l.companyId = ? ${dateFilter} AND l.branchId IN (?)
      GROUP BY l.branchId, a.idAccounting_Accounts
      ORDER BY Group_Of_Type, Account_Name
    `;

    const [rawLogs] = await new Promise((resolve, reject) => {
      db.query(query, queryParams, (err, rows) => {
        if (err) return reject(err);
        resolve([rows]);
      });
    });

    // 3. Map Account Center Branch names and Process Data
    let totalDebitOverall = 0;
    let totalCreditOverall = 0;

    const increaseOnDebit = ["Assets", "Expenses"];
    const increaseOnCredit = ["Liabilities", "Income", "Revenue", "Equity", "Contra Accounts"];

    // Map branches for quick lookup
    const branchInfoMap = {};
    accountCenterBranches.forEach(b => {
        branchInfoMap[b.idBranch] = b.Name;
    });

    const accountsMap = {};
    const usedBranchesMap = {};

    rawLogs.forEach(log => {
      const { Account_Code, Account_Number, Account_Name, Group_Of_Type, branchId, totalDebit, totalCredit } = log;
      
      let finalCode = Account_Code;
      if (!finalCode && Account_Number) {
        finalCode = String(Account_Number).trim().slice(-8);
      }
      if (!finalCode) {
        finalCode = "N/A";
      }

      const branchName = branchInfoMap[branchId] || `Branch #${branchId}`;
      
      if (!usedBranchesMap[branchId]) {
        usedBranchesMap[branchId] = { id: branchId, name: branchName };
      }

      // Use finalCode as the unique key to merge rows across branches
      if (!accountsMap[finalCode]) {
        accountsMap[finalCode] = {
          Account_Code: finalCode,
          Account_Name,
          Group_Of_Type,
          branches: {}
        };
      }

      // Calculate net balances
      const netDebitRaw = parseFloat(totalDebit || 0);
      const netCreditRaw = parseFloat(totalCredit || 0);
      
      let finalDebit = 0;
      let finalCredit = 0;

      if (increaseOnDebit.includes(Group_Of_Type)) {
        const bal = netDebitRaw - netCreditRaw;
        if (bal >= 0) finalDebit = bal;
        else finalCredit = Math.abs(bal);
      } else {
        const bal = netCreditRaw - netDebitRaw;
        if (bal >= 0) finalCredit = bal;
        else finalDebit = Math.abs(bal);
      }

      accountsMap[finalCode].branches[branchId] = {
        debit: Math.round(finalDebit * 100) / 100,
        credit: Math.round(finalCredit * 100) / 100
      };

      totalDebitOverall += finalDebit;
      totalCreditOverall += finalCredit;
    });

    const finalAccounts = Object.values(accountsMap);
    const finalBranches = Object.values(usedBranchesMap);

    // Sort finalBranches by isMainBranch if available, or name
    finalBranches.sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({
      success: true,
      branches: finalBranches.length > 0 ? finalBranches : accountCenterBranches.map(b => ({ id: b.idBranch, name: b.Name })),
      accounts: finalAccounts,
      totalDebit: Math.round(totalDebitOverall * 100) / 100,
      totalCredit: Math.round(totalCreditOverall * 100) / 100,
      isMultiBranch: targetBranchIds.length > 1
    });

  } catch (error) {
    console.error("Error fetching trial balance:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get Balance Sheet
const getBalanceSheet = async (req, res, next) => {
  try {
    const { start_date, end_date, branchId, companyId } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: "Start date and end date are required for balance sheet" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
      return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD" });
    }
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({ success: false, message: "start_date cannot be after end_date" });
    }

    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required" });
    }

    // 1. Fetch Branches from Account Center (db2)
    let branchQuery = "SELECT idBranch, Name, isMainBranch FROM branch WHERE Company_idCompany = ? AND status = 1";
    let branchParams = [companyId];

    if (branchId && branchId !== "all") {
        const parsedBranchIds = branchId.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (parsedBranchIds.length > 0) {
            branchQuery += " AND idBranch IN (?)";
            branchParams.push(parsedBranchIds);
        }
    }

    const [accountCenterBranches] = await new Promise((resolve, reject) => {
        db2.query(branchQuery, branchParams, (err, rows) => {
            if (err) return reject(err);
            resolve([rows]);
        });
    });

    if (accountCenterBranches.length === 0) {
        return res.status(404).json({ success: false, message: "No branches found" });
    }

    const selectedBranchIds = accountCenterBranches.map(b => b.idBranch);
    const multiBranch = selectedBranchIds.length > 1;

    const dateClause = "DATE(STR_TO_DATE(l.Date_Time, '%Y-%m-%d %H:%i:%s')) BETWEEN ? AND ?";
    const typeClause = "(l.Type IS NULL OR l.Type != 'Charted Account Creation')";

    const [bsAccounts] = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idAccounting_Accounts, Account_Name, Account_Code, Account_Type, Group_Of_Type, Parent_Account
         FROM accounting_accounts
         WHERE (companyId = ? OR companyId IS NULL OR companyId = 0) AND Group_Of_Type IN ('Assets', 'Liabilities', 'Equity')`,
        [companyId],
        (err, rows) => err ? reject(err) : resolve([rows])
      );
    });

    const accountMeta = new Map(bsAccounts.map((a) => [a.idAccounting_Accounts, a]));
    const allIds = bsAccounts.map((a) => a.idAccounting_Accounts);

    let rawRows = [];

    if (allIds.length > 0) {
      if (multiBranch) {
        const [rows] = await new Promise((resolve, reject) => {
          db.query(
            `SELECT l.branchId,
                    l.Accounting_Accounts_idAccounting_Accounts,
                    SUM(l.Debit) AS totalDebitAmount,
                    SUM(l.Credit) AS totalCreditAmount
             FROM accounting_accounts_log l
             WHERE l.companyId = ?
               AND l.Accounting_Accounts_idAccounting_Accounts IN (?)
               AND ${dateClause}
               AND l.branchId IN (?)
               AND ${typeClause}
             GROUP BY l.branchId, l.Accounting_Accounts_idAccounting_Accounts`,
            [companyId, allIds, start_date, end_date, selectedBranchIds],
            (err, r) => err ? reject(err) : resolve([r])
          );
        });
        rawRows = rows;
      } else {
        const [rows] = await new Promise((resolve, reject) => {
          db.query(
            `SELECT Accounting_Accounts_idAccounting_Accounts,
                    SUM(Debit) AS totalDebitAmount,
                    SUM(Credit) AS totalCreditAmount
             FROM accounting_accounts_log l
             WHERE l.companyId = ?
               AND l.Accounting_Accounts_idAccounting_Accounts IN (?)
               AND ${dateClause}
               AND l.branchId IN (?)
               AND ${typeClause}
             GROUP BY Accounting_Accounts_idAccounting_Accounts`,
            [companyId, allIds, start_date, end_date, selectedBranchIds],
            (err, r) => err ? reject(err) : resolve([r])
          );
        });
        rawRows = rows;
      }
    }

    const branchNameMap = new Map(accountCenterBranches.map(b => [b.idBranch, b.Name]));

    const balanceSheetAmount = (g, debit, credit) => {
      debit = Number(debit) || 0;
      credit = Number(credit) || 0;
      if (g === 'Assets') return debit - credit;
      return credit - debit;
    };

    // Map raw balances by account ID (and branchId if multiBranch)
    const rawBalances = new Map();
    
    rawRows.forEach(row => {
      const id = row.Accounting_Accounts_idAccounting_Accounts;
      const meta = accountMeta.get(id);
      if (!meta) return;
      
      const bal = balanceSheetAmount(meta.Group_Of_Type, row.totalDebitAmount, row.totalCreditAmount);
      const key = multiBranch ? `${id}_${row.branchId}` : `${id}`;
      
      rawBalances.set(key, {
        accountId: id,
        branchId: row.branchId || null,
        balance: bal
      });
    });

    // Helper to get top parent account ID
    const getTopParentId = (accId) => {
      const acc = accountMeta.get(accId);
      if (!acc) return accId;
      if (acc.Parent_Account) {
        return getTopParentId(acc.Parent_Account);
      }
      return accId;
    };

    // Roll up balances to top parent accounts
    const rolledUpBalances = new Map();

    rawBalances.forEach((val) => {
      const topParentId = getTopParentId(val.accountId);
      const targetKey = multiBranch ? `${topParentId}_${val.branchId}` : `${topParentId}`;
      
      rolledUpBalances.set(targetKey, (rolledUpBalances.get(targetKey) || 0) + val.balance);
    });

    // Construct final balanceSheetGrouped containing top-level accounts only
    const balanceSheetGrouped = [];

    bsAccounts.forEach(acc => {
      // Only show top-level accounts on the Balance Sheet
      if (acc.Parent_Account) return;
      
      if (multiBranch) {
        selectedBranchIds.forEach(bId => {
          const key = `${acc.idAccounting_Accounts}_${bId}`;
          const bal = rolledUpBalances.get(key) || 0;
          
          if (Math.abs(bal) > 0.001) {
            balanceSheetGrouped.push({
              idAccounting_Accounts: acc.idAccounting_Accounts,
              Account_Name: acc.Account_Name,
              Account_Code: acc.Account_Code,
              Account_Type: acc.Account_Type,
              Group_Of_Type: acc.Group_Of_Type,
              balance: bal,
              branchId: bId,
              branchName: branchNameMap.get(bId) || `Branch #${bId}`
            });
          }
        });
      } else {
        const key = `${acc.idAccounting_Accounts}`;
        const bal = rolledUpBalances.get(key) || 0;
        
        if (Math.abs(bal) > 0.001) {
          balanceSheetGrouped.push({
            idAccounting_Accounts: acc.idAccounting_Accounts,
            Account_Name: acc.Account_Name,
            Account_Code: acc.Account_Code,
            Account_Type: acc.Account_Type,
            Group_Of_Type: acc.Group_Of_Type,
            balance: bal
          });
        }
      }
    });

    // ✅ --- Calculate Net Income / Retained Earnings for the period ---
    try {
      const [pnlAccounts] = await new Promise((resolve, reject) => {
        db.query(
          `SELECT idAccounting_Accounts, Account_Name, Account_Code, Account_Type, Group_Of_Type
           FROM accounting_accounts
           WHERE companyId = ? AND Group_Of_Type IN ('Income', 'Revenue', 'Expenses', 'Contra Accounts')`,
          [companyId],
          (err, rows) => err ? reject(err) : resolve([rows])
        );
      });

      const pnlIds = pnlAccounts.map(a => a.idAccounting_Accounts);
      let pnlRows = [];

      if (pnlIds.length > 0) {
        if (multiBranch) {
          const [rows] = await new Promise((resolve, reject) => {
            db.query(
              `SELECT l.branchId,
                      l.Accounting_Accounts_idAccounting_Accounts,
                      SUM(l.Debit) AS totalDebitAmount,
                      SUM(l.Credit) AS totalCreditAmount
               FROM accounting_accounts_log l
               WHERE l.companyId = ?
                 AND l.Accounting_Accounts_idAccounting_Accounts IN (?)
                 AND ${dateClause}
                 AND l.branchId IN (?)
                 AND ${typeClause}
               GROUP BY l.branchId, l.Accounting_Accounts_idAccounting_Accounts`,
              [companyId, pnlIds, start_date, end_date, selectedBranchIds],
              (err, r) => err ? reject(err) : resolve([r])
            );
          });
          pnlRows = rows;
        } else {
          const [rows] = await new Promise((resolve, reject) => {
            db.query(
              `SELECT Accounting_Accounts_idAccounting_Accounts,
                      SUM(Debit) AS totalDebitAmount,
                      SUM(Credit) AS totalCreditAmount
               FROM accounting_accounts_log l
               WHERE l.companyId = ?
                 AND l.Accounting_Accounts_idAccounting_Accounts IN (?)
                 AND ${dateClause}
                 AND l.branchId IN (?)
                 AND ${typeClause}
               GROUP BY Accounting_Accounts_idAccounting_Accounts`,
              [companyId, pnlIds, start_date, end_date, selectedBranchIds],
              (err, r) => err ? reject(err) : resolve([r])
            );
          });
          pnlRows = rows;
        }
      }

      const pnlMeta = new Map(pnlAccounts.map(a => [a.idAccounting_Accounts, a]));
      const branchNetIncomeMap = new Map();

      for (const row of pnlRows) {
        const meta = pnlMeta.get(row.Accounting_Accounts_idAccounting_Accounts);
        if (!meta) continue;
        const bId = row.branchId || "single";
        const deb = Number(row.totalDebitAmount) || 0;
        const cred = Number(row.totalCreditAmount) || 0;

        let val = 0;
        if (meta.Group_Of_Type === "Income" || meta.Group_Of_Type === "Revenue") {
          val = cred - deb; // Revenue increases net income
        } else if (meta.Group_Of_Type === "Expenses") {
          val = -(deb - cred); // Expenses decrease net income
        } else if (meta.Group_Of_Type === "Contra Accounts") {
          val = cred - deb; // Contra accounts balance adjusts net income
        }

        branchNetIncomeMap.set(bId, (branchNetIncomeMap.get(bId) || 0) + val);
      }

      if (multiBranch) {
        for (const [bId, netInc] of branchNetIncomeMap.entries()) {
          if (Math.abs(netInc) > 0.001) {
            balanceSheetGrouped.push({
              idAccounting_Accounts: `net-income-virtual-${bId}`,
              Account_Name: "Retained Earnings (Current Period)",
              Account_Code: "6000-NET",
              Account_Type: "Equity",
              Group_Of_Type: "Equity",
              balance: netInc,
              branchId: bId,
              branchName: branchNameMap.get(bId) || `Branch #${bId}`
            });
          }
        }
      } else {
        const netInc = Array.from(branchNetIncomeMap.values()).reduce((sum, v) => sum + v, 0);
        if (Math.abs(netInc) > 0.001) {
          balanceSheetGrouped.push({
            idAccounting_Accounts: "net-income-virtual-single",
            Account_Name: "Retained Earnings (Current Period)",
            Account_Code: "6000-NET",
            Account_Type: "Equity",
            Group_Of_Type: "Equity",
            balance: netInc
          });
        }
      }
    } catch (pnlError) {
      console.error("Error calculating Net Income for Balance Sheet:", pnlError);
    }

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    for (const r of balanceSheetGrouped) {
      if (r.Group_Of_Type === "Assets") totalAssets += r.balance;
      else if (r.Group_Of_Type === "Liabilities") totalLiabilities += r.balance;
      else if (r.Group_Of_Type === "Equity") totalEquity += r.balance;
    }

    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const balanceSheetDifference = totalAssets - totalLiabilitiesAndEquity;
    const balanceSheetStatus = Math.abs(balanceSheetDifference) < 0.01 ? "Balanced" : "Unbalanced";

    const finalBranches = accountCenterBranches.map(b => ({ idBranch: b.idBranch, Name: b.Name, Branch_Code: b.idBranch }));

    res.status(200).json({
      success: true,
      data: {
        multiBranch,
        selectedBranchIds,
        branches: finalBranches,
        start_date,
        end_date,
        balanceSheetGrouped,
        totalAssets,
        totalLiabilities,
        totalEquity,
        totalLiabilitiesAndEquity,
        balanceSheetStatus,
        balanceSheetDifference,
      },
    });

  } catch (error) {
    console.error("Error in getBalanceSheet:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Helper to create an account and its initial log entry
const createAccountWithLog = async (
  accountData,
  connection,
  userId,
  logType = "Chartered Account creation",
) => {
  const accountSql = `INSERT INTO accounting_accounts 
    (Account_Name, Account_Type, Created_At, Type, Group_Of_Type, Branch_idBranch, Account_Balance, Status, User_idUser, Account_Code, Parent_Account, Description, companyId) 
    VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const [accountResult] = await new Promise((resolve, reject) => {
    connection.query(accountSql, accountData, (err, result) => {
      if (err) {
        console.error(
          `[createAccountWithLog] FAILED to insert account: ${accountData[0]}`,
          err,
        );
        return reject(err);
      }
      resolve([result]);
    });
  });

  // Log the account creation
  const logSql = `INSERT INTO accounting_accounts_log 
    (Accounting_Accounts_idAccounting_Accounts, Type, Description, Debit, Credit, Balance, User_idUser, branchId, companyId) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const logDescription = `${accountData[0]} - ${accountData[3]}`; // Name - Type
  const branchId = accountData[4];
  const companyId = accountData[11];

  await new Promise((resolve, reject) => {
    connection.query(
      logSql,
      [
        accountResult.insertId,
        logType,
        logDescription,
        0,
        0,
        0,
        userId,
        branchId,
        companyId,
      ],
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
  });

  return accountResult.insertId;
};

// Initialize Chart of Accounts if empty
const initializeAccounts = async (req, res, next) => {
  let connection;
  try {
    const { branchId, companyId, branchName } = req.body;
    const userId = req.user?.id || 1; // Fallback or extract from auth

    if (!branchId || !companyId) {
       console.error("Initialization error: Missing required fields", { branchId, companyId, body: req.body });
       return res.status(400).json({ success: false, message: "branchId and companyId are required" });
    }

    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

    // Check if accounts already exist for this branch (WITH LOCK)
    const [existing] = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT COUNT(*) as count FROM accounting_accounts WHERE companyId = ? AND Branch_idBranch = ? FOR UPDATE", 
          [companyId, branchId], 
          (err, res) => (err ? reject(err) : resolve([res]))
        );
    });

    if (existing[0].count > 0) {
        await new Promise((resolve) => connection.rollback(() => resolve()));
        return res.status(200).json({ success: true, message: "Accounts already initialized", redirect: false });
    }

    const defaultAccounts = [
      // Assets
      { name: "Cash in Hand", type: "Assets", group: "Assets", code: "1000-001" },
      { name: "Bank Account", type: "Assets", group: "Assets", code: "1000-002" },
      { name: "Accounts Receivable (Debtors)", type: "Assets", group: "Assets", code: "1000-003" },
      { name: "Inventory", type: "Assets", group: "Assets", code: "1000-004" },
      { name: "Cheque Clearing Account", type: "Assets", group: "Assets", code: "1000-005" },
      { name: "Receivable from Provider", type: "Assets", group: "Assets", code: "1000-006" },
      // Liabilities
      { name: "Accounts Payable (Creditors)", type: "Liabilities", group: "Liabilities", code: "2000-001" },
      { name: "VAT Payable", type: "Liabilities", group: "Liabilities", code: "2000-002" },
      { name: "Customer Advance", type: "Liabilities", group: "Liabilities", code: "2000-003" },
      { name: "Gift Voucher Liability", type: "Liabilities", group: "Liabilities", code: "2000-004" },
      // Income
      { name: "Sales Revenue", type: "Income", group: "Income", code: "3000-001" },
      { name: "Other Income (Rental, etc.)", type: "Income", group: "Income", code: "3000-002" },
      { name: "Purchase Discounts Received", type: "Income", group: "Income", code: "3000-003" },
      // Expenses
      { name: "Cost of Goods Sold (COGS)", type: "Expenses", group: "Expenses", code: "4000-001" },
      { name: "Utilities Expense (Water, Electricity)", type: "Expenses", group: "Expenses", code: "4000-002" },
      { name: "General Expenses", type: "Expenses", group: "Expenses", code: "4000-003" },
      { name: "Promotion Expense", type: "Expenses", group: "Expenses", code: "4000-004" },
      { name: "Inventory Adjustment", type: "Expenses", group: "Expenses", code: "4000-005" },
      // Equity
      { name: "Opening Balance Equity", type: "Equity", group: "Equity", code: "6000-001" },
      // Contra Accounts
      { name: "Sales Discounts", type: "Contra Accounts", group: "Contra Accounts", code: "5000-001" },
      { name: "Purchase Returns", type: "Contra Accounts", group: "Contra Accounts", code: "5000-002" },
      { name: "Customer Loyalty Discounts", type: "Contra Accounts", group: "Contra Accounts", code: "5000-003" },
    ];

    for (const acc of defaultAccounts) {
      const accountData = [
        acc.name,
        "Chartered Account",
        acc.type,
        acc.group,
        branchId,
        0,
        1,
        userId,
        acc.code,
        null,
        `${acc.name} default account for ${branchName || 'Company'}`,
        companyId
      ];
      await createAccountWithLog(accountData, connection, userId, "System Initialization");
    }

    await new Promise((resolve, reject) => {
      connection.commit((err) => (err ? reject(err) : resolve()));
    });

    res.status(200).json({ success: true, message: "Accounts initialized successfully" });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
    }
    console.error("Error initializing accounts:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  } finally {
    if (connection) connection.release();
  }
};

// Get Advanced Profit and Loss
const getAdvancedProfitAndLoss = async (req, res, next) => {
  try {
    const { startDate, endDate, branchId, companyId } = req.query;

    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required" });
    }

    // 1. Fetch Branches from Account Center (db2)
    let branchQuery = "SELECT idBranch, Name, isMainBranch FROM branch WHERE Company_idCompany = ? AND status = 1";
    let branchParams = [companyId];

    if (branchId && branchId !== "all") {
        branchQuery += " AND idBranch = ?";
        branchParams.push(branchId);
    }

    const [accountCenterBranches] = await new Promise((resolve, reject) => {
        db2.query(branchQuery, branchParams, (err, rows) => {
            if (err) return reject(err);
            resolve([rows]);
        });
    });

    if (accountCenterBranches.length === 0) {
        return res.status(404).json({ success: false, message: "No branches found" });
    }

    const selectedBranchIds = accountCenterBranches.map(b => b.idBranch);
    const multiBranch = selectedBranchIds.length > 1;

    // 2. Fetch Revenue and Expense Accounts
    const [revenueAccounts] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT idAccounting_Accounts, Account_Name, Account_Type, Account_Code, Group_Of_Type FROM accounting_accounts WHERE companyId = ? AND (Group_Of_Type = 'Revenue' OR Group_Of_Type = 'Income')",
        [companyId],
        (err, rows) => err ? reject(err) : resolve([rows])
      );
    });

    const [expenseAccounts] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT idAccounting_Accounts, Account_Name, Account_Type, Account_Code, Group_Of_Type FROM accounting_accounts WHERE companyId = ? AND (Group_Of_Type = 'Expenses' OR Group_Of_Type = 'Contra Accounts')",
        [companyId],
        (err, rows) => err ? reject(err) : resolve([rows])
      );
    });

    const revenueIds = revenueAccounts.map((a) => a.idAccounting_Accounts);
    const expenseIds = expenseAccounts.map((a) => a.idAccounting_Accounts);

    const revenueMap = new Map(revenueAccounts.map((a) => [a.idAccounting_Accounts, a]));
    const expenseMap = new Map(expenseAccounts.map((a) => [a.idAccounting_Accounts, a]));

    let dateClause = "";
    const dateParams = [];
    if (startDate && endDate) {
      dateClause = " AND l.Date_Time >= ? AND l.Date_Time <= ?";
      dateParams.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    let revenueRows = [];
    let expenseRows = [];

    // Map branches for quick lookup
    const branchInfoMap = {};
    accountCenterBranches.forEach(b => {
        branchInfoMap[b.idBranch] = b.Name;
    });

    if (multiBranch) {
      if (revenueIds.length > 0) {
        const query = `
          SELECT l.branchId, l.Accounting_Accounts_idAccounting_Accounts, SUM(l.Credit) AS totalCreditAmount, SUM(l.Debit) as totalDebitSub
          FROM accounting_accounts_log l
          WHERE l.companyId = ? AND l.Accounting_Accounts_idAccounting_Accounts IN (?) ${dateClause} AND l.branchId IN (?)
          GROUP BY l.branchId, l.Accounting_Accounts_idAccounting_Accounts`;
        
        const [rows] = await new Promise((resolve, reject) => {
          db.query(query, [companyId, revenueIds, ...dateParams, selectedBranchIds], (err, res) => err ? reject(err) : resolve([res]));
        });
        revenueRows = rows;
      }

      if (expenseIds.length > 0) {
        const query = `
          SELECT l.branchId, l.Accounting_Accounts_idAccounting_Accounts, SUM(l.Debit) AS totalDebitAmount, SUM(l.Credit) as totalCreditSub
          FROM accounting_accounts_log l
          WHERE l.companyId = ? AND l.Accounting_Accounts_idAccounting_Accounts IN (?) ${dateClause} AND l.branchId IN (?)
          GROUP BY l.branchId, l.Accounting_Accounts_idAccounting_Accounts`;
          
        const [rows] = await new Promise((resolve, reject) => {
          db.query(query, [companyId, expenseIds, ...dateParams, selectedBranchIds], (err, res) => err ? reject(err) : resolve([res]));
        });
        expenseRows = rows;
      }
    } else {
      if (revenueIds.length > 0) {
        const query = `SELECT Accounting_Accounts_idAccounting_Accounts, SUM(Credit) AS totalCreditAmount, SUM(Debit) as totalDebitSub FROM accounting_accounts_log l WHERE companyId = ? AND Accounting_Accounts_idAccounting_Accounts IN (?) ${dateClause} AND branchId IN (?) GROUP BY Accounting_Accounts_idAccounting_Accounts`;
        const [rows] = await new Promise((resolve, reject) => {
          db.query(query, [companyId, revenueIds, ...dateParams, selectedBranchIds], (err, res) => err ? reject(err) : resolve([res]));
        });
        revenueRows = rows;
      }

      if (expenseIds.length > 0) {
        const query = `SELECT Accounting_Accounts_idAccounting_Accounts, SUM(Debit) AS totalDebitAmount, SUM(Credit) as totalCreditSub FROM accounting_accounts_log l WHERE companyId = ? AND Accounting_Accounts_idAccounting_Accounts IN (?) ${dateClause} AND branchId IN (?) GROUP BY Accounting_Accounts_idAccounting_Accounts`;
        const [rows] = await new Promise((resolve, reject) => {
          db.query(query, [companyId, expenseIds, ...dateParams, selectedBranchIds], (err, res) => err ? reject(err) : resolve([res]));
        });
        expenseRows = rows;
      }
    }

    const mapRevenueRow = (row) => {
      const id = row.Accounting_Accounts_idAccounting_Accounts;
      const acc = revenueMap.get(id) || {};
      const netAmount = (Number(row.totalCreditAmount) || 0) - (Number(row.totalDebitSub) || 0);
      const base = {
        idAccounting_Accounts: id,
        Account_Name: acc.Account_Name,
        Account_Type: acc.Account_Type,
        Group_Of_Type: acc.Group_Of_Type,
        Account_Code: acc.Account_Code,
        totalCreditAmount: netAmount > 0 ? netAmount : 0, 
      };
      if (multiBranch) {
        return {
          ...base,
          branchId: row.branchId,
          branchName: branchInfoMap[row.branchId] || `Branch #${row.branchId}`,
        };
      }
      return base;
    };

    const mapExpenseRow = (row) => {
      const id = row.Accounting_Accounts_idAccounting_Accounts;
      const acc = expenseMap.get(id) || {};
      const netAmount = (Number(row.totalDebitAmount) || 0) - (Number(row.totalCreditSub) || 0);
      const base = {
        idAccounting_Accounts: id,
        Account_Name: acc.Account_Name,
        Account_Type: acc.Account_Type,
        Group_Of_Type: acc.Group_Of_Type,
        Account_Code: acc.Account_Code,
        totalDebitAmount: netAmount > 0 ? netAmount : 0,
      };
      if (multiBranch) {
        return {
          ...base,
          branchId: row.branchId,
          branchName: branchInfoMap[row.branchId] || `Branch #${row.branchId}`,
        };
      }
      return base;
    };

    const revenueByAccount = revenueRows.map(mapRevenueRow);
    const expensesByAccount = expenseRows.map(mapExpenseRow);

    const totalRevenue = revenueByAccount.reduce((acc, curr) => acc + curr.totalCreditAmount, 0);
    const totalExpenses = expensesByAccount.reduce((acc, curr) => acc + curr.totalDebitAmount, 0);
    const profitAndLoss = totalRevenue - totalExpenses;

    const status = profitAndLoss < 0 ? "Net Loss" : "Net Profit";
    
    // Sort finalBranches by isMainBranch if available, or name
    const finalBranches = accountCenterBranches.map(b => ({idBranch: b.idBranch, Name: b.Name, Branch_Code: b.idBranch}));

    res.status(200).json({
      success: true,
      data: {
        profitAndLoss,
        status,
        multiBranch,
        selectedBranchIds,
        branches: finalBranches,
        totalCreditAmountsGrouped: revenueByAccount,
        totalDebitAmountsGrouped: expensesByAccount,
      },
    });

  } catch (error) {
    console.error("Error fetching advanced profit and loss:", error);
    if (next) return next(errorHandler(500, "Internal Server Error"));
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Create Manual Journal
const createManualJournal = async (req, res, next) => {
  let connection;
  try {
    const { branchId, companyId, date, description, entries } = req.body;
    const userId = req.user?.id || 1; // Fallback or extract from auth

    if (!branchId || !companyId) {
       return res.status(400).json({ success: false, message: "branchId and companyId are required" });
    }

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: "Manual journal entries are required" });
    }

    // Validate entries
    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of entries) {
      if (!entry.accountId) {
        return res.status(400).json({ success: false, message: "Account is required for all entries" });
      }
      if (!entry.type || !['debit', 'credit'].includes(entry.type)) {
        return res.status(400).json({ success: false, message: "Type must be debit or credit" });
      }
      if (typeof entry.amount !== 'number' || entry.amount <= 0) {
        return res.status(400).json({ success: false, message: "Amount must be greater than 0" });
      }

      if (entry.type === 'debit') {
        totalDebit += entry.amount;
      } else {
        totalCredit += entry.amount;
      }
    }

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    if (totalDebit !== totalCredit) {
      return res.status(400).json({ success: false, message: "Total debits must equal total credits" });
    }

    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

    // Process entries
    for (const entry of entries) {
      // Find the account to get Type and Group
      const [accountData] = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT idAccounting_Accounts, Account_Type, Group_Of_Type FROM accounting_accounts WHERE idAccounting_Accounts = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) FOR UPDATE",
          [entry.accountId, companyId],
          (err, results) => {
            if (err) return reject(err);
            resolve([results]);
          }
        );
      });

      if (!accountData || accountData.length === 0) {
        throw errorHandler(400, `Account missing or not found for ID ${entry.accountId}`);
      }

      const accInfo = accountData[0];

      await creditDebitLogHelper({
        accountType: accInfo.Account_Type,
        group: accInfo.Group_Of_Type,
        amount: entry.amount,
        description: `Manual Journal: ${description || 'N/A'}`,
        type: 'Manual Journal',
        accountId: entry.accountId,
        branchId,
        userId,
        companyId,
        transactionType: entry.type,
        connection
      });
    }

    await new Promise((resolve, reject) => {
      connection.commit((err) => (err ? reject(err) : resolve()));
    });

    res.status(200).json({ success: true, message: "Manual journal created successfully" });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
    }
    console.error("Error creating manual journal:", error);
    if (next) return next(errorHandler(500, error.message || "Internal Server Error"));
    return res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
  } finally {
    if (connection) connection.release();
  }
};

const createUserAccount = async (req, res, next) => {
  let connection;
  try {
    const { name, type, group, parentId, description, code, branchId, companyId, userId } = req.body;
    const resolvedUserId = userId || req.user?.id || 1;

    if (!name || !type || !group || !branchId || !companyId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

    // Check if account name already exists for this branch/company
    const [existingName] = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT COUNT(*) as count FROM accounting_accounts WHERE Account_Name = ? AND Branch_idBranch = ? AND companyId = ? AND Status = 1",
        [name, branchId, companyId],
        (err, res) => (err ? reject(err) : resolve([res]))
      );
    });

    if (existingName[0].count > 0) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
      return res.status(400).json({ success: false, message: `Account name '${name}' already exists.` });
    }

    // Determine code
    let finalCode = code;
    if (!finalCode) {
      let prefix = "1000";
      if (group === "Liabilities") prefix = "2000";
      else if (group === "Income") prefix = "3000";
      else if (group === "Expenses") prefix = "4000";
      else if (group === "Contra Accounts") prefix = "5000";
      else if (group === "Equity") prefix = "6000";

      const [maxCodeRow] = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT Account_Code FROM accounting_accounts WHERE Account_Code LIKE ? AND Branch_idBranch = ? AND companyId = ? ORDER BY Account_Code DESC LIMIT 1",
          [`${prefix}-%`, branchId, companyId],
          (err, res) => (err ? reject(err) : resolve([res]))
        );
      });

      if (maxCodeRow && maxCodeRow.length > 0) {
        const lastNum = parseInt(maxCodeRow[0].Account_Code.split("-")[1]);
        const nextNum = (lastNum + 1).toString().padStart(3, "0");
        finalCode = `${prefix}-${nextNum}`;
      } else {
        finalCode = `${prefix}-001`;
      }
    } else {
      const [existingCode] = await new Promise((resolve, reject) => {
        connection.query(
          "SELECT COUNT(*) as count FROM accounting_accounts WHERE Account_Code = ? AND Branch_idBranch = ? AND companyId = ? AND Status = 1",
          [finalCode, branchId, companyId],
          (err, res) => (err ? reject(err) : resolve([res]))
        );
      });

      if (existingCode[0].count > 0) {
        await new Promise((resolve) => connection.rollback(() => resolve()));
        return res.status(400).json({ success: false, message: `Account code '${finalCode}' already exists.` });
      }
    }

    const accountData = [
      name,
      "Chartered Account",
      type,
      group,
      branchId,
      0,
      1,
      resolvedUserId,
      finalCode,
      parentId || null,
      description || `${name} account`,
      companyId
    ];

    const newAccountId = await createAccountWithLog(accountData, connection, resolvedUserId, "Account Creation");

    await new Promise((resolve, reject) => {
      connection.commit((err) => (err ? reject(err) : resolve()));
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      accountId: newAccountId,
      code: finalCode
    });

  } catch (error) {
    if (connection) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
    }
    console.error("Error creating user chartered account:", error);
    if (next) return next(error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  } finally {
    if (connection) connection.release();
  }
};

const reconcileAccountLogs = async (req, res, next) => {
  try {
    const { logIds, reconciled, branchId } = req.body;

    if (!Array.isArray(logIds) || logIds.length === 0 || branchId === undefined) {
      return res.status(400).json({ success: false, message: "Invalid parameters. logIds array and branchId are required." });
    }

    const value = reconciled ? 1 : 0;

    await new Promise((resolve, reject) => {
      db.query(
        "UPDATE accounting_accounts_log SET Reconciled = ? WHERE idAccounting_Accounts_Log IN (?) AND branchId = ?",
        [value, logIds, branchId],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    res.status(200).json({
      success: true,
      message: "Transactions reconciled successfully"
    });
  } catch (error) {
    console.error("Error reconciling transactions:", error);
    if (next) return next(error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Synchronizes the current on-hand inventory valuation with the Inventory asset ledger account
const syncInventoryValuation = async (req, res, next) => {
  let connection;
  try {
    const { branchId, companyId } = req.body;
    const userId = req.user?.id || req.body.userId || 1;

    if (!branchId || !companyId) {
      return res.status(400).json({ success: false, message: "branchId and companyId are required" });
    }

    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => (err ? reject(err) : resolve(conn)));
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

    // 1. Calculate actual stock valuation on hand for this branch
    const [invRows] = await connection.promise().query(
      `SELECT SUM(Qty * COALESCE(NULLIF(Cost, 0), NULLIF(Real_Cost, 0), 0)) AS totalValuation,
              COUNT(*) AS itemCount
       FROM item 
       WHERE Branch_idBranch = ? AND Qty > 0`,
      [branchId]
    );

    const actualValuation = Math.round(parseFloat(invRows[0]?.totalValuation || 0) * 100) / 100;

    // 2. Find the Inventory asset account
    const {
      findInventoryAssetAccountId,
      findOpeningBalanceEquityAccountId,
      findInventoryAdjustmentAccountId
    } = require("../services/inventoryAccountingService");

    const inventoryAccId = await findInventoryAssetAccountId(companyId, branchId, connection);
    if (!inventoryAccId) {
      await connection.promise().rollback();
      return res.status(400).json({
        success: false,
        message: "Accounting module is not initialized for this branch (Inventory account not found)."
      });
    }

    // 3. Get current balance of Inventory asset account
    const [accRows] = await connection.promise().query(
      "SELECT Account_Balance FROM accounting_accounts WHERE idAccounting_Accounts = ? FOR UPDATE",
      [inventoryAccId]
    );
    const currentBalance = Math.round(parseFloat(accRows[0]?.Account_Balance || 0) * 100) / 100;
    const difference = Math.round((actualValuation - currentBalance) * 100) / 100;

    if (Math.abs(difference) < 0.01) {
      await connection.promise().rollback();
      return res.status(200).json({
        success: true,
        message: "Inventory account is already in sync with current stock valuation.",
        actualValuation,
        currentBalance,
        difference: 0
      });
    }

    if (difference > 0) {
      // Stock valuation > Ledger balance: Bring initial stock into ledger
      const equityAccId = await findOpeningBalanceEquityAccountId(companyId, branchId, userId, connection);
      if (!equityAccId) {
        throw new Error("Could not resolve Opening Balance Equity account");
      }

      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Assets",
        amount: difference,
        description: `Inventory balance alignment with on-hand stock (Valuation: ${actualValuation}, Previous Ledger: ${currentBalance})`,
        type: "Opening Stock",
        accountId: inventoryAccId,
        branchId,
        userId,
        companyId,
        transactionType: "debit",
        connection,
      });

      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Equity",
        amount: difference,
        description: `Opening balance equity alignment for on-hand inventory (Valuation: ${actualValuation})`,
        type: "Opening Stock",
        accountId: equityAccId,
        branchId,
        userId,
        companyId,
        transactionType: "credit",
        connection,
      });
    } else {
      // Stock valuation < Ledger balance: Record adjustment reduction
      const adjAmount = Math.abs(difference);
      const adjAccId = await findInventoryAdjustmentAccountId(companyId, branchId, userId, connection);
      if (!adjAccId) {
        throw new Error("Could not resolve Inventory Adjustment account");
      }

      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Expenses",
        amount: adjAmount,
        description: `Inventory reconciliation adjustment (Valuation: ${actualValuation}, Previous Ledger: ${currentBalance})`,
        type: "Stock Adjustment",
        accountId: adjAccId,
        branchId,
        userId,
        companyId,
        transactionType: "debit",
        connection,
      });

      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Assets",
        amount: adjAmount,
        description: `Inventory ledger reduction to match actual stock (Valuation: ${actualValuation})`,
        type: "Stock Adjustment",
        accountId: inventoryAccId,
        branchId,
        userId,
        companyId,
        transactionType: "credit",
        connection,
      });
    }

    await connection.promise().commit();

    return res.status(200).json({
      success: true,
      message: "Inventory account successfully synchronized with current stock valuation.",
      actualValuation,
      previousBalance: currentBalance,
      adjustedAmount: difference,
      newBalance: actualValuation
    });

  } catch (error) {
    if (connection) await connection.promise().rollback();
    console.error("Error syncing inventory valuation:", error);
    if (next) return next(error);
    return res.status(500).json({ success: false, message: error.message || "Internal Server Error" });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  errorHandler,
  amountDescreaseOrIncreaseStatusByAccountGroupType,
  calculateNewAccountBalance,
  getDebitCreditAmounts,
  creditDebitLogHelper,
  findAccountByNameAndGroup,
  ensureAccountExists,
  getAllChartAccounts,
  getChartAccountLogs,
  getAccountingSummary,
  getTrialBalance,
  getAdvancedProfitAndLoss,
  getBalanceSheet,
  initializeAccounts,
  createManualJournal,
  createUserAccount,
  reconcileAccountLogs,
  syncInventoryValuation
};
