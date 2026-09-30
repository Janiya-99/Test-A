const db = require("../db/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const transporter = require("../utils/emailTransporter");


// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save files in 'uploads' folder
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({ storage });


exports.saveFieldData = (req, res) => {
  const { task_id } = req.params;
  const { field_data } = req.body;

  if (!Array.isArray(field_data) || field_data.length === 0) {
    return res.status(400).json({ message: "No data provided." });
  }

  const values = field_data.map((item) => [task_id, item.field_id, item.value]);

  const sql = `
    INSERT INTO TaskFieldData (task_id, field_id, value) VALUES ?
  `;

  db.query(sql, [values], (err) => {
    if (err) {
      console.error("Error saving field data:", err);
      return res.status(500).json({ message: "Failed to save data." });
    }
    return res.status(200).json({ message: "Data saved successfully." });
  });
};



exports.getTasksByProject = (req, res) => {
  const projectId = req.params.projectId;
  db.query(
    "SELECT * FROM tasks WHERE project_id = ? AND active = 1 ORDER BY `order` ASC",
    [projectId],
    (err, results) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch tasks" });
      } else {
        const formattedTasks = results.reduce((acc, task) => {
          const status = task.status.toLowerCase(); // Assuming the status is stored as a string (e.g., "todo", "inprogress")

          const taskData = {
            ...task,
            assignees: task.assignees
              ? JSON.parse(task.assignees).join(" ")
              : "",
            tags: task.tags ? JSON.parse(task.tags).join(" ") : "",
          };

          if (!acc[status]) {
            acc[status] = [];
          }

          acc[status].push(taskData);
          return acc;
        }, {});

        // Send the formatted tasks as response
        res.json(formattedTasks);
      }
    }
  );
};

exports.updateTaskOrder = (req, res) => {
  const { orderedTaskIds } = req.body;

  if (!Array.isArray(orderedTaskIds)) {
    return res.status(400).json({ error: "orderedTaskIds must be an array" });
  }

  const queries = orderedTaskIds.map((taskId, index) => {
    return new Promise((resolve, reject) => {
      db.query(
        "UPDATE tasks SET `order` = ? WHERE id = ?",
        [index, taskId],
        (err) => (err ? reject(err) : resolve())
      );
    });
  });

  Promise.all(queries)
    .then(() => res.status(200).json({ message: "Order updated successfully" }))
    .catch((err) => {
      console.error("Error updating task order:", err);
      res.status(500).json({ error: "Failed to update order" });
    });
};



exports.addTask = (req, res) => {
  const { title, category, assignees, tags, status, projectId, Branch_idBranch } = req.body;

  db.query(
    "INSERT INTO tasks (title, category, assignees, tags, status, project_id, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [title, category, JSON.stringify(assignees), JSON.stringify(tags), status, projectId, Branch_idBranch],
    (err, result) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to add task" });
      } else {
        // Log the task creation action with the user's name
        const logMessage = `Task created: `;
        logAction(
          "task", // entityType
          result.insertId, // entityId (newly created task ID)
          "create", // action
          { message: logMessage, title, category, status, projectId }, // details
          Branch_idBranch // doneBy (user's name)
        );

        // Send response with the newly created task ID and request body
        res.status(201).json({ id: result.insertId, ...req.body });
      }
    }
  );
};

exports.deleteTask = (req, res) => {
  const { taskId } = req.params;
  const { deleted_by_user_nic } = req.body; // Extract the user's name from the request body
  const { done_by } = req.body; 

  if (!deleted_by_user_nic) {
    return res.status(400).json({ error: "User name is required for deletion" });
  }

  db.query(
    "UPDATE tasks SET active = 0, deleted_by = ? WHERE id = ?", // Update the query to include `deleted_by`
    [deleted_by_user_nic, taskId],
    (err, result) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete task" });
      } else if (result.affectedRows === 0) {
        res.status(404).json({ error: "Task not found" });
      } else {
        logAction("task", taskId, "delete", { deleted_by: deleted_by_user_nic } , { done_by: done_by }); // Log the soft delete action with the user's name
        res
          .status(200)
          .json({ message: "Task deleted successfully (soft delete)" });
      }
    }
  );
};

exports.updateTaskStatus = (req, res) => {
  const { taskId } = req.params;
  const { status: newStatus, updated_by_user_nic } = req.body; // ✅ Capture user who changed status

  if (!updated_by_user_nic) {
    return res
      .status(400)
      .json({ error: "User who updated the task is required" });
  }

  // ✅ Fetch the old status first
  db.query(
    "SELECT status FROM tasks WHERE id = ?",
    [taskId],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching old status:", err);
        return res
          .status(500)
          .json({ error: "Failed to retrieve old task status" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Task not found" });
      }

      const oldStatus = results[0].status;

      if (oldStatus === newStatus) {
        return res.status(200).json({ message: "Status unchanged" });
      }

      // ✅ Update task status
      db.query(
        "UPDATE tasks SET status = ? WHERE id = ?",
        [newStatus, taskId],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Error updating task status:", updateErr);
            return res
              .status(500)
              .json({ error: "Failed to update task status" });
          }

          // ✅ Log the status change
          const logMessage = `Status updated from: "${oldStatus}" → "${newStatus}"`;
          logAction(
            "task",
            taskId,
            "update_status",
            { message: logMessage },
            updated_by_user_nic
          );

          // ✅ Send response
          res.json({
            message: logMessage,
            old_status: oldStatus,
            new_status: newStatus,
            updated_by: updated_by_user_nic, // ✅ Include user in response
          });
        }
      );
    }
  );
};



exports.updateTaskTags = (req, res) => {
  const { taskId } = req.params;
  const { tags } = req.body;

  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "Tags must be an array" });
  }

  db.query(
    "UPDATE tasks SET tags = ? WHERE id = ?",
    [JSON.stringify(tags), taskId],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update task tags" });
      } else {
        res.json({ message: "Task tags updated successfully", tags });
      }
    }
  );
};

// Update task assignees
exports.updateTaskAssignees = (req, res) => {
  const { taskId } = req.params;
  const { assignees } = req.body;

  db.query(
    "UPDATE tasks SET assignees = ? WHERE id = ?",
    [JSON.stringify(assignees), taskId],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update task assignees" });
      } else {
        res.json({ message: "Task assignees updated successfully" });
      }
    }
  );
};



exports.updateTaskDescription = (req, res) => {
  const { taskId } = req.params;
  const { description: newDescription, updated_by_user_nic } = req.body;

  if (
    !newDescription ||
    newDescription.trim() === "" ||
    newDescription === "<p><br></p>"
  ) {
    return res.status(400).json({ error: "Description cannot be empty" });
  }

  db.query(
    "SELECT description FROM tasks WHERE id = ?",
    [taskId],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching old description:", err);
        return res
          .status(500)
          .json({ error: "Failed to retrieve old description" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Task not found" });
      }

      const oldDescription = results[0].description || ""; // Handle null values

      db.query(
        "UPDATE tasks SET description = ? WHERE id = ?",
        [newDescription, taskId],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Error updating description:", updateErr);
            return res
              .status(500)
              .json({ error: "Failed to update task description" });
          }

          // ✅ Format log message with "update -" prefix
          const logMessage = `Description updated from: ${oldDescription} -> ${newDescription}`;

          logAction(
            "task",
            taskId,
            "update", // ✅ Use "update" as action name
            { message: logMessage },
            updated_by_user_nic
          );

          res.json({
            message: logMessage,
            old_description: oldDescription,
            new_description: newDescription,
          });
        }
      );
    }
  );
};





// Update task title and log the action
exports.updateTaskTitle = (req, res) => {
  const { taskId } = req.params; // Get taskId from URL params
  const { title: newTitle, updated_by_user_nic } = req.body; // Get new title and user's name from the request body

  // First, fetch the old title from the database
  db.query("SELECT title FROM tasks WHERE id = ?", [taskId], (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Failed to retrieve old task title" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    const oldTitle = results[0].title;

    // Update the task title in the database
    db.query(
      "UPDATE tasks SET title = ? WHERE id = ?",
      [newTitle, taskId],
      (updateErr) => {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({ error: "Failed to update task title" });
        }

        // Log the update action with formatted message including the user name
        const logMessage = `Title updated from: ${oldTitle} -> ${newTitle} `;
        logAction(
          "task", // entityType
          taskId, // entityId
          "update", // action
          { message: logMessage }, // details
          updated_by_user_nic // doneBy (user's name)
        );

        // Send response with formatted message
        res.json({
          message: logMessage,
          old_title: oldTitle,
          new_title: newTitle,
          updated_by: updated_by_user_nic, // Include updated_by in the response
        });
      }
    );
  });
};


exports.addSubTask = (req, res) => {
  const { title, category, assignees, tags, status, parentTaskId, Branch_idBranch  } = req.body;

  console.log("Received userNIC in backend:", Branch_idBranch ); // Debugging log

  db.query(
    "INSERT INTO subtasks (title, category, assignees, tags, status, task_id, Branch_idBranch ) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [title, category || "", JSON.stringify(assignees || []), JSON.stringify(tags || []), status || "Todo", parentTaskId, Branch_idBranch ],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to add subtask" });
      }

      // Log the subtask creation action with the user's name
      const logMessage = `Subtask created: "${title}" under parent task "${parentTaskId}" `;
      logAction(
        "subtask", // entityType
        result.insertId, // entityId (newly created subtask ID)
        "create", // action
        { message: logMessage, category}, // details
        Branch_idBranch  // doneBy (user's name)
      );

      // Send response with the newly created subtask ID and request body
      res.status(201).json({ id: result.insertId, ...req.body, status: status || "Todo" });
    }
  );
};


exports.updateSubTaskStatus = (req, res) => {
  const { subtaskId } = req.params; // ✅ Subtask ID from the URL
  const { status: newStatus, updated_by_user_nic } = req.body; // ✅ Capture the new status and user who changed it

  // ✅ Allowed status values
  const allowedStatuses = ["todo", "inProgress", "underReview", "done"];
  if (!allowedStatuses.includes(newStatus)) {
    return res.status(400).json({ error: "❌ Invalid status value" });
  }

  // ✅ Fetch the old status first
  db.query(
    "SELECT status FROM subtasks WHERE id = ?",
    [subtaskId],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching old status:", err);
        return res
          .status(500)
          .json({ error: "Failed to retrieve old subtask status" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "❌ Subtask not found" });
      }

      const oldStatus = results[0].status;

      // ✅ Update the subtask status in the database
      db.query(
        "UPDATE subtasks SET status = ?, updated_by_user_nic = ? WHERE id = ?",
        [newStatus, updated_by_user_nic, subtaskId],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Error updating subtask status:", updateErr);
            return res
              .status(500)
              .json({ error: "Failed to update subtask status" });
          }

          // ✅ Log the status change with the user who changed it
          const logMessage = `Status updated from: "${oldStatus}" → "${newStatus}"`;
          logAction(
            "subtask",
            subtaskId,
            "update_status",
            { message: logMessage },
            updated_by_user_nic
          );

          // ✅ Send response
          res.json({
            message: logMessage,
            old_status: oldStatus,
            new_status: newStatus,
            updated_by: updated_by_user_nic, // ✅ Include user in response
          });
        }
      );
    }
  );
};






// Get active subtasks by parent task ID
exports.getSubTasksByParentTaskId = (req, res) => {
  const { parentTaskId } = req.params;

  console.log("Fetching active subtasks for parent task ID:", parentTaskId);

  if (!parentTaskId) {
    return res.status(400).json({ error: "parentTaskId is required" });
  }

  db.query(
    "SELECT * FROM subtasks WHERE task_id = ? AND active = 1", // Added active check
    [parentTaskId],
    (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({ error: "Failed to fetch subtasks" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "No active subtasks found" });
      }

      console.log("Active subtasks fetched successfully:", results);
      res.status(200).json(results);
    }
  );
};

exports.addComments = (req, res) => {
  const { comment_text, parentTaskId, mentionedUsers, added_by } = req.body;
  const taskId = parentTaskId;

  console.log("📩 Received comment data:", req.body);

  if (!taskId || !comment_text.trim()) {
    return res.status(400).json({
      error: "taskId (parentTaskId), comment_text and added_by are required",
    });
  }

  // ✅ Ensure mentionedUsers is an array and format names properly
  const mentionedUsernames = Array.isArray(mentionedUsers)
    ? mentionedUsers.map((user) => user.trim().toLowerCase()) // ✅ Convert to lowercase for case-insensitive matching
    : [];

  db.query(
    "INSERT INTO comments (task_id, comment_text, added_by, created_at) VALUES (?, ?, ?, current_timestamp())",
    [taskId, comment_text, added_by],
    (err, result) => {
      if (err) {
        console.error("❌ Database insert error:", err);
        return res.status(500).json({ error: "Failed to add comment" });
      }

      console.log("✅ Comment added successfully with ID:", result.insertId);
      console.log("✅ Comment added by:", added_by);

      if (mentionedUsernames.length === 0) {
        return res.status(201).json({ message: "Comment added successfully!" });
      }

      // ✅ Fetch project ID, project name, task title, and board name
      const taskQuery = `
        SELECT t.id AS task_id, t.title AS task_title, t.status AS board_name, 
               p.id AS project_id, p.project_name 
        FROM tasks t
        JOIN pro p ON t.project_id = p.id
        WHERE t.id = ?`;

      db.query(taskQuery, [taskId], (err, taskResult) => {
        if (err) {
          console.error("❌ Error fetching task details:", err);
          return res
            .status(500)
            .json({ error: "Failed to fetch task details" });
        }

        if (taskResult.length === 0) {
          console.warn("⚠️ Task not found for email notification.");
          return;
        }

        const { task_id, task_title, board_name, project_id, project_name } =
          taskResult[0];

        // ✅ Convert mentioned names to lowercase for case-insensitive matching
        const mentionedUsernames = Array.isArray(mentionedUsers)
          ? mentionedUsers.map((user) => user.trim().toLowerCase())
          : [];

        const placeholders = mentionedUsernames.map(() => "?").join(", ");
        db.query(
          `SELECT email FROM members WHERE LOWER(name) IN (${placeholders})`,
          mentionedUsernames,
          (err, members) => {
            if (err) {
              console.error("❌ Error fetching member emails:", err);
              return;
            }

            if (members.length === 0) {
              console.warn(
                "⚠️ No matching users found for mention:",
                mentionedUsernames
              );
              return;
            }

            members.forEach((member) => {
              // ✅ Use project ID in the task URL

              //const taskUrl = `http://localhost:5174/tasks/${project_id}`;
              const taskUrl = `https://projectmanagement.asipiya.lk/tasks/${project_id}`;

              // ✅ Format email with Board Name
              const mailOptions = {
                from: "sethrajarathne@gmail.com",
                to: member.email,
                subject: "🔔 You have been mentioned in a comment!",
                html: `
          <p><strong>Hello,</strong></p>
          <p>You have been <strong>mentioned</strong> in a comment:</p>
          <blockquote style="background:#f9f9f9;padding:10px;border-left:5px solid #ccc;">
            ${comment_text}
          </blockquote>
          <p><strong>Task:</strong> ${task_title} (Task ID: ${task_id})</p>
          <p><strong>Project:</strong> ${project_name} (ID: ${project_id})</p>
          <p><strong>Board:</strong> ${board_name}</p>  <!-- ✅ Added Board Name -->
          <p>📌 <a href="${taskUrl}" style="color:blue;">View Task</a></p>
          <p>Best Regards,</p>
          <p><strong>Asipiya Soft Solutions</strong></p>
        `,
              };

              // ✅ Send the email
              transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                  console.error("❌ Error sending email:", error);
                } else {
                  console.log("✅ Email sent successfully:", info.response);
                }
              });
            });
          }
        );
      });

      res
        .status(201)
        .json({ message: "Comment added and notifications sent!" });
    }
  );
};



// ✅ **Fetch All Comments for a Task**
exports.getComments = (req, res) => {
  const { taskId } = req.params;

  db.query(
    "SELECT id, task_id, comment_text, added_by, created_at FROM comments WHERE task_id = ? ORDER BY created_at DESC",
    [taskId],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Failed to fetch comments" });
      }
      res.status(200).json(result);
    }
  );
};



// Update subtask assignees
exports.updateSubtaskAssignees = (req, res) => {
  const { subtaskId } = req.params;
  const { assignees } = req.body; // Assumes assignees are sent as an array

  // Ensure assignees is an array before updating
  if (!Array.isArray(assignees)) {
    return res.status(400).json({ error: "Assignees must be an array" });
  }

  // Update the assignees in the database
  db.query(
    "UPDATE subtasks SET assignees = ? WHERE id = ?",
    [JSON.stringify(assignees), subtaskId], // Storing assignees as JSON string in DB
    (err) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ error: "Failed to update subtask assignees" });
      }
      res.json({ message: "Subtask assignees updated successfully" });
    }
  );
};

// Update subtask tags
exports.updateSubtaskTags = (req, res) => {
  const { subtaskId } = req.params;
  const { tags } = req.body; // Assumes tags are sent as an array

  // Ensure tags is an array before updating
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "Tags must be an array" });
  }

  // Update the tags in the database
  db.query(
    "UPDATE subtasks SET tags = ? WHERE id = ?",
    [JSON.stringify(tags), subtaskId], // Storing tags as JSON string in DB
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to update subtask tags" });
      }
      res.json({ message: "Subtask tags updated successfully" });
    }
  );
};

// Update subtask description and log the action
exports.updateSubtaskDescription = (req, res) => {
  const { subtaskId } = req.params;
  const { description: newDescription, updated_by_user_nic } = req.body;

  if (
    !newDescription ||
    newDescription.trim() === "" ||
    newDescription === "<p><br></p>"
  ) {
    return res.status(400).json({ error: "Description cannot be empty" });
  }

  db.query(
    "SELECT description FROM subtasks WHERE id = ?",
    [subtaskId],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching old description:", err);
        return res
          .status(500)
          .json({ error: "Failed to retrieve old description" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Subtask not found" });
      }

      const oldDescription = results[0].description || ""; // Handle null values
      const strippedOldDescription = stripHtmlTags(oldDescription).trim();
      const strippedNewDescription = stripHtmlTags(newDescription).trim();

      db.query(
        "UPDATE subtasks SET description = ? WHERE id = ?",
        [strippedNewDescription, subtaskId],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Error updating description:", updateErr);
            return res
              .status(500)
              .json({ error: "Failed to update description" });
          }

          // ✅ Format log message
          const logMessage = `Description updated from: "${strippedOldDescription}" → "${strippedNewDescription}"`;

          logAction(
            "subtask",
            subtaskId,
            "update", // ✅ Use "update" as action name
            { message: logMessage },
            updated_by_user_nic
          );

          res.json({
            message: logMessage,
            old_description: strippedOldDescription,
            new_description: strippedNewDescription,
            updated_by: updated_by_user_nic,
          });
        }
      );
    }
  );
};


// Update subtask status
exports.updateSubtaskStatus = (req, res) => {
  const { subtaskId } = req.params;
  const { status, updated_by_user_nic } = req.body; // Assuming userId is passed in the request body for logging

  db.query(
    "UPDATE subtasks SET status = ? WHERE id = ?",
    [status, subtaskId],
    (err, result) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update subtask status" });
      } else {
        // Log the action
        logAction(
          'subtask',           // entityType
          subtaskId,           // entityId
          'update',     // action
          { new_status: status }, // details
          updated_by_user_nic               // doneBy (the user who performed the action)
        );
        
        res.json({ message: "Subtask status updated successfully" });
      }
    }
  );
};

exports.updateSubtaskTitle = (req, res) => {
  const { subtaskId } = req.params;
  const { title: newTitle, updated_by_user_nic } = req.body; // Extract new title and user's name

  // First, fetch the old title from the database
  db.query(
    "SELECT title FROM subtasks WHERE id = ?",
    [subtaskId],
    (err, results) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ error: "Failed to retrieve old subtask title" });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Subtask not found" });
      }

      const oldTitle = results[0].title;

      // Update the subtask title in the database
      db.query(
        "UPDATE subtasks SET title = ? WHERE id = ?",
        [newTitle, subtaskId],
        (updateErr) => {
          if (updateErr) {
            console.error(updateErr);
            return res
              .status(500)
              .json({ error: "Failed to update subtask title" });
          }

          // Log the update action with the user's name
          const logMessage = `Update Title from: "${oldTitle}" -> "${newTitle}" by ${updated_by_user_nic}`;
          logAction(
            "subtask", // entityType
            subtaskId, // entityId
            "update", // action
            { message: logMessage }, // details
            updated_by_user_nic // doneBy (user's name)
          );

          // Send response with old and new titles
          res.json({
            message: logMessage,
            old_title: oldTitle,
            new_title: newTitle,
            updated_by: updated_by_user_nic, // Include updated_by in the response
          });
        }
      );
    }
  );
};


exports.addSubComment = (req, res) => {
const { sub_comment_text, subtaskId, mentionedUsers, added_by } = req.body;


  console.log("📩 Received sub-comment data:", req.body); // ✅ Debugging log

  if (!subtaskId || !sub_comment_text.trim()) {
    console.error("❌ Missing subtaskId or comment text!");
    return res.status(400).json({
      error: "subtaskId and sub_comment_text are required",
    });
  }

  // ✅ Ensure mentionedUsers is an array
  const mentionedUsernames = Array.isArray(mentionedUsers)
    ? mentionedUsers.map((user) => user.trim())
    : [];

  console.log("🔍 Mentioned Users Extracted:", mentionedUsernames); // ✅ Debugging log

  // ✅ Insert sub-comment into database
db.query(
  "INSERT INTO subcomments (subtask_id, sub_comment_text, added_by, created_at) VALUES (?, ?, ?, current_timestamp())",
  [subtaskId, sub_comment_text, added_by],

  (err, result) => {
    if (err) {
      console.error("❌ Database insert error:", err);
      return res.status(500).json({ error: "Failed to add sub-comment" });
    }

    console.log("✅ Sub-comment added successfully with ID:", result.insertId);

    // If no mentioned users, return immediately
    if (mentionedUsernames.length === 0) {
      console.log("⚠️ No users mentioned, skipping email sending.");
      return res.status(201).json({
        message: "Sub-comment added successfully!",
        id: result.insertId,
        subtask_id: subtaskId,
        sub_comment_text: sub_comment_text,
        added_by: added_by, // ✅ Include this
        created_at: new Date().toISOString(),
      });

    }

    // ✅ Fetch project details, task title, subtask title, and board name
    const subtaskQuery = `
        SELECT s.id AS subtask_id, s.title AS subtask_title, 
               t.id AS task_id, t.title AS task_title, t.status AS board_name, 
               p.id AS project_id, p.project_name 
        FROM subtasks s
        JOIN tasks t ON s.task_id = t.id
        JOIN pro p ON t.project_id = p.id
        WHERE s.id = ?`;

    db.query(subtaskQuery, [subtaskId], (err, subtaskResult) => {
      if (err) {
        console.error("❌ Error fetching subtask details:", err);
        return res
          .status(500)
          .json({ error: "Failed to fetch subtask details" });
      }

      if (subtaskResult.length === 0) {
        console.warn("⚠️ Subtask not found for email notification.");
        return;
      }

      const {
        subtask_id,
        subtask_title,
        task_id,
        task_title,
        board_name,
        project_id,
        project_name,
      } = subtaskResult[0];

      console.log("🔍 Subtask Details:", {
        subtask_title,
        task_title,
        board_name,
        project_name,
      });

      // ✅ Ensure mentionedUsers is an array and format names properly
      const mentionedUsernames = Array.isArray(mentionedUsers)
        ? mentionedUsers.map((user) => user.trim().toLowerCase())
        : [];

      const placeholders = mentionedUsernames.map(() => "?").join(", ");
      db.query(
        `SELECT email FROM members WHERE LOWER(name) IN (${placeholders})`,
        mentionedUsernames,
        (err, members) => {
          if (err) {
            console.error("❌ Error fetching member emails:", err);
            return;
          }

          if (members.length === 0) {
            console.warn(
              "⚠️ No matching users found for mention:",
              mentionedUsernames
            );
            return;
          }

          members.forEach((member) => {
            const subtaskUrl = `http://localhost:5174/tasks/${project_id}`;

            const mailOptions = {
              from: "sethrajarathne@gmail.com",
              to: member.email,
              subject: "🔔 You have been mentioned in a subtask comment!",
              html: `
          <p><strong>Hello,</strong></p>
          <p>You have been <strong>mentioned</strong> in a subtask comment:</p>
          <blockquote style="background:#f9f9f9;padding:10px;border-left:5px solid #ccc;">
            ${sub_comment_text}
          </blockquote>
          <p><strong>Subtask:</strong> ${subtask_title} (ID: ${subtask_id})</p>
          <p><strong>Task:</strong> ${task_title} (ID: ${task_id})</p>
          <p><strong>Project:</strong> ${project_name} (ID: ${project_id})</p>
          <p>📌 <a href="${subtaskUrl}" style="color:blue;">View Subtask</a></p>
        `,
            };

            transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                console.error("❌ Error sending email:", error);
              } else {
                console.log("✅ Email sent successfully:", info.response);
              }
            });
          });
        }
      );
    });

    res
      .status(201)
      .json({ message: "Sub-comment added and notifications sent!" });
  }
);
};




// ✅ Get all sub-comments for a subtask (including added_by)
exports.getSubCommentsBySubtaskId = (req, res) => {
  const { subtaskId } = req.params;

  console.log("Fetching sub-comments for subtaskId:", subtaskId);

  db.query(
    `SELECT 
        id, 
        subtask_id, 
        sub_comment_text, 
        added_by, 
        created_at 
     FROM subcomments 
     WHERE subtask_id = ? 
     ORDER BY created_at DESC`,
    [subtaskId],
    (err, result) => {
      if (err) {
        console.error("Database fetch error:", err);
        return res.status(500).json({ error: "Failed to fetch sub-comments" });
      }

      res.status(200).json(result); // ✅ Now includes added_by
    }
  );
};


// Add an attachment to a task
exports.addAttachment = (req, res) => {
  const { taskId } = req.params;
  const file = req.file;
  const addedBy = req.body.added_by; // Extract the added_by field from the request body

  if (!file) return res.status(400).json({ message: "No file uploaded" });

  const filePath = `uploads/${file.filename}`;
  const sql =
    "INSERT INTO maintaskattachment (task_id, name, path, added_by) VALUES (?, ?, ?, ?)"; // Include added_by in the SQL query

  db.query(sql, [taskId, file.originalname, filePath, addedBy], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res
        .status(500)
        .json({ error: "Database error", details: err.message });
    }

    res.status(201).json({ message: "Attachment saved", filePath });
  });
};

exports.getAttachments = (req, res) => {
  const { taskId } = req.params;
  const sql =
    "SELECT * FROM maintaskattachment WHERE task_id = ? AND active = 1 ";

  db.query(sql, [taskId], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res
        .status(500)
        .json({ error: "Database error", details: err.message });
    }

    const attachmentsWithBase64 = results.map((attachment) => {
      try {
        const filePath = path.join(__dirname, "../", attachment.path); // Ensure correct file path
        const mimeType = getMimeType(filePath); // Get MIME type based on file extension
        const fileData = fs.readFileSync(filePath); // Read the file from the server
        const base64String = fileData.toString("base64"); // Convert to base64 encoding

        return {
          id: attachment.id, // Include the attachment ID here
          name: attachment.name,
          base64: `data:${mimeType};base64,${base64String}`,
          mimeType,
        };
      } catch (error) {
        console.error("Error reading file:", error);
        return {
          id: attachment.id, // Ensure attachment ID is returned even if an error occurs
          name: attachment.name,
          base64: null,
          error: "File could not be read",
        };
      }
    });

    res.status(200).json(attachmentsWithBase64);
  });
};

// Helper function to get MIME type based on file extension
const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
  };
  return mimeTypes[ext] || "application/octet-stream"; // Default to generic MIME type
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


exports.deleteAttachment = (req, res) => {
  const { attachmentId } = req.params;
  const { deleted_by_user_nic } = req.body;

  if (!deleted_by_user_nic) {
    return res
      .status(400)
      .json({ error: "User name is required for deletion" });
  }

  // ✅ Step 1: Fetch attachment name BEFORE deleting
  const fetchAttachmentQuery = `SELECT name FROM maintaskattachment WHERE id = ?`;

  db.query(fetchAttachmentQuery, [attachmentId], (err, fetchResult) => {
    if (err) {
      return res.status(500).json({
        error: "Failed to fetch attachment details",
        details: err.message,
      });
    }

    if (fetchResult.length === 0) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    const attachmentName = fetchResult[0].name; // ✅ NOW safe to use here

    // ✅ Step 2: Soft delete
    const sqlSoftDeleteAttachment =
      "UPDATE maintaskattachment SET active = 0, deleted_by = ? WHERE id = ?";

    db.query(
      sqlSoftDeleteAttachment,
      [deleted_by_user_nic, attachmentId],
      (err, result) => {
        if (err) {
          return res.status(500).json({
            error: "Failed to delete attachment",
            details: err.message,
          });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ error: "Attachment not found" });
        }

        // ✅ Step 3: Log action WITH attachment name
        const logDetails = {
          message: `Attachment "${attachmentName}" deleted`,
        };

        logAction(
          "task", 
          attachmentId,
          "delete",
          logDetails,
          deleted_by_user_nic
        );

        return res.status(200).json({
          message: "Attachment deleted successfully (soft delete)",
        });
      }
    );
  });
};



// ✅ Fetch Task History including attachment logs correctly
exports.getTaskHistory = (req, res) => {
  const { taskId } = req.params;

  const historyQuery = `
    (
      SELECT logs.action, logs.details, logs.timestamp, logs.done_by 
      FROM logs
      WHERE logs.entity_type = "task" AND logs.entity_id = ?
    )
    UNION ALL
    (
      SELECT logs.action, logs.details, logs.timestamp, logs.done_by 
      FROM logs
      WHERE logs.entity_type = "task" 
        AND logs.entity_id IN (
          SELECT id FROM maintaskattachment WHERE task_id = ?
        )
        AND logs.action = "delete"
    )
    UNION ALL
    (
      SELECT 'attachment_added' AS action, 
             JSON_OBJECT('file_name', maintaskattachment.name, 'file_path', maintaskattachment.path) AS details, 
             maintaskattachment.created_at AS timestamp, 
             maintaskattachment.added_by AS done_by
      FROM maintaskattachment
      WHERE maintaskattachment.task_id = ? 
    )
    UNION ALL
    (
      SELECT 'assignee_added' AS action, 
             JSON_OBJECT('assignee_name', task_assignees.assignee_name) AS details, 
             task_assignees.assigned_at AS timestamp, 
             task_assignees.assigned_by AS done_by
      FROM task_assignees
      WHERE task_assignees.task_id = ?
    )
    UNION ALL
    (
      SELECT 'tag_added' AS action, 
             JSON_OBJECT('tag_name', task_tags.tag) AS details, 
             task_tags.created_at AS timestamp, 
             NULL AS done_by
      FROM task_tags
      WHERE task_tags.task_id = ?
    )
    ORDER BY timestamp DESC;
  `;

  db.query(
    historyQuery,
    [taskId, taskId, taskId, taskId, taskId],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching task history:", err);
        return res.status(500).json({ error: "Failed to fetch task history" });
      }
      console.log("✅ Task history fetched successfully for Task ID:", taskId);
      res.json(results);
    }
  );
};




exports.getSubtaskCounts = (req, res) => {
  const { taskIds } = req.body; // Get task IDs from request body

  if (!taskIds || !Array.isArray(taskIds)) {
    return res
      .status(400)
      .json({ error: "Invalid request: taskIds must be an array" });
  }

  const query = `
    SELECT task_id,
           COUNT(*) AS total_subtasks,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_subtasks
    FROM subtasks
    WHERE task_id IN (?) AND active = 1
    GROUP BY task_id
  `;

  db.query(query, [taskIds], (err, results) => {
    if (err) {
      console.error("Error executing query:", err);
      return res.status(500).json({ error: "Failed to fetch subtask counts" });
    }

    // Convert results to an object { taskId: "doneSubtasks/totalSubtasks" }
    const counts = {};
    results.forEach(({ task_id, total_subtasks, done_subtasks }) => {
      counts[task_id] = `${done_subtasks}/${total_subtasks}`;
    });

    res.json(counts);
  });
};

exports.getTaskDetails = (req, res) => {
  const { taskId, projectId } = req.params;
  let query;
  let params;

  if (taskId) {
    query = `
      SELECT t.*, p.team_name
      FROM tasks t
      LEFT JOIN pro p ON t.project_id = p.id
      WHERE t.id = ?
    `;
    params = [taskId];
  } else if (projectId) {
    query = "SELECT * FROM tasks WHERE project_id = ? AND active = 1";
    params = [projectId];
  } else {
    return res.status(400).json({ error: "Invalid request parameters" });
  }

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!results.length) {
      return res
        .status(404)
        .json({ error: taskId ? "Task not found" : "No tasks found" });
    }

    const formattedData = results.map((task) => ({
      ...task,
      assignees: task.assignees ? JSON.parse(task.assignees).join(" ") : "",
      tags: task.tags ? JSON.parse(task.tags).join(" ") : "",
    }));

    if (taskId) {
      console.log("Task Details Response:", formattedData[0]);
      return res.json(formattedData[0]);
    }

    const formattedTasks = {
      todo: [],
      inProgress: [],
      underReview: [],
      done: [],
    };

    formattedData.forEach((task) => {
      if (formattedTasks[task.status]) {
        formattedTasks[task.status].push(task);
      }
    });

    res.json(formattedTasks);
  });
};


exports.getTaskStatusSummary = (req, res) => {
  const { taskId } = req.params;

  const query = `
    SELECT 
      t.title AS taskName, 
      s.status, 
      COUNT(*) as count
    FROM subtasks s
    JOIN tasks t ON t.id = s.task_id
    WHERE s.task_id = ? AND s.active = 1
    GROUP BY s.status
  `;

  const assigneeQuery = `
    SELECT 
      ta.assignee_name AS taskAssignee, 
      sa.assignee_name AS subtaskAssignee
    FROM tasks t
    LEFT JOIN task_assignees ta ON t.id = ta.task_id
    LEFT JOIN subtasks s ON t.id = s.task_id
    LEFT JOIN subtask_assignees sa ON s.id = sa.subtask_id
    WHERE t.id = ?
  `;

  db.query(query, [taskId], (err, results) => {
    if (err) {
      console.error("Error fetching task status summary:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No subtasks found" });
    }

    // Extract taskName from first row
    const taskName = results[0].taskName;
    const statusCounts = {};
    let total = 0;
    results.forEach((row) => {
      statusCounts[row.status] = row.count;
      total += row.count;
    });

    db.query(assigneeQuery, [taskId], (err, assigneeResults) => {
      if (err) {
        console.error("Error fetching assignees:", err);
        return res.status(500).json({ error: "Database error" });
      }

      const taskAssignees = [];
      const subtaskAssignees = [];

      assigneeResults.forEach((row) => {
        if (row.taskAssignee && !taskAssignees.includes(row.taskAssignee)) {
          taskAssignees.push(row.taskAssignee);
        }
        if (row.subtaskAssignee && !subtaskAssignees.includes(row.subtaskAssignee)) {
          subtaskAssignees.push(row.subtaskAssignee);
        }
      });

      return res.status(200).json({
        total,
        statusCounts,
        taskName,
        taskAssignees,
        subtaskAssignees,
      });
    });
  });
};

exports.getSubtasksWithAssignees = (req, res) => {
  const { taskId } = req.params;

  const query = `
    SELECT 
      s.id AS subtaskId, 
      s.title AS subtaskTitle,
      s.status AS subtaskStatus,
      sa.assignee_name AS subtaskAssignee
    FROM subtasks s
    LEFT JOIN subtask_assignees sa ON s.id = sa.subtask_id
    WHERE s.task_id = ? AND s.active = 1
  `;

  db.query(query, [taskId], (err, results) => {
    if (err) {
      console.error("Error fetching subtasks with assignees:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const subtasksMap = {};

    results.forEach((row) => {
      const id = row.subtaskId;
      if (!subtasksMap[id]) {
        subtasksMap[id] = {
          id: id,
          title: row.subtaskTitle,
          status: row.subtaskStatus,
          assignees: [],
        };
      }
      if (
        row.subtaskAssignee &&
        !subtasksMap[id].assignees.includes(row.subtaskAssignee)
      ) {
        subtasksMap[id].assignees.push(row.subtaskAssignee);
      }
    });

    const subtasks = Object.values(subtasksMap);

    return res.status(200).json(subtasks);
  });
};


exports.postTaskFieldData = (req, res) => {
  const { taskId } = req.params;
  const {
    field_id,
    field_type,
    value_text,
    value_number,
    value_date,
    value_json,
  } = req.body;

  // Validate required fields
  if (!field_id || !field_type) {
    return res.status(400).json({
      success: false,
      message: "field_id and field_type are required",
    });
  }

  // 1. Check if record exists
  const checkQuery = `
    SELECT id FROM task_field_data 
    WHERE task_id = ? AND field_id = ?
  `;
  db.query(checkQuery, [taskId, field_id], (err, existingRecords) => {
    if (err) {
      console.error("MySQL Error (Check Query):", err);
      return res.status(500).json({
        success: false,
        message: "Failed to check existing records",
        error: err.message,
      });
    }

    let query;
    let params;

    if (existingRecords && existingRecords.length > 0) {
      // 2. Update existing record
      query = `
        UPDATE task_field_data SET
          field_type = ?,
          value_text = ?,
          value_number = ?,
          value_date = ?,
          value_json = ?
        WHERE task_id = ? AND field_id = ?
      `;
      params = [
        field_type,
        value_text,
        value_number,
        value_date,
        value_json,
        taskId,
        field_id,
      ];
    } else {
      // 3. Create new record
      query = `
        INSERT INTO task_field_data (
          task_id, field_id, field_type,
          value_text, value_number, value_date, value_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      params = [
        taskId,
        field_id,
        field_type,
        value_text,
        value_number,
        value_date,
        value_json,
      ];
    }

    // Execute the query (Insert or Update)
    db.query(query, params, (err, result) => {
      if (err) {
        console.error("MySQL Error (Insert/Update Query):", err);
        return res.status(500).json({
          success: false,
          message: "Failed to save field data",
          error: err.message,
        });
      }

      // 4. Return appropriate response
      return res.status(200).json({
        success: true,
        data: {
          task_id: taskId,
          field_id,
          affectedRows: result.affectedRows || 1,
        },
        action: existingRecords.length ? "updated" : "created",
      });
    });
  });
};

// get task field data
exports.getTaskFieldData = (req, res) => {
  const { taskId } = req.params;

  // Query to fetch task field data
  const query = `
    SELECT 
      field_id,
      field_type,
      value_text,
      value_number,
      value_date,
      value_json
    FROM task_field_data
    WHERE task_id = ?
  `;

  db.query(query, [taskId], (err, results) => {
    if (err) {
      console.error("MySQL Error (Get Task Field Data):", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch task field data",
        error: err.message,
      });
    }

    // Return the fetched data
    return res.status(200).json({
      success: true,
      data: results,
    });
  });
};
