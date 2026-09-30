const db = require("../db/db");

const insertEmployee = (
  Employee_Name,
  Employee_NIC,
  Employee_Number,
  ETF_No,
  Contact_No,
  Branch_idBranch,
  Type = "salesman",
  connection,
) => {
  if (Type && typeof Type === "object" && typeof Type.query === "function") {
    connection = Type;
    Type = "salesman";
  }
  const query = `INSERT INTO employee 
    (Employee_Name, Employee_NIC, Employee_Number, ETF_No, Contact_No, Status, Branch_idBranch, Type) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Employee_Name,
        Employee_NIC,
        Employee_Number,
        ETF_No,
        Contact_No,
        1,
        Branch_idBranch,
        Type,
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

const updateEmployee = (
  idEmployee,
  Employee_Name,
  Employee_NIC,
  Employee_Number,
  ETF_No,
  Contact_No,
  Type = "salesman",
) => {
  const query = `
    UPDATE employee 
    SET 
    Employee_Name=?, 
    Employee_NIC=?, 
    Employee_Number=?, 
    ETF_No=?, 
    Contact_No=?,
    Type=?
    WHERE 
    idEmployee=?
  `;

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Employee_Name,
        Employee_NIC,
        Employee_Number,
        ETF_No,
        Contact_No,
        Type,
        idEmployee,
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

const fetchEmployees = (Branch_idBranch, type) => {
  let query = `SELECT * FROM employee WHERE Branch_idBranch = ?`;
  const params = [Branch_idBranch];
  if (type) {
    query += ` AND Type = ?`;
    params.push(type);
  }
  query += ` ORDER BY idEmployee ASC`;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateStatus = (idEmployee) => {
  const query =
    "UPDATE employee SET Status = CASE WHEN Status = 1 THEN 0 ELSE 1 END WHERE idEmployee = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idEmployee], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const checkInvoiceAvailability = (Branch_idBranch, idEmployee) => {
  const query = `SELECT * FROM invoice WHERE Branch_idBranch = ? AND Employee_idEmployee =?`;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, idEmployee], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchEmployeeById = (idEmployee) => {
  const query = `SELECT * FROM employee WHERE idEmployee = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [idEmployee], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  insertEmployee,
  fetchEmployees,
  updateEmployee,
  updateStatus,
  checkInvoiceAvailability,
  fetchEmployeeById,
};
