const pool = require("../db/db");
const crypto = require("crypto");

const getAppointmentSettings = async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "Branch ID required" });
    }

    const query = "SELECT * FROM appointment_settings WHERE branch_id = ?";
    pool.query(query, [branchId], (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      
      if (results.length === 0) {
        // Return default empty settings
        return res.status(200).json({
          success: true,
          data: {
            branch_id: branchId,
            default_location: "",
            default_start_time: "09:00",
            default_end_time: "10:00",
            public_booking_token: null
          }
        });
      }

      res.status(200).json({ success: true, data: results[0] });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateAppointmentSettings = async (req, res) => {
  try {
    const branchId = req.body.branch_id || req.query.branch_id || req.user?.Branch_idBranch;
    const { default_location, default_start_time, default_end_time } = req.body;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "Branch ID required" });
    }

    pool.query("SELECT id, public_booking_token FROM appointment_settings WHERE branch_id = ?", [branchId], (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });

      if (results.length === 0) {
        // Insert
        const token = crypto.randomBytes(16).toString("hex");
        const insertQuery = `INSERT INTO appointment_settings (branch_id, default_location, default_start_time, default_end_time, public_booking_token) VALUES (?, ?, ?, ?, ?)`;
        pool.query(insertQuery, [branchId, default_location, default_start_time, default_end_time, token], (err2) => {
          if (err2) return res.status(500).json({ success: false, message: err2.message });
          res.status(200).json({ success: true, message: "Settings saved", data: { public_booking_token: token } });
        });
      } else {
        // Update
        let token = results[0].public_booking_token;
        if (!token) {
          token = crypto.randomBytes(16).toString("hex");
        }
        const updateQuery = `UPDATE appointment_settings SET default_location = ?, default_start_time = ?, default_end_time = ?, public_booking_token = ? WHERE branch_id = ?`;
        pool.query(updateQuery, [default_location, default_start_time, default_end_time, token, branchId], (err2) => {
          if (err2) return res.status(500).json({ success: false, message: err2.message });
          res.status(200).json({ success: true, message: "Settings updated", data: { public_booking_token: token } });
        });
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getAppointmentSettings, updateAppointmentSettings };
