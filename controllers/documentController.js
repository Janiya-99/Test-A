const db2 = require("../db/db2");
const fs = require("fs");
const path = require("path");

// --- Helper for Query Promises ---
const runQuery = (sql, params) => {
  return new Promise((resolve, reject) => {
    db2.query(sql, params, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
};

// --- Dashboard Stats ---
exports.getDashboardStats = async (req, res) => {
  const { company_id } = req.query;

  if (!company_id) {
    return res.status(400).json({ message: "Company ID is required" });
  }

  try {
    const totalFilesQuery = `SELECT COUNT(*) as count FROM documents WHERE company_id = ?`;
    const totalSizeQuery = `SELECT SUM(size) as size FROM documents WHERE company_id = ?`;
    const totalFoldersQuery = `SELECT COUNT(*) as count FROM document_folders WHERE company_id = ?`;
    const recentUploadsQuery = `SELECT * FROM documents WHERE company_id = ? ORDER BY created_at DESC LIMIT 5`;
    const storageLimitQuery = `SELECT storage_limit FROM companyhassoftware WHERE company_id = ?`;

    const [filesRes, sizeRes, foldersRes, recentRes, limitRes] =
      await Promise.all([
        runQuery(totalFilesQuery, [company_id]),
        runQuery(totalSizeQuery, [company_id]),
        runQuery(totalFoldersQuery, [company_id]),
        runQuery(recentUploadsQuery, [company_id]),
        runQuery(storageLimitQuery, [company_id]),
      ]);

    res.status(200).json({
      totalFiles: filesRes[0]?.count || 0,
      usedStorage: sizeRes[0]?.size || 0,
      totalFolders: foldersRes[0]?.count || 0,
      recentUploads: recentRes || [],
      storageLimit: limitRes[0]?.storage_limit || 104857600, // Default 100MB
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ message: "Database error" });
  }
};

// --- Folders ---
exports.getFolders = async (req, res) => {
  const { company_id, parent_id } = req.query;

  if (!company_id) {
    return res.status(400).json({ message: "Company ID is required" });
  }

  try {
    let query = `SELECT * FROM document_folders WHERE company_id = ?`;
    const params = [company_id];

    if (parent_id) {
      query += ` AND parent_id = ?`;
      params.push(parent_id);
    } else {
      query += ` AND parent_id IS NULL`;
    }

    query += ` ORDER BY name ASC`;

    const folders = await runQuery(query, params);
    res.status(200).json(folders);
  } catch (err) {
    console.error("Error fetching folders:", err);
    res.status(500).json({ message: "Database error" });
  }
};

exports.createFolder = async (req, res) => {
  const { company_id, name, parent_id } = req.body;

  if (!company_id || !name) {
    return res
      .status(400)
      .json({ message: "Company ID and Name are required" });
  }

  try {
    const sql = `INSERT INTO document_folders (company_id, name, parent_id) VALUES (?, ?, ?)`;
    const result = await runQuery(sql, [company_id, name, parent_id || null]);
    res
      .status(201)
      .json({ message: "Folder created", folderId: result.insertId });
  } catch (err) {
    console.error("Error creating folder:", err);
    res.status(500).json({ message: "Database error" });
  }
};

exports.deleteFolder = async (req, res) => {
  const { id } = req.params;

  try {
    // Ideally this should recursively delete content, but for now blocking if not empty is safer
    // Or we can just delete the folder entry and orphans stay (bad practice).
    // Let's check if empty first.
    const fileCount = await runQuery(
      `SELECT COUNT(*) as count FROM documents WHERE folder_id = ?`,
      [id],
    );
    const folderCount = await runQuery(
      `SELECT COUNT(*) as count FROM document_folders WHERE parent_id = ?`,
      [id],
    );

    if ((fileCount[0]?.count || 0) > 0 || (folderCount[0]?.count || 0) > 0) {
      return res
        .status(400)
        .json({ message: "Folder must be empty to delete" });
    }

    await runQuery(`DELETE FROM document_folders WHERE id = ?`, [id]);
    res.status(200).json({ message: "Folder deleted" });
  } catch (err) {
    console.error("Error deleting folder:", err);
    res.status(500).json({ message: "Database error" });
  }
};

// --- Documents ---
exports.getDocuments = async (req, res) => {
  const { company_id, folder_id, search, category } = req.query;

  if (!company_id) {
    res.status(400).json({ message: "Company ID is required" });
    return;
  }

  try {
    let query = `SELECT * FROM documents WHERE company_id = ?`;
    const params = [company_id];

    if (search) {
      query += ` AND original_name LIKE ?`;
      params.push(`%${search}%`);
    } else {
      // Normal navigation mode
      if (folder_id) {
        query += ` AND folder_id = ?`;
        params.push(folder_id);
      } else {
        query += ` AND folder_id IS NULL`;
      }
    }

    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }

    query += ` ORDER BY created_at DESC`;

    const documents = await runQuery(query, params);
    res.status(200).json(documents);
  } catch (err) {
    console.error("Error getting documents:", err);
    res.status(500).json({ message: "Database error" });
  }
};

exports.uploadDocument = async (req, res) => {
  // Multer middleware should have run before this
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const { company_id, folder_id, category } = req.body;
  if (!company_id) {
    return res.status(400).json({ message: "Company ID is required" });
  }

  try {
    const { filename, originalname, path: filePath, size, mimetype } = req.file;

    const sql = `
        INSERT INTO documents (company_id, folder_id, filename, original_name, path, file_type, size, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await runQuery(sql, [
      company_id,
      folder_id || null,
      filename,
      originalname,
      filePath.replace(/\\/g, "/"), // Ensure forward slashes for cross-platform compatibility
      mimetype,
      size,
      category || "Other",
    ]);

    res.status(201).json({
      message: "File uploaded successfully",
      fileId: result.insertId,
      file: {
        filename,
        original_name: originalname,
        size,
      },
    });
  } catch (err) {
    console.error("Error saving document info:", err);
    res.status(500).json({ message: "Database error" });
  }
};

exports.deleteDocument = async (req, res) => {
  const { id } = req.params;

  try {
    const docs = await runQuery(`SELECT * FROM documents WHERE id = ?`, [id]);
    if (docs.length === 0) {
      return res.status(404).json({ message: "Document not found" });
    }
    const doc = docs[0];

    // Delete from DB first
    await runQuery(`DELETE FROM documents WHERE id = ?`, [id]);

    // Delete from filesystem
    const absolutePath = path.resolve(doc.path);
    fs.unlink(absolutePath, (err) => {
      if (err) console.error("Failed to delete local file:", absolutePath, err);
    });

    res.status(200).json({ message: "Document deleted" });
  } catch (err) {
    console.error("Error deleting document:", err);
    res.status(500).json({ message: "Database error" });
  }
};
