const db = require("../db/db.js");

exports.saveRolePrivilages = (req, res) => {
  const {
    User_Role_id,
    Branch_idBranch,
    Add_projects
  } = req.body;

  if (!User_Role_id) {
    return res.status(400).json({ message: "Role is required." });
  }

  const sql = `
    INSERT INTO role_has_privilages
      (User_Role_id, Branch_idBranch, Add_projects)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      Add_projects = VALUES(Add_projects)
  `;

  db.query(
    sql,
    [User_Role_id, Branch_idBranch || null, Add_projects ? 1 : 0],
    (err, result) => {
      if (err) {
        console.error("Error saving privileges:", err);
        return res.status(500).json({ message: "Database error." });
      }
      res.json({ message: "Privileges saved successfully." });
    }
  );
};