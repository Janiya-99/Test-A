const db = require("../db/db");

const insertSupplierCreditLog = (
  Supplier_idSupplier,
  Type,
  Type_Id,
  Credit,
  Debit,
  Total_Credit_Balance,
  Payment_Type,
  Payment_Method,
  Cheque_Type,
  Cheque_No,
  Cheque_Date,
  Cheque_Name,
  Branch_idBranch,
  connection,
  Note,
  Discount_Amount = 0,
  Bank_Account_Id = null,
  customDateTime = null,
) => {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
  const day = currentDate.getDate().toString().padStart(2, "0");
  const hours = currentDate.getHours().toString().padStart(2, "0");
  const minutes = currentDate.getMinutes().toString().padStart(2, "0");
  const seconds = currentDate.getSeconds().toString().padStart(2, "0");

  const Date_Time = customDateTime || `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  const query =
    "INSERT INTO supplier_log (Supplier_idSupplier, Date_Time, Type, Type_Id, Credit, Debit, Total_Credit_Balance, Payment_Type, Payment_Method, Cheque_Type, Cheque_No, Cheque_Date, Cheque_Name, Branch_idBranch, Discount_Amount, Note, Bank_Account_Id ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Supplier_idSupplier,
        Date_Time,
        Type,
        Type_Id,
        Credit,
        Debit,
        Total_Credit_Balance,
        Payment_Type,
        Payment_Method,
        Cheque_Type,
        Cheque_No,
        Cheque_Date,
        Cheque_Name,
        Branch_idBranch,
        Discount_Amount,
        Note,
        Bank_Account_Id,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const fetchLastLog = (Supplier_idSupplier) => {
  const query =
    "SELECT * FROM supplier_log WHERE Supplier_idSupplier = ? ORDER BY idSupplier_Log DESC LIMIT 1";
  return new Promise((resolve, reject) => {
    db.query(query, [Supplier_idSupplier], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchLogs = (Supplier_idSupplier) => {
  const query =
    "SELECT * FROM supplier_log WHERE Supplier_idSupplier = ?  ORDER BY Date_Time DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Supplier_idSupplier], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchLogsByGrnId = (idGRN, connection) => {
  const query =
    "SELECT * FROM supplier_log WHERE Type_Id = ? AND Type = 'PAYMENT' ORDER BY idSupplier_Log DESC";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idGRN], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteSupplierLogById = (idSupplier_Log, connection) => {
  const query = "DELETE FROM supplier_log WHERE idSupplier_Log = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idSupplier_Log], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const recalculateSupplierCreditLogs = async (supplierId, connection) => {
  const query = "SELECT * FROM supplier_log WHERE Supplier_idSupplier = ? ORDER BY idSupplier_Log ASC";
  const logs = await new Promise((resolve, reject) => {
    (connection || db).query(query, [supplierId], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });

  let runningBalance = 0;
  for (const log of logs) {
    runningBalance += (parseFloat(log.Credit) || 0) - (parseFloat(log.Debit) || 0) - (parseFloat(log.Discount_Amount) || 0);

    if (Math.abs((parseFloat(log.Total_Credit_Balance) || 0) - runningBalance) > 0.005) {
      const updateQuery = "UPDATE supplier_log SET Total_Credit_Balance = ? WHERE idSupplier_Log = ?";
      await new Promise((resolve, reject) => {
        (connection || db).query(updateQuery, [runningBalance.toFixed(2), log.idSupplier_Log], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
};

module.exports = {
  insertSupplierCreditLog,
  fetchLastLog,
  fetchLogs,
  fetchLogsByGrnId,
  deleteSupplierLogById,
  recalculateSupplierCreditLogs,
};
