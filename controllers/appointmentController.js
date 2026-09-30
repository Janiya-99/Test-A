const pool = require("../db/db");
const axios = require("axios");


// Get all appointments for a branch
const getAllAppointments = async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const query = `SELECT 
        a.id, a.title, 
        DATE_FORMAT(a.start_datetime, '%Y-%m-%d %H:%i:%s') as start_datetime,
        DATE_FORMAT(a.end_datetime, '%Y-%m-%d %H:%i:%s') as end_datetime,
        a.location, a.description, a.participant_type, a.participant_id, a.participant_name,
        a.branch_id, a.user_id, a.created_at, a.updated_at, a.notify_person_id,
        CASE 
          WHEN a.participant_type = 'customer' THEN c.displayName
          WHEN a.participant_type = 'supplier' THEN s.Company_Name
          ELSE a.participant_name
        END as participant_display_name,
        CONCAT(u.First_Name, ' ', u.Last_Name) as created_by_name,
        np.name as notify_person_name,
        np.whatsapp_number as notify_person_whatsapp
      FROM appointments a
      LEFT JOIN customer c ON a.participant_type = 'customer' AND a.participant_id = c.idCustomer
      LEFT JOIN supplier s ON a.participant_type = 'supplier' AND a.participant_id = s.idSupplier
      LEFT JOIN user u ON a.user_id = u.idUser
      LEFT JOIN appointment_notify_people np ON a.notify_person_id = np.id
      WHERE a.branch_id = ?
      ORDER BY a.start_datetime ASC`;

    pool.query(query, [branchId], (error, appointments) => {
      if (error) {
        console.error("Error fetching appointments:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch appointments",
          error: error.message,
        });
      }

      res.status(200).json({
        success: true,
        data: appointments,
      });
    });
  } catch (error) {
    console.error("Error fetching appointments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch appointments",
      error: error.message,
    });
  }
};

// Get appointments by date range
const getAppointmentsByDateRange = async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;
    const { start, end } = req.query;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "Start and end dates are required",
      });
    }

    const query = `SELECT 
        a.id, a.title, 
        DATE_FORMAT(a.start_datetime, '%Y-%m-%d %H:%i:%s') as start_datetime,
        DATE_FORMAT(a.end_datetime, '%Y-%m-%d %H:%i:%s') as end_datetime,
        a.location, a.description, a.participant_type, a.participant_id, a.participant_name,
        a.branch_id, a.user_id, a.created_at, a.updated_at, a.notify_person_id,
        CASE 
          WHEN a.participant_type = 'customer' THEN c.displayName
          WHEN a.participant_type = 'supplier' THEN s.Company_Name
          ELSE a.participant_name
        END as participant_display_name,
        CONCAT(u.First_Name, ' ', u.Last_Name) as created_by_name,
        np.name as notify_person_name,
        np.whatsapp_number as notify_person_whatsapp
      FROM appointments a
      LEFT JOIN customer c ON a.participant_type = 'customer' AND a.participant_id = c.idCustomer
      LEFT JOIN supplier s ON a.participant_type = 'supplier' AND a.participant_id = s.idSupplier
      LEFT JOIN user u ON a.user_id = u.idUser
      LEFT JOIN appointment_notify_people np ON a.notify_person_id = np.id
      WHERE a.branch_id = ?
        AND a.start_datetime >= ?
        AND a.end_datetime <= ?
      ORDER BY a.start_datetime ASC`;

    pool.query(query, [branchId, start, end], (error, appointments) => {
      if (error) {
        console.error("Error fetching appointments by date range:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch appointments",
          error: error.message,
        });
      }

      res.status(200).json({
        success: true,
        data: appointments,
      });
    });
  } catch (error) {
    console.error("Error fetching appointments by date range:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch appointments",
      error: error.message,
    });
  }
};

// Get single appointment by ID
const getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const branchId = req.user?.Branch_idBranch;

    const query = `SELECT 
        a.id, a.title, 
        DATE_FORMAT(a.start_datetime, '%Y-%m-%d %H:%i:%s') as start_datetime,
        DATE_FORMAT(a.end_datetime, '%Y-%m-%d %H:%i:%s') as end_datetime,
        a.location, a.description, a.participant_type, a.participant_id, a.participant_name,
        a.branch_id, a.user_id, a.created_at, a.updated_at, a.notify_person_id,
        CASE 
          WHEN a.participant_type = 'customer' THEN c.displayName
          WHEN a.participant_type = 'supplier' THEN s.Company_Name
          ELSE a.participant_name
        END as participant_display_name,
        CONCAT(u.First_Name, ' ', u.Last_Name) as created_by_name,
        np.name as notify_person_name,
        np.whatsapp_number as notify_person_whatsapp
      FROM appointments a
      LEFT JOIN customer c ON a.participant_type = 'customer' AND a.participant_id = c.idCustomer
      LEFT JOIN supplier s ON a.participant_type = 'supplier' AND a.participant_id = s.idSupplier
      LEFT JOIN user u ON a.user_id = u.idUser
      LEFT JOIN appointment_notify_people np ON a.notify_person_id = np.id
      WHERE a.id = ? AND a.branch_id = ?`;

    pool.query(query, [id, branchId], (error, appointments) => {
      if (error) {
        console.error("Error fetching appointment:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch appointment",
          error: error.message,
        });
      }

      if (appointments.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Appointment not found",
        });
      }

      res.status(200).json({
        success: true,
        data: appointments[0],
      });
    });
  } catch (error) {
    console.error("Error fetching appointment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch appointment",
      error: error.message,
    });
  }
};

// Create new appointment
const createAppointment = async (req, res) => {
  try {
    const {
      title,
      start_datetime,
      end_datetime,
      location,
      description,
      participant_type,
      participant_id,
      participant_name,
      notify_person_id,
      is_recurring,
      recurrence_pattern,
      recurrence_interval,
      recurrence_end_date,
    } = req.body;


    // Accept from body or req.user
    const branchId =
      req.body.branch_id || req.query.branch_id || req.user?.Branch_idBranch;
    const userId = req.body.user_id || req.user?.idUser || 1; // Default to 1 if not available

    // Validation
    if (!title || !start_datetime || !end_datetime || !participant_type) {
      return res.status(400).json({
        success: false,
        message:
          "Title, start time, end time, and participant type are required",
      });
    }

    // Validate dates
    const startDate = new Date(start_datetime);
    const endDate = new Date(end_datetime);

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: "End time must be after start time",
      });
    }

    // Validate participant data
    if (
      (participant_type === "customer" || participant_type === "supplier") &&
      !participant_id
    ) {
      return res.status(400).json({
        success: false,
        message: `Participant ID is required for ${participant_type} type`,
      });
    }

    if (participant_type === "other" && !participant_name) {
      return res.status(400).json({
        success: false,
        message: "Participant name is required for 'other' type",
      });
    }

    // Generate date series for recurring appointments
    const instances = [];
    const durationMs = endDate.getTime() - startDate.getTime();

    if (is_recurring === 1 && recurrence_pattern && recurrence_end_date) {
      let currentStart = new Date(startDate);
      let currentEnd = new Date(endDate);
      const recurrenceEnd = new Date(recurrence_end_date);
      // Set time to end of day to include end date
      recurrenceEnd.setHours(23, 59, 59, 999);

      let occurrences = 0;
      // Guard against infinite loops or excessive rows (limit to 100 occurrences)
      while (currentStart <= recurrenceEnd && occurrences < 100) {
        instances.push({
          start: new Date(currentStart),
          end: new Date(currentEnd),
        });

        // Calculate next recurrence date
        if (recurrence_pattern === "daily") {
          currentStart.setDate(currentStart.getDate() + (parseInt(recurrence_interval) || 1));
        } else if (recurrence_pattern === "weekly") {
          currentStart.setDate(currentStart.getDate() + (parseInt(recurrence_interval) || 1) * 7);
        } else if (recurrence_pattern === "monthly") {
          currentStart.setMonth(currentStart.getMonth() + (parseInt(recurrence_interval) || 1));
        } else if (recurrence_pattern === "yearly") {
          currentStart.setFullYear(currentStart.getFullYear() + (parseInt(recurrence_interval) || 1));
        } else {
          break;
        }
        currentEnd = new Date(currentStart.getTime() + durationMs);
        occurrences++;
      }
    } else {
      // Single appointment
      instances.push({
        start: startDate,
        end: endDate,
      });
    }

    // Bulk insert appointments
    const insertQuery = `INSERT INTO appointments 
        (title, start_datetime, end_datetime, location, description, 
         participant_type, participant_id, participant_name, branch_id, user_id, notify_person_id,
         is_recurring, recurrence_pattern, recurrence_interval, recurrence_end_date)
      VALUES ?`;

    const insertValues = instances.map((inst) => [
      title,
      inst.start,
      inst.end,
      location || null,
      description || null,
      participant_type,
      participant_id || null,
      participant_name || null,
      branchId,
      userId,
      notify_person_id || null,
      is_recurring || 0,
      recurrence_pattern || null,
      recurrence_interval || 1,
      recurrence_end_date || null,
    ]);

    pool.query(
      insertQuery,
      [insertValues],
      (error, result) => {
        if (error) {
          console.error("Error creating appointment:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to create appointment",
            error: error.message,
          });
        }

        // Fetch the created appointment with joined data (the first one)
        const selectQuery = `SELECT 
          a.id, a.title, 
          DATE_FORMAT(a.start_datetime, '%Y-%m-%d %H:%i:%s') as start_datetime,
          DATE_FORMAT(a.end_datetime, '%Y-%m-%d %H:%i:%s') as end_datetime,
          a.location, a.description, a.participant_type, a.participant_id, a.participant_name,
          a.branch_id, a.user_id, a.created_at, a.updated_at, a.notify_person_id,
          a.is_recurring, a.recurrence_pattern, a.recurrence_interval, a.recurrence_end_date,
          CASE 
            WHEN a.participant_type = 'customer' THEN c.displayName
            WHEN a.participant_type = 'supplier' THEN s.Company_Name
            ELSE a.participant_name
          END as participant_display_name,
          CONCAT(u.First_Name, ' ', u.Last_Name) as created_by_name,
          np.name as notify_person_name,
          np.whatsapp_number as notify_person_whatsapp,
          c.phoneNumber as customer_phone
        FROM appointments a
        LEFT JOIN customer c ON a.participant_type = 'customer' AND a.participant_id = c.idCustomer
        LEFT JOIN supplier s ON a.participant_type = 'supplier' AND a.participant_id = s.idSupplier
        LEFT JOIN user u ON a.user_id = u.idUser
        LEFT JOIN appointment_notify_people np ON a.notify_person_id = np.id
        WHERE a.id = ?`;

        pool.query(selectQuery, [result.insertId], (err, newAppointment) => {
          if (err) {
            console.error("Error fetching created appointment:", err);
            return res.status(500).json({
              success: false,
              message: "Appointment created but failed to fetch details",
              error: err.message,
            });
          }

          // Automatically award Appointment Creation XP upon successful appointment booking
          try {
            const loyaltyService = require("../services/loyaltyService");
            loyaltyService.awardUserXp(userId, "APPOINTMENT_CREATION")
              .then(() => console.log(`[Loyalty] Successfully awarded appointment creation XP to user ${userId}`))
              .catch((xpErr) => console.error("[Loyalty] Failed to award appointment XP:", xpErr));
          } catch (xpErr) {
            console.error("[Loyalty] Failed to load loyaltyService:", xpErr);
          }
          
          // Trigger SMS Notifications
          try {
            const smsService = require("../services/smsService");
            const appt = newAppointment[0];
            
            if (appt.participant_type === 'customer' && appt.customer_phone) {
              const customerData = {
                name: appt.participant_display_name,
                title: appt.title,
                start_time: appt.start_datetime,
                end_time: appt.end_datetime,
                location: appt.location || "N/A",
                description: appt.description || ""
              };
              smsService.triggerSMSNotification(appt.branch_id, "appointment_customer", appt.customer_phone, customerData, appt.user_id);
            }
            
            if (appt.notify_person_id && appt.notify_person_whatsapp) {
              const assignedData = {
                assigned_person: appt.notify_person_name,
                name: appt.participant_display_name || appt.participant_name,
                title: appt.title,
                start_time: appt.start_datetime,
                end_time: appt.end_datetime,
                location: appt.location || "N/A"
              };
              smsService.triggerSMSNotification(appt.branch_id, "appointment_assigned", appt.notify_person_whatsapp, assignedData, appt.user_id);
            }
          } catch (smsErr) {
            console.error("[SMS-Trigger] Appointment SMS failed:", smsErr);
          }

          res.status(201).json({
            success: true,
            message: "Appointment created successfully",
            data: newAppointment[0],
          });
        });
      },
    );
  } catch (error) {
    console.error("Error creating appointment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create appointment",
      error: error.message,
    });
  }
};

// Update appointment
const updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      start_datetime,
      end_datetime,
      location,
      description,
      participant_type,
      participant_id,
      participant_name,
      notify_person_id,
    } = req.body;


    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    // Check if appointment exists and belongs to this branch
    pool.query(
      "SELECT * FROM appointments WHERE id = ? AND branch_id = ?",
      [id, branchId],
      (error, existing) => {
        if (error) {
          console.error("Error checking appointment:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to update appointment",
            error: error.message,
          });
        }

        if (existing.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Appointment not found",
          });
        }

        // Validate dates if provided
        if (start_datetime && end_datetime) {
          const startDate = new Date(start_datetime);
          const endDate = new Date(end_datetime);

          if (endDate <= startDate) {
            return res.status(400).json({
              success: false,
              message: "End time must be after start time",
            });
          }
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (title !== undefined) {
          updates.push("title = ?");
          values.push(title);
        }
        if (start_datetime !== undefined) {
          updates.push("start_datetime = ?");
          values.push(start_datetime);
        }
        if (end_datetime !== undefined) {
          updates.push("end_datetime = ?");
          values.push(end_datetime);
        }
        if (location !== undefined) {
          updates.push("location = ?");
          values.push(location);
        }
        if (description !== undefined) {
          updates.push("description = ?");
          values.push(description);
        }
        if (participant_type !== undefined) {
          updates.push("participant_type = ?");
          values.push(participant_type);
        }
        if (participant_id !== undefined) {
          updates.push("participant_id = ?");
          values.push(participant_id || null);
        }
        if (participant_name !== undefined) {
          updates.push("participant_name = ?");
          values.push(participant_name);
        }
        if (notify_person_id !== undefined) {
          updates.push("notify_person_id = ?");
          values.push(notify_person_id || null);
        }

        if (updates.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No fields to update",
          });
        }

        values.push(id, branchId);

        pool.query(
          `UPDATE appointments SET ${updates.join(", ")} WHERE id = ? AND branch_id = ?`,
          values,
          (updateError) => {
            if (updateError) {
              console.error("Error updating appointment:", updateError);
              return res.status(500).json({
                success: false,
                message: "Failed to update appointment",
                error: updateError.message,
              });
            }

            // Fetch updated appointment
            const selectQuery = `SELECT 
              a.id, a.title, 
              DATE_FORMAT(a.start_datetime, '%Y-%m-%d %H:%i:%s') as start_datetime,
              DATE_FORMAT(a.end_datetime, '%Y-%m-%d %H:%i:%s') as end_datetime,
              a.location, a.description, a.participant_type, a.participant_id, a.participant_name,
              a.branch_id, a.user_id, a.created_at, a.updated_at, a.notify_person_id,
              CASE 
                WHEN a.participant_type = 'customer' THEN c.displayName
                WHEN a.participant_type = 'supplier' THEN s.Company_Name
                ELSE a.participant_name
              END as participant_display_name,
              CONCAT(u.First_Name, ' ', u.Last_Name) as created_by_name,
              np.name as notify_person_name,
              np.whatsapp_number as notify_person_whatsapp
            FROM appointments a
            LEFT JOIN customer c ON a.participant_type = 'customer' AND a.participant_id = c.idCustomer
            LEFT JOIN supplier s ON a.participant_type = 'supplier' AND a.participant_id = s.idSupplier
            LEFT JOIN user u ON a.user_id = u.idUser
            LEFT JOIN appointment_notify_people np ON a.notify_person_id = np.id
            WHERE a.id = ?`;

            pool.query(selectQuery, [id], (fetchError, updatedAppointment) => {
              if (fetchError) {
                console.error(
                  "Error fetching updated appointment:",
                  fetchError,
                );
                return res.status(500).json({
                  success: false,
                  message: "Appointment updated but failed to fetch details",
                  error: fetchError.message,
                });
              }

              res.status(200).json({
                success: true,
                message: "Appointment updated successfully",
                data: updatedAppointment[0],
              });
            });
          },
        );
      },
    );
  } catch (error) {
    console.error("Error updating appointment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update appointment",
      error: error.message,
    });
  }
};

// Delete appointment
const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    pool.query(
      "DELETE FROM appointments WHERE id = ? AND branch_id = ?",
      [id, branchId],
      (error, result) => {
        if (error) {
          console.error("Error deleting appointment:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to delete appointment",
            error: error.message,
          });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: "Appointment not found",
          });
        }

        res.status(200).json({
          success: true,
          message: "Appointment deleted successfully",
        });
      },
    );
  } catch (error) {
    console.error("Error deleting appointment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete appointment",
      error: error.message,
    });
  }
};

// Get customers for appointment dropdown
const getCustomersForAppointment = async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const query = `SELECT 
        idCustomer, 
        displayName,
        phoneNumber,
        companyEmail
      FROM customer 
      WHERE Branch_idBranch = ? AND Status = 1
      ORDER BY displayName ASC`;

    pool.query(query, [branchId], (error, customers) => {
      if (error) {
        console.error("Error fetching customers:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch customers",
          error: error.message,
        });
      }

      res.status(200).json({
        success: true,
        data: customers.map((c) => ({
          id: c.idCustomer,
          name: c.displayName,
          phone: c.phoneNumber,
          email: c.companyEmail,
        })),
      });
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
      error: error.message,
    });
  }
};

// Get suppliers for appointment dropdown
const getSuppliersForAppointment = async (req, res) => {
  try {
    const branchId = req.query.branch_id || req.user?.Branch_idBranch;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch ID is required",
      });
    }

    const query = `SELECT 
        idSupplier, 
        Company_Name,
        Contact_No,
        Email
      FROM supplier 
      WHERE Branch_idBranch = ? AND Status = 1 AND isDeleted = 0
      ORDER BY Company_Name ASC`;

    pool.query(query, [branchId], (error, suppliers) => {
      if (error) {
        console.error("Error fetching suppliers:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch suppliers",
          error: error.message,
        });
      }

      res.status(200).json({
        success: true,
        data: suppliers.map((s) => ({
          id: s.idSupplier,
          name: s.Company_Name,
          phone: s.Contact_No,
          email: s.Email,
        })),
      });
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch suppliers",
      error: error.message,
    });
  }
};

// Get holidays from Google Calendar
const getHolidays = async (req, res) => {
  try {
    const calendarId = encodeURIComponent(
      "en.lk#holiday@group.v.calendar.google.com",
    );
    const url = `https://calendar.google.com/calendar/ical/${calendarId}/public/basic.ics`;

    const response = await axios.get(url);
    const icsContent = response.data;

    const holidays = [];
    // Split by BEGIN:VEVENT and skip the first part (header)
    const vevents = icsContent.split("BEGIN:VEVENT").slice(1);

    vevents.forEach((vevent, index) => {
      const summaryMatch = vevent.match(/SUMMARY:(.*)/);
      const dtstartMatch = vevent.match(/DTSTART;VALUE=DATE:(\d{8})/);
      const dtendMatch = vevent.match(/DTEND;VALUE=DATE:(\d{8})/);

      if (summaryMatch && dtstartMatch) {
        const title = summaryMatch[1].trim().replace(/\r/g, "");
        const startStr = dtstartMatch[1];
        const endStr = dtendMatch ? dtendMatch[1] : startStr;

        const year = parseInt(startStr.substring(0, 4));
        const month = parseInt(startStr.substring(4, 6)) - 1;
        const day = parseInt(startStr.substring(6, 8));

        const startDate = new Date(year, month, day);

        let endDate;
        if (dtendMatch) {
          const eYear = parseInt(endStr.substring(0, 4));
          const eMonth = parseInt(endStr.substring(4, 6)) - 1;
          const eDay = parseInt(endStr.substring(6, 8));
          endDate = new Date(eYear, eMonth, eDay);
        } else {
          endDate = new Date(year, month, day + 1);
        }

        holidays.push({
          id: `holiday-${index}`,
          title: title,
          start: startDate,
          end: endDate,
          allDay: true,
          isHoliday: true,
        });
      }
    });

    res.status(200).json({
      success: true,
      data: holidays,
    });
  } catch (error) {
    console.error("Error fetching holidays:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch holidays",
      error: error.message,
    });
  }
};

module.exports = {

  getAllAppointments,
  getAppointmentsByDateRange,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getCustomersForAppointment,
  getSuppliersForAppointment,
  getHolidays,
};

