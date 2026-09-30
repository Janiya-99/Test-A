const db = require("../db/db");

// Create a new board under a project
exports.createBoard = (req, res) => {
  const { name, projectId, Branch_idBranch } = req.body;

  // Validate input data
  if (!name || !projectId || !Branch_idBranch) {
    return res.status(400).json({ message: 'Board name, project ID, and user Branch_idBranch are required.' });
  }

  // Check if a board with the same name already exists for this project
  const checkQuery = 'SELECT COUNT(*) AS boardCount FROM boards WHERE name = ? AND project_id = ?';
  db.query(checkQuery, [name, projectId], (err, results) => {
    if (err) {
      console.error('Error checking for existing board:', err);
      return res.status(500).json({ message: 'Server error while checking for existing board.' });
    }

    if (results[0].boardCount > 0) {
      return res.status(400).json({ message: 'A board with this name already exists in this project.' });
    }

    // Insert the new board into the database
    const query = 'INSERT INTO boards (name, project_id, Branch_idBranch) VALUES (?, ?, ?)';
    db.query(query, [name, projectId, Branch_idBranch], (err, result) => {
      if (err) {
        console.error('Error creating board:', err);
        return res.status(500).json({ message: 'Server error while creating board.' });
      }

      // Return the created board data
      const newBoard = {
        id: result.insertId, // Get the ID of the newly inserted board
        name,
        project_id: projectId,
        Branch_idBranch,
      };
      return res.status(201).json(newBoard);
    });
  });
};

  
  // Get all active boards for a specific project
exports.getBoardsForProject = (req, res) => {
  const { projectId } = req.params;

  // Fetch all active boards for the given project ID (active = 1)
  const query = 'SELECT * FROM boards WHERE project_id = ? AND active = 1';
  db.query(query, [projectId], (err, results) => {
    if (err) {
      console.error('Error fetching boards:', err);
      return res.status(500).json({ message: 'Server error while fetching boards.' });
    }

    // Return the list of active boards
    return res.status(200).json(results);
  });
};


// Soft delete a board by setting active = 0
exports.deleteBoard = (req, res) => {
  const { boardId } = req.params;

  // Update the board's active status to 0 (soft delete)
  const query = 'UPDATE boards SET active = 0 WHERE id = ?';
  
  db.query(query, [boardId], (err, result) => {
    if (err) {
      console.error('Error soft deleting board:', err);
      return res.status(500).json({ message: 'Server error while deleting board.' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Board not found or already deleted.' });
    }

    return res.status(200).json({ message: 'Board soft deleted successfully.' });
  });
};


// Update the title of a board
exports.updateBoardTitle = (req, res) => {
  const { boardId } = req.params;
  const { name } = req.body;

  // Validate input data
  if (!name) {
    return res.status(400).json({ message: 'Board name is required.' });
  }

  // Update the board title in the database
  const query = 'UPDATE boards SET name = ? WHERE id = ?';
  db.query(query, [name, boardId], (err, result) => {
    if (err) {
      console.error('Error updating board title:', err);
      return res.status(500).json({ message: 'Server error while updating board title.' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Board not found.' });
    }

    // Return the updated board data
    const updatedBoard = {
      id: boardId,
      name,
    };
    return res.status(200).json(updatedBoard);
  });
};


// Save or update board order
exports.saveBoardOrder = (req, res) => {
  const { projectId } = req.params;
  const { order } = req.body;

  if (!Array.isArray(order)) {
    return res.status(400).json({ message: 'Invalid board order format' });
  }

  const boardIdsJson = JSON.stringify(order);

  const checkQuery = 'SELECT id FROM board_order WHERE project_id = ?';
  db.query(checkQuery, [projectId], (err, existing) => {
    if (err) {
      console.error('Error checking board order:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (existing.length > 0) {
      const updateQuery = 'UPDATE board_order SET board_ids = ?, updated_at = NOW() WHERE project_id = ?';
      db.query(updateQuery, [boardIdsJson, projectId], (err2) => {
        if (err2) {
          console.error('Error updating board order:', err2);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(200).json({ message: 'Board order updated successfully' });
      });
    } else {
      const insertQuery = 'INSERT INTO board_order (project_id, board_ids) VALUES (?, ?)';
      db.query(insertQuery, [projectId, boardIdsJson], (err3) => {
        if (err3) {
          console.error('Error inserting board order:', err3);
          return res.status(500).json({ message: 'Internal server error' });
        }

        res.status(200).json({ message: 'Board order saved successfully' });
      });
    }
  });
};

// Get board order
// Get board order
exports.getBoardOrder = (req, res) => {
  const { projectId } = req.params;

  const query = 'SELECT board_ids FROM board_order WHERE project_id = ?';
  db.query(query, [projectId], (err, results) => {
    if (err) {
      console.error('Error fetching board order:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No board order found' });
    }

    try {
      const boardOrder = JSON.parse(results[0].board_ids);
      return res.status(200).json({ boardOrder });
    } catch (parseError) {
      console.error('Error parsing board order:', parseError);
      return res.status(500).json({ message: 'Error parsing board order data' });
    }
  });
};