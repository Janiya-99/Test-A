const pool = require("../db/db");

// Get all notify people for a branch
const getAllNotifyPeople = async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const query = "SELECT * FROM appointment_notify_people WHERE branch_id = ? ORDER BY name ASC";

    pool.query(query, [branchId], (error, people) => {
      if (error) {
        console.error("Error fetching notify people:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch notify people",
          error: error.message,
        });
      }

      res.status(200).json({
        success: true,
        data: people,
      });
    });
  } catch (error) {
    console.error("Error fetching notify people:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notify people",
      error: error.message,
    });
  }
};

// Create new notify person
const createNotifyPerson = async (req, res) => {
  try {
    const { name, whatsapp_number } = req.body;
    const branchId = req.body.branch_id || req.query.branch_id || req.user?.Branch_idBranch;

    if (!name || !whatsapp_number || !branchId) {
      return res.status(400).json({
        success: false,
        message: "Name, WhatsApp number, and Branch ID are required",
      });
    }

    const query = "INSERT INTO appointment_notify_people (name, whatsapp_number, branch_id) VALUES (?, ?, ?)";

    pool.query(query, [name, whatsapp_number, branchId], (error, result) => {
      if (error) {
        console.error("Error creating notify person:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to create notify person",
          error: error.message,
        });
      }

      res.status(201).json({
        success: true,
        message: "Notify person created successfully",
        data: {
          id: result.insertId,
          name,
          whatsapp_number,
          branch_id: branchId,
        },
      });
    });
  } catch (error) {
    console.error("Error creating notify person:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create notify person",
      error: error.message,
    });
  }
};

// Update notify person
const updateNotifyPerson = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, whatsapp_number } = req.body;
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!id || !branchId) {
      return res.status(400).json({
        success: false,
        message: "ID and Branch ID are required",
      });
    }

    const query = "UPDATE appointment_notify_people SET name = ?, whatsapp_number = ? WHERE id = ? AND branch_id = ?";

    pool.query(query, [name, whatsapp_number, id, branchId], (error, result) => {
      if (error) {
        console.error("Error updating notify person:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to update notify person",
          error: error.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Notify person not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Notify person updated successfully",
      });
    });
  } catch (error) {
    console.error("Error updating notify person:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notify person",
      error: error.message,
    });
  }
};

// Delete notify person
const deleteNotifyPerson = async (req, res) => {
  try {
    const { id } = req.params;
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!id || !branchId) {
      return res.status(400).json({
        success: false,
        message: "ID and Branch ID are required",
      });
    }

    const query = "DELETE FROM appointment_notify_people WHERE id = ? AND branch_id = ?";

    pool.query(query, [id, branchId], (error, result) => {
      if (error) {
        console.error("Error deleting notify person:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to delete notify person",
          error: error.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Notify person not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Notify person deleted successfully",
      });
    });
  } catch (error) {
    console.error("Error deleting notify person:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notify person",
      error: error.message,
    });
  }
};

module.exports = {
  getAllNotifyPeople,
  createNotifyPerson,
  updateNotifyPerson,
  deleteNotifyPerson,
};
