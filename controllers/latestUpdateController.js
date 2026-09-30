const db = require("../db/db");

exports.getLatestTaskLog = async (req, res) => {
    const { taskId } = req.params;
  
    try {
      const [rows] = await db.promise().query(
        `SELECT done_by, timestamp 
         FROM logs 
         WHERE entity_type = 'task' AND entity_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [taskId]
      );
  
      console.log("Logs found:", rows); // ✅ DEBUGGING
  
      if (rows.length > 0 && rows[0].done_by && rows[0].timestamp) {
        return res.json(rows[0]);
      } else {
        return res.status(404).json({ message: "No logs found for this task." });
      }
    } catch (err) {
      console.error("❌ Error fetching latest task log:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  };
  