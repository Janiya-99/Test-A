const db = require("../db/db");


const insertExpenses = (branch_id, date, reason, amount) => {
  const query =
    "INSERT INTO expences (branch_id, date, reason, amount) VALUES (?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(query, [branch_id, date, reason, amount], (err, results) => {

      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchExpenses = (branch_id) => {
  const query = "SELECT * FROM expences WHERE branch_id = ? ORDER BY date";
  return new Promise((resolve, reject) => {
    db.query(query, [branch_id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteExpenses = (expences_id) => {
  const query = "DELETE FROM expences WHERE idexpences=?";
  return db.query(query, [expences_id]);
};

const fetchExpensesbyDate = (date) => {
  const query = "SELECT * FROM expences WHERE date=?";
  return new Promise((resolve, reject) => {
    db.query(query, [date], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  insertExpenses,
  fetchExpenses,
  deleteExpenses,
  fetchExpensesbyDate,
};
