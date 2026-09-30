const db = require("../db/db");

// ==========================
// CREATE Custom Field
// ==========================
exports.createField = (req, res) => {
  const {
    project_id,
    field_type,
    field_name,
    description = "",
    tags = "",
    created_by,
    required = 0,
    members = [],
    teams = [],
    selection_type = null,
    people_type = null,
  } = req.body;

  console.log("📥 Incoming Field Payload:", {
    project_id,
    field_type,
    field_name,
    description,
    tags,
    created_by,
    required,
    members,
    teams,
    selection_type,
    people_type,
  });

  const sql = `
    INSERT INTO CustomFields 
    (project_id, field_type, field_name, description, tags, created_by, active, required, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, NOW())
  `;

  db.query(
    sql,
    [
      project_id,
      field_type,
      field_name,
      description,
      tags,
      created_by,
      required,
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Error inserting custom field:", err);
        return res.status(500).json({ message: "Failed to create field." });
      }

      const field_id = result.insertId;

      // ✅ Handle People Field: Specific Members
      if (field_type === "People") {
        if (selection_type === "People" && members.length > 0) {
          const values = members.map((member_id) => [
            field_id,
            member_id,
            created_by,
          ]);

          const memberSQL = `
            INSERT INTO PeopleMembers (field_id, member_id, created_by)
            VALUES ?
          `;

          db.query(memberSQL, [values], (err2) => {
            if (err2) {
              console.error("❌ Error inserting PeopleMembers:", err2);
              return res
                .status(500)
                .json({ message: "Failed to save members." });
            }

            return res.status(201).json({
              message: "People field with members created successfully!",
              field_id: field_id,
            });
          });
        }

        // 🚧 You can later handle Group/Teams here (currently unimplemented)
        else if (selection_type === "Group" && teams.length > 0) {
          // Optional: add logic to save team-based People fields
          return res.status(201).json({
            message: "People field with teams received (not yet implemented).",
            field_id: field_id,
          });
        }

        // Fallback if no members or teams
        else {
          return res.status(201).json({
            message: "People field created with no members or teams.",
            field_id: field_id,
          });
        }
      }

      // ✅ Non-People fields
      return res.status(201).json({
        message: "Custom Field created successfully!",
        field_id: field_id,
      });
    }
  );
};

// ==========================
// CREATE Field Option (Dropdown/Checkbox)
// ==========================
exports.createOption = (req, res) => {
  const { field_id } = req.params;
  const { option_text, created_by } = req.body;

  const sql = `
    INSERT INTO FieldOptions 
    (field_id, option_text, created_by, active, created_at) 
    VALUES (?, ?, ?, 1, NOW())
  `;

  db.query(sql, [field_id, option_text, created_by], (err, result) => {
    if (err) {
      console.error("Error inserting option:", err);
      return res.status(500).json({ message: "Failed to create option." });
    }

    return res.status(201).json({
      message: "Option added successfully!",
      option_id: result.insertId,
    });
  });
};

// ==========================
// GET Fields by Project ID (with Options & Members)
// ==========================
exports.getFieldsByProject = (req, res) => {
  const { project_id } = req.params;

  const fieldQuery = `
    SELECT * FROM CustomFields 
WHERE project_id = ? AND active = 1
ORDER BY \`order\` ASC
  `;

  db.query(fieldQuery, [project_id], (err, fields) => {
    if (err) {
      console.error("Error fetching fields:", err);
      return res.status(500).json({ message: "Failed to fetch fields." });
    }

    if (fields.length === 0) {
      return res.status(200).json([]);
    }

    const fieldIds = fields.map((f) => f.field_id);

    // Fetch options for Dropdown/Checkbox fields
    const optionQuery = `
      SELECT * FROM FieldOptions 
      WHERE field_id IN (?) AND active = 1
    `;

    db.query(optionQuery, [fieldIds], (err2, options) => {
      if (err2) {
        console.error("Error fetching options:", err2);
        return res.status(500).json({ message: "Failed to fetch options." });
      }

      // Fetch members for People fields
      const memberQuery = `
        SELECT * FROM PeopleMembers 
        WHERE field_id IN (?)
      `;

      db.query(memberQuery, [fieldIds], (err3, members) => {
        if (err3) {
          console.error("Error fetching PeopleMembers:", err3);
          return res.status(500).json({ message: "Failed to fetch members." });
        }

        // Map everything
        const finalFields = fields.map((field) => {
          const fieldOptions = options.filter(
            (opt) => opt.field_id === field.field_id
          );
          const fieldMembers = members
            .filter((m) => m.field_id === field.field_id)
            .map((m) => m.member_id);

          return {
            ...field,
            options: fieldOptions,
            members: field.field_type === "People" ? fieldMembers : [],
          };
        });

        return res.status(200).json(finalFields);
      });
    });
  });
};

// ==========================
// UPDATE Field
// ==========================
exports.updateField = (req, res) => {
  const { field_id } = req.params;
  const {
    field_name,
    description,
    tags,
    required,
    field_type,
    members,
    created_by,
  } = req.body;

  const sql = `
    UPDATE CustomFields 
    SET field_name = ?, description = ?, tags = ?, required = ? 
    WHERE field_id = ?
  `;

  db.query(
    sql,
    [field_name, description, tags, required, field_id],
    (err, result) => {
      if (err) {
        console.error("Error updating field:", err);
        return res.status(500).json({ message: "Failed to update field." });
      }

      // === Check if People field and update members ===
      if (field_type === "People") {
        // 1. Delete old members
        const deleteSQL = `DELETE FROM PeopleMembers WHERE field_id = ?`;
        db.query(deleteSQL, [field_id], (err2) => {
          if (err2) {
            console.error("Error deleting old members:", err2);
            return res
              .status(500)
              .json({ message: "Failed to remove old members." });
          }

          // 2. Insert new members
          if (members && members.length > 0) {
            const values = members.map((member_id) => [
              field_id,
              member_id,
              created_by || "system", // fallback if not passed
            ]);
            const insertSQL = `
              INSERT INTO PeopleMembers (field_id, member_id, created_by)
              VALUES ?
            `;
            db.query(insertSQL, [values], (err3) => {
              if (err3) {
                console.error("Error inserting members:", err3);
                return res
                  .status(500)
                  .json({ message: "Failed to save members." });
              }

              return res
                .status(200)
                .json({ message: "Field and members updated successfully!" });
            });
          } else {
            // No members selected
            return res
              .status(200)
              .json({ message: "Field updated, no members selected." });
          }
        });
      } else {
        // Non-People field
        return res.status(200).json({ message: "Field updated successfully!" });
      }
    }
  );
};


// ==========================
// DELETE All Options by Field
// ==========================
exports.deleteOptionsByField = (req, res) => {
  const { field_id } = req.params;
  const sql = `DELETE FROM FieldOptions WHERE field_id = ?`;

  db.query(sql, [field_id], (err, result) => {
    if (err) {
      console.error("Error deleting options:", err);
      return res.status(500).json({ message: "Failed to delete options." });
    }

    return res.status(200).json({ message: "Options deleted successfully!" });
  });
};

// ==========================
// SOFT DELETE Field
// ==========================
exports.softDeleteField = (req, res) => {
  const { field_id } = req.params;

  const sql = `
    UPDATE CustomFields 
    SET active = 0 
    WHERE field_id = ?
  `;

  db.query(sql, [field_id], (err, result) => {
    if (err) {
      console.error("Error soft deleting field:", err);
      return res.status(500).json({ message: "Failed to delete field." });
    }

    return res
      .status(200)
      .json({ message: "Field soft-deleted successfully!" });
  });
};

// ==========================
// SOFT DELETE Option
// ==========================
exports.softDeleteOption = (req, res) => {
  const { option_id } = req.params;

  const sql = `
    UPDATE FieldOptions 
    SET active = 0 
    WHERE option_id = ?
  `;

  db.query(sql, [option_id], (err, result) => {
    if (err) {
      console.error("Error soft deleting option:", err);
      return res.status(500).json({ message: "Failed to delete option." });
    }

    return res
      .status(200)
      .json({ message: "Option soft-deleted successfully!" });
  });
};



exports.updateFieldOrder = (req, res) => {
  const { project_id } = req.params;
  const { orderData } = req.body;

  if (!orderData || !Array.isArray(orderData)) {
    return res.status(400).json({ message: "Invalid order data." });
  }

  const updatePromises = orderData.map(({ field_id, order }) => {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE CustomFields 
        SET \`order\` = ? 
        WHERE field_id = ? AND project_id = ?
      `;
      db.query(sql, [order, field_id, project_id], (err) => {
        if (err) {
          console.error("Error updating order:", err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });

  Promise.all(updatePromises)
    .then(() =>
      res.status(200).json({ message: "Order updated successfully!" })
    )
    .catch(() => res.status(500).json({ message: "Failed to update order." }));
};



