const db = require("../db/db");
const { resolveDateTime } = require("../utils/currentData");

const insertCustomerCreditLog = (
  Customer_idCustomer,
  Type,
  Type_Id,
  Credit,
  Debit,
  Total_Credit_Balance,
  Payment_Type,
  Payment_Method,
  Cheque_Type = null,
  Cheque_No = null,
  Cheque_Date = null,
  Cheque_Name = null,
  Cheque_Status = 0,
  Branch_idBranch,
  Card_Type = null,
  Card_Number = null,
  Transaction_Id = null,
  Receipt = null,
  Bank_Name = null,
  Bank_No = null,
  Note = null,
  receipt_number = null,
  connection,
  Date_Time = null,
  Bank_Account_Id = null,
) => {
  const formattedDate = resolveDateTime(Date_Time);

  const query = `
    INSERT INTO customer_credit_log (
      Customer_idCustomer,
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
      Cheque_Status,
      Branch_idBranch,
      Card_Type,
      Card_Number,
      Transaction_Id,
      Receipt,
      Bank_Name,
      Bank_No,
      Note,
      receipt_number,
      Bank_Account_Id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    Customer_idCustomer,
    formattedDate,
    Type,
    Type_Id,
    parseFloat(Credit) || 0,
    parseFloat(Debit) || 0,
    parseFloat(Total_Credit_Balance) || 0,
    Payment_Type,
    Payment_Method,
    Cheque_Type,
    Cheque_No,
    Cheque_Date
      ? (typeof Cheque_Date === "string" ? Cheque_Date.split("T")[0].split(" ")[0] : new Date(Cheque_Date).toISOString().slice(0, 10))
      : null,
    Cheque_Name,
    Cheque_Status,
    Branch_idBranch,
    Card_Type,
    Card_Number,
    Transaction_Id,
    Receipt,
    Bank_Name,
    Bank_No,
    Note,
    receipt_number,
    Bank_Account_Id,
  ];

  console.log("Executing customer credit log insert with values:", {
    Customer_idCustomer,
    Date_Time: formattedDate,
    Type,
    Type_Id,
    Credit: parseFloat(Credit) || 0,
    Debit: parseFloat(Debit) || 0,
    Total_Credit_Balance: parseFloat(Total_Credit_Balance) || 0,
    Payment_Type,
    Payment_Method,
    Cheque_Type,
    Cheque_No,
    Cheque_Date: Cheque_Date
      ? new Date(Cheque_Date).toISOString().slice(0, 19).replace("T", " ")
      : null,
    Cheque_Name,
    Cheque_Status,
    Branch_idBranch,
    Card_Type,
    Card_Number,
    Transaction_Id,
    Receipt: Receipt ? `[Binary data, ${Receipt.length} bytes]` : null,
    Bank_Name,
    Bank_No,
    Note,
    receipt_number,
  });

  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) {
        console.error("Error executing customer credit log insert:", {
          error: err,
          sql: query,
          values: values.map((v) =>
            v instanceof Buffer ? "[binary data]" : v,
          ),
        });
        reject(err);
      } else {
        console.log("Customer credit log inserted successfully:", {
          insertId: results.insertId,
          affectedRows: results.affectedRows,
        });
        resolve(results);
      }
    });
  });
};

const updateCustomerLog = (
  idCustomer_Credit_Log,
  Credit,
  Debit,
  Total_Credit_Balance,
  connection,
) => {
  const query =
    "UPDATE customer_credit_log SET Credit = ?, Debit = ?, Total_Credit_Balance = ? WHERE idCustomer_Credit_Log = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Credit, Debit, Total_Credit_Balance, idCustomer_Credit_Log],
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

const getCustomerLogByTypeId = (Type, Type_Id, connection) => {
  const query = "SELECT * FROM customer_credit_log WHERE Type=? AND Type_Id=?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Type, Type_Id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchLastLog = (Customer_idCustomer, connection) => {
  const query =
    "SELECT * FROM customer_credit_log WHERE Customer_idCustomer = ? ORDER BY idCustomer_Credit_Log DESC LIMIT 1";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Customer_idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchLogs = (Customer_idCustomer) => {
  const query =
    "SELECT * FROM customer_credit_log WHERE Customer_idCustomer = ? ORDER BY idCustomer_Credit_Log ASC";
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchLogsByInvoiceId = (idInvoice, connection) => {
  const query = "SELECT * FROM customer_credit_log WHERE Type_Id = ? AND Type = 'PAYMENT' ORDER BY idCustomer_Credit_Log DESC";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteCustomerLogById = (idCustomer_Credit_Log, connection) => {
  const query = "DELETE FROM customer_credit_log WHERE idCustomer_Credit_Log = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idCustomer_Credit_Log], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchpastpayment = (Branch_idBranch) => {
  const query = `
    SELECT 
      ccl.*, 
      ccl.Payment_Method AS Method,
      ccl.Card_Number AS CardNo,
      ccl.Transaction_Id AS TransactionId,
      inv.*
    FROM 
      customer_credit_log ccl
    LEFT JOIN 
      invoice inv
    ON 
      ccl.Type_Id = inv.idInvoice AND ccl.Branch_idBranch = inv.Branch_idBranch
    WHERE 
      ccl.Branch_idBranch = ? 
      AND ccl.Type = 'PAYMENT'
  `;
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

const recalculateCustomerCreditLogs = async (customerId, connection) => {
  const query = "SELECT * FROM customer_credit_log WHERE Customer_idCustomer = ? ORDER BY idCustomer_Credit_Log ASC";
  const logs = await new Promise((resolve, reject) => {
    (connection || db).query(query, [customerId], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });

  let runningBalance = 0;
  for (const log of logs) {
    runningBalance += (parseFloat(log.Credit) || 0) - (parseFloat(log.Debit) || 0);
    
    if (Math.abs((parseFloat(log.Total_Credit_Balance) || 0) - runningBalance) > 0.005) {
      const updateQuery = "UPDATE customer_credit_log SET Total_Credit_Balance = ? WHERE idCustomer_Credit_Log = ?";
      await new Promise((resolve, reject) => {
        (connection || db).query(updateQuery, [runningBalance.toFixed(2), log.idCustomer_Credit_Log], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
};

module.exports = {
  insertCustomerCreditLog,
  fetchLastLog,
  fetchLogs,
  getCustomerLogByTypeId,
  updateCustomerLog,
  fetchpastpayment,
  fetchLogsByInvoiceId,
  deleteCustomerLogById,
  recalculateCustomerCreditLogs,
};

