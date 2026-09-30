const db = require("../db/db");


//backend assignee controller
exports.assignMember = (req, res) => {
  const { task_id, assignee_name, assigned_by } = req.body;

  // Validate input fields
  if (!task_id || !assignee_name || !assigned_by) {
    return res.status(400).json({ error: "Task ID, assignee name, and assigned by are required" });
  }

  // Check if the assignee is already assigned to the task by the same user
  const checkQuery = `
    SELECT * FROM task_assignees 
    WHERE task_id = ? AND assignee_name = ? AND assigned_by = ?
  `;
  db.query(checkQuery, [task_id, assignee_name, assigned_by], (err, results) => {
    if (err) {
      console.error("Error checking existing assignee:", err);
      return res.status(500).json({ error: "Failed to check assignee." });
    }

    if (results.length > 0) {
      return res.status(400).json({ message: "User is already assigned to this task by you." });
    }

    // Insert new assignee if not already assigned
    const insertQuery = `
      INSERT INTO task_assignees (task_id, assignee_name, assigned_by) 
      VALUES (?, ?, ?)
    `;
    db.query(insertQuery, [task_id, assignee_name, assigned_by], (err, result) => {
      if (err) {
        console.error("Error inserting assignee:", err);
        return res.status(500).json({ error: "Failed to add assignee." });
      }
      res.json({ message: "Assignee added successfully", insertId: result.insertId });
    });
  });
};
  

exports.deleteTask = async (req, res) => {
  const subtaskId = req.params.id;
  const { deleted_by_user_nic } = req.body; // Extract the user's name from the request body

  if (!deleted_by_user_nic) {
    return res.status(400).json({ message: "User name is required for deletion" });
  }

  try {
    // Update the subtask to set active = 0 and save the user's name in deleted_by
    const [result] = await db.promise().query(
      "UPDATE subtasks SET active = 0, deleted_by = ? WHERE id = ?", // Update the query to include `deleted_by`
      [deleted_by_user_nic, subtaskId]
    );

    // If result is not an array, log it to check its structure
    console.log(result);

    // Check if affectedRows is in the correct object, depending on db library
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Subtask not found" });
    }

    res.status(200).json({ message: "Subtask deleted successfully (soft delete)" });
  } catch (error) {
    console.error("Error deleting subtask:", error);
    res.status(500).json({ message: "Error deleting subtask" });
  }
};



exports.getAllAssignee = (req, res) => {
  const taskId = req.params.taskId;

  const query = "SELECT assignee_name FROM task_assignees WHERE task_id = ?";
  db.query(query, [taskId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results.map(row => row.assignee_name));
  });
};

exports.deleteAssigneeById = (req, res) => {
  const { task_id, assignee_name, deleted_by_user_nic } = req.body;

  if (!task_id || !assignee_name || !deleted_by_user_nic) {
    return res
      .status(400)
      .json({ error: "Task ID, Assignee Name, and User are required." });
  }

  const deleteQuery =
    "DELETE FROM task_assignees WHERE task_id = ? AND assignee_name = ?";

  db.query(deleteQuery, [task_id, assignee_name], (err, result) => {
    if (err) {
      console.error("Error deleting assignee:", err);
      return res.status(500).json({ error: "Failed to delete assignee." });
    }

    if (result.affectedRows > 0) {
      // ✅ Add Log after successful deletion
      const logDetails = {
        message: `Assignee "${assignee_name}" removed from Task ID ${task_id}`,
      };

      logAction(
        "task", // entityType
        task_id, // entityId
        "delete", // action
        logDetails, // details
        deleted_by_user_nic // done_by
      );

      return res.json({ message: "Assignee removed successfully." });
    } else {
      return res.status(404).json({ message: "Assignee not found." });
    }
  });
};



exports.addStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const query = "UPDATE subtasks SET status = ? WHERE id = ?";
    await db.promise().query(query, [status, id]);

    res.status(200).json({ message: "Subtask status updated successfully" });
  } catch (error) {
    console.error("Error updating subtask status:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
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