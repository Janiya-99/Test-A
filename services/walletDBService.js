const db = require("../db/db");

const insertWallet = (
  Date,
  Type,
  Wallet_Category_idWallet_Category,
  Amount,
  Note,
  Branch_idBranch,
  Wallet_File,
  Accounting_Accounts_id,
  Status,
  project_id,
  Wallet_SubCategory_id
) => {
  const query =
    "INSERT INTO wallet (Date, Type, Wallet_Category_idWallet_Category, Amount, Note, Branch_idBranch, Wallet_File, Accounting_Accounts_id, Status, project_id, Wallet_SubCategory_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Date,
        Type,
        Wallet_Category_idWallet_Category,
        Amount,
        Note,
        Branch_idBranch,
        Wallet_File,
        Accounting_Accounts_id,
        Status,
        project_id,
        Wallet_SubCategory_id
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
};

const insertCategory = (Type, Description, Branch_idBranch) => {
  const query =
    "INSERT INTO wallet_category (Type, Description, Branch_idBranch) VALUES (?, ?, ?)";

  return new Promise((resolve, reject) => {
    db.query(query, [Type, Description, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchCategory = (Branch_idBranch) => {
  const query = "SELECT * FROM wallet_category WHERE Branch_idBranch = ?";
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

const updateCategory = (Type, Description, idWallet_Category) => {
  const query = `UPDATE wallet_category SET Type=?, Description=? WHERE idWallet_Category=?`;

  return new Promise((resolve, reject) => {
    db.query(query, [Type, Description, idWallet_Category], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchWallet = (Branch_idBranch) => {
  const query =
    "SELECT w.*, wc.Description AS Wallet_Category, wsc.Description AS Wallet_SubCategory, p.project_name FROM wallet w INNER JOIN wallet_category wc ON w.Wallet_Category_idWallet_Category = wc.idWallet_Category LEFT JOIN wallet_sub_category wsc ON w.Wallet_SubCategory_id = wsc.idWallet_SubCategory LEFT JOIN pro p ON w.project_id = p.id WHERE w.Branch_idBranch = ? && w.Status = 1 ORDER BY w.idWallet DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, 1], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateWallet = (
  Date,
  Type,
  Wallet_Category_idWallet_Category,
  Amount,
  Note,
  Wallet_File,
  Accounting_Accounts_id,
  project_id,
  Wallet_SubCategory_id,
  idWallet
) => {
  const query =
    "UPDATE wallet SET Date=?, Type=?, Wallet_Category_idWallet_Category=?, Amount=?, Note=?, Wallet_File=?, Accounting_Accounts_id=?, project_id=?, Wallet_SubCategory_id=? WHERE idWallet=?";

    console.log('Wallet_File',Wallet_File)
  return new Promise((resolve, reject) => {
    return db.query(
      query,
      [
        Date,
        Type,
        Wallet_Category_idWallet_Category,
        Amount,
        Note,
        Wallet_File,
        Accounting_Accounts_id,
        project_id,
        Wallet_SubCategory_id,
        idWallet
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
};

//soft delete
const deleteWallet = (idWallet) => {
  const query =
    "UPDATE wallet SET Status = CASE WHEN Status = 1 THEN 0 ELSE 1 END WHERE idWallet = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idWallet], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchEarning = (Branch_idBranch,fromDate,toDate) => {
  const query =
    "SELECT w.*, wc.Description AS Wallet_Category, wsc.Description AS Wallet_SubCategory, p.project_name FROM wallet w INNER JOIN wallet_category wc ON w.Wallet_Category_idWallet_Category = wc.idWallet_Category LEFT JOIN wallet_sub_category wsc ON w.Wallet_SubCategory_id = wsc.idWallet_SubCategory LEFT JOIN pro p ON w.project_id = p.id WHERE w.Branch_idBranch = ? && w.Status = 1 && w.Type = 1 && w.Date BETWEEN ? AND ?  ORDER BY w.idWallet DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch,fromDate,toDate], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchExpenses = (Branch_idBranch,fromDate,toDate) => {
  const query =
    "SELECT w.*, wc.Description AS Wallet_Category, wsc.Description AS Wallet_SubCategory, p.project_name FROM wallet w INNER JOIN wallet_category wc ON w.Wallet_Category_idWallet_Category = wc.idWallet_Category LEFT JOIN wallet_sub_category wsc ON w.Wallet_SubCategory_id = wsc.idWallet_SubCategory LEFT JOIN pro p ON w.project_id = p.id WHERE w.Branch_idBranch = ? && w.Status = 1 && w.Type = 2 && w.Date BETWEEN ? AND ?  ORDER BY w.idWallet DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch,fromDate,toDate], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const insertSubCategory = (Description, Wallet_Category_idWallet_Category, Branch_idBranch) => {
  const query =
    "INSERT INTO wallet_sub_category (Description, Wallet_Category_idWallet_Category, Branch_idBranch) VALUES (?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(query, [Description, Wallet_Category_idWallet_Category, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchSubCategory = (Branch_idBranch) => {
  const query =
    "SELECT wsc.*, wc.Description AS Wallet_Category, wc.Type AS Category_Type FROM wallet_sub_category wsc INNER JOIN wallet_category wc ON wsc.Wallet_Category_idWallet_Category = wc.idWallet_Category WHERE wsc.Branch_idBranch = ? ORDER BY wsc.idWallet_SubCategory DESC";
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

const updateSubCategory = (Description, Wallet_Category_idWallet_Category, idWallet_SubCategory) => {
  const query =
    "UPDATE wallet_sub_category SET Description=?, Wallet_Category_idWallet_Category=? WHERE idWallet_SubCategory=?";
  return new Promise((resolve, reject) => {
    db.query(query, [Description, Wallet_Category_idWallet_Category, idWallet_SubCategory], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const deleteSubCategory = (idWallet_SubCategory) => {
  const query = "DELETE FROM wallet_sub_category WHERE idWallet_SubCategory = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idWallet_SubCategory], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

module.exports = {
  fetchCategory,
  fetchWallet,
  insertCategory,
  insertWallet,
  updateWallet,
  updateCategory,
  deleteWallet,
  fetchEarning,
  fetchExpenses,
  insertSubCategory,
  fetchSubCategory,
  updateSubCategory,
  deleteSubCategory
};
