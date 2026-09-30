const db = require("../db/db");
const axiosClient = require("../utils/axiosClient");

exports.getAllProjects = (req, res) => {
  const { branchId } = req.params;

  const query = "SELECT * FROM pro WHERE active = 1 AND Branch_idBranch = ?";

  db.query(query, [branchId], (err, results) => {
    if (err) {
      console.error("Error fetching projects:", err);
      return res.status(500).json({ error: "Database query error" });
    }
    res.json(results);
  });
};


exports.createProject = (req, res) => {
  const { projectName, description, key, Branch_idBranch } = req.body;
  const teamName = "default";

  const query = `
    INSERT INTO pro (project_name, description, team_name, project_key, Branch_idBranch) 
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(query, [projectName, description, teamName, key, Branch_idBranch], (err, results) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ message: "Project key already exists. Please choose a unique key." });
      }

      console.error("Error creating project:", err);
      return res.status(500).json({ message: "Error creating project" });
    }

    const projectId = results.insertId;

    // Create default boards
    const defaultBoards = [
      { name: "Todo" },
      { name: "In Progress" },
      { name: "Under Review" },
      { name: "Done" },
    ];

    const boardValues = defaultBoards.map(board => [board.name, projectId, Branch_idBranch]);
    const boardQuery = `
      INSERT INTO boards (name, project_id, Branch_idBranch) 
      VALUES ?
    `;

    db.query(boardQuery, [boardValues], (boardErr) => {
      if (boardErr) {
        console.error("Error creating default boards:", boardErr);
        return res.status(201).json({ 
          message: "Project created, but failed to create default boards", 
          projectId 
        });
      }

      return res.status(201).json({ 
        message: "Project and default boards created successfully", 
        projectId 
      });
    });
  });
};


exports.deleteProject = (req, res) => {
  const projectId = req.params.id;
  const sql = "UPDATE pro SET active = 0 WHERE id = ?";

  db.query(sql, [projectId], (err, result) => {
    if (err) {
      console.error("Error updating project status:", err);
      return res.status(500).json({ message: "Error updating project status" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Project not found" });
    }
    res.json({ message: "Project marked as inactive successfully" });
  });
};

exports.updateProject = (req, res) => {const { id } = req.params;
  const { project_name, description, teams, members } = req.body;

  // Fetch the existing project details
  const fetchSql = "SELECT team_name, members FROM pro WHERE id = ?";
  db.query(fetchSql, [id], (err, result) => {
    if (err) {
      console.error("Error fetching project details:", err);
      res.status(500).json({ error: "Database fetch failed" });
    } else {
      const existingTeamNames = result[0].team_name.split(", "); // Split existing teams into an array
      const existingMemberNames = result[0].members.split(", "); // Split existing members into an array

      // Split new teams and members into arrays
      const newTeamNames = teams.split(", ");
      const newMemberNames = members.split(", ");

      // Filter out teams and members that are not selected (removed by the user)
      const updatedTeamNames = newTeamNames; // Use only the selected teams
      const updatedMemberNames = newMemberNames; // Use only the selected members

      // Update the project with the combined team and member names
      const updateSql =
        "UPDATE pro SET project_name = ?, description = ?, team_name = ?, members = ? WHERE id = ?";
      db.query(
        updateSql,
        [
          project_name,
          description,
          updatedTeamNames.join(", "),
          updatedMemberNames.join(", "),
          id,
        ],
        (err, result) => {
          if (err) {
            console.error("Error updating project:", err);
            res.status(500).json({ error: "Database update failed" });
          } else {
            res.status(200).json({ message: "Project updated successfully" });
          }
        }
      );
    }
  });
};

exports.getProjectSummary = (req, res) => {
  const { projectId } = req.params;

  const projectQuery = `SELECT * FROM pro WHERE id = ?`;

  const tasksQuery = `
    SELECT 
      t.id AS taskId, 
      t.title AS taskTitle,
      t.status AS taskStatus,            -- ✅ Add status
      ta.assignee_name AS taskAssignee
    FROM tasks t
    LEFT JOIN task_assignees ta ON t.id = ta.task_id
    WHERE t.project_id = ? AND t.active = 1   -- ✅ Only active tasks
  `;

  db.query(projectQuery, [projectId], (err, projectResults) => {
    if (err) {
      console.error("Error fetching project details:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (projectResults.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = projectResults[0];

    db.query(tasksQuery, [projectId], (err, taskResults) => {
      if (err) {
        console.error("Error fetching tasks:", err);
        return res.status(500).json({ error: "Database error" });
      }

      const tasksMap = {};

      taskResults.forEach((row) => {
        const id = row.taskId;
        if (!tasksMap[id]) {
          tasksMap[id] = {
            id: id,
            title: row.taskTitle,
            status: row.taskStatus, // ✅ Include status
            assignees: [],
          };
        }
        if (
          row.taskAssignee &&
          !tasksMap[id].assignees.includes(row.taskAssignee)
        ) {
          tasksMap[id].assignees.push(row.taskAssignee);
        }
      });

      const tasks = Object.values(tasksMap);

      const workload = {};
      tasks.forEach((task) => {
        task.assignees.forEach((assignee) => {
          if (!workload[assignee]) {
            workload[assignee] = 0;
          }
          workload[assignee]++;
        });
      });

      return res.status(200).json({
        project,
        tasks,
        workload,
      });
    });
  });
};

// Controller to add a member to the project
exports.addMemberToProject = (req, res) => {
  const { project_id, member_id } = req.body;

  if (!project_id || !member_id) {
    return res.status(400).json({ message: 'Project ID and Member ID are required.' });
  }

  // Check for duplicate entry
  const checkQuery = `
    SELECT id FROM project_membership WHERE project_id = ? AND member_id = ?
  `;
  db.query(checkQuery, [project_id, member_id], (checkErr, checkResults) => {
    if (checkErr) {
      console.error('Error checking project membership:', checkErr);
      return res.status(500).json({ message: 'Database error while checking membership.' });
    }
    if (checkResults.length > 0) {
      return res.status(409).json({ message: 'Member is already assigned to this project.' });
    }

    // Insert membership
    const query = `
      INSERT INTO project_membership (project_id, member_id, active, role)
      VALUES (?, ?, 1, 'Staff')
    `;
    db.query(query, [project_id, member_id], (err, result) => {
      if (err) {
        console.error('Error inserting project membership:', err);
        return res.status(500).json({ message: 'User Already added to this project' });
      }
      if (result.affectedRows > 0) {
        return res.status(200).json({ message: 'Member added to the project successfully.' });
      } else {
        return res.status(500).json({ message: 'Failed to add member to the project.' });
      }
    });
  });
};

exports.getMembersInProject = (req, res) => {
  const { project_id } = req.params;

  if (!project_id) {
    return res.status(400).json({ message: "Project ID is required." });
  }

  const query = `
    SELECT pm.id AS membershipId, pm.member_id AS memberId, pm.role, pm.active, pm.project_id
    FROM project_membership pm
    WHERE pm.project_id = ?
  `;

  db.query(query, [project_id], async (err, results) => {
    if (err) {
      console.error("Error fetching project members:", err);
      return res.status(500).json({ message: "Database error while fetching members." });
    }

    try {
      // Fetch user details for each member from external API
      const members = await Promise.all(
        results.map(async (row) => {
          try {
            const userResponse = await axiosClient.get(`/user/${row.memberId}`);
            const user = userResponse.data;

            return {
              membershipId: row.membershipId,
              role: row.role,
              active: row.active,
              project_id: row.project_id,
              ...user, // attach user details
            };
          } catch (userErr) {
            console.error(`Error fetching details for member ${row.memberId}:`, userErr.message);
            return {
              membershipId: row.membershipId,
              role: row.role,
              active: row.active,
              project_id: row.project_id,
              error: "Failed to fetch user details",
            };
          }
        })
      );

      return res.status(200).json(members);
    } catch (error) {
      console.error("Error fetching members with details:", error);
      return res.status(500).json({ message: "Failed to fetch members with details." });
    }
  });
};

exports.deleteMemberFromProject = (req, res) => {
  const membershipId = req.params.id; // get from URL param

  if (!membershipId) {
    return res.status(400).json({ message: 'Membership ID is required.' });
  }

  const deleteQuery = `
    DELETE FROM project_membership WHERE id = ?
  `;
  db.query(deleteQuery, [membershipId], (err, result) => {
    if (err) {
      console.error('Error deleting project membership:', err);
      return res.status(500).json({ message: 'Database error while deleting membership.' });
    }

    if (result.affectedRows > 0) {
      return res.status(200).json({ message: 'Member removed from the project successfully.' });
    } else {
      return res.status(404).json({ message: 'Membership ID not found.' });
    }
  });
};

// ─── Link a customer to a project ─────────────────────────────────────────

exports.linkCustomerToProject = (req, res) => {
  const { id } = req.params;
  const { customer_id, project_status } = req.body;

  const fields = [];
  const values = [];

  if (customer_id !== undefined) {
    fields.push("customer_id = ?");
    values.push(customer_id || null);
  }
  if (project_status) {
    fields.push("project_status = ?");
    values.push(project_status);
  }

  if (fields.length === 0) {
    return res.status(400).json({ message: "No fields to update." });
  }

  values.push(id);
  const sql = `UPDATE pro SET ${fields.join(", ")} WHERE id = ?`;

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("linkCustomerToProject error:", err);
      return res.status(500).json({ message: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Project not found" });
    }
    return res.status(200).json({ message: "Project updated successfully." });
  });
};

// ─── Get project with full details (includes customer_id, status) ──────────

exports.getProjectWithDetails = (req, res) => {
  const { id } = req.params;

  const sql = `
    SELECT
      p.*,
      c.Name AS customer_name
    FROM pro p
    LEFT JOIN customer c ON c.idCustomer = p.customer_id
    WHERE p.id = ? AND p.active = 1
  `;

  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error("getProjectWithDetails error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!results || results.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    return res.json(results[0]);
  });
};
