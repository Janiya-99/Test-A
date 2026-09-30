const db = require("../db/db");
const multer = require("multer");
const path = require("path"); // Make sure to import path if you haven't already.
const fs = require("fs");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Ensure the folder exists
  },
  filename: (req, file, cb) => {
    // Extract file extension and preserve it
    const fileExtension = path.extname(file.originalname); // Get the file extension
    const timestamp = Date.now(); // Timestamp for unique file name

    // Debugging log to ensure correct extension is being captured
    console.log('Original Filename:', file.originalname);
    console.log('File Extension:', fileExtension);

    // Save the file with timestamp and the correct extension
    cb(null, `${timestamp}${fileExtension}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype) {
      return cb(new Error("Invalid file type"), false);
    }
    cb(null, true);
  },
});


exports.addAttachment = (req, res) => {
  const { subtaskId } = req.params;
  const file = req.file;
  const addedBy = req.body.added_by; // Extract the added_by field from the request body

  console.log("Uploaded file:", file); // Debugging: log the file object

  if (!file) return res.status(400).json({ message: "No file uploaded" });

  const filePath = `uploads/${file.filename}`; // This includes the original extension
  const sql = "INSERT INTO attachments (subtask_id, name, path, added_by) VALUES (?, ?, ?, ?)"; // Include added_by in the SQL query
  
  db.query(sql, [subtaskId, file.originalname, filePath, addedBy], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    res.status(201).json({ message: "Attachment saved", filePath });
  });
};


exports.getAttachments = (req, res) => {
  const { subtaskId } = req.params;
  const sql = "SELECT * FROM attachments WHERE subtask_id = ? AND Active = 1";

  db.query(sql, [subtaskId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const attachmentsWithBase64 = results.map((attachment) => {
      try {
        const filePath = path.join(__dirname, "../", attachment.path); // Ensure correct path
        const mimeType = getMimeType(filePath);
        const fileData = fs.readFileSync(filePath);
        const base64String = fileData.toString("base64");

        return {
          id: attachment.id,  // Include the attachment ID here
          name: attachment.name,
          base64: `data:${mimeType};base64,${base64String}`,
          mimeType,
        };
      } catch (error) {
        console.error("Error reading file:", error);
        return {
          id: attachment.id,  // Include the attachment ID even in case of an error
          name: attachment.name,
          base64: null,
          error: "File could not be read",
        };
      }
    });

    res.status(200).json(attachmentsWithBase64);
  });
};

exports.deleteAttachment = (req, res) => {
  const { attachmentId } = req.params;
  const { deleted_by_user_nic } = req.body; // Extract user name

  if (!deleted_by_user_nic) {
    return res
      .status(400)
      .json({ error: "User name is required for deletion" });
  }

  // ✅ Step 1: Fetch attachment name BEFORE deleting
  const fetchAttachmentQuery = `SELECT name, subtask_id FROM attachments WHERE id = ?`;

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

    const attachmentName = fetchResult[0].name;
    const subtaskId = fetchResult[0].subtask_id;

    // ✅ Step 2: Soft delete attachment
    const sqlSoftDeleteAttachment = `
      UPDATE attachments SET active = 0, deleted_by = ? WHERE id = ?
    `;

    db.query(
      sqlSoftDeleteAttachment,
      [deleted_by_user_nic, attachmentId],
      (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ error: "Attachment not found" });
        }

        // ✅ Step 3: Log the deletion
        const logDetails = {
          message: `Attachment "${attachmentName}" deleted`,
        };

        logAction(
          "subtask", // entityType → subtask
          subtaskId, // entityId → log under subtask
          "delete", // action → make clear it's attachment deletion
          logDetails,
          deleted_by_user_nic
        );

        return res
          .status(200)
          .json({ message: "Attachment deleted successfully (soft delete)" });
      }
    );
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


// Ensure getMimeType function is defined
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
  return mimeTypes[ext] || "application/octet-stream"; // Default fallback
};

// ✅ Fetch Subtask History Including Logs, Attachments, Assignees, and Tags
exports.getSubtaskHistory = (req, res) => {
  const { subtaskId } = req.params;
  console.log(`📩 Fetching subtask history for subtaskId: ${subtaskId}`);

  const historyQuery = `
    (
      SELECT logs.action, logs.details, logs.timestamp, logs.done_by 
      FROM logs
      WHERE logs.entity_type = "subtask" AND logs.entity_id = ?
    )
    UNION ALL
    (
      SELECT 'attachment_added' AS action, 
             JSON_OBJECT('file_name', attachments.name, 'file_path', attachments.path) AS details, 
             attachments.created_at AS timestamp, 
             attachments.added_by AS done_by
      FROM attachments
      WHERE attachments.subtask_id = ?
    )
    UNION ALL
    (
      SELECT 'assignee_added' AS action, 
             JSON_OBJECT('assignee_name', subtask_assignees.assignee_name) AS details, 
             subtask_assignees.assigned_at AS timestamp, 
             subtask_assignees.assigned_by AS done_by
      FROM subtask_assignees
      WHERE subtask_assignees.subtask_id = ?
    )
    UNION ALL
    (
      SELECT 'tag_added' AS action, 
             JSON_OBJECT('tag_name', subtask_tags.tag) AS details, 
             subtask_tags.created_at AS timestamp, 
             subtask_tags.added_by AS done_by
      FROM subtask_tags
      WHERE subtask_tags.subtask_id = ?
    )
    ORDER BY timestamp DESC;
  `;

  db.query(historyQuery, [subtaskId, subtaskId, subtaskId, subtaskId], (err, results) => {
    if (err) {
      console.error("❌ Error fetching subtask history:", err);
      return res.status(500).json({ error: "Failed to fetch subtask history" });
    }
    console.log("✅ Subtask history fetched successfully for Subtask ID:", subtaskId);
    res.json(results);
  });
};


exports.restoresubTask = (req, res) => {
  const { id } = req.params;
  const query = "UPDATE subtasks SET active = 1 WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error restoring task:", err);
      return res.status(500).json({ error: "Database update error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ message: "Task restored successfully" });
  });
};


