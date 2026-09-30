const db = require("../db/db");

// Get GRN settings for a specific branch and supplier
exports.getGrnSettings = (req, res) => {
  const branchId = req.params.branchId;
  const supplierId = req.params.supplierId;

  if (!branchId || !supplierId) {
    return res.status(400).json({ error: "Branch ID and Supplier ID are required" });
  }

  const query = "SELECT * FROM grn_settings WHERE branch_id = ? AND supplier_id = ? LIMIT 1";

  db.query(query, [branchId, supplierId], (err, results) => {
    if (err) {
      console.error("Database error for GRN Settings:", err);
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      return res.json({ settings: null });
    }

    res.json({ settings: results[0] });
  });
};

// Save or update GRN settings
exports.saveGrnSettings = (req, res) => {
  const branchId = req.params.branchId;
  const supplierId = req.params.supplierId;
  const { show_bank_account, bank_account_details } = req.body;

  if (!branchId || !supplierId) {
    return res.status(400).json({ error: "Branch ID and Supplier ID are required" });
  }

  const data = {
    branch_id: branchId,
    supplier_id: supplierId,
    show_bank_account: show_bank_account ? 1 : 0,
    bank_account_details: bank_account_details || "",
  };

  // Check if a record exists for this branch and supplier
  db.query(
    "SELECT id FROM grn_settings WHERE branch_id = ? AND supplier_id = ?",
    [branchId, supplierId],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (results.length > 0) {
        // Update existing record
        db.query(
          "UPDATE grn_settings SET ? WHERE branch_id = ? AND supplier_id = ?",
          [{ show_bank_account: data.show_bank_account, bank_account_details: data.bank_account_details }, branchId, supplierId],
          (err, result) => {
            if (err) {
              console.error("Update error:", err);
              return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: "GRN settings updated" });
          }
        );
      } else {
        // Insert new record
        db.query("INSERT INTO grn_settings SET ?", data, (err, result) => {
          if (err) {
            console.error("Insert error:", err);
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, message: "GRN settings created" });
        });
      }
    }
  );
};
