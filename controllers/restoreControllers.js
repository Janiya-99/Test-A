const db = require("../db/db");

exports.getAllDeleteProjects = (req, res) => {
  const { branchId } = req.params;

  const query = `
    SELECT id, project_name, description, team_name, project_key, created_at 
    FROM pro 
    WHERE active = 0 AND Branch_idBranch = ?
  `;

  db.query(query, [branchId], (err, results) => {
    if (err) {
      console.error("Error fetching deleted projects:", err);
      return res
        .status(500)
        .json({ error: "Database query error", details: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "No deleted projects found." });
    }

    res.json(results);
  });
};

// Restore a deleted project by setting active = 1
exports.restoreProject = (req, res) => {
  const { id } = req.params;
  const query = "UPDATE pro SET active = 1 WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error restoring project:", err);
      return res.status(500).json({ error: "Database update error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ message: "Project restored successfully" });
  });
};

// ✅ Get inactive subtasks for a specific Task
exports.getInactiveSubtasksByTask = (req, res) => {
  const { taskId } = req.params;

  const query = `
    SELECT * FROM subtasks 
    WHERE task_id = ? AND active = 0
  `;

  db.query(query, [taskId], (err, result) => {
    if (err) {
      console.error("Error fetching inactive subtasks:", err);
      return res.status(500).json({ error: "Database error" });
    }

    console.log("Inactive Subtasks: ", result); // ✅ Debug
    res.status(200).json(result);
  });
};



// ✅ Restore a subtask
exports.restoreSubtask = (req, res) => {
  const { id } = req.params;

  const query = `UPDATE subtasks SET active = 1 WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error restoring subtask:", err);
      return res.status(500).json({ error: "Failed to restore subtask" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Subtask not found" });
    }

    res.status(200).json({ success: true, message: "Subtask restored successfully" });
  });
};






// ✅ Fetch inactive tasks for a specific project
// controllers/restoreControllers.js
exports.getInactiveTasksByProject = (req, res) => {
  const { projectId } = req.params;

  const query = `
    SELECT * FROM tasks 
    WHERE project_id = ? AND active = 0
  `;

  db.query(query, [projectId], (err, result) => {
    if (err) {
      console.error("Error fetching inactive tasks:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.status(200).json(result); // Return inactive tasks
  });
};


// ✅ Restore task by updating the 'active' status
exports.restoreTask = (req, res) => {
  const { id } = req.params;

  // Default board names (case-insensitive matching)
  const defaultBoards = ["Todo", "In Progress", "Under Review", "Done"];

  // 1. Get current status of the task
  db.query("SELECT status FROM tasks WHERE id = ?", [id], (err, result) => {
    if (err || result.length === 0) {
      console.error("Error fetching task:", err);
      return res.status(500).json({ error: "Task not found" });
    }

    let currentStatus = result[0].status;

    // 2. Check if current status is in default boards
    const isDefaultBoard = defaultBoards.some(
      (board) => board.toLowerCase() === currentStatus.toLowerCase()
    );

    if (isDefaultBoard) {
      // ✅ If it's a default board → directly restore
      db.query(
        "UPDATE tasks SET active = 1 WHERE id = ?",
        [id],
        (err, updateResult) => {
          if (err) {
            console.error("Error restoring task:", err);
            return res.status(500).json({ error: "Failed to restore task" });
          }

          return res.json({
            success: true,
            message: `Task restored to default board '${currentStatus}'`,
            status: currentStatus,
          });
        }
      );
    } else {
      // 3. Check if custom board exists & active
      db.query(
        "SELECT name FROM boards WHERE name = ? AND active = 1",
        [currentStatus],
        (err, boardResult) => {
          if (err) {
            console.error("Error checking board:", err);
            return res.status(500).json({ error: "Failed to check board" });
          }

          let newStatus = currentStatus;
          if (boardResult.length === 0) {
            // Board doesn't exist → fallback to Todo
            newStatus = "Todo";
          }

          // 4. Update task
          db.query(
            "UPDATE tasks SET active = 1, status = ? WHERE id = ?",
            [newStatus, id],
            (err, updateResult) => {
              if (err) {
                console.error("Error restoring task:", err);
                return res
                  .status(500)
                  .json({ error: "Failed to restore task" });
              }

              return res.json({
                success: true,
                message: `Task restored successfully to '${newStatus}' board.`,
                status: newStatus,
              });
            }
          );
        }
      );
    }
  });
};
