// controllers/taskFieldDataController.js

const db = require("../db/db");

exports.saveTaskFieldData = (req, res) => {
  const { task_id, field_id, value, created_by } = req.body;

  // Check required
  const checkRequiredQuery = `SELECT required FROM CustomFields WHERE field_id = ?`;

  db.query(checkRequiredQuery, [field_id], (err, result) => {
    if (err) return res.status(500).json({ message: "Check failed" });

    if (
      result.length > 0 &&
      result[0].required === 1 &&
      (!value || value.trim() === "")
    ) {
      return res
        .status(400)
        .json({ message: "Required field cannot be empty" });
    }

    const sql = `
      INSERT INTO TaskFieldData (task_id, field_id, value, created_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE value = VALUES(value)
    `;

    db.query(sql, [task_id, field_id, value, created_by], (err2) => {
      if (err2)
        return res.status(500).json({ message: "Failed to save field data" });
      return res.status(200).json({ message: "Field data saved successfully" });
    });
  });
};


