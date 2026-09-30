const db = require("../db/db");

// ✅ Add User to a Team

exports.addUserToTeam = (req, res) => {
  const { teamId } = req.params;
  const { memberId } = req.body;

  console.log("📌 Received Request to Add User:", { teamId, memberId });

  if (!teamId || !memberId) {
    console.error("❌ Missing required fields:", { teamId, memberId });
    return res
      .status(400)
      .json({ error: "❌ Missing required fields: teamId or memberId" });
  }

  db.query(
    "SELECT * FROM team_membership WHERE team_id = ? AND member_id = ?",
    [teamId, memberId],
    (err, result) => {
      if (err) {
        console.error("❌ Database error:", err);
        return res
          .status(500)
          .json({
            error: "Database error while checking existing membership",
            details: err.message,
          });
      }

      if (result.length > 0) {
        console.warn("⚠️ User is already in this team!");
        return res
          .status(400)
          .json({ message: "User is already in this team!" });
      }

      db.query(
        "INSERT INTO team_membership (team_id, member_id) VALUES (?, ?)",
        [teamId, memberId],
        (err, result) => {
          if (err) {
            console.error("❌ Error inserting team member:", err);
            return res
              .status(500)
              .json({
                error: "Database error while adding user to team",
                details: err.message,
              });
          }

          console.log("✅ User successfully added to team!", result);
          res
            .status(201)
            .json({ message: "User successfully added to the team!" });
        }
      );
    }
  );
};


// ✅ Get all teams with members
exports.getAllTeamsByBranch = (req, res) => {
  const branchId = req.params.branchId;

  if (!branchId) {
    return res.status(400).json({ error: "Branch ID is required" });
  }

  const query = `
    SELECT 
      t.team_id, 
      t.team_name, 
      t.description, 
      IF(u.Status = 1, CONCAT(u.First_Name, ' ', u.Last_Name), 'Not Assigned') AS team_leader_name, 
      t.created_at
    FROM teams t
    LEFT JOIN user u ON t.team_leader = u.idUser
    WHERE t.active = 1 AND t.Branch_idBranch = ?
  `;

  db.query(query, [branchId], (err, teams) => {
    if (err) {
      console.error("❌ Error fetching teams:", err);
      return res.status(500).json({ error: "Failed to fetch teams" });
    }

    if (teams.length === 0) return res.json([]);

    const teamIds = teams.map((team) => team.team_id);

    const membersQuery = `
      SELECT 
        tm.team_id, 
        u.idUser AS member_id, 
        CONCAT(u.First_Name, ' ', u.Last_Name) AS member_name
      FROM team_membership tm
      JOIN user u ON tm.member_id = u.idUser
      WHERE tm.team_id IN (?) AND tm.active = 1 AND u.Status = 1
    `;

    db.query(membersQuery, [teamIds], (err, members) => {
      if (err) {
        console.error("❌ Error fetching team members:", err);
        return res.status(500).json({ error: "Failed to fetch team members" });
      }

      const teamsWithMembers = teams.map((team) => ({
        ...team,
        members: members
          .filter((m) => m.team_id === team.team_id)
          .map((m) => m.member_name),
      }));

      res.json(teamsWithMembers);
    });
  });
};




// ✅ Add a new team and insert members into `team_membership`
exports.addTeam = async (req, res) => {
  const { team_name, description, team_leader, members, created_by, branch_id } = req.body;

  console.log("📌 Received Data from Frontend:", req.body);

  if (!team_name || !team_leader || !Array.isArray(members) || members.length === 0 || !created_by || !branch_id) {
    return res.status(400).json({ 
      success: false,
      error: "Missing required fields" 
    });
  }

  try {
    // Start transaction
    await new Promise((resolve, reject) => {
      db.beginTransaction(err => {
        if (err) return reject(err);
        resolve();
      });
    });

    // 1. Insert into teams table
    const teamResult = await new Promise((resolve, reject) => {
      db.query(
        "INSERT INTO teams (team_name, description, team_leader, created_by, Branch_idBranch) VALUES (?, ?, ?, ?, ?)",
        [team_name, description, team_leader, created_by, branch_id],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });

    const teamId = teamResult.insertId;

    if (!teamId) {
      await db.rollback();
      return res.status(500).json({
        success: false,
        error: "Failed to retrieve team ID after insertion"
      });
    }

    // 2. Insert team members
    if (members.length > 0) {
      const memberValues = members.map(memberId => [teamId, memberId]);

      await new Promise((resolve, reject) => {
        db.query(
          "INSERT INTO team_membership (team_id, member_id) VALUES ?",
          [memberValues],
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
      });
    }

    // Commit transaction
    await new Promise((resolve, reject) => {
      db.commit(err => {
        if (err) return reject(err);
        resolve();
      });
    });

    res.status(200).json({
      success: true,
      message: "Team added successfully",
      teamId
    });

  } catch (err) {
    // Rollback on error
    await new Promise(resolve => db.rollback(() => resolve()));
    
    console.error("❌ Database error:", err);
    res.status(500).json({
      success: false,
      error: "Database operation failed",
      details: err.message
    });
  }
};



// ✅ Delete a team
exports.deleteTeam = (req, res) => {
  const teamId = req.params.id;

  db.query("DELETE FROM team_membership WHERE team_id = ?", [teamId], (err) => {
    if (err) {
      console.error("❌ Error deleting team members:", err);
      return res.status(500).json({ error: "Failed to delete team members" });
    }

    db.query("DELETE FROM teams WHERE team_id = ?", [teamId], (err, result) => {
      if (err) {
        console.error("❌ Error deleting team:", err);
        return res.status(500).json({ error: "Failed to delete team" });
      }

      res.status(200).json({ message: "✅ Team deleted successfully!" });
    });
  });
};

exports.getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("📌 Fetching User Details for ID:", id);

    // ✅ Fetch user details
    const userQuery = "SELECT * FROM members WHERE id = ?";
    const [userResult] = await db.promise().query(userQuery, [id]);

    if (userResult.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult[0];

    // ✅ Fetch ONLY teams where the user is explicitly assigned (as leader or member)
    const teamQuery = `
      SELECT 
        t.team_id, 
        t.team_name, 
        t.description AS team_description,
        CASE 
          WHEN t.team_leader = ? THEN 'Team Leader'
          WHEN tm.member_id IS NOT NULL THEN 'Member'
          ELSE NULL
        END AS membership_status
      FROM teams t
      LEFT JOIN team_membership tm ON t.team_id = tm.team_id AND tm.member_id = ?
      WHERE t.team_leader = ? OR tm.member_id IS NOT NULL
    `;

    const [teamResults] = await db.promise().query(teamQuery, [id, id, id]);

    console.log(`✅ Assigned Teams for User ${id}:`, teamResults); // Debugging

    // ✅ Filter out NULL membership_status values
    user.teams = teamResults.filter((team) => team.membership_status !== null);

    return res.json(user);
  } catch (error) {
    console.error("❌ Error fetching user details:", error);
    return res.status(500).json({ error: "Failed to fetch user details" });
  }
};


//  Get all teams for dropdown
exports.getTeam = (req, res) => {
  db.query("SELECT team_id, team_name FROM teams", (err, results) => {
    if (err) {
      console.error("Error fetching teams:", err);
      return res.status(500).json({ error: "Failed to fetch teams" });
    }
    res.json(results);
  });
};

// ✅ Add a member to a team using `team_membership`
exports.addUserToTeam = (req, res) => {
  const { teamId } = req.params;
  const { memberId } = req.body;

  console.log("📌 Received Request to Add User:", { teamId, memberId });

  if (!teamId || !memberId) {
    return res
      .status(400)
      .json({ error: "❌ Missing required fields: teamId or memberId" });
  }

  db.query(
    "SELECT * FROM team_membership WHERE team_id = ? AND member_id = ?",
    [teamId, memberId],
    (err, result) => {
      if (err) {
        console.error("❌ Database error:", err);
        return res
          .status(500)
          .json({ error: "Database error while checking existing membership" });
      }

      if (result.length > 0) {
        console.warn("⚠️ User is already in this team!");
        return res
          .status(400)
          .json({ message: "User is already in this team!" });
      }

      db.query(
        "INSERT INTO team_membership (team_id, member_id) VALUES (?, ?)",
        [teamId, memberId],
        (err) => {
          if (err) {
            console.error("❌ Error inserting team member:", err);
            return res
              .status(500)
              .json({ error: "Database error while adding user to team" });
          }

          console.log("✅ User successfully added to team!");
          res
            .status(200)
            .json({ message: "User successfully added to the team!" });
        }
      );
    }
  );
};

exports.dreactivateTeam =  (req, res) => {
  const { teamId } = req.params;
  const query = "UPDATE teams SET active = 0 WHERE team_id = ?";

  db.query(query, [teamId], (err, result) => {
    if (err) {
      console.error("Error deactivating team:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    if (result.affectedRows > 0) {
      res.json({ success: true, message: "Team deactivated successfully" });
    } else {
      res.status(404).json({ success: false, message: "Team not found" });
    }
  });
};


exports.getAllDreactivatTeams = (req, res) => {
  const { branchId } = req.params;
  if (!branchId) {
    return res.status(400).json({
      success: false,
      message: "Branch ID is required",
    });
  }

  const teamQuery = `
    SELECT 
      t.team_id, 
      t.team_name, 
      t.description, 
      t.created_at,
      t.team_leader,
      CONCAT(u.First_Name, ' ', u.Last_Name) AS team_leader_name
    FROM teams t
    LEFT JOIN user u ON t.team_leader = u.idUser
    WHERE t.active = 0 AND t.Branch_idBranch = ?
  `;

  db.query(teamQuery, [branchId], (err, teams) => {
    if (err) {
      console.error("Error fetching teams:", err);
      return res.status(500).json({
        success: false,
        message: "Error fetching teams",
        error: err.message,
      });
    }

    if (!teams.length) {
      return res.json({ success: true, data: [] });
    }

    const teamIds = teams.map(team => team.team_id);
    const teamIdList = teamIds.length ? teamIds.join(",") : "0"; // Fix

    const membersQuery = `
      SELECT 
        tm.team_id,
        u.idUser,
        CONCAT(u.First_Name, ' ', u.Last_Name) AS member_name
      FROM team_membership tm
      JOIN user u ON tm.member_id = u.idUser
      WHERE tm.team_id IN (${teamIdList})
    `;

    db.query(membersQuery, (err, members) => {
      if (err) {
        console.error("Error fetching members:", err);
        return res.status(500).json({
          success: false,
          message: "Error fetching team members",
          error: err.message,
        });
      }

      const teamsWithMembers = teams.map(team => {
        const teamMembers = members
          .filter(m => m.team_id === team.team_id)
          .map(m => m.member_name);

        return {
          team_id: team.team_id,
          team_name: team.team_name,
          description: team.description,
          team_leader_name: team.team_leader_name,
          members: teamMembers,
          member_count: teamMembers.length,
        };
      });

      res.json({
        success: true,
        data: teamsWithMembers,
      });
    });
  });
};






exports.reactivateTeam = (req, res) => {
  const { teamId } = req.params;
  const query = "UPDATE teams SET active = 1 WHERE team_id = ?";

  db.query(query, [teamId], (err, result) => {
    if (err) {
      console.error("❌ Error reactivating team:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }

    if (result.affectedRows > 0) {
      res.json({ success: true, message: "Team reactivated successfully" });
    } else {
      res.status(404).json({ success: false, message: "Team not found" });
    }
  });
};

exports.updateTeam = (req, res) => {
  const { team_id, team_name, description, team_leader_name, members } = req.body;

  if (!team_id) {
    return res.status(400).json({ error: "❌ Team ID is required" });
  }

  // ✅ Split leader's full name into first and last name
  const [leaderFirstName, leaderLastName] = team_leader_name.trim().split(" ");

  const getLeaderQuery = `
    SELECT idUser FROM user 
    WHERE First_Name = ? AND Last_Name = ? AND Status = 1
    LIMIT 1
  `;

  db.query(getLeaderQuery, [leaderFirstName, leaderLastName], (err, leaderResult) => {
    if (err) return res.status(500).json({ error: "Failed to fetch team leader" });

    const team_leader_id = leaderResult.length > 0 ? leaderResult[0].idUser : null;

    const updateTeamQuery = `
      UPDATE teams SET team_name = ?, description = ?, team_leader = ?
      WHERE team_id = ?
    `;

    db.query(updateTeamQuery, [team_name, description, team_leader_id, team_id], (err) => {
      if (err) return res.status(500).json({ error: "Failed to update team details" });

      const deleteMembersQuery = `DELETE FROM team_membership WHERE team_id = ?`;

      db.query(deleteMembersQuery, [team_id], (err) => {
        if (err) return res.status(500).json({ error: "Failed to update team members" });

        if (members.length > 0) {
          // ✅ Get member IDs from user table using First_Name + Last_Name
          const memberNameTuples = members.map((fullName) => {
            const [first, last] = fullName.trim().split(" ");
            return [first, last];
          });

          // Build dynamic WHERE clause
          const conditions = memberNameTuples.map(() => `(First_Name = ? AND Last_Name = ?)`).join(" OR ");
          const values = memberNameTuples.flat();

          const getMemberIdsQuery = `
            SELECT idUser FROM user 
            WHERE (${conditions}) AND Status = 1
          `;

          db.query(getMemberIdsQuery, values, (err, memberResults) => {
            if (err) return res.status(500).json({ error: "Failed to fetch member IDs" });

            const insertMembersQuery = `INSERT INTO team_membership (team_id, member_id) VALUES ?`;
            const memberValues = memberResults.map((m) => [team_id, m.idUser]);

            if (memberValues.length === 0) {
              return res.status(400).json({ error: "No matching users found for selected members." });
            }

            db.query(insertMembersQuery, [memberValues], (err) => {
              if (err) return res.status(500).json({ error: "Failed to add new team members" });
              res.json({ message: "✅ Team updated successfully!" });
            });
          });
        } else {
          res.json({ message: "✅ Team updated, no members added!" });
        }
      });
    });
  });
};




exports.getActiveUsers = (req, res) => {
  const { branchId } = req.params;

  const sql = `
    SELECT idUser, First_Name, Last_Name
    FROM user
    WHERE Status = 1 AND Branch_idBranch = ?
    ORDER BY First_Name ASC
  `;

  db.query(sql, [branchId], (err, results) => {
    if (err) {
      console.error("Error fetching users:", err);
      return res.status(500).json({
        success: false,
        message: "Error fetching users",
        error: err.message
      });
    }

    const formattedResults = results.map(user => ({
      id: user.idUser,
      name: `${user.First_Name} ${user.Last_Name}`,
    }));

    res.json({
      success: true,
      data: formattedResults
    });
  });
};







