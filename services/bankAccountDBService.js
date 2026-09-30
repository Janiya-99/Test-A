const db = require("../db/db");

const insertCompanyBankAccount = (
  bank_type,
  bank_name,
  account_name,
  account_no,
  bank_branch,
  account_balance,
  code,
  type,
  cashflow,
  acc_type_group,
  description,
  user,
  status,
  primary_account,
  tracking_no,
  branch_id,
  parent_account_id,
  companyId
) => {
  const query = `
    INSERT INTO accounting_accounts 
    (Account_Type, Account_Name, Account_Number, Account_Balance, Account_Code, Type, Group_Of_Type, Description, User_idUser, Status, Parent_Account, Branch_idBranch, companyId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const descJson = JSON.stringify({
    bank_name: bank_name || '',
    bank_branch: bank_branch || '',
    note: description || ''
  });

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        bank_type || 'Bank Account', // Account_Type
        account_name, // Account_Name
        account_no, // Account_Number
        account_balance, // Account_Balance
        code, // Account_Code
        type || 'Assets', // Type
        acc_type_group || 'Assets', // Group_Of_Type
        descJson, // Description
        user, // User_idUser
        status, // Status
        parent_account_id, // Parent_Account
        branch_id, // Branch_idBranch
        companyId, // companyId
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      },
    );
  });
};

const parseAccountDescription = (account) => {
  try {
    if (!account.description) throw new Error("No description");
    const desc = JSON.parse(account.description);
    return {
      ...account,
      bank_name: desc.bank_name || '',
      bank_branch: desc.bank_branch || '',
      description: desc.note || ''
    };
  } catch (e) {
    // If not JSON (legacy or fallback)
    return {
      ...account,
      bank_name: account.description || '',
      bank_branch: ''
    };
  }
};

const getAllCompanyBankAccounts = (branchId, parentAccountId) => {
  let query = `
    SELECT 
      cba.idAccounting_Accounts AS idbank,
      cba.Account_Type AS bank_type,
      cba.Account_Name AS account_name,
      cba.Account_Number AS account_no,
      cba.Account_Balance AS account_balance,
      cba.Status AS status,
      cba.Branch_idBranch AS branch_id,
      cba.Description AS description,
      u.First_Name AS created_by
    FROM accounting_accounts cba
    LEFT JOIN user u ON cba.User_idUser = u.idUser
    WHERE cba.Branch_idBranch = ? AND cba.Parent_Account = ? AND cba.Status = 1
  `;

  const values = [branchId, parentAccountId];

  return new Promise((resolve, reject) => {
    db.query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        const parsed = JSON.parse(JSON.stringify(results)).map(parseAccountDescription);
        resolve(parsed);
      }
    });
  });
};

const getAccountById = (accountId, branch_id) => {
  const query = `
    SELECT 
      cba.idAccounting_Accounts AS idbank,
      cba.Account_Type AS bank_type,
      cba.Account_Name AS account_name,
      cba.Account_Number AS account_no,
      cba.Account_Balance AS account_balance,
      cba.Status AS status,
      cba.Branch_idBranch AS branch_id,
      cba.User_idUser AS user,
      cba.Description AS description
    FROM accounting_accounts cba
    WHERE cba.idAccounting_Accounts = ? AND cba.Branch_idBranch = ?
  `;

  const values = [accountId, branch_id];

  return new Promise((resolve, reject) => {
    db.query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        const parsed = JSON.parse(JSON.stringify(results)).map(parseAccountDescription);
        resolve(parsed);
      }
    });
  });
};

const deleteBankAccount = (accountId, branch_id) => {
  const query = `
    UPDATE accounting_accounts SET Status = 0 WHERE idAccounting_Accounts = ? AND Branch_idBranch = ?
  `;
  const values = [accountId, branch_id];

  return new Promise((resolve, reject) => {
    db.query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateCompanyBankAccount = (
  idbank,
  bank_type,
  bank_name,
  account_name,
  account_no,
  bank_branch,
  branch_id,
) => {
  const descJson = JSON.stringify({
    bank_name: bank_name || '',
    bank_branch: bank_branch || '',
    note: ''
  });
  const query = `
    UPDATE accounting_accounts 
    SET 
      Account_Name = ?, 
      Account_Number = ?, 
      Description = ?,
      Account_Type = ?
    WHERE idAccounting_Accounts = ? AND Branch_idBranch = ?
  `;

  const values = [
    account_name,
    account_no,
    descJson,
    bank_type || 'Bank Account',
    idbank,
    branch_id,
  ];

  return new Promise((resolve, reject) => {
    db.query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateCompanyBankAccountBalance = (
  accountId,
  newBalance,
  branch_id,
  connection,
) => {
  const query = `
    UPDATE accounting_accounts 
    SET Account_Balance = ? 
    WHERE idAccounting_Accounts = ? AND Branch_idBranch = ?
  `;
  const values = [newBalance, accountId, branch_id];
  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getMainBankAccountByBranch = (branchId) => {
  const query = `
    SELECT idAccounting_Accounts 
    FROM accounting_accounts 
    WHERE Account_Code = '1000-002' AND Branch_idBranch = ?
    LIMIT 1
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branchId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length > 0 ? results[0].idAccounting_Accounts : null);
      }
    });
  });
};

module.exports = {
  insertCompanyBankAccount,
  getAllCompanyBankAccounts,
  getAccountById,
  deleteBankAccount,
  updateCompanyBankAccount,
  updateCompanyBankAccountBalance,
  getMainBankAccountByBranch
};

