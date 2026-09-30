const db = require("../db/db");// Ensure this connects to your database
const moment = require("moment-timezone");

// ✅ Fetch user details along with group memberships
exports.getUserDetails = (req, res) => {
  const memberId = req.params.id;

  if (!memberId) {
    return res.status(400).json({ message: "Member ID is required" });
  }

  // ✅ Fetch user details
  const userQuery = `SELECT id, name, job_role, nic, contact_no, email FROM members WHERE id = ?`;

  db.query(userQuery, [memberId], (err, userResults) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Database error", error: err.sqlMessage });
    }
    if (userResults.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResults[0];

    // ✅ Fetch only the teams where the user is a member or leader
    const groupsQuery = `
  SELECT DISTINCT
    t.team_id,
    t.team_name, 
    t.description AS team_description,
    CASE 
      WHEN t.team_leader = ? THEN 'Team Leader' 
      ELSE 'Team Member' 
    END AS membership_status
  FROM teams t
  LEFT JOIN team_membership tm ON t.team_id = tm.team_id
  WHERE (tm.member_id = ? OR t.team_leader = ?) 
    AND t.active = 1
  ORDER BY membership_status = 'Team Leader' DESC, t.team_name ASC;
`;

    db.query(
      groupsQuery,
      [memberId, memberId, memberId],
      (err, groupResults) => {
        if (err) {
          console.error("❌ Database error in groups query:", err);
          return res
            .status(500)
            .json({ message: "Database error", error: err.sqlMessage });
        }

        return res.json({
          user,
          groups: groupResults || [],
        });
      }
    );

  });
};


// ✅ Add a new member (ONLY adds to `members` table, not `team_membership`)
exports.addMember = (req, res) => {
  const { name, job_role, nic, contact_no, email, created_by } = req.body;

  // Validate input fields
  if (!name || !job_role || !nic || !contact_no || !email || !created_by) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Insert query with `created_by` column
  const query = `
    INSERT INTO members (name, job_role, nic, contact_no, email, created_by) 
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(query, [name, job_role, nic, contact_no, email, created_by], (err, result) => {
    if (err) {
      console.error("❌ Error inserting member:", err);
      return res.status(500).json({ message: "Error inserting member", error: err.message });
    }

    return res.status(201).json({ message: "✅ Member added successfully", member_id: result.insertId });
  });
};


exports.getMembers = (req, res) => {
  const sqlQuery = "SELECT id, name, job_role, last_active, email FROM members WHERE active = 1";

  db.query(sqlQuery, (error, results) => {
    if (error) {
      console.error("❌ Error fetching members:", error);
      return res
        .status(500)
        .json({ message: "Error fetching members", error: error.message });
    }

    console.log("✅ Active Members Fetched Successfully:", results);
    res.status(200).json(results);
  });
};




// ✅ Update last_active when user logs in
exports.userLogin = (req, res) => {
  const { email, password } = req.body;

  const sqlQuery = "SELECT id, password FROM members WHERE email = ? AND active = 1";

  db.getConnection((err, connection) => {
    if (err) {
      console.error("❌ Database Connection Failed:", err);
      return res.status(500).json({ message: "Database connection failed" });
    }

    connection.query(sqlQuery, [email], (error, results) => {
      if (error) {
        connection.release();
        return res.status(500).json({ message: "Error fetching user" });
      }

      if (results.length === 0) {
        connection.release();
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const user = results[0];

      // ✅ Assuming you're using bcrypt for password comparison
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err || !isMatch) {
          connection.release();
          return res.status(401).json({ message: "Invalid email or password" });
        }

        // ✅ Update last_active timestamp
        const updateQuery =
          "UPDATE members SET last_active = CURRENT_TIMESTAMP WHERE id = ?";
        connection.query(updateQuery, [user.id], (updateError) => {
          connection.release();

          if (updateError) {
            console.error("❌ Failed to update last_active:", updateError);
          }

          // ✅ Return successful login response
          res.status(200).json({
            message: "Login successful",
            userId: user.id,
          });
        });
      });
    });
  });
};


exports.getMemberById = (req, res) => {
  const { id } = req.params;

  db.query(
    "SELECT * FROM members WHERE id = ? AND active = 1",
    [id],
    (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error fetching member", error: err.message });
      }
      if (result.length === 0) {
        return res
          .status(404)
          .json({ message: "Member not found or inactive" });
      }
      res.status(200).json(result[0]);
    }
  );
};

// ✅ Update member details (Only updates provided fields)
exports.updateMember = (req, res) => {
  const { id } = req.params;
  const { name, job_role, nic, contact_no, email } = req.body;

  if (!name && !job_role && !nic && !contact_no && !email) {
    return res
      .status(400)
      .json({ message: "At least one field is required to update" });
  }

  const updates = [];
  const values = [];

  if (name) {
    updates.push("name=?");
    values.push(name);
  }
  if (job_role) {
    updates.push("job_role=?");
    values.push(job_role);
  }
  if (nic) {
    updates.push("nic=?");
    values.push(nic);
  }
  if (contact_no) {
    updates.push("contact_no=?");
    values.push(contact_no);
  }
  if (email) {
    updates.push("email=?");
    values.push(email);
  }

  values.push(id);

  const query = `UPDATE members SET ${updates.join(", ")} WHERE id=?`;

  db.query(query, values, (err, result) => {
    if (err) {
      console.error("Database Update Error:", err);
      return res
        .status(500)
        .json({ message: "Error updating member", error: err.message });
    }

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Member not found. ID may be incorrect." });
    }

    res.status(200).json({ message: "Member updated successfully" });
  });
};



// ✅ Soft Delete Member (Set active = 0 Instead of Deleting)
exports.deleteMember = (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: "Invalid member ID" });
  }

  db.getConnection((err, connection) => {
    if (err) {
      console.error("❌ Database Connection Failed:", err);
      return res.status(500).json({ message: "Database connection failed" });
    }

    // ✅ Check if the member exists
    connection.query(
      "SELECT active FROM members WHERE id = ?",
      [id],
      (err, results) => {
        if (err) {
          connection.release(); // Always release connection
          console.error("❌ Error fetching member:", err);
          return res
            .status(500)
            .json({ message: "Error fetching member", error: err.message });
        }

        if (results.length === 0) {
          connection.release();
          return res.status(404).json({ message: "Member not found" });
        }

        if (results[0].active === 0) {
          connection.release();
          return res
            .status(400)
            .json({ message: "Member is already inactive" });
        }

        // ✅ Perform soft delete (set active = 0)
        connection.query(
          "UPDATE members SET active = 0 WHERE id = ?",
          [id],
          (err, result) => {
            connection.release(); // Always release connection

            if (err) {
              console.error("❌ Error deleting member:", err);
              return res
                .status(500)
                .json({ message: "Error deleting member", error: err.message });
            }

            if (result.affectedRows === 0) {
              return res
                .status(500)
                .json({ message: "Failed to soft delete member" });
            }

            res
              .status(200)
              .json({ message: "Member soft deleted successfully" });
          }
        );
      }
    );
  });
};


