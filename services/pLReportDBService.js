const db = require("../db/db");

const fetchInvoices = (from, to, Branch_idBranch, routeId = null) => {
  let query =
    "SELECT i.*, c.Title, c.displayName, r.Route_Name, r.Route_Code FROM invoice i INNER JOIN customer c ON i.Customer_idCustomer = c.idCustomer LEFT JOIN distribution_route r ON i.Route_idRoute = r.idRoute WHERE i.Date BETWEEN ? AND ? AND i.Branch_idBranch = ?";
  const params = [from, to, Branch_idBranch];
  if (routeId) {
    query += " AND i.Route_idRoute = ?";
    params.push(routeId);
  }
  query += " ORDER BY idInvoice DESC";

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

const fetchInvoiceItems = (idInvoice) => {
  const query =
    "SELECT ihi.*, COALESCE(i.Description, ihi.Description) as Item_Name, ihimd.supplier_name AS manual_supplier_name, ihimd.cost AS manual_cost FROM invoice_has_item ihi LEFT JOIN item i ON ihi.Item_idItem = i.idItem LEFT JOIN invoice_has_item_manual_details ihimd ON ihi.ID = ihimd.invoice_has_item_id WHERE ihi.Invoice_idInvoice = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchExpenses = (from, to, Branch_idBranch) => {
  const query =
    "SELECT w.*, wc.Description FROM wallet w INNER JOIN wallet_category wc ON w.Wallet_Category_idWallet_Category = wc.idWallet_Category WHERE w.Date BETWEEN ? AND ? AND w.Type = ? AND Status = 1 AND w.Branch_idBranch = ? ORDER BY w.idWallet DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, 2, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchDamages = (from, to, Branch_idBranch) => {
  const query =
    "SELECT * FROM damage_note WHERE Date BETWEEN ? AND ? AND Branch_idBranch = ? AND (Reason NOT LIKE 'Supplier Return%' OR Reason IS NULL) ORDER BY idDamage_Note DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchDamageItems = (Damage_Note_idDamage_Note) => {
  const query =
    "SELECT * FROM damage_note_has_item WHERE Damage_Note_idDamage_Note = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Damage_Note_idDamage_Note], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoiceTotal = (from, to, Branch_idBranch, routeId = null) => {
  let query =
    "SELECT SUM(ii.Total_Amount) AS Total FROM invoice i INNER JOIN invoice_has_item ii ON i.idInvoice = ii.Invoice_idInvoice WHERE i.Date BETWEEN ? AND ? AND i.Branch_idBranch = ?";
  const params = [from, to, Branch_idBranch];
  if (routeId) {
    query += " AND i.Route_idRoute = ?";
    params.push(routeId);
  }

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

const fetchExpensesTotal = (from, to, Branch_idBranch) => {
  const query =
    "SELECT SUM(Amount) AS Total FROM wallet WHERE Date BETWEEN (?) AND (?) AND Type = (?) AND Status = 1 AND Branch_idBranch = (?)";
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, 2, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchDamageTotal = (from, to, Branch_idBranch) => {
  const query =
    "SELECT COALESCE(SUM(Total_Amount), 0) AS Total FROM damage_note WHERE Date BETWEEN (?) AND (?) AND Branch_idBranch = (?) AND (Reason NOT LIKE 'Supplier Return%' OR Reason IS NULL)";
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchPurchaseReturnTotal = (from, to, Branch_idBranch) => {
  const query =
    "SELECT COALESCE(SUM(CAST(Total_Amount AS DECIMAL(15,2))), 0) AS Total FROM purchase_return WHERE Date BETWEEN ? AND ? AND Branch_idBranch = ? AND Status = 1";
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchPurchaseReturns = (from, to, Branch_idBranch) => {
  const query =
    "SELECT p.*, s.Company_Name FROM purchase_return p INNER JOIN supplier s ON p.Supplier_idSupplier = s.idSupplier WHERE p.Date BETWEEN ? AND ? AND p.Branch_idBranch = ? AND p.Status = 1 ORDER BY p.idPurchase_Return DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoiceCost = (from, to, Branch_idBranch, useRealCost = false, routeId = null) => {
  const costColumn = useRealCost ? "sc.Real_Cost" : "sc.Cost";
  let query =
    `SELECT 
    SUM(COALESCE(
      ihimd.cost * ii.Qty, 
      sc.Cost * ii.Qty,
      sc.Real_Cost * ii.Qty,
      (SELECT sc2.Cost FROM stock_card sc2 WHERE sc2.Description = ii.Description AND sc2.Branch_idBranch = i.Branch_idBranch ORDER BY sc2.id DESC LIMIT 1) * ii.Qty,
      0
    )) AS Cost
    FROM 
    invoice i 
    INNER JOIN invoice_has_item ii 
    ON i.idInvoice = ii.Invoice_idInvoice 
    LEFT JOIN stock_card sc 
    ON ii.Description = sc.Description AND (sc.Transaction_ID = i.idInvoice OR sc.Transaction_ID = i.Invoice_Number) AND sc.Branch_idBranch = i.Branch_idBranch
    LEFT JOIN invoice_has_item_manual_details ihimd
    ON ii.ID = ihimd.invoice_has_item_id
    WHERE i.Date BETWEEN ? AND ? 
    AND i.Branch_idBranch = ?`;
  const params = [from, to, Branch_idBranch];
  if (routeId) {
    query += " AND i.Route_idRoute = ?";
    params.push(routeId);
  }

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

module.exports = {
  fetchInvoices,
  fetchInvoiceItems,
  fetchExpenses,
  fetchDamages,
  fetchDamageItems,
  fetchInvoiceTotal,
  fetchInvoiceCost,
  fetchExpensesTotal,
  fetchDamageTotal,
  fetchPurchaseReturnTotal,
  fetchPurchaseReturns,
};
