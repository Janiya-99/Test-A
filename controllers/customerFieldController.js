const db = require("../db/db");

exports.createCustomerField = (req, res) => {
  const {
    field_type,
    field_name,
    description,
    tags,
    required,
    created_by,
    branch_id,
    options, // optional
    show_in_invoice,
  } = req.body;

  // --- Validation ---
  if (!field_type || !field_name || !branch_id) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: field_type, field_name, and branch_id are mandatory.",
    });
  }

  const b_id = parseInt(branch_id);
  const c_by = parseInt(created_by) || 0;

  const fieldSQL = `
    INSERT INTO customer_fields 
    (field_type, field_name, description, tags, required, created_by, branch_id, show_in_invoice, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
  `;

  db.query(
    fieldSQL,
    [
      field_type,
      field_name,
      description || "",
      tags || "",
      required ? 1 : 0,
      c_by,
      b_id,
      show_in_invoice ? 1 : 0,
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Error inserting customer field:", err);
        return res
          .status(500)
          .json({ 
            success: false, 
            message: "Failed to create field.",
            details: err.sqlMessage || err.message,
            code: err.code
          });
      }

      const field_id = result.insertId;

      // Insert options if field type is option-based
      if (
        (field_type === "Dropdown" ||
          field_type === "Checkbox" ||
          field_type === "RadioButton") &&
        options &&
        Array.isArray(options) &&
        options.length > 0
      ) {
        const optionValues = options.map((opt) => [field_id, opt, created_by]);

        const optionSQL = `
          INSERT INTO customer_field_options 
          (customer_field_id, option_text, created_by)
          VALUES ?
        `;

        db.query(optionSQL, [optionValues], (err2) => {
          if (err2) {
            console.error("❌ Error inserting options:", err2);
            return res
              .status(500)
              .json({
                success: false,
                message: "Failed to save field options.",
                details: err2.sqlMessage || err2.message,
                code: err2.code
              });
          }

          return res.status(201).json({
            success: true,
            message: "Customer field and options created successfully.",
            field_id,
          });
        });
      } else {
        return res.status(201).json({
          success: true,
          message: "Customer field created successfully.",
          field_id,
        });
      }
    }
  );
};

// Get all customer fields (and options) by branch_id
exports.getCustomerFieldsByBranch = (req, res) => {
  const branchId = parseInt(req.params.branchId);

  if (!branchId) {
    return res
      .status(400)
      .json({ success: false, message: "Branch ID is required" });
  }

  const fieldSQL = `
    SELECT * FROM customer_fields WHERE branch_id = ? ORDER BY id DESC
  `;

  db.query(fieldSQL, [branchId], (err, fields) => {
    if (err) {
      console.error("❌ Error fetching fields:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch fields",
      });
    }

    if (fields.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Fetch all field options for matched field IDs
    const fieldIds = fields.map((f) => f.id);

    const optionSQL = `
      SELECT * FROM customer_field_options 
      WHERE customer_field_id IN (?)
    `;

    db.query(optionSQL, [fieldIds], (err2, options) => {
      if (err2) {
        console.error("❌ Error fetching options:", err2);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch options",
        });
      }

      // Attach options to their fields
      const fieldMap = {};
      fields.forEach((f) => {
        fieldMap[f.id] = { ...f, options: [] };
      });

      options.forEach((opt) => {
        fieldMap[opt.customer_field_id].options.push(opt);
      });

      const result = Object.values(fieldMap);
      return res.status(200).json({ success: true, data: result });
    });
  });
};


exports.updateCustomerField = (req, res) => {
  const fieldId = req.params.id;
  const {
    field_type,
    field_name,
    description,
    tags,
    required,
    created_by,
    branch_id,
    options,
    show_in_invoice,
  } = req.body;

  // Generate field_label from field_name
  const field_label = field_name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());

  // First update the main field
  const updateFieldSQL = `
    UPDATE customer_fields 
    SET 
      field_type = ?,
      field_name = ?,
      description = ?,
      tags = ?,
      required = ?,
      show_in_invoice = ?,
      updated_at = NOW()
    WHERE id = ? AND branch_id = ?
  `;

  db.query(
    updateFieldSQL,
    [
      field_type,
      field_name,
      description,
      tags,
      required ? 1 : 0,
      show_in_invoice ? 1 : 0,
      fieldId,
      branch_id
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Error updating product field:", err);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to update field.",
          details: err.sqlMessage || err.message,
          code: err.code
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Field not found or not owned by this branch." 
        });
      }

      // For option-based fields, update the options
      if (
        field_type === "Dropdown" ||
        field_type === "Checkbox" ||
        field_type === "RadioButton"
      ) {
        // First delete all existing options
        const deleteOptionsSQL = `
          DELETE FROM customer_field_options 
          WHERE customer_field_id = ?
        `;

        db.query(deleteOptionsSQL, [fieldId], (delErr) => {
          if (delErr) {
            console.error("❌ Error deleting old options:", delErr);
            return res.status(500).json({ 
              success: false, 
              message: "Failed to update field options." 
            });
          }

          // Insert new options if provided
          if (options && Array.isArray(options) && options.length > 0) {
            const optionValues = options.map((opt) => [
              fieldId,
              opt,
              created_by,
            ]);

            const insertOptionsSQL = `
              INSERT INTO customer_field_options 
              (customer_field_id, option_text, created_by)
              VALUES ?
            `;

            db.query(insertOptionsSQL, [optionValues], (insertErr) => {
              if (insertErr) {
                console.error("❌ Error inserting new options:", insertErr);
                return res.status(500).json({ 
                  success: false, 
                  message: "Field updated but options failed to save." 
                });
              }

              return res.json({
                success: true,
                message: "Field and options updated successfully.",
              });
            });
          } else {
            return res.json({
              success: true,
              message: "Field updated successfully (no options to save).",
            });
          }
        });
      } else {
        return res.json({
          success: true,
          message: "Field updated successfully.",
        });
      }
    }
  );
};


exports.deleteCustomerField = (req, res) => {
  const fieldId = req.params.id;

  // First delete all options associated with this field
  const deleteOptionsSQL = `
    DELETE FROM customer_field_options 
    WHERE customer_field_id = ?
  `;

  db.query(deleteOptionsSQL, [fieldId], (delOptErr) => {
    if (delOptErr) {
      console.error("❌ Error deleting field options:", delOptErr);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to delete field options." 
      });
    }

    // Then delete the field itself
    const deleteFieldSQL = `
      DELETE FROM customer_fields 
      WHERE id = ?
    `;

    db.query(deleteFieldSQL, [fieldId], (delFieldErr, result) => {
      if (delFieldErr) {
        console.error("❌ Error deleting customer field:", delFieldErr);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to delete field." 
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ 
          success: false, 
          message: "Field not found." 
        });
      }

      res.json({ 
        success: true, 
        message: "Field deleted successfully." 
      });

    });
  });
};