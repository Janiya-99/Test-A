const db = require("../db/db"); 

// Get all active banks
exports.getAllBanks = async (req, res) => {
  const query = `
    SELECT 
      idBank, 
      bank_name, 
      bank_number, 
      branch_idBranch,
      created_at,
      updated_at
    FROM banks 
    WHERE is_active = TRUE 
    ORDER BY bank_name ASC
  `;
  db.query(query, (error, banks) => {
    if (error) {
      console.error("Get banks error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch banks",
        error: error.message
      });
    }
    res.json({
      success: true,
      data: banks,
      count: banks.length
    });
  });
};

// Get bank by ID
exports.getBankById = async (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT 
      idBank, 
      bank_name, 
      bank_number, 
      branch_idBranch,
      created_at,
      updated_at
    FROM banks 
    WHERE idBank = ? AND is_active = TRUE
  `;
  db.query(query, [id], (error, banks) => {
    if (error) {
      console.error("Get bank by ID error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch bank",
        error: error.message
      });
    }
    if (banks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Bank not found"
      });
    }
    res.json({
      success: true,
      data: banks[0]
    });
  });
};

// Create new bank
exports.createBank = async (req, res) => {
  const { bank_name, bank_number, branch_idBranch } = req.body;
  if (!bank_name || !bank_number || !branch_idBranch) {
    return res.status(400).json({
      success: false,
      message: "Bank name, bank number, and branch are required"
    });
  }
  // Check if bank number already exists in the same branch
  const checkQuery = `
    SELECT idBank FROM banks 
    WHERE bank_number = ? AND branch_idBranch = ? AND is_active = TRUE
  `;
  db.query(checkQuery, [bank_number, branch_idBranch], (error, existingBanks) => {
    if (error) {
      console.error("Create bank error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create bank",
        error: error.message
      });
    }
    if (existingBanks.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Bank number already exists in this branch"
      });
    }
    // Insert new bank
    const insertQuery = `
      INSERT INTO banks (bank_name, bank_number, branch_idBranch, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
    `;
    db.query(insertQuery, [bank_name.trim(), bank_number.trim(), branch_idBranch], (error, result) => {
      if (error) {
        console.error("Create bank error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to create bank",
          error: error.message
        });
      }
      // Get the newly created bank
      db.query(
        `SELECT idBank, bank_name, bank_number, branch_idBranch, created_at, updated_at 
         FROM banks WHERE idBank = ?`,
        [result.insertId],
        (error, newBank) => {
          if (error) {
            console.error("Create bank error:", error);
            return res.status(500).json({
              success: false,
              message: "Failed to create bank",
              error: error.message
            });
          }
          res.status(201).json({
            success: true,
            message: "Bank created successfully",
            data: newBank[0]
          });
        }
      );
    });
  });
};

// Update bank
exports.updateBank = async (req, res) => {
  const { id } = req.params;
  const { bank_name, bank_number } = req.body;
  if (!bank_name || !bank_number) {
    return res.status(400).json({
      success: false,
      message: "Bank name and bank number are required"
    });
  }
  // Check if bank exists
  const checkQuery = `
    SELECT idBank, branch_idBranch FROM banks 
    WHERE idBank = ? AND is_active = TRUE
  `;
  db.query(checkQuery, [id], (error, banks) => {
    if (error) {
      console.error("Update bank error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update bank",
        error: error.message
      });
    }
    if (banks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Bank not found"
      });
    }
    const existingBank = banks[0];
    // Check if bank number already exists (excluding current bank)
    const duplicateQuery = `
      SELECT idBank FROM banks 
      WHERE bank_number = ? AND branch_idBranch = ? AND is_active = TRUE AND idBank != ?
    `;
    db.query(duplicateQuery, [bank_number, existingBank.branch_idBranch, id], (error, duplicates) => {
      if (error) {
        console.error("Update bank error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to update bank",
          error: error.message
        });
      }
      if (duplicates.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Bank number already exists in this branch"
        });
      }
      // Update bank
      const updateQuery = `
        UPDATE banks 
        SET bank_name = ?, bank_number = ?, updated_at = NOW()
        WHERE idBank = ?
      `;
      db.query(updateQuery, [bank_name.trim(), bank_number.trim(), id], (error) => {
        if (error) {
          console.error("Update bank error:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to update bank",
            error: error.message
          });
        }
        // Get updated bank
        db.query(
          `SELECT idBank, bank_name, bank_number, branch_idBranch, created_at, updated_at 
           FROM banks WHERE idBank = ?`,
          [id],
          (error, updatedBank) => {
            if (error) {
              console.error("Update bank error:", error);
              return res.status(500).json({
                success: false,
                message: "Failed to update bank",
                error: error.message
              });
            }
            res.json({
              success: true,
              message: "Bank updated successfully",
              data: updatedBank[0]
            });
          }
        );
      });
    });
  });
};

// Delete bank (soft delete)
exports.deleteBank = async (req, res) => {
  const { id } = req.params;
  // Check if bank exists
  const checkQuery = `
    SELECT idBank FROM banks 
    WHERE idBank = ? AND is_active = TRUE
  `;
  db.query(checkQuery, [id], (error, banks) => {
    if (error) {
      console.error("Delete bank error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete bank",
        error: error.message
      });
    }
    if (banks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Bank not found"
      });
    }
    // Soft delete
    const deleteQuery = `
      UPDATE banks 
      SET is_active = FALSE, updated_at = NOW()
      WHERE idBank = ?
    `;
    db.query(deleteQuery, [id], (error) => {
      if (error) {
        console.error("Delete bank error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to delete bank",
          error: error.message
        });
      }
      res.json({
        success: true,
        message: "Bank deleted successfully"
      });
    });
  });
};

// Get banks by branch
exports.getBanksByBranch = async (req, res) => {
  const { branchId } = req.params;
  const query = `
    SELECT 
      idBank, 
      bank_name, 
      bank_number, 
      branch_idBranch,
      created_at,
      updated_at
    FROM banks 
    WHERE branch_idBranch = ? AND is_active = TRUE 
    ORDER BY bank_name ASC
  `;
  db.query(query, [branchId], (error, banks) => {
    if (error) {
      console.error("Get banks by branch error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch banks for branch",
        error: error.message
      });
    }
    res.json({
      success: true,
      data: banks,
      count: banks.length
    });
  });
};

// Search banks by name or number
exports.searchBanks = async (req, res) => {
  const { search, branchId } = req.query;
  if (!search || search.trim() === '') {
    return res.status(400).json({
      success: false,
      message: "Search query is required"
    });
  }
  const searchTerm = `%${search.trim()}%`;
  let query, params;
  if (branchId) {
    query = `
      SELECT idBank, bank_name, bank_number, branch_idBranch
      FROM banks 
      WHERE (bank_name LIKE ? OR bank_number LIKE ?) 
        AND branch_idBranch = ? 
        AND is_active = TRUE
      ORDER BY bank_name ASC
      LIMIT 20
    `;
    params = [searchTerm, searchTerm, branchId];
  } else {
    query = `
      SELECT idBank, bank_name, bank_number, branch_idBranch
      FROM banks 
      WHERE (bank_name LIKE ? OR bank_number LIKE ?) 
        AND is_active = TRUE
      ORDER BY bank_name ASC
      LIMIT 20
    `;
    params = [searchTerm, searchTerm];
  }
  db.query(query, params, (error, banks) => {
    if (error) {
      console.error("Search banks error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to search banks",
        error: error.message
      });
    }
    res.json({
      success: true,
      data: banks,
      count: banks.length
    });
  });
};