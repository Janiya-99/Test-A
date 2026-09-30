const db = require("../db/db");

exports.subAssignMember = (req, res) => {
  const { subtask_id, assignee_name, assigned_by } = req.body; // Extract assigned_by from the request body

  if (!subtask_id || !assignee_name || !assigned_by) {
    return res.status(400).json({ error: "Subtask ID, assignee name, and assigned by are required" });
  }

  // Check if the assignee is already assigned to the subtask
  const checkQuery = "SELECT * FROM subtask_assignees WHERE subtask_id = ? AND assignee_name = ?";
  db.query(checkQuery, [subtask_id, assignee_name], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (results.length > 0) {
      return res.status(400).json({ message: "User is already assigned to this subtask" });
    }

    // Insert new assignee if not already assigned
    const insertQuery = "INSERT INTO subtask_assignees (subtask_id, assignee_name, assigned_by) VALUES (?, ?, ?)"; // Include assigned_by in the SQL query
    db.query(insertQuery, [subtask_id, assignee_name, assigned_by], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Assignee added successfully", insertId: result.insertId });
    });
  });
};


  exports.subGetAllAssignee = (req, res) => {
    const subtaskId = req.params.subtaskId;
  
    const query = "SELECT assignee_name FROM subtask_assignees WHERE subtask_id = ?";
    db.query(query, [subtaskId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results.map(row => row.assignee_name));
    });
  };

  exports.removeAssignee = (req, res) => {
    const { subtask_id, assignee_name, deleted_by_user_nic } = req.body;

    if (!subtask_id || !assignee_name || !deleted_by_user_nic) {
      return res
        .status(400)
        .json({ error: "Subtask ID, Assignee Name, and User are required." });
    }

    const deleteQuery =
      "DELETE FROM subtask_assignees WHERE subtask_id = ? AND assignee_name = ?";

    db.query(deleteQuery, [subtask_id, assignee_name], (err, result) => {
      if (err) {
        console.error("Error deleting subtask assignee:", err);
        return res.status(500).json({ error: "Failed to delete assignee." });
      }

      if (result.affectedRows > 0) {
        // ✅ Log the deletion after success
        const logDetails = {
          message: `Subtask Assignee "${assignee_name}" removed from Subtask ID ${subtask_id}`,
        };

        logAction(
          "subtask", // entityType
          subtask_id, // entityId
          "delete", // action
          logDetails, // details
          deleted_by_user_nic // done_by
        );

        return res.json({ message: "Subtask assignee removed successfully." });
      } else {
        return res.status(404).json({ message: "Assignee not found." });
      }
    });
  };


  exports.assignSubAssignee = (req, res) => {
    const { subtask_id, assignee_name, assigned_by } = req.body; // Extract assigned_by from the request body
  
    if (!subtask_id || !assignee_name || !assigned_by) {
      return res.status(400).json({ error: "Subtask ID, assignee name, and assigned by are required" });
    }
  
    // Check if the assignee is already assigned to the subtask
    const checkQuery = "SELECT * FROM subtask_assignees WHERE subtask_id = ? AND assignee_name = ?";
    db.query(checkQuery, [subtask_id, assignee_name], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (results.length > 0) {
        return res.status(400).json({ message: "User is already assigned to this subtask" });
      }
  
      // Insert new assignee if not already assigned
      const insertQuery = "INSERT INTO subtask_assignees (subtask_id, assignee_name, assigned_by) VALUES (?, ?, ?)"; // Include assigned_by in the SQL query
      db.query(insertQuery, [subtask_id, assignee_name, assigned_by], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Assignee added successfully", insertId: result.insertId });
      });
    });
  };

  exports.getSubTaskDescription = (req, res) => {
    const subtaskId = req.params.id;
  
    const query = `SELECT description FROM subtasks WHERE id = ?`;
    db.query(query, [subtaskId], (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).send('Server error');
      }
  
      if (result.length > 0) {
        const description = result[0].description;
        return res.json({ description });
      } else {
        return res.status(404).json({ message: 'Subtask not found' });
      }
    });
  };
  
  
  

  const logAction = (
    entityType,
    entityId,
    action,
    details,
    doneBy // No default value here
  ) => {
    const logQuery = `INSERT INTO logs (entity_type, entity_id, action, details, done_by) VALUES (?, ?, ?, ?, ?)`;

    db.query(
      logQuery,
      [entityType, entityId, action, JSON.stringify(details), doneBy], // Use the provided `doneBy` value
      (err, result) => {
        if (err) {
          console.error("Logging error:", err);
        } else {
          console.log("✅ Log entry added:", result.insertId);
        }
      }
    );
  };