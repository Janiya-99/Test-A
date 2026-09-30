const db = require("../db/db");

const getActiveUsers = (req, res) => {
  const { branchId } = req.params;

  const sql = `
    SELECT idUser, First_Name, Last_Name 
    FROM user 
    WHERE Status = 1 AND Branch_idBranch = ? AND Role = 2
    ORDER BY First_Name ASC
  `;

  db.query(sql, [branchId], (err, results) => {
    if (err) {
      console.error("Error fetching users:", err);
      return res.status(500).json({ message: "Error fetching users" });
    }
    res.json(results);
  });
};

const updateUserPrivileges = (req, res) => {
  const userId = req.params.id;

  // Extract branch_id separately — it's routing info, not a privilege column
  const { branch_id: rawBranchId, ...privilegeUpdates } = req.body;
  const branchId = rawBranchId != null ? Number(rawBranchId) : 0;

  const fields = Object.keys(privilegeUpdates)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = Object.values(privilegeUpdates);

  // Check if a row already exists for this specific user+branch combination
  const sqlCheck = `SELECT * FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ?`;
  db.query(sqlCheck, [userId, branchId], (checkErr, checkRes) => {
    if (checkErr) {
      console.error("Check failed:", checkErr);
      return res.status(500).json({ message: "Check failed" });
    }

    if (checkRes.length === 0) {
      // No row for this user+branch — insert one first
      const insertSql = `INSERT INTO user_privilages (User_idUser, Branch_idBranch) VALUES (?, ?)`;
      db.query(insertSql, [userId, branchId], (insertErr) => {
        if (insertErr) {
          console.error("Insert failed:", insertErr);
          return res.status(500).json({ message: "Insert failed" });
        }

        const updateSql = `UPDATE user_privilages SET ${fields} WHERE User_idUser = ? AND Branch_idBranch = ?`;
        db.query(updateSql, [...values, userId, branchId], (updateErr) => {
          if (updateErr) {
            console.error("Update failed:", updateErr);
            return res.status(500).json({ message: "Update failed" });
          }
          return res.json({ message: "Privileges inserted and updated successfully." });
        });
      });
    } else {
      // Row exists — update directly
      const updateSql = `UPDATE user_privilages SET ${fields} WHERE User_idUser = ? AND Branch_idBranch = ?`;
      db.query(updateSql, [...values, userId, branchId], (updateErr) => {
        if (updateErr) {
          console.error("Update failed:", updateErr);
          return res.status(500).json({ message: "Update failed" });
        }
        return res.json({ message: "Privileges updated successfully." });
      });
    }
  });
};



const getUserPrivileges = (req, res) => {
  const userId = req.params.userId;
  const branchId = req.query.branch_id != null ? Number(req.query.branch_id) : null;

  const sql = branchId != null
    ? "SELECT * FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ? LIMIT 1"
    : "SELECT * FROM user_privilages WHERE User_idUser = ? LIMIT 1";
  const params = branchId != null ? [userId, branchId] : [userId];

  db.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Error fetching privileges" });
    }
    res.json(results[0] || {});
  });
};

module.exports = { getActiveUsers, updateUserPrivileges, getUserPrivileges };
