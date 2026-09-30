const db = require("../db/db");

const insertCompanyBankAccountLog = (
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
  updated_user,
  payment_id,
  contra_account,
  reconcilation_status,
  branch_id,
  connection,
) => {
  const query = `
    INSERT INTO accounting_accounts_log
    (Accounting_Accounts_idAccounting_Accounts, Type, Description, Debit, Credit, Balance, User_idUser, branchId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const fullDescription = note && note !== '-' ? `${description} | Note: ${note}` : description;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        bank_acc_id,
        type,
        fullDescription,
        debit,
        credit,
        balance,
        user,
        branch_id,
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

const insertCompanyBankAccountUpdateLog = (
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
) => {
  const query = `
    INSERT INTO accounting_accounts_log
    (Accounting_Accounts_idAccounting_Accounts, Type, Description, Debit, Credit, Balance, User_idUser, branchId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const fullDescription = updated_note ? `${description} | ${updated_note}` : description;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        bank_acc_id,
        type,
        fullDescription,
        debit,
        credit,
        balance,
        user || updated_user, // use updated_user if user is not available
        branch_id,
      ],
      (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      },
    );
  });
};

const getCompanyBankAccountLogs = (bank_acc_id, branch_id, fromDate = null, toDate = null) => {
  let query = `
    SELECT 
      l.idAccounting_Accounts_Log AS idbank_log,
      l.Accounting_Accounts_idAccounting_Accounts AS bank_acc_id,
      l.Date_Time AS date_time,
      l.Type AS type,
      l.Description AS description,
      l.Debit AS debit,
      l.Credit AS credit,
      l.Balance AS balance,
      l.User_idUser AS user,
      u.First_Name, 
      u.Last_Name AS lastName
    FROM accounting_accounts_log l
    LEFT JOIN user u ON l.User_idUser = u.idUser
    WHERE l.Accounting_Accounts_idAccounting_Accounts = ? AND l.branchId = ?
  `;
  const params = [bank_acc_id, branch_id];
  if (fromDate && toDate) {
    query += ` AND DATE(l.Date_Time) BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  }
  query += ` ORDER BY l.idAccounting_Accounts_Log DESC`;

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

module.exports = {
  insertCompanyBankAccountLog,
  insertCompanyBankAccountUpdateLog,
  getCompanyBankAccountLogs,
};

