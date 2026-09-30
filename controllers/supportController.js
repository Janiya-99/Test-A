const db2 = require("../db/db2");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ─── Multer storage: uploads/support-tickets/<timestamp>-<original> ──────────
const supportStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "../uploads/support-tickets");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed"), false);
};

exports.upload = multer({
  storage: supportStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
});

// ─── Helper: build absolute public URL for a stored file path ────────────────
function buildPublicUrl(req, filePath) {
  // Use SERVER_ROOT_URI from env if set (production), otherwise fall back to the
  // request origin so it works transparently on both localhost and live server.
  const base =
    process.env.SERVER_ROOT_URI ||
    `${req.protocol}://${req.get("host")}`;
  // filePath looks like: .../uploads/support-tickets/1234567890-abc.jpg
  // We want: <base>/uploads/support-tickets/1234567890-abc.jpg
  const relativePart = filePath
    .replace(/\\/g, "/")
    .split("/uploads/")
    .pop();
  return `${base}/uploads/${relativePart}`;
}

// ─── POST /api/support/create ─────────────────────────────────────────────────
exports.createTicket = (req, res) => {
  const { company_id, user_id, subject, description, priority } = req.body;

  if (!company_id || !user_id || !subject || !description) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // Build array of public URLs for each uploaded file
  const attachments = req.files
    ? req.files.map((f) => buildPublicUrl(req, f.path))
    : [];

  const attachmentsJson = attachments.length
    ? JSON.stringify(attachments)
    : null;

  const query = `
    INSERT INTO support_tickets (company_id, user_id, subject, description, priority, attachments)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db2.query(
    query,
    [
      company_id,
      user_id,
      subject,
      description,
      priority || "Low",
      attachmentsJson,
    ],
    (err, result) => {
      if (err) {
        console.error("Error creating ticket:", err);
        return res.status(500).json({ message: "Database error" });
      }
      const initialMsgQuery = `
        INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_id, message, attachments, is_read_by_admin, is_read_by_customer)
        VALUES (?, 'customer', ?, ?, ?, false, true)
      `;
      db2.query(initialMsgQuery, [result.insertId, user_id, description, attachmentsJson], (msgErr) => {
        if (msgErr) console.error('Error creating initial ticket message:', msgErr);
        res.status(201).json({
          message: "Ticket created successfully",
          ticketId: result.insertId,
          attachments,
        });
      });
    }
  );
};

// ─── GET /api/support/company/:company_id ─────────────────────────────────────
exports.getTickets = (req, res) => {
  const { company_id } = req.params;
  const { status, search, days, user_filter, current_user_id } = req.query;

  if (!company_id) {
    return res.status(400).json({ message: "Company ID is required" });
  }

  let query = `SELECT * FROM support_tickets WHERE company_id = ?`;
  const params = [company_id];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (user_filter === "me" && current_user_id) {
    query += ` AND user_id = ?`;
    params.push(current_user_id);
  }

  if (days) {
    query += ` AND created_at >= NOW() - INTERVAL ? DAY`;
    params.push(Number(days));
  }

  if (search) {
    query += ` AND (subject LIKE ? OR description LIKE ?)`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  query += ` ORDER BY created_at DESC`;

  db2.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching tickets:", err);
      return res.status(500).json({ message: "Database error" });
    }

    // Parse JSON attachments column (stored as JSON string in DB)
    const parsed = results.map((row) => ({
      ...row,
      attachments: row.attachments
        ? typeof row.attachments === "string"
          ? JSON.parse(row.attachments)
          : row.attachments
        : [],
    }));

    res.status(200).json(parsed);
  });
};

// ─── GET /api/support/counts/:company_id ─────────────────────────────────────
exports.getTicketCounts = (req, res) => {
  const { company_id } = req.params;
  const { user_id } = req.query;

  if (!company_id) {
    return res.status(400).json({ message: "Company ID is required" });
  }

  const queries = {
    all: `SELECT COUNT(*) as count FROM support_tickets WHERE company_id = ?`,
    my_open: `SELECT COUNT(*) as count FROM support_tickets WHERE company_id = ? AND user_id = ? AND status = 'Open'`,
    my_recent: `SELECT COUNT(*) as count FROM support_tickets WHERE company_id = ? AND user_id = ? AND created_at >= NOW() - INTERVAL 7 DAY`,
    by_status: `SELECT status, COUNT(*) as count FROM support_tickets WHERE company_id = ? GROUP BY status`,
  };

  const results = {
    all: 0,
    my_open: 0,
    my_recent: 0,
    status_counts: {},
  };

  const runQuery = (sql, params) =>
    new Promise((resolve, reject) => {
      db2.query(sql, params, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });

  Promise.all([
    runQuery(queries.all, [company_id]),
    runQuery(queries.my_open, [company_id, user_id]),
    runQuery(queries.my_recent, [company_id, user_id]),
    runQuery(queries.by_status, [company_id]),
  ])
    .then(([allRes, myOpenRes, myRecentRes, statusRes]) => {
      results.all = allRes[0]?.count || 0;
      results.my_open = myOpenRes[0]?.count || 0;
      results.my_recent = myRecentRes[0]?.count || 0;
      statusRes.forEach((row) => {
        results.status_counts[row.status] = row.count;
      });
      res.status(200).json(results);
    })
    .catch((err) => {
      console.error("Error fetching counts:", err);
      res.status(500).json({ message: "Database error" });
    });
};

// ─── GET /api/support/all  (admin: all tickets across companies) ──────────────
exports.getAllTickets = (req, res) => {
  const { status, search, company_id } = req.query;

  let query = `
    SELECT st.*, NULL AS company_name
    FROM support_tickets st
    WHERE 1=1
  `;
  const params = [];

  if (company_id) {
    query += ` AND st.company_id = ?`;
    params.push(company_id);
  }

  if (status) {
    query += ` AND st.status = ?`;
    params.push(status);
  }

  if (search) {
    query += ` AND (st.subject LIKE ? OR st.description LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s);
  }

  query += ` ORDER BY st.created_at DESC`;

  db2.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching all tickets:", err);
      return res.status(500).json({ message: "Database error" });
    }

    const parsed = results.map((row) => ({
      ...row,
      attachments: row.attachments
        ? typeof row.attachments === "string"
          ? JSON.parse(row.attachments)
          : row.attachments
        : [],
    }));

    res.status(200).json(parsed);
  });
};

// ─── PATCH /api/support/:id/status  (admin: update ticket status) ────────────
exports.updateTicketStatus = (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ["Open", "Pending", "On hold", "Solved", "Closed"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: "Invalid status value" });
  }

  db2.query(
    "UPDATE support_tickets SET status = ? WHERE id = ?",
    [status, id],
    (err) => {
      if (err) {
        console.error("Error updating ticket status:", err);
        return res.status(500).json({ message: "Database error" });
      }
      res.status(200).json({ message: "Status updated successfully" });
    }
  );
};


// ─── GET /api/support/:id/messages (fetch conversation thread) ─────────────────
exports.getTicketMessages = (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT stm.*,
           CASE 
             WHEN stm.sender_type = 'customer' THEN CONCAT(COALESCE(u.First_Name, ''), ' ', COALESCE(u.Last_Name, ''))
             WHEN stm.sender_type = 'admin' THEN COALESCE(a.name, 'Support Staff')
             ELSE 'User'
           END AS sender_name
    FROM support_ticket_messages stm
    LEFT JOIN asipiya_user u ON stm.sender_type = 'customer' AND stm.sender_id = u.idAsipiya_User
    LEFT JOIN admin a ON stm.sender_type = 'admin' AND stm.sender_id = a.id
    WHERE stm.ticket_id = ?
    ORDER BY stm.created_at ASC
  `;

  db2.query(query, [id], (err, results) => {
    if (err) {
      console.error('Error fetching ticket messages:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    // Mark messages as read by customer
    db2.query(
      'UPDATE support_ticket_messages SET is_read_by_customer = true WHERE ticket_id = ? AND sender_type = "admin"',
      [id]
    );

    const parsed = results.map((row) => ({
      ...row,
      attachments: row.attachments
        ? typeof row.attachments === 'string'
          ? JSON.parse(row.attachments)
          : row.attachments
        : [],
    }));

    res.status(200).json(parsed);
  });
};

// ─── POST /api/support/:id/messages (customer reply to ticket) ────────────────
exports.addMessage = (req, res) => {
  const { id } = req.params;
  const { user_id, message } = req.body;

  if (!user_id || !message) {
    return res.status(400).json({ message: 'User ID and message are required' });
  }

  const attachments = req.files
    ? req.files.map((f) => buildPublicUrl(req, f.path))
    : [];
  const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;

  const query = `
    INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_id, message, attachments, is_read_by_admin, is_read_by_customer)
    VALUES (?, 'customer', ?, ?, ?, false, true)
  `;

  db2.query(query, [id, user_id, message, attachmentsJson], (err, result) => {
    if (err) {
      console.error('Error adding message:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    // Update ticket status to Open if closed or pending, and update updated_at
    db2.query(
      "UPDATE support_tickets SET updated_at = NOW(), status = CASE WHEN status = 'Closed' THEN 'Open' WHEN status = 'Solved' THEN 'Open' ELSE status END WHERE id = ?",
      [id]
    );

    res.status(201).json({
      message: 'Message added successfully',
      messageId: result.insertId,
      attachments,
    });
  });
};

// ─── GET /api/support/unread-count/:company_id (for customer navbar badge) ─────
exports.getUnreadCustomerCount = (req, res) => {
  const { company_id } = req.params;
  const { user_id } = req.query;

  const query = `
    SELECT COUNT(DISTINCT stm.ticket_id) AS unread_count
    FROM support_ticket_messages stm
    JOIN support_tickets st ON stm.ticket_id = st.id
    WHERE st.company_id = ?
      ` + (user_id ? 'AND st.user_id = ? ' : '') + `
      AND stm.sender_type = 'admin'
      AND stm.is_read_by_customer = false
  `;

  const params = user_id ? [company_id, user_id] : [company_id];

  db2.query(query, params, (err, results) => {
    if (err) {
      console.error('Error fetching unread count for customer:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.status(200).json({ unread_count: results[0]?.unread_count || 0 });
  });
};
