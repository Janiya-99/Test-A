const db = require("../db/db");
const path = require("path");
const fs = require("fs");

const VALID_STATUSES = ["Packing", "Dispatch", "Delivered", "Cancel", "Return"];

exports.addDelivery = async (req, res) => {
  try {
    // Validate required fields
    if (!req.body.Invoice_Number) {
      return res.status(400).json({ message: "Invoice number is required!" });
    }
    if (!req.body.idInvoice) {
      return res.status(400).json({ message: "Invoice ID is required!" });
    }

    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    let attachmentPath = null;

    // Handle file upload if present - note the field name matches frontend's "Attachment"
    if (req.files?.Attachment) {
      const file = req.files.Attachment;
      const fileExt = path.extname(file.name);
      const fileName = `delivery_${Date.now()}${fileExt}`;
      attachmentPath = path.join(uploadDir, fileName);

      await file.mv(attachmentPath);
      // Store just the filename in DB
      attachmentPath = fileName;
    }

    const {
      idInvoice,
      Invoice_Number,
      Customer_Name,
      Customer_Address,
      Delivery_Reference_No,
      Status = "Packing",
      Date_Time = new Date(),
      Delivered_By,
      Note,
      Branch_idBranch,
    } = req.body;

    const query = `
  INSERT INTO delivery (
    idInvoice,
    Invoice_Number,
    Customer_Name,
    Customer_Address,
    Delivery_Reference_No,
    Status,
    Date_Time,
    Delivered_By,
    Attachment,
    Note,
    Branch_idBranch
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

    const values = [
      idInvoice,
      Invoice_Number,
      Customer_Name,
      Customer_Address || null,
      Delivery_Reference_No || null,
      Status,
      Date_Time,
      Delivered_By || null,
      attachmentPath,
      Note || null,
      Branch_idBranch,
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error("Database error:", err);
        // Clean up uploaded file if there was an error
        if (attachmentPath) {
          fs.unlink(path.join(uploadDir, attachmentPath), () => {});
        }
        return res.status(500).json({
          message: "Failed to save delivery",
          error: err.message,
        });
      }
      // Trigger SMS
      const userId = req.body?.User_idUser || req.body?.userId || req.user?.id || req.user?.userId || null;
      triggerDeliverySms(idInvoice, Status, Delivery_Reference_No, Branch_idBranch, userId);

      return res.status(201).json({
        message: "Delivery saved successfully!",
        deliveryId: result.insertId,
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
};

exports.getDeliveries = async (req, res) => {
  try {
    const { status, branch_id, from_date, to_date } = req.query;

    let query = `
      SELECT * FROM delivery 
      WHERE 1=1
    `;

    const params = [];

    // Filter by status if provided
    if (status) {
      query += ` AND Status = ?`;
      params.push(status);
    }

    // Filter by branch if provided
    if (branch_id) {
      query += ` AND Branch_idBranch = ?`;
      params.push(branch_id);
    }

    // Filter by date range if provided
    if (from_date && to_date) {
      query += ` AND Date_Time BETWEEN ? AND ?`;
      params.push(from_date, to_date);
    }

    // Order by most recent first
    query += ` ORDER BY Date_Time DESC`;

    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          message: "Failed to fetch deliveries",
          error: err.message,
        });
      }

      return res.status(200).json({
        message: "Deliveries fetched successfully",
        deliveries: results,
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
};

// Update Delivery Status
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const query = `UPDATE delivery SET Status = ? WHERE idDelivery = ?`;

    db.query(query, [status, id], (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          message: "Failed to update delivery status",
          error: err.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Delivery not found" });
      }

      db.query("SELECT idInvoice, Delivery_Reference_No, Branch_idBranch FROM delivery WHERE idDelivery = ?", [id], (selErr, selRes) => {
        if (!selErr && selRes && selRes.length > 0) {
          const del = selRes[0];
          const userId = req.body?.User_idUser || req.body?.userId || req.user?.id || req.user?.userId || null;
          triggerDeliverySms(del.idInvoice, status, del.Delivery_Reference_No, del.Branch_idBranch, userId);
        }
      });

      return res.status(200).json({
        message: "Delivery status updated successfully",
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
};


// deliveryControllers.js
exports.updateDelivery = async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const {
      idInvoice,
      Invoice_Number,
      Customer_Name,
      Customer_Address,
      Delivery_Reference_No,
      Status = "Packing",
      Date_Time,
      Delivered_By,
      Note,
    } = req.body;

    const idDelivery = req.params.id;

    if (!idDelivery) {
      return res.status(400).json({ message: "Missing delivery ID." });
    }

    let attachmentPath = null;

    if (req.files?.attachment) {
      const file = req.files.attachment;
      const fileExt = path.extname(file.name);
      const fileName = `delivery_${Date.now()}${fileExt}`;
      attachmentPath = fileName;
      await file.mv(path.join(uploadDir, fileName));
    } else if (req.body.keepExistingAttachment === "true") {
      attachmentPath = req.body.existingAttachment || null;
    }

    const updateQuery = `
      UPDATE delivery SET
        idInvoice = ?,
        Invoice_Number = ?,
        Customer_Name = ?,
        Customer_Address = ?,
        Delivery_Reference_No = ?,
        Status = ?,
        Date_Time = ?,
        Delivered_By = ?,
        Attachment = ?,
        Note = ?
      WHERE idDelivery = ?
    `;

    const values = [
      idInvoice,
      Invoice_Number,
      Customer_Name,
      Customer_Address || null,
      Delivery_Reference_No || null,
      Status,
      Date_Time,
      Delivered_By || null,
      attachmentPath,
      Note || null,
      idDelivery,
    ];

    db.query(updateQuery, values, (err, result) => {
      if (err) {
        console.error("Update error:", err);
        return res.status(500).json({ message: "Failed to update delivery", error: err.message });
      }
      return res.status(200).json({ message: "Delivery updated successfully" });
    });
  } catch (err) {
    console.error("Update server error:", err);
    return res.status(500).json({ message: "Internal server error", error: err.message });
  }
};


exports.deleteDelivery = (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM delivery WHERE idDelivery = ?", [id], (err, result) => {
    if (err) {
      console.error("Delete Delivery Error:", err);
      return res.status(500).json({ message: "Failed to delete delivery" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    res.json({ message: "Delivery deleted successfully" });
  });
};

const triggerDeliverySms = async (idInvoice, status, referenceNo, branchId, userId) => {
  try {
    const db = require("../db/db");
    const smsService = require("../services/smsService");
    const customerDb = require("../services/customerDBService");
    
    // 1. Fetch customer details via invoice
    db.query("SELECT Customer_idCustomer, Invoice_Number FROM invoice WHERE idInvoice = ?", [idInvoice], (invErr, invRes) => {
      if (!invErr && invRes && invRes.length > 0) {
        const invoice = invRes[0];
        customerDb.fetchCustomerById(invoice.Customer_idCustomer).then(async (customerList) => {
          if (customerList && customerList.length > 0) {
            const customer = customerList[0];
            const recipientPhone = customer.phoneNumber || customer.Tp;
            const customerName = `${customer.First_Name || ""} ${customer.lastName || ""}`.trim() || customer.displayName;
            
            const smsData = {
              name: customerName,
              invoice_no: invoice.Invoice_Number,
              status: status,
              reference_no: referenceNo || "N/A",
              date: new Date().toISOString().split("T")[0]
            };
            
            await smsService.triggerSMSNotification(branchId, "delivery_stage", recipientPhone, smsData, userId);
          }
        });
      }
    });
  } catch (smsErr) {
    console.error("[SMS-Trigger] Delivery SMS failed:", smsErr);
  }
};