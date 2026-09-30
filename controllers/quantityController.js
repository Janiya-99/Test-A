const db = require("../db/db");
const db2 = require("../db/db2");

const getSiblingBranchIds = (branchId) => {
  return new Promise((resolve, reject) => {
    // 1. Get Company ID from db2
    const companyQuery =
      "SELECT Company_idCompany FROM branch WHERE idBranch = ?";
    db2.query(companyQuery, [branchId], (err, results) => {
      if (err) return reject(err);
      if (results.length === 0) return resolve([branchId]); // Fallback

      const companyId = results[0].Company_idCompany;

      // 2. Get all branches for this company from db2
      const branchesQuery =
        "SELECT idBranch FROM branch WHERE Company_idCompany = ?";
      db2.query(branchesQuery, [companyId], (err2, branchRows) => {
        if (err2) return reject(err2);

        const ids = branchRows.map((b) => b.idBranch);
        resolve(ids.length > 0 ? ids : [branchId]);
      });
    });
  });
};

// Create Quantity Type
const createQuantityType = async (req, res) => {
  try {
    const { description, Branch_idBranch } = req.body;

    const sql = `
      INSERT INTO quantity_type (Description, Branch_idBranch)
      VALUES (?, ?)
    `;
    db.query(sql, [description, Branch_idBranch], (err, result) => {
      if (err) {
        console.error("Insert failed:", err);
        return res
          .status(500)
          .json({ message: "Insert failed", error: err.message });
      }
      res.status(201).json({ message: "Quantity Type added successfully" });
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating Quantity Type", error: err.message });
  }
};

// Get Quantity Types by Branch ID
const getQuantityTypes = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const branchIds = await getSiblingBranchIds(Branch_idBranch);
    const sql = "SELECT * FROM quantity_type WHERE Branch_idBranch IN (?)";
    db.query(sql, [branchIds], (err, results) => {
      if (err) {
        console.error("Fetch failed:", err);
        return res
          .status(500)
          .json({ message: "Fetch failed", error: err.message });
      }

      const formatted = results.map((row) => ({
        id: row.idQuantity_Type,
        name: row.idQuantity_Type.toString(),
        description: row.Description,
      }));

      res.json(formatted);
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching Quantity Types", error: err.message });
  }
};

// Update Quantity Type
const updateQuantityType = async (req, res) => {
  try {
    const { id } = req.params;
    const { description, Branch_idBranch } = req.body;

    const sql = `
      UPDATE quantity_type
      SET Description = ?, Branch_idBranch = ?
      WHERE idQuantity_Type = ?
    `;
    db.query(sql, [description, Branch_idBranch, id], (err, result) => {
      if (err) {
        console.error("Update failed:", err);
        return res.status(500).json({ message: "Update failed", error: err.message });
      }
      res.json({ message: "Quantity Type updated successfully" });
    });
  } catch (err) {
    res.status(500).json({ message: "Error updating Quantity Type", error: err.message });
  }
};



// Delete Quantity Type
const deleteQuantityType = (req, res) => {
  const { id } = req.params;
  const sql = "DELETE FROM quantity_type WHERE idQuantity_Type = ?";
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Delete failed:", err);
      return res.status(500).json({ message: "Delete failed", error: err.message });
    }
    res.json({ message: "Quantity Type deleted successfully" });
  });
};

module.exports = {
  createQuantityType,
  getQuantityTypes,
  updateQuantityType,
  deleteQuantityType,
};
