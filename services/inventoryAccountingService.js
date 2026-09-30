const db = require("../db/db");
const db2 = require("../db/db2");
const branchDBService = require("./branchDBService");
const {
  findAccountByNameAndGroup,
  ensureAccountExists,
  creditDebitLogHelper,
} = require("../controllers/accountingController");

/**
 * Resolves companyId for a branch using multiple resilient fallback sources.
 */
const resolveCompanyId = async (branchId, connection) => {
  if (!branchId) return null;
  const conn = connection || db;
  try {
    // 1. Try branchDBService cache / helper
    let companyId = await branchDBService.getCompanyIdByBranch(branchId);
    if (companyId) return companyId;

    // 2. Try accounting_accounts table for this branch (guaranteed match if accounting is initialized)
    const [accRows] = await new Promise((resolve) => {
      conn.query(
        "SELECT companyId FROM accounting_accounts WHERE Branch_idBranch = ? AND companyId IS NOT NULL AND companyId > 0 LIMIT 1",
        [branchId],
        (err, res) => resolve([res || []]),
      );
    });
    companyId = accRows?.[0]?.companyId;
    if (companyId) return companyId;

    // 3. Try product_history_log
    const [phRows] = await new Promise((resolve) => {
      conn.query(
        "SELECT Company_idCompany FROM product_history_log WHERE Branch_idBranch = ? AND Company_idCompany IS NOT NULL AND Company_idCompany > 0 ORDER BY idProduct_History_Log DESC LIMIT 1",
        [branchId],
        (err, res) => resolve([res || []]),
      );
    });
    companyId = phRows?.[0]?.Company_idCompany;
    if (companyId) return companyId;

    // 4. Try querying branch table in db2 (asipbook_account_center)
    const [bRows] = await new Promise((resolve) => {
      db2.query(
        "SELECT Company_idCompany FROM branch WHERE idBranch = ? LIMIT 1",
        [branchId],
        (err, res) => resolve([res || []]),
      );
    });
    companyId = bRows?.[0]?.Company_idCompany;
    return companyId || null;
  } catch (err) {
    console.error("[inventoryAccountingService] Error resolving companyId:", err);
    return null;
  }
};

/**
 * Resolves the Inventory asset account for a company/branch.
 * Checks for "Inventory" or common synonyms, code "1000-004", and lenient company/branch matching.
 */
const findInventoryAssetAccountId = async (companyId, branchId, connection) => {
  const conn = connection || db;

  // 1. Standard name "Inventory" with group "Assets"
  let accId = await findAccountByNameAndGroup("Inventory", "Assets", companyId, branchId, connection);
  if (accId) return accId;

  // 2. Synonyms
  const synonyms = ["Inventory Asset", "Stock in Hand", "Stock", "Merchandise Inventory"];
  for (const name of synonyms) {
    accId = await findAccountByNameAndGroup(name, "Assets", companyId, branchId, connection);
    if (accId) return accId;
  }

  // 3. By standard Chart of Accounts code "1000-004"
  const [codeRows] = await new Promise((resolve) => {
    conn.query(
      "SELECT idAccounting_Accounts FROM accounting_accounts WHERE Account_Code = '1000-004' AND Branch_idBranch = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) AND Status = 1 LIMIT 1",
      [branchId, companyId],
      (err, res) => resolve([res || []]),
    );
  });
  if (codeRows?.[0]?.idAccounting_Accounts) {
    return codeRows[0].idAccounting_Accounts;
  }

  // 4. Fallback search allowing partial match or null companyId
  const [anyRows] = await new Promise((resolve) => {
    conn.query(
      `SELECT idAccounting_Accounts FROM accounting_accounts 
       WHERE (Account_Name IN ('Inventory', 'Inventory Asset', 'Stock in Hand', 'Stock', 'Merchandise Inventory') OR Account_Code = '1000-004') 
         AND Group_Of_Type = 'Assets' 
         AND (Branch_idBranch = ? OR Branch_idBranch IS NULL OR Branch_idBranch = 0) 
         AND (companyId = ? OR companyId IS NULL OR companyId = 0) 
         AND Status = 1 
       ORDER BY Branch_idBranch DESC LIMIT 1`,
      [branchId, companyId],
      (err, res) => resolve([res || []]),
    );
  });
  if (anyRows?.[0]?.idAccounting_Accounts) {
    return anyRows[0].idAccounting_Accounts;
  }

  return null;
};

/**
 * Resolves or creates Opening Balance Equity account.
 */
const findOpeningBalanceEquityAccountId = async (companyId, branchId, userId, connection) => {
  const conn = connection || db;

  let equityAccId = await findAccountByNameAndGroup(
    "Opening Balance Equity",
    "Equity",
    companyId,
    branchId,
    connection,
  );
  if (equityAccId) return equityAccId;

  // By standard code 6000-001
  const [codeRows] = await new Promise((resolve) => {
    conn.query(
      "SELECT idAccounting_Accounts FROM accounting_accounts WHERE Account_Code = '6000-001' AND Branch_idBranch = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) AND Status = 1 LIMIT 1",
      [branchId, companyId],
      (err, res) => resolve([res || []]),
    );
  });
  if (codeRows?.[0]?.idAccounting_Accounts) {
    return codeRows[0].idAccounting_Accounts;
  }

  // Ensure Opening Balance Equity account exists
  equityAccId = await ensureAccountExists(
    "Opening Balance Equity",
    "Equity",
    "Equity",
    "6000-001",
    "Opening Balance Equity account",
    companyId,
    branchId,
    userId || 1,
    connection,
  );

  return equityAccId || null;
};

/**
 * Resolves or creates Inventory Adjustment account (Expenses).
 */
const findInventoryAdjustmentAccountId = async (companyId, branchId, userId, connection) => {
  const conn = connection || db;

  let adjAccId = await findAccountByNameAndGroup(
    "Inventory Adjustment",
    "Expenses",
    companyId,
    branchId,
    connection,
  );
  if (adjAccId) return adjAccId;

  adjAccId = await findAccountByNameAndGroup(
    "Stock Adjustment",
    "Expenses",
    companyId,
    branchId,
    connection,
  );
  if (adjAccId) return adjAccId;

  // By standard code 4000-005
  const [codeRows] = await new Promise((resolve) => {
    conn.query(
      "SELECT idAccounting_Accounts FROM accounting_accounts WHERE Account_Code = '4000-005' AND Branch_idBranch = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) AND Status = 1 LIMIT 1",
      [branchId, companyId],
      (err, res) => resolve([res || []]),
    );
  });
  if (codeRows?.[0]?.idAccounting_Accounts) {
    return codeRows[0].idAccounting_Accounts;
  }

  // Ensure Inventory Adjustment account exists under Expenses
  adjAccId = await ensureAccountExists(
    "Inventory Adjustment",
    "Expenses",
    "Expenses",
    "4000-005",
    "Inventory Adjustment / Stock Variance account",
    companyId,
    branchId,
    userId || 1,
    connection,
  );

  return adjAccId || null;
};

/**
 * Posts standard double entry for Opening Inventory:
 *   Debit:  Inventory (Assets)
 *   Credit: Opening Balance Equity (Equity)
 */
const postOpeningStockAccounting = async ({
  productId,
  productName,
  quantity,
  unitCost,
  branchId,
  companyId: providedCompanyId,
  userId = 1,
  connection,
}) => {
  try {
    const qty = parseFloat(quantity) || 0;
    let cost = parseFloat(unitCost) || 0;

    // Fallback: If unitCost not supplied, query Cost or Real_Cost from database
    if (cost <= 0 && productId) {
      const conn = connection || db;
      const [prodRows] = await new Promise((resolve) => {
        conn.query(
          "SELECT Cost, Real_Cost FROM item WHERE idItem = ? LIMIT 1",
          [productId],
          (err, res) => resolve([res || []]),
        );
      });
      if (prodRows?.[0]) {
        cost = parseFloat(prodRows[0].Cost || prodRows[0].Real_Cost || 0);
      }
    }

    if (qty <= 0 || cost <= 0) return false;

    const amount = Math.round(qty * cost * 100) / 100;
    if (amount <= 0) return false;

    const companyId =
      providedCompanyId || (await resolveCompanyId(branchId, connection));
    if (!companyId || !branchId) return false;

    // Check if Accounting module is initialized (Inventory asset account must exist)
    const inventoryAccId = await findInventoryAssetAccountId(
      companyId,
      branchId,
      connection,
    );

    if (!inventoryAccId) {
      // Accounting module is not initialized for this company/branch; skip gracefully
      return false;
    }

    // Ensure Opening Balance Equity account exists
    const equityAccId = await findOpeningBalanceEquityAccountId(
      companyId,
      branchId,
      userId,
      connection,
    );

    if (!equityAccId) {
      console.warn(
        "[inventoryAccountingService] Could not resolve Opening Balance Equity account",
      );
      return false;
    }

    const desc = `Opening stock for ${productName || `Product #${productId}`} (Qty: ${qty} @ ${cost})`;

    // 1. Debit Inventory (Asset increases)
    await creditDebitLogHelper({
      accountType: "Chartered Account",
      group: "Assets",
      amount,
      description: desc,
      type: "Opening Stock",
      accountId: inventoryAccId,
      branchId,
      userId: userId || 1,
      companyId,
      transactionType: "debit",
      connection,
    });

    // 2. Credit Opening Balance Equity (Equity increases)
    await creditDebitLogHelper({
      accountType: "Chartered Account",
      group: "Equity",
      amount,
      description: `Opening stock equity for ${productName || `Product #${productId}`} (Qty: ${qty} @ ${cost})`,
      type: "Opening Stock",
      accountId: equityAccId,
      branchId,
      userId: userId || 1,
      companyId,
      transactionType: "credit",
      connection,
    });

    return true;
  } catch (err) {
    console.error(
      "[inventoryAccountingService] Error in postOpeningStockAccounting:",
      err,
    );
    return false;
  }
};

/**
 * Posts standard double entry for Inventory Adjustments (write-ups and write-downs):
 * Increase (Surplus):
 *   Debit:  Inventory (Assets)
 *   Credit: Inventory Adjustment (Expenses)
 * Decrease (Shrinkage / Damage / Shortage):
 *   Debit:  Inventory Adjustment (Expenses)
 *   Credit: Inventory (Assets)
 */
const postStockAdjustmentAccounting = async ({
  productId,
  productName,
  deltaQty,
  unitCost,
  branchId,
  companyId: providedCompanyId,
  userId = 1,
  reference,
  notes,
  connection,
}) => {
  try {
    const delta = parseFloat(deltaQty) || 0;
    let cost = parseFloat(unitCost) || 0;

    // Fallback: If unitCost not supplied, query Cost or Real_Cost from database
    if (cost <= 0 && productId) {
      const conn = connection || db;
      const [prodRows] = await new Promise((resolve) => {
        conn.query(
          "SELECT Cost, Real_Cost FROM item WHERE idItem = ? LIMIT 1",
          [productId],
          (err, res) => resolve([res || []]),
        );
      });
      if (prodRows?.[0]) {
        cost = parseFloat(prodRows[0].Cost || prodRows[0].Real_Cost || 0);
      }
    }

    if (delta === 0 || cost <= 0) return false;

    const amount = Math.round(Math.abs(delta) * cost * 100) / 100;
    if (amount <= 0) return false;

    const companyId =
      providedCompanyId || (await resolveCompanyId(branchId, connection));
    if (!companyId || !branchId) return false;

    // Check if Accounting module is initialized (Inventory asset account must exist)
    const inventoryAccId = await findInventoryAssetAccountId(
      companyId,
      branchId,
      connection,
    );

    if (!inventoryAccId) {
      return false;
    }

    // Ensure Inventory Adjustment account exists (under Expenses)
    const adjAccId = await findInventoryAdjustmentAccountId(
      companyId,
      branchId,
      userId,
      connection,
    );

    if (!adjAccId) {
      console.warn(
        "[inventoryAccountingService] Could not resolve Inventory Adjustment account",
      );
      return false;
    }

    const refText = reference ? ` (Ref: ${reference})` : "";
    const noteText = notes ? ` - ${notes}` : "";

    if (delta > 0) {
      // Stock Increased (Surplus / Recovery)
      // Debit: Inventory (Asset increases)
      // Credit: Inventory Adjustment (Expense decreases / gain)
      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Assets",
        amount,
        description: `Stock adjustment surplus for ${productName || `Product #${productId}`}: +${delta} @ ${cost}${refText}${noteText}`,
        type: "Stock Adjustment",
        accountId: inventoryAccId,
        branchId,
        userId: userId || 1,
        companyId,
        transactionType: "debit",
        connection,
      });

      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Expenses",
        amount,
        description: `Stock adjustment gain for ${productName || `Product #${productId}`}: +${delta} @ ${cost}${refText}${noteText}`,
        type: "Stock Adjustment",
        accountId: adjAccId,
        branchId,
        userId: userId || 1,
        companyId,
        transactionType: "credit",
        connection,
      });
    } else {
      // Stock Decreased (Shrinkage / Damage / Physical Shortage)
      // Debit: Inventory Adjustment (Expense increases / loss)
      // Credit: Inventory (Asset decreases)
      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Expenses",
        amount,
        description: `Stock adjustment shrinkage/loss for ${productName || `Product #${productId}`}: -${Math.abs(delta)} @ ${cost}${refText}${noteText}`,
        type: "Stock Adjustment",
        accountId: adjAccId,
        branchId,
        userId: userId || 1,
        companyId,
        transactionType: "debit",
        connection,
      });

      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Assets",
        amount,
        description: `Inventory reduction for ${productName || `Product #${productId}`}: -${Math.abs(delta)} @ ${cost}${refText}${noteText}`,
        type: "Stock Adjustment",
        accountId: inventoryAccId,
        branchId,
        userId: userId || 1,
        companyId,
        transactionType: "credit",
        connection,
      });
    }

    return true;
  } catch (err) {
    console.error(
      "[inventoryAccountingService] Error in postStockAdjustmentAccounting:",
      err,
    );
    return false;
  }
};

module.exports = {
  postOpeningStockAccounting,
  postStockAdjustmentAccounting,
  resolveCompanyId,
  findInventoryAssetAccountId,
  findOpeningBalanceEquityAccountId,
  findInventoryAdjustmentAccountId,
};
