const db = require("../db/db");

exports.addTag = (req, res) => {
  const { subtask_id, tag, added_by } = req.body; // Extract added_by from the request body

  if (!subtask_id || !tag || !added_by) {
    return res.status(400).json({ success: false, message: "Invalid data" });
  }

  const sql = "INSERT INTO subtask_tags (subtask_id, tag, added_by) VALUES (?, ?, ?)"; // Include added_by in the SQL query
  db.query(sql, [subtask_id, tag, added_by], (err, result) => {
    if (err) {
      console.error("Error inserting tag:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    res.json({ success: true, tagId: result.insertId });
  });
};

  exports.getTag = (req, res) => {
    const { subtask_id } = req.params;
  
    const sql = "SELECT id, tag FROM subtask_tags WHERE subtask_id = ?";
    db.query(sql, [subtask_id], (err, results) => {
      if (err) {
        console.error("Error fetching tags:", err);
        return res.status(500).json({ success: false, message: "Database error" });
      }
      res.json({ success: true, tags: results });
    });
  };


  exports.deleteTag = (req, res) => {
    const { id } = req.params;
  
    const sql = "DELETE FROM subtask_tags WHERE id = ?";
    db.query(sql, [id], (err, result) => {
      if (err) {
        console.error("Error deleting tag:", err);
        return res.status(500).json({ success: false, message: "Database error" });
      }
      res.json({ success: true, message: "Tag deleted" });
    });
  };