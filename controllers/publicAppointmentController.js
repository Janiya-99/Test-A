const pool = require("../db/db");

const getPublicAppointmentDetails = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ success: false, message: "Token required" });
    }

    const query = "SELECT * FROM appointment_settings WHERE public_booking_token = ?";
    pool.query(query, [token], (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      
      if (results.length === 0) {
        return res.status(404).json({ success: false, message: "Invalid booking link" });
      }

      const settings = results[0];
      
      res.status(200).json({ 
        success: true, 
        data: {
            branch_id: settings.branch_id,
            default_location: settings.default_location,
            default_start_time: settings.default_start_time,
            default_end_time: settings.default_end_time
        }
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createPublicAppointment = async (req, res) => {
    try {
        const { token } = req.params;
        const { title, start_datetime, end_datetime, description } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, message: "Token required" });
        }

        // Validate dates
        if (!title || !start_datetime || !end_datetime) {
            return res.status(400).json({
                success: false,
                message: "Name, start time, and end time are required",
            });
        }

        const startDate = new Date(start_datetime);
        const endDate = new Date(end_datetime);

        if (endDate <= startDate) {
            return res.status(400).json({
                success: false,
                message: "End time must be after start time",
            });
        }

        // 1. Get branch ID and location from token
        const query = "SELECT branch_id, default_location FROM appointment_settings WHERE public_booking_token = ?";
        pool.query(query, [token], (err, results) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            if (results.length === 0) {
                return res.status(404).json({ success: false, message: "Invalid booking link" });
            }

            const branchId = results[0].branch_id;
            const location = results[0].default_location;

            // 2. Insert into appointments
            const appointmentTitle = `Appointment: ${title}`;
            
            const insertQuery = `
                INSERT INTO appointments 
                (branch_id, user_id, title, start_datetime, end_datetime, location, description, participant_type, participant_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            pool.query(insertQuery, [
                branchId,
                1, // default user
                appointmentTitle,
                start_datetime,
                end_datetime,
                location,
                description || "",
                "customer",
                title
            ], (insertErr, insertResult) => {
                if (insertErr) return res.status(500).json({ success: false, message: insertErr.message });
                
                res.status(201).json({
                    success: true,
                    message: "Appointment booked successfully",
                    data: { id: insertResult.insertId }
                });
            });
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getPublicAppointmentDetails, createPublicAppointment };
