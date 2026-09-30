const db = require("../db/db");

const getQuotationNumberDetails = (Branch_idBranch) => {
  const query =
    "SELECT Quotations_No_Start_With, Quotations_No_Start_From FROM rules WHERE Branch_idBranch = ?";
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

const getInvoiceNumberDetails = (Branch_idBranch) => {
  const query =
    "SELECT Invoice_No_Start_With, Invoice_No_Strat_From, salesman_enabled, salesman_invoice_update, advanced_invoice_number FROM rules WHERE Branch_idBranch = ?";
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

const getPurchaseOrderNumberDetails = (Branch_idBranch) => {
  const query =
    "SELECT PO_No_Start_With, PO_No_Start_From FROM rules WHERE Branch_idBranch = ?";
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

const getManufacturingNumberDetails = (Branch_idBranch) => {
  const query =
    "SELECT Manufacture_No_Start_With, Manufacture_No_Start_From FROM rules WHERE Branch_idBranch = ?";
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

const updateManufacturingNumberDetails = (Branch_idBranch, prefix, startFrom) => {
  const query =
    "UPDATE rules SET Manufacture_No_Start_With = ?, Manufacture_No_Start_From = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [prefix, startFrom, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

module.exports = {
  getQuotationNumberDetails,
  getInvoiceNumberDetails,
  getPurchaseOrderNumberDetails,
  getManufacturingNumberDetails,
  updateManufacturingNumberDetails,
};
