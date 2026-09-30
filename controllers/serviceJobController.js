const db = require("../db/db");
const fs = require("fs");
const path = require("path");
const stockCardDBService = require("../services/stockCardDBService");
const productDBService = require("../services/productDBService");
const branchDBService = require("../services/branchDBService");


// Helper: Save Base64 Photo
const saveBase64Photo = (base64String, jobId) => {
  if (!base64String) return null;
  try {
    // If it's already an uploaded file path, return it as-is
    if (!base64String.startsWith("data:") && (base64String.startsWith("uploads/") || base64String.startsWith("http"))) {
      return base64String;
    }
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    const type = matches[1];
    const data = matches[2];
    const buffer = Buffer.from(data, "base64");
    
    let extension = type.split("/")[1];
    if (extension === "jpeg") extension = "jpg";
    if (extension === "svg+xml") extension = "svg";

    const fileName = `sj_${jobId || 'temp'}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const uploadDir = path.join(__dirname, "../uploads/service_jobs");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return `uploads/service_jobs/${fileName}`;
  } catch (error) {
    console.error("Error saving photo image:", error);
    return null;
  }
};

// Helper: Delete Photo from Filesystem
const deletePhotoFile = (photoPath) => {
  if (!photoPath) return;
  try {
    const fullPath = path.join(__dirname, `../${photoPath}`);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    console.error("Error deleting file:", photoPath, err);
  }
};

// Generate next Job No
const getNextJobNo = (branch_id) => {
  return new Promise((resolve, reject) => {
    // 1. Get settings from rules table
    db.query("SELECT Service_Job_No_Start_With, Service_Job_No_Start_From FROM rules WHERE Branch_idBranch = ?", [branch_id], (err, rulesResult) => {
      if (err) return reject(err);
      
      let prefix = "ES002/OUN";
      let startFrom = 1000;
      if (rulesResult && rulesResult.length > 0) {
        prefix = rulesResult[0].Service_Job_No_Start_With || prefix;
        startFrom = rulesResult[0].Service_Job_No_Start_From || startFrom;
      }

      // 2. Get last job no for the branch
      db.query("SELECT job_no FROM service_jobs WHERE branch_id = ? AND job_no LIKE ? ORDER BY id DESC LIMIT 1", [branch_id, `${prefix}%`], (err, jobResult) => {
        if (err) return reject(err);

        let nextJobNo = `${prefix}-${startFrom}`; // Format: PREFIX-1000
        if (jobResult && jobResult.length > 0) {
          const lastJobNo = jobResult[0].job_no;
          // Extract number part
          const match = lastJobNo.match(/-(\d+)$/);
          if (match && match[1]) {
            const nextNum = parseInt(match[1]) + 1;
            nextJobNo = `${prefix}-${nextNum}`;
          }
        }
        resolve(nextJobNo);
      });
    });
  });
};

// ─── DEFAULT CUSTOM FIELD CATALOG ────────────────────────────────────────────
// Same catalog as estimate so fields can be matched by key/label during conversion
const DEFAULT_CUSTOM_FIELDS = [
  // Vehicle / Transport
  { key: "vehicle_brand",    label: "Brand / Make",        type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_model",    label: "Model",               type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_year",     label: "Year",                type: "number", group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_color",    label: "Color",               type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_number",   label: "Vehicle / Plate No.", type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "chassis_number",   label: "Chassis Number",      type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "engine_number",    label: "Engine Number",       type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "mileage",          label: "Mileage (km)",        type: "number", group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "fuel_type",        label: "Fuel Type",           type: "select", group: "Vehicle Info",      enabled: false, custom_label: "", options: ["Petrol","Diesel","Electric","Hybrid","CNG"] },
  { key: "transmission",     label: "Transmission",        type: "select", group: "Vehicle Info",      enabled: false, custom_label: "", options: ["Manual","Automatic","CVT","Semi-Automatic"] },
  // Device / Electronics
  { key: "serial_number",    label: "Serial Number",       type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "imei_number",      label: "IMEI Number",         type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "device_type",      label: "Device Type",         type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "warranty_number",  label: "Warranty Number",     type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "purchase_date",    label: "Purchase Date",       type: "date",   group: "Device / Product", enabled: false, custom_label: "" },
  // Insurance / Claims
  { key: "claim_number",     label: "Claim Number",        type: "text",   group: "Insurance / Claim", enabled: false, custom_label: "" },
  { key: "policy_number",    label: "Policy Number",       type: "text",   group: "Insurance / Claim", enabled: false, custom_label: "" },
  { key: "incident_date",    label: "Incident Date",       type: "date",   group: "Insurance / Claim", enabled: false, custom_label: "" },
  // Customer / Admin
  { key: "customer_nic",     label: "Customer NIC / ID No", type: "text",  group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "technician_name",  label: "Technician Assigned", type: "text",   group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "job_order_started_date", label: "Job Order Started Date", type: "date", group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "job_order_completed_date", label: "Job Order Completed Date", type: "date", group: "Customer / Admin", enabled: false, custom_label: "" },
];

// Helper: merge saved custom_fields_config with default catalog
const mergeCustomFields = (savedJson) => {
  let savedFields = [];
  try { savedFields = JSON.parse(savedJson || '[]'); } catch(_) {}
  const mergedFields = DEFAULT_CUSTOM_FIELDS.map(def => {
    const saved = savedFields.find(f => f.key === def.key);
    return saved ? { ...def, ...saved } : def;
  });
  // Append any saved fields not in default catalog
  savedFields.forEach(sf => {
    if (!mergedFields.find(f => f.key === sf.key)) mergedFields.push(sf);
  });
  return mergedFields;
};

const deductStockForServiceJobItem = async (item, jobId, jobNo, branchId, companyId, userId, connection) => {
  const itemId = item.item_id;
  const qty = Number(item.qty || 1);
  const unitPrice = Number(item.unit_price || 0);
  const variationId = item.variation_id || null;
  const serialNoId = item.serial_no_id || null;

  // 1. Fetch item details (Type, Cost, Description)
  const dbItem = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT Type, Cost, Description, Qty FROM item WHERE idItem = ?",
      [itemId],
      (e, rows) => { if (e) reject(e); else resolve(rows ? rows[0] : null); }
    );
  });

  if (!dbItem) return null; // Item not found

  // 2. Only process physical products (Type = 1)
  if (String(dbItem.Type) !== "1") {
    return null; 
  }

  const cost = Number(dbItem.Cost) || 0;

  // 3. Find batches to deduct FIFO (branch-wide, filtering by variation if present)
  const batches = await new Promise((resolve, reject) => {
    const q = `SELECT ib.* FROM item_batch ib
               INNER JOIN grn g ON ib.grn_id = g.idGRN
               WHERE ib.item_id = ? 
                 AND (ib.variation_id = ? OR (? IS NULL AND ib.variation_id IS NULL))
                 AND g.Branch_idBranch = ? AND ib.qty > 0
               ORDER BY ib.batch_id ASC FOR UPDATE`;
    connection.query(q, [itemId, variationId, variationId, branchId], (e, rows) => { if (e) reject(e); else resolve(rows); });
  });

  // FIFO batch deduction
  let remaining = qty;
  let firstBatchId = null;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const deduct = Math.min(remaining, Number(batch.qty));
    await new Promise((resolve, reject) => {
      connection.query(
        "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
        [deduct, batch.batch_id],
        (e, r) => { if (e) reject(e); else resolve(r); }
      );
    });
    remaining -= deduct;
    if (!firstBatchId) firstBatchId = batch.batch_id;
  }

  // 4. Update variation stock if variation_id present
  if (variationId) {
    await new Promise((resolve, reject) => {
      connection.query(
        "UPDATE item_variations SET qty = qty - ? WHERE id = ?",
        [qty, variationId],
        (e, r) => { if (e) reject(e); else resolve(r); }
      );
    });
  }

  // 5. Update main item quantity
  await new Promise((resolve, reject) => {
    connection.query(
      "UPDATE item SET Qty = Qty - ? WHERE idItem = ?",
      [qty, itemId],
      (e, r) => { if (e) reject(e); else resolve(r); }
    );
  });

  // 5b. Lock serial number if serialNoId is provided
  if (serialNoId) {
    await new Promise((resolve, reject) => {
      connection.query(
        "UPDATE item_has_serial_no SET Qty = 0 WHERE ID = ?",
        [serialNoId],
        (e, r) => { if (e) reject(e); else resolve(r); }
      );
    });
  }

  // 6. Get current SIH for stock card
  const sihRow = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT Qty FROM item WHERE idItem = ?",
      [itemId],
      (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
    );
  });

  // 7. Stock card entry
  await stockCardDBService.insertStockCard(
    itemId,
    dbItem.Description,
    "SERVICE_JOB",
    jobId,
    cost,
    cost,
    unitPrice,
    0, // IN_Stock
    qty, // Out_Stock
    sihRow.Qty,
    branchId,
    connection,
    variationId
  );

  // 8. Product history log
  await productDBService.productHistoryLogHelper({
    productId: itemId,
    variationId: variationId,
    quantityChange: -qty,
    oldQty: sihRow.Qty + qty,
    newQty: sihRow.Qty,
    type: "Service Job",
    description: `Stock issued via Service Job: ${jobNo}`,
    branchId,
    companyId,
    userId,
    connection,
  });

  return firstBatchId;
};

const reverseStockForServiceJobItem = async (oldItem, jobId, jobNo, branchId, companyId, userId, connection) => {
  const itemId = oldItem.item_id;
  const qty = Number(oldItem.qty || 1);
  const unitPrice = Number(oldItem.unit_price || 0);
  const variationId = oldItem.variation_id || null;
  const serialNoId = oldItem.serial_no_id || null;

  // 1. Fetch item details (Type, Cost, Description)
  const dbItem = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT Type, Cost, Description, Qty FROM item WHERE idItem = ?",
      [itemId],
      (e, rows) => { if (e) reject(e); else resolve(rows ? rows[0] : null); }
    );
  });

  if (!dbItem || String(dbItem.Type) !== "1") return; // Non-physical

  const cost = Number(dbItem.Cost) || 0;

  // 2. Restore to item_batch
  if (oldItem.batch_id) {
    await new Promise((resolve, reject) => {
      connection.query(
        "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?",
        [qty, oldItem.batch_id],
        (e, r) => { if (e) reject(e); else resolve(r); }
      );
    });
  }

  // 3. Restore variation stock if variation_id present
  if (variationId) {
    await new Promise((resolve, reject) => {
      connection.query(
        "UPDATE item_variations SET qty = qty + ? WHERE id = ?",
        [qty, variationId],
        (e, r) => { if (e) reject(e); else resolve(r); }
      );
    });
  }

  // 4. Restore main item Qty
  await new Promise((resolve, reject) => {
    connection.query(
      "UPDATE item SET Qty = Qty + ? WHERE idItem = ?",
      [qty, itemId],
      (e, r) => { if (e) reject(e); else resolve(r); }
    );
  });

  // 4b. Unlock serial number if serialNoId is provided
  if (serialNoId) {
    await new Promise((resolve, reject) => {
      connection.query(
        "UPDATE item_has_serial_no SET Qty = 1 WHERE ID = ?",
        [serialNoId],
        (e, r) => { if (e) reject(e); else resolve(r); }
      );
    });
  }

  // 5. Get current SIH for stock card
  const sihRow = await new Promise((resolve, reject) => {
    connection.query(
      "SELECT Qty FROM item WHERE idItem = ?",
      [itemId],
      (e, rows) => { if (e) reject(e); else resolve(rows[0] || { Qty: 0 }); }
    );
  });

  // 6. Stock card entry
  await stockCardDBService.insertStockCard(
    itemId,
    dbItem.Description,
    "SERVICE_REVERSAL",
    jobId,
    cost,
    cost,
    unitPrice,
    qty, // IN_Stock
    0, // Out_Stock
    sihRow.Qty,
    branchId,
    connection,
    variationId
  );

  // 7. Product history log
  await productDBService.productHistoryLogHelper({
    productId: itemId,
    variationId: variationId,
    quantityChange: qty,
    oldQty: sihRow.Qty - qty,
    newQty: sihRow.Qty,
    type: "Service Job",
    description: `Stock restored from deleted/modified Service Job: ${jobNo}`,
    branchId,
    companyId,
    userId,
    connection,
  });
};

const createServiceJob = async (req, res) => {
  const {
    date,
    customer_id,
    contact_person,
    service_details,
    contact_no,
    mobile_no,
    req_no,
    manual_ref,
    order_no,
    other_ref,
    technician_id,
    technician_ids, // multiple technicians
    remarks,
    branch_id,
    user_id,
    items, // array of items
    photos, // array of base64 strings
    custom_fields_data // object of enabled custom field values
  } = req.body;

  const cfDataJson = custom_fields_data
    ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
    : null;

  const technicianIdsJson = technician_ids && Array.isArray(technician_ids)
    ? JSON.stringify(technician_ids)
    : null;

  db.getConnection(async (err, connection) => {
    if (err) return res.status(500).json({ error: "DB Connection failed" });

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const job_no = await getNextJobNo(branch_id);

        const insertJobQuery = `
          INSERT INTO service_jobs (
            job_no, date, customer_id, contact_person, service_details,
            contact_no, mobile_no, req_no, manual_ref, order_no, other_ref,
            technician_id, remarks, branch_id, user_id, custom_fields_data, technician_ids
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const jobValues = [
          job_no, date, customer_id, contact_person, service_details,
          contact_no, mobile_no, req_no, manual_ref, order_no, other_ref,
          technician_id, remarks, branch_id, user_id, cfDataJson, technicianIdsJson
        ];
        connection.query(insertJobQuery, jobValues, async (err, jobResult) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to create service job" });
            });
          }

          const jobId = jobResult.insertId;

          // Deduct stock for physical items
          try {
            const companyId = await branchDBService.getCompanyIdByBranch(branch_id);
            if (items && items.length > 0) {
              for (const item of items) {
                if (item.is_business_item === 1 && item.item_id) {
                  const bId = await deductStockForServiceJobItem(item, jobId, job_no, branch_id, companyId, user_id, connection);
                  item.batch_id = bId;
                }
              }
            }
          } catch (stockErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Stock deduction failed: " + stockErr.message });
            });
          }
          const executeSaveItems = () => {
            return new Promise((resolve, reject) => {
              if (!items || items.length === 0) return resolve();

              const insertItemsQuery = `
                INSERT INTO service_job_items (
                  service_job_id, item_id, item_name, brand, model, serial_1,
                  warranty_no, doc_date, warr_status, defect_type, remarks,
                  qty, unit_price, total_amount, is_business_item, item_technician_id,
                  manual_cost, batch_id, variation_id, serial_no_id
                ) VALUES ?
              `;

              const itemsValues = items.map(item => [
                jobId, 
                item.item_id || null, 
                item.item_name || null, 
                item.brand || null, 
                item.model || null, 
                item.serial_1 || null,
                item.warranty_no || null, 
                (item.doc_date && item.doc_date !== "" && item.doc_date !== "null") ? item.doc_date.split('T')[0] : null, 
                item.warr_status || null, 
                item.defect_type || null, 
                item.remarks || null,
                item.qty !== undefined ? item.qty : 1,
                item.unit_price !== undefined ? item.unit_price : 0,
                item.total_amount !== undefined ? item.total_amount : 0,
                item.is_business_item !== undefined ? item.is_business_item : 0,
                item.item_technician_id || null,
                item.manual_cost !== undefined ? item.manual_cost : 0,
                item.batch_id || null,
                item.variation_id || null,
                item.serial_no_id || null
              ]);

              connection.query(insertItemsQuery, [itemsValues], (err) => {
                if (err) return reject(err);
                resolve();
              });
            });
          };

          const executeSavePhotos = () => {
            return new Promise((resolve, reject) => {
              if (!photos || photos.length === 0) return resolve();

              const savedPaths = photos.map(p => saveBase64Photo(p, jobId)).filter(Boolean);
              if (savedPaths.length === 0) return resolve();

              const insertPhotosQuery = `
                INSERT INTO service_job_photos (service_job_id, photo_path) VALUES ?
              `;
              const photoValues = savedPaths.map(p => [jobId, p]);

              connection.query(insertPhotosQuery, [photoValues], (err) => {
                if (err) {
                  savedPaths.forEach(deletePhotoFile);
                  return reject(err);
                }
                resolve();
              });
            });
          };

          const executeUpdateEstimate = () => {
            return new Promise((resolve) => {
              if (!req.body.estimate_id) return resolve();
              connection.query(
                "UPDATE estimates SET status = 'Completed', service_job_no = ? WHERE id = ? OR parent_estimate_id = ?",
                [job_no, req.body.estimate_id, req.body.estimate_id],
                (updateErr) => {
                  if (updateErr) {
                    console.error("Failed to update estimate from service job:", updateErr);
                  }
                  resolve();
                }
              );
            });
          };

          Promise.all([executeSaveItems(), executeSavePhotos(), executeUpdateEstimate()])
            .then(() => {
              connection.commit((commitErr) => {
                if (commitErr) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: "Commit failed" });
                  });
                }
                connection.release();

                // Trigger SMS Notifications
                try {
                  const customerDb = require("../services/customerDBService");
                  const smsService = require("../services/smsService");
                  
                  customerDb.fetchCustomerById(customer_id)
                    .then(async (customerList) => {
                      if (customerList && customerList.length > 0) {
                        const customer = customerList[0];
                        const recipientPhone = customer.phoneNumber || customer.Tp;
                        const customerName = `${customer.First_Name || ""} ${customer.lastName || ""}`.trim() || customer.displayName;
                        
                        const smsData = {
                          name: customerName,
                          job_no: job_no,
                          description: service_details || remarks || "",
                          date: date || new Date().toISOString().split("T")[0]
                        };
                        
                        await smsService.triggerSMSNotification(branch_id, "service_job_create", recipientPhone, smsData, user_id || req.body?.User_idUser || req.user?.id || req.user?.userId || null);
                      }
                    })
                    .catch(err => console.error("[SMS-Trigger] Service job SMS fetch customer failed:", err));
                } catch (smsErr) {
                  console.error("[SMS-Trigger] Service job SMS failed:", smsErr);
                }

                res.status(200).json({ message: "Service job created", job_no, id: jobId });
              });
            })
            .catch((txErr) => {
              connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: "Transaction items/photos failed: " + txErr.message });
              });
            });
        });

      } catch (error) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ error: error.message });
        });
      }
    });
  });
};

const getServiceJobs = (req, res) => {
  const branch_id = req.params.branch_id;
  const { job_no, customer_id, date, technician_id } = req.query;

  let query = `
    SELECT sj.*, c.displayName as Customer_Name, e.Employee_Name,
           inv.Invoice_Number as related_invoice_no,
           q.Quotation_Number as related_quotation_no
    FROM service_jobs sj
    LEFT JOIN customer c ON sj.customer_id = c.idCustomer
    LEFT JOIN employee e ON sj.technician_id = e.idEmployee
    LEFT JOIN invoice inv ON sj.invoice_id = inv.idInvoice
    LEFT JOIN quotation q ON sj.quotation_id = q.idQuotation
    WHERE sj.branch_id = ?
  `;
  const params = [branch_id];

  if (job_no) {
    query += " AND sj.job_no LIKE ?";
    params.push(`%${job_no}%`);
  }
  if (customer_id) {
    query += " AND sj.customer_id = ?";
    params.push(customer_id);
  }
  if (date) {
    query += " AND sj.date = ?";
    params.push(date);
  }
  if (technician_id) {
    query += " AND (sj.technician_id = ? OR (sj.technician_ids IS NOT NULL AND JSON_CONTAINS(sj.technician_ids, ?)))";
    params.push(technician_id, JSON.stringify(Number(technician_id)));
  }

  query += " ORDER BY sj.id DESC";

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json(results);
  });
};

const getServiceJobById = (req, res) => {
  const id = req.params.id;
  const queryJob = `
    SELECT sj.*, c.displayName as Customer_Name, c.billingAddress1 as Customer_Address,
           e.Employee_Name,
           inv.Invoice_Number as related_invoice_no,
           q.Quotation_Number as related_quotation_no
    FROM service_jobs sj
    LEFT JOIN customer c ON sj.customer_id = c.idCustomer
    LEFT JOIN employee e ON sj.technician_id = e.idEmployee
    LEFT JOIN invoice inv ON sj.invoice_id = inv.idInvoice
    LEFT JOIN quotation q ON sj.quotation_id = q.idQuotation
    WHERE sj.id = ?
  `;
  
  db.query(queryJob, [id], (err, jobResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (jobResults.length === 0) return res.status(404).json({ error: "Job not found" });

    const job = jobResults[0];
    // Parse custom_fields_data JSON
    try {
      job.custom_fields_data = job.custom_fields_data
        ? JSON.parse(job.custom_fields_data)
        : {};
    } catch(_) { job.custom_fields_data = {}; }

    // Parse technician_ids JSON
    try {
      job.technician_ids = job.technician_ids
        ? JSON.parse(job.technician_ids)
        : [];
    } catch(_) { job.technician_ids = []; }

    const techIds = job.technician_ids || [];
    const fetchTechNames = (callback) => {
      if (techIds.length === 0) {
        job.technician_names = job.Employee_Name ? [job.Employee_Name] : [];
        return callback();
      }
      db.query("SELECT Employee_Name FROM employee WHERE idEmployee IN (?)", [techIds], (err, techRows) => {
        if (!err && techRows && techRows.length > 0) {
          job.technician_names = techRows.map(r => r.Employee_Name);
        } else {
          job.technician_names = job.Employee_Name ? [job.Employee_Name] : [];
        }
        callback();
      });
    };

    fetchTechNames(() => {
      db.query(`
        SELECT sji.*, e.Employee_Name as technician_name, sn.Serial_No as Serial_Number
        FROM service_job_items sji
        LEFT JOIN employee e ON sji.item_technician_id = e.idEmployee
        LEFT JOIN item_has_serial_no sn ON sji.serial_no_id = sn.ID
        WHERE sji.service_job_id = ?
      `, [id], (err, itemsResult) => {
        if (err) return res.status(500).json({ error: err.message });
        job.items = itemsResult;
        
        db.query("SELECT * FROM service_job_photos WHERE service_job_id = ?", [id], (err, photosResult) => {
          if (err) return res.status(500).json({ error: err.message });
          job.photos = photosResult;
          res.status(200).json(job);
        });
      });
    });
  });
};

const updateServiceJob = (req, res) => {
  const id = req.params.id;
  const {
    date,
    customer_id,
    contact_person,
    service_details,
    contact_no,
    mobile_no,
    req_no,
    manual_ref,
    order_no,
    other_ref,
    technician_id,
    technician_ids, // multiple technicians
    remarks,
    branch_id,
    user_id,
    items,
    photos, // array of items, some might be existing paths, some new base64s
    removed_photo_ids, // list of photo IDs to delete
    custom_fields_data // object of enabled custom field values
  } = req.body;

  const cfDataJson = custom_fields_data
    ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
    : null;

  const technicianIdsJson = technician_ids && Array.isArray(technician_ids)
    ? JSON.stringify(technician_ids)
    : null;

  db.getConnection(async (err, connection) => {
    if (err) return res.status(500).json({ error: "DB Connection failed" });

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const updateJobQuery = `
          UPDATE service_jobs SET 
            date = ?, customer_id = ?, contact_person = ?, service_details = ?,
            contact_no = ?, mobile_no = ?, req_no = ?, manual_ref = ?, 
            order_no = ?, other_ref = ?, technician_id = ?, remarks = ?,
            custom_fields_data = ?, technician_ids = ?
          WHERE id = ?
        `;
        
        const jobValues = [
          (date && date !== "" && date !== "null") ? date.split('T')[0] : null, 
          customer_id || null, 
          contact_person || null, 
          service_details || null,
          contact_no || null, 
          mobile_no || null, 
          req_no || null, 
          manual_ref || null, 
          order_no || null, 
          other_ref || null,
          technician_id || null, 
          remarks || null,
          cfDataJson,
          technicianIdsJson,
          id
        ];

        connection.query(updateJobQuery, jobValues, async (err) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to update service job: " + err.message });
            });
          }

          // Fetch jobNo
          const sjRow = await new Promise((resolve) => {
            connection.query("SELECT job_no FROM service_jobs WHERE id = ?", [id], (e, rows) => resolve(rows?.[0]));
          });
          const jobNo = sjRow?.job_no || "SJ";

          // Fetch and reverse old items stock
          try {
            const oldItems = await new Promise((resolve, reject) => {
              connection.query("SELECT * FROM service_job_items WHERE service_job_id = ?", [id], (e, rows) => {
                if (e) reject(e); else resolve(rows || []);
              });
            });
            const companyId = await branchDBService.getCompanyIdByBranch(branch_id);
            for (const oldItem of oldItems) {
              if (oldItem.is_business_item === 1 && oldItem.item_id) {
                await reverseStockForServiceJobItem(oldItem, id, jobNo, branch_id, companyId, user_id, connection);
              }
            }
          } catch (revertErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to revert stock for old items: " + revertErr.message });
            });
          }

          // Deduct stock for new items
          try {
            const companyId = await branchDBService.getCompanyIdByBranch(branch_id);
            if (items && items.length > 0) {
              for (const item of items) {
                if (item.is_business_item === 1 && item.item_id) {
                  const bId = await deductStockForServiceJobItem(item, id, jobNo, branch_id, companyId, user_id, connection);
                  item.batch_id = bId;
                }
              }
            }
          } catch (stockErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Stock deduction failed: " + stockErr.message });
            });
          }

          // Delete existing items
          connection.query("DELETE FROM service_job_items WHERE service_job_id = ?", [id], (err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: "Failed to delete old items: " + err.message });
              });
            }

            const executeSaveItems = () => {
              return new Promise((resolve, reject) => {
                if (!items || items.length === 0) return resolve();

                const insertItemsQuery = `
                  INSERT INTO service_job_items (
                    service_job_id, item_id, item_name, brand, model, serial_1,
                    warranty_no, doc_date, warr_status, defect_type, remarks,
                    qty, unit_price, total_amount, is_business_item, item_technician_id,
                    manual_cost, batch_id, variation_id, serial_no_id
                  ) VALUES ?
                `;

                const itemsValues = items.map(item => [
                  id, 
                  item.item_id || null, 
                  item.item_name || null, 
                  item.brand || null, 
                  item.model || null, 
                  item.serial_1 || null,
                  item.warranty_no || null, 
                  (item.doc_date && item.doc_date !== "" && item.doc_date !== "null") ? item.doc_date.split('T')[0] : null, 
                  item.warr_status || null, 
                  item.defect_type || null, 
                  item.remarks || null,
                  item.qty !== undefined ? item.qty : 1,
                  item.unit_price !== undefined ? item.unit_price : 0,
                  item.total_amount !== undefined ? item.total_amount : 0,
                  item.is_business_item !== undefined ? item.is_business_item : 0,
                  item.item_technician_id || null,
                  item.manual_cost !== undefined ? item.manual_cost : 0,
                  item.batch_id || null,
                  item.variation_id || null,
                  item.serial_no_id || null
                ]);

                connection.query(insertItemsQuery, [itemsValues], (err) => {
                  if (err) return reject(err);
                  resolve();
                });
              });
            };

            const executePhotoUpdates = () => {
              return new Promise((resolve, reject) => {
                const deleteRemovedPhotos = () => {
                  return new Promise((resolveDel, rejectDel) => {
                    if (!removed_photo_ids || removed_photo_ids.length === 0) return resolveDel();

                    connection.query("SELECT photo_path FROM service_job_photos WHERE id IN (?)", [removed_photo_ids], (err, rows) => {
                      if (err) return rejectDel(err);
                      
                      rows.forEach(row => deletePhotoFile(row.photo_path));

                      connection.query("DELETE FROM service_job_photos WHERE id IN (?)", [removed_photo_ids], (err) => {
                        if (err) return rejectDel(err);
                        resolveDel();
                      });
                    });
                  });
                };

                const insertNewPhotos = () => {
                  return new Promise((resolveIns, rejectIns) => {
                    if (!photos || photos.length === 0) return resolveIns();

                    const base64s = photos.filter(p => typeof p === 'string' && p.startsWith("data:"));
                    if (base64s.length === 0) return resolveIns();

                    const savedPaths = base64s.map(p => saveBase64Photo(p, id)).filter(Boolean);
                    if (savedPaths.length === 0) return resolveIns();

                    const insertPhotosQuery = `
                      INSERT INTO service_job_photos (service_job_id, photo_path) VALUES ?
                    `;
                    const photoValues = savedPaths.map(p => [id, p]);

                    connection.query(insertPhotosQuery, [photoValues], (err) => {
                      if (err) {
                        savedPaths.forEach(deletePhotoFile);
                        return rejectIns(err);
                      }
                      resolveIns();
                    });
                  });
                };

                deleteRemovedPhotos()
                  .then(insertNewPhotos)
                  .then(resolve)
                  .catch(reject);
              });
            };

            Promise.all([executeSaveItems(), executePhotoUpdates()])
              .then(() => {
                connection.commit((commitErr) => {
                  if (commitErr) {
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({ error: "Commit failed: " + commitErr.message });
                    });
                  }
                  connection.release();
                  res.status(200).json({ message: "Service job updated successfully" });
                });
              })
              .catch((txErr) => {
                connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ error: "Failed saving items/photos in update: " + txErr.message });
                });
              });
          });
        });

      } catch (error) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ error: error.message });
        });
      }
    });
  });
};

const updateServiceJobStatus = (req, res) => {
  const id = req.params.id;
  const { status, completion_reason } = req.body;
  if (status === "Completed") {
    db.query("UPDATE service_jobs SET status = ?, completion_reason = ? WHERE id = ?", [status, completion_reason || null, id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ message: `Service job status updated to ${status}` });
    });
  } else {
    db.query("UPDATE service_jobs SET status = ?, completion_reason = NULL WHERE id = ?", [status, id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ message: `Service job status updated to ${status}` });
    });
  }
};

const deleteServiceJob = (req, res) => {
  const id = req.params.id;

  db.getConnection((err, connection) => {
    if (err) return res.status(500).json({ error: "DB Connection failed" });

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        // Fetch job info
        const sjRow = await new Promise((resolve) => {
          connection.query("SELECT job_no, branch_id, user_id FROM service_jobs WHERE id = ?", [id], (e, rows) => resolve(rows?.[0]));
        });

        if (sjRow) {
          const { job_no, branch_id, user_id } = sjRow;
          const companyId = await branchDBService.getCompanyIdByBranch(branch_id);

          // Fetch items to reverse stock
          const oldItems = await new Promise((resolve, reject) => {
            connection.query("SELECT * FROM service_job_items WHERE service_job_id = ?", [id], (e, rows) => {
              if (e) reject(e); else resolve(rows || []);
            });
          });

          for (const oldItem of oldItems) {
            if (oldItem.is_business_item === 1 && oldItem.item_id) {
              await reverseStockForServiceJobItem(oldItem, id, job_no, branch_id, companyId, user_id, connection);
            }
          }
        }

        // Fetch photo paths
        const photos = await new Promise((resolve, reject) => {
          connection.query("SELECT photo_path FROM service_job_photos WHERE service_job_id = ?", [id], (e, rows) => {
            if (e) reject(e); else resolve(rows || []);
          });
        });

        // Delete photos files
        photos.forEach(p => deletePhotoFile(p.photo_path));

        // Delete photo records
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM service_job_photos WHERE service_job_id = ?", [id], (e) => e ? reject(e) : resolve());
        });

        // Delete items
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM service_job_items WHERE service_job_id = ?", [id], (e) => e ? reject(e) : resolve());
        });

        // Delete job
        await new Promise((resolve, reject) => {
          connection.query("DELETE FROM service_jobs WHERE id = ?", [id], (e) => e ? reject(e) : resolve());
        });

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Commit failed" });
            });
          }
          connection.release();
          res.status(200).json({ message: "Service job deleted successfully" });
        });

      } catch (txErr) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ error: "Failed to delete service job: " + txErr.message });
        });
      }
    });
  });
};

// ─── CONVERT ESTIMATE TO SERVICE JOB ─────────────────────────────────────────
const convertEstimateToServiceJob = async (req, res) => {
  const estimate_id = req.params.estimate_id;
  const { branch_id, user_id } = req.body;

  if (!branch_id) return res.status(400).json({ error: "branch_id is required" });

  try {
    // 1. Fetch estimate
    const [estRows] = await db.promise().query(
      `SELECT est.*, c.displayName as Customer_Name, c.phoneNumber as Customer_Phone, c.billingAddress1 as Customer_Address
       FROM estimates est
       LEFT JOIN customer c ON est.customer_id = c.idCustomer
       WHERE est.id = ?`,
      [estimate_id]
    );
    if (!estRows || estRows.length === 0) return res.status(404).json({ error: "Estimate not found" });
    const estimate = estRows[0];

    // Parse estimate custom_fields_data
    let estCfData = {};
    try { estCfData = JSON.parse(estimate.custom_fields_data || '{}'); } catch(_) {}

    // 2. Fetch estimate settings to get field definitions (for label resolution)
    const [estSettingsRows] = await db.promise().query(
      "SELECT custom_fields_config FROM estimate_settings WHERE branch_id = ?",
      [estimate.branch_id]
    );
    let estFields = DEFAULT_CUSTOM_FIELDS;
    if (estSettingsRows && estSettingsRows.length > 0) {
      estFields = mergeCustomFields(estSettingsRows[0].custom_fields_config);
    }

    // 3. Fetch service job settings to get enabled field definitions and photo settings
    const [sjSettingsRows] = await db.promise().query(
      "SELECT custom_fields_config, enable_photos FROM service_job_settings WHERE branch_id = ?",
      [branch_id]
    );
    let sjFields = DEFAULT_CUSTOM_FIELDS;
    if (sjSettingsRows && sjSettingsRows.length > 0) {
      sjFields = mergeCustomFields(sjSettingsRows[0].custom_fields_config);
    }

    // 4. Build a lookup: normalized label → value from estimate
    // Normalize: trim + lowercase
    const normalize = (str) => (str || "").trim().toLowerCase();

    // Build estimate label→value map (use custom_label if set, else label)
    const estLabelMap = {};
    estFields.forEach(f => {
      const resolvedLabel = normalize(f.custom_label?.trim() || f.label);
      const val = estCfData[f.key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        estLabelMap[resolvedLabel] = val;
        // Also index by canonical key for same-key fallback
        estLabelMap[`__key__${f.key}`] = val;
      }
    });

    // 5. Map enabled SJ fields by label (or key) to estimate values
    const sjCfData = {};
    sjFields.filter(f => f.enabled).forEach(f => {
      const sjLabel = normalize(f.custom_label?.trim() || f.label);
      // Try by key first (most reliable when same catalog)
      if (estLabelMap[`__key__${f.key}`] !== undefined) {
        sjCfData[f.key] = estLabelMap[`__key__${f.key}`];
      } else if (estLabelMap[sjLabel] !== undefined) {
        sjCfData[f.key] = estLabelMap[sjLabel];
      }
    });

    // 6. Fetch estimate items (including supplementary ones)
    const [estItems] = await db.promise().query(
      `SELECT * FROM estimate_items 
       WHERE estimate_id = ? OR estimate_id IN (SELECT id FROM estimates WHERE parent_estimate_id = ?)`,
      [estimate_id, estimate_id]
    );

    // 7. Get next job no
    const job_no = await getNextJobNo(branch_id);

    // 8. Insert service job
    const cfDataJson = Object.keys(sjCfData).length > 0 ? JSON.stringify(sjCfData) : null;

    const [jobInsert] = await db.promise().query(
      `INSERT INTO service_jobs (
        job_no, date, customer_id, contact_person, service_details,
        contact_no, mobile_no, req_no, manual_ref, order_no, other_ref,
        technician_id, remarks, branch_id, user_id, custom_fields_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job_no,
        estimate.date,
        estimate.customer_id || null,
        estimate.Customer_Name || null,
        null, // service_details
        estimate.Customer_Phone || null, // contact_no
        estimate.Customer_Phone || null, // mobile_no
        null, null, null, null,          // req_no, manual_ref, order_no, other_ref
        null,                            // technician_id
        estimate.remarks || null,
        branch_id,
        user_id || null,
        cfDataJson
      ]
    );

    const jobId = jobInsert.insertId;

    // 9. Copy estimate items as business items
    if (estItems && estItems.length > 0) {
      const itemsValues = estItems
        .filter(itm => itm.item_name && String(itm.item_name).trim() !== '')
        .map(itm => [
          jobId,
          null,                   // item_id
          itm.item_name,
          null,                   // brand
          null,                   // model
          null,                   // serial_1
          null,                   // warranty_no
          null,                   // doc_date
          null,                   // warr_status
          null,                   // defect_type
          itm.remarks || null,
          itm.qty || 1,
          itm.unit_price || 0,
          itm.total_amount || 0,
          1,                      // is_business_item
          null                    // item_technician_id
        ]);

      if (itemsValues.length > 0) {
        await db.promise().query(
          `INSERT INTO service_job_items (
            service_job_id, item_id, item_name, brand, model, serial_1,
            warranty_no, doc_date, warr_status, defect_type, remarks,
            qty, unit_price, total_amount, is_business_item, item_technician_id
          ) VALUES ?`,
          [itemsValues]
        );
      }
    }

    // 10. Copy estimate photos if enabled on service job settings
    const enablePhotosVal = sjSettingsRows && sjSettingsRows.length > 0 ? sjSettingsRows[0].enable_photos : 0;
    if (enablePhotosVal) {
      const [estPhotos] = await db.promise().query(
        `SELECT * FROM estimate_photos 
         WHERE estimate_id = ? OR estimate_id IN (SELECT id FROM estimates WHERE parent_estimate_id = ?)`,
        [estimate_id, estimate_id]
      );
      if (estPhotos && estPhotos.length > 0) {
        const photoPaths = [];
        for (const photo of estPhotos) {
          const originalPath = photo.photo_path;
          const fullOriginalPath = path.join(__dirname, `../${originalPath}`);
          if (fs.existsSync(fullOriginalPath)) {
            const extension = path.extname(originalPath) || ".jpg";
            const fileName = `sj_${jobId}_${Date.now()}_${Math.floor(Math.random() * 1000)}${extension}`;
            const uploadDir = path.join(__dirname, "../uploads/service_jobs");
            if (!fs.existsSync(uploadDir)) {
              fs.mkdirSync(uploadDir, { recursive: true });
            }
            const newRelativePath = `uploads/service_jobs/${fileName}`;
            fs.copyFileSync(fullOriginalPath, path.join(uploadDir, fileName));
            photoPaths.push([jobId, newRelativePath]);
          }
        }
        if (photoPaths.length > 0) {
          await db.promise().query(
            "INSERT INTO service_job_photos (service_job_id, photo_path) VALUES ?",
            [photoPaths]
          );
        }
      }
    }

    res.status(200).json({
      message: "Estimate converted to service job successfully",
      job_no,
      id: jobId
    });

  } catch (error) {
    console.error("convertEstimateToServiceJob error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

const getSettings = (req, res) => {
  const branch_id = req.params.branch_id;
  db.query("SELECT * FROM service_job_settings WHERE branch_id = ?", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // If not exists, return default
    if (results.length === 0) {
      return res.status(200).json({
        header_type: 'text',
        business_name: 'ADANS PLC',
        address: 'NO: 396/2/1 ,KANDY ROAD, DALUGAMA',
        email: 'lahirud@abansgroup.com',
        phone: '0115555888',
        terms_conditions: '1. A charge will be levied on all items removed without repairs depending on the item & time taken for handing same.\n2. Accessory Return Policy: Customers must return all accessories to the designated service center, BuyAbans, or the original point of purchase in order to qualify for a replacement or refund, subject to approval by the service center. Failure to comply with this.\n3. All items should be confirmed to be in good working order prior to collection after repair.\n4. Please note that with respect to computers given to Abans IT Service Department & mobile phones given to Abans Mobile Service Department for repairs we, Abans IT service Department & Abans mobile service department shall not be responsible for the customer\'s data. It will be sold responsibility of the\n5. The customer agrees to collect the repaired items within 14 days from the date of notice of collection. And further acknowledges and duly notices that the repaired items not collected within 14 days from the date of notice of collection shall be disposed by the company without any further notice.\n6. The repaired items not collected within 14 days from the date of notice of collection, shall be disposed by the company without further notice and without impose any liability towards such disposal. The company shall not compensate for such disposal items which are not collected after due notice being given.',
        header_image: null,
        spare_part_approval_flow: 'value_based',
        spare_part_high_value_threshold: 5000.0000,
        spare_part_high_value_keywords: 'panel,display,screen,motherboard',
        custom_fields_config: JSON.stringify(DEFAULT_CUSTOM_FIELDS),
        enable_photos: 0,
        max_photos: 5,
        show_reference_section: 1
      });
    }
    
    const settings = results[0];
    // Safeguard null or missing pipeline settings
    if (!settings.spare_part_approval_flow) {
      settings.spare_part_approval_flow = 'value_based';
      settings.spare_part_high_value_threshold = 5000.0000;
      settings.spare_part_high_value_keywords = 'panel,display,screen,motherboard';
    }

    if (settings.enable_photos === undefined || settings.enable_photos === null) {
      settings.enable_photos = 0;
    }
    if (settings.max_photos === undefined || settings.max_photos === null) {
      settings.max_photos = 5;
    }
    if (settings.show_reference_section === undefined || settings.show_reference_section === null) {
      settings.show_reference_section = 1;
    }

    // Merge saved custom_fields_config with default catalog
    const mergedFields = mergeCustomFields(settings.custom_fields_config);
    settings.custom_fields_config = JSON.stringify(mergedFields);

    // Provide base64 representation of header_image to prevent client-side CORS issues during print/export
    if (settings.header_image) {
      try {
        let relPath = settings.header_image;
        if (relPath.includes("uploads/")) {
          relPath = relPath.substring(relPath.indexOf("uploads/"));
        } else if (relPath.startsWith("/")) {
          relPath = relPath.substring(1);
        }
        const fullPath = path.isAbsolute(relPath) ? relPath : path.join(__dirname, "../", relPath);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(fullPath).slice(1).toLowerCase() || "png";
          let mime = `image/${ext === "jpg" ? "jpeg" : ext}`;
          if (ext === "svg") mime = "image/svg+xml";
          const imgBuffer = fs.readFileSync(fullPath);
          settings.header_image_base64 = `data:${mime};base64,${imgBuffer.toString("base64")}`;
        }
      } catch (imgErr) {
        console.error("Failed to convert header_image to base64 in getSettings:", imgErr);
      }
    }
    
    res.status(200).json(settings);
  });
};

const saveBase64Receipt = (base64String) => {
    if (!base64String) return null;
    try {
      if (!base64String.startsWith("data:") && (base64String.startsWith("uploads/") || base64String.startsWith("http"))) {
        return base64String;
      }
      const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) return null;
      const type = matches[1];
      const data = matches[2];
      const buffer = Buffer.from(data, "base64");
      
      const fs = require('fs');
      const path = require('path');
      
      let extension = type.split("/")[1];
      if (extension === "jpeg") extension = "jpg";
      if (extension === "svg+xml") extension = "svg";
  
      const fileName = `sj_header_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
      const uploadDir = path.join(__dirname, "../uploads/receipts");
  
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
  
      fs.writeFileSync(path.join(uploadDir, fileName), buffer);
      return `uploads/receipts/${fileName}`;
    } catch (error) {
      console.error("Error saving header image:", error);
      return null;
    }
  };

const updateSettings = (req, res) => {
  const branch_id = req.params.branch_id;
  const { 
    header_type, 
    business_name, 
    address, 
    email, 
    phone, 
    header_image, 
    terms_conditions, 
    prefix, 
    next_number,
    spare_part_approval_flow,
    spare_part_high_value_threshold,
    spare_part_high_value_keywords,
    custom_fields_config,
    enable_photos,
    max_photos,
    show_reference_section
  } = req.body;

  const isImageCleared = (header_image === "" || header_image === null || header_image === undefined);
  const savedImage = saveBase64Receipt(header_image);

  const cfJson = custom_fields_config
    ? (typeof custom_fields_config === 'string' ? custom_fields_config : JSON.stringify(custom_fields_config))
    : JSON.stringify(DEFAULT_CUSTOM_FIELDS);

  db.query("SELECT id FROM service_job_settings WHERE branch_id = ?", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length === 0) {
      const query = `
        INSERT INTO service_job_settings 
        (branch_id, header_type, business_name, address, email, phone, header_image, terms_conditions, spare_part_approval_flow, spare_part_high_value_threshold, spare_part_high_value_keywords, custom_fields_config, enable_photos, max_photos, show_reference_section) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.query(query, [
        branch_id, 
        header_type, 
        business_name, 
        address, 
        email, 
        phone, 
        isImageCleared ? null : savedImage, 
        terms_conditions,
        spare_part_approval_flow || 'value_based',
        spare_part_high_value_threshold !== undefined ? spare_part_high_value_threshold : 5000.0000,
        spare_part_high_value_keywords || 'panel,display,screen,motherboard',
        cfJson,
        enable_photos !== undefined ? enable_photos : 0,
        max_photos !== undefined ? max_photos : 5,
        show_reference_section !== undefined ? show_reference_section : 1
      ], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        updatePrefixSettings(branch_id, prefix, next_number, res);
      });
    } else {
      let query = `
        UPDATE service_job_settings SET 
        header_type = ?, business_name = ?, address = ?, email = ?, phone = ?, terms_conditions = ?,
        spare_part_approval_flow = ?, spare_part_high_value_threshold = ?, spare_part_high_value_keywords = ?,
        custom_fields_config = ?, enable_photos = ?, max_photos = ?, show_reference_section = ?
      `;
      const values = [
        header_type, 
        business_name, 
        address, 
        email, 
        phone, 
        terms_conditions,
        spare_part_approval_flow || 'value_based',
        spare_part_high_value_threshold !== undefined ? spare_part_high_value_threshold : 5000.0000,
        spare_part_high_value_keywords || 'panel,display,screen,motherboard',
        cfJson,
        enable_photos !== undefined ? enable_photos : 0,
        max_photos !== undefined ? max_photos : 5,
        show_reference_section !== undefined ? show_reference_section : 1
      ];
      
      if (isImageCleared) {
          query += `, header_image = NULL`;
      } else if (savedImage !== null) {
          query += `, header_image = ?`;
          values.push(savedImage);
      }
      query += ` WHERE branch_id = ?`;
      values.push(branch_id);

      db.query(query, values, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        
        updatePrefixSettings(branch_id, prefix, next_number, res);
      });
    }
  });
};

const updatePrefixSettings = (branch_id, prefix, next_number, res) => {
    if(prefix || next_number) {
        let updates = [];
        let params = [];
        if(prefix) { updates.push('Service_Job_No_Start_With = ?'); params.push(prefix); }
        if(next_number) { updates.push('Service_Job_No_Start_From = ?'); params.push(next_number); }
        params.push(branch_id);

        db.query(`UPDATE rules SET ${updates.join(', ')} WHERE Branch_idBranch = ?`, params, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(200).json({ message: "Settings updated successfully" });
        });
    } else {
        res.status(200).json({ message: "Settings updated successfully" });
    }
}

const getPrefixSettings = (req, res) => {
    const branch_id = req.params.branch_id;
    db.query("SELECT Service_Job_No_Start_With, Service_Job_No_Start_From FROM rules WHERE Branch_idBranch = ?", [branch_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json(results[0] || { Service_Job_No_Start_With: 'ES002/OUN', Service_Job_No_Start_From: 1000 });
    });
}

const getServiceJobReport = (req, res) => {
  const branch_id = req.query.branch_id || req.user?.Branch_idBranch;
  const { from, to, technician_id, status } = req.query;

  if (!branch_id) {
    return res.status(400).json({ error: "Branch ID is required" });
  }

  let query = `
    SELECT sj.*, c.displayName as Customer_Name, e.Employee_Name as Technician_Name
    FROM service_jobs sj
    LEFT JOIN customer c ON sj.customer_id = c.idCustomer
    LEFT JOIN employee e ON sj.technician_id = e.idEmployee
    WHERE sj.branch_id = ?
  `;
  const params = [branch_id];

  if (from) {
    query += " AND sj.date >= ?";
    params.push(from);
  }
  if (to) {
    query += " AND sj.date <= ?";
    params.push(to);
  }
  if (status) {
    query += " AND sj.status = ?";
    params.push(status);
  }
  if (technician_id) {
    query += " AND (sj.technician_id = ? OR (sj.technician_ids IS NOT NULL AND JSON_CONTAINS(sj.technician_ids, ?)))";
    params.push(technician_id, JSON.stringify(Number(technician_id)));
  }

  query += " ORDER BY sj.date DESC, sj.id DESC";

  db.query(query, params, (err, jobs) => {
    if (err) return res.status(500).json({ error: err.message });

    if (jobs.length === 0) {
      return res.status(200).json({ jobs: [], technicianSummary: [] });
    }

    const jobIds = jobs.map(j => j.id);
    const itemQuery = `
      SELECT sji.*, e.Employee_Name as item_technician_name
      FROM service_job_items sji
      LEFT JOIN employee e ON sji.item_technician_id = e.idEmployee
      WHERE sji.service_job_id IN (?)
    `;

    db.query(itemQuery, [jobIds], (itemErr, items) => {
      if (itemErr) return res.status(500).json({ error: itemErr.message });

      const itemsByJob = {};
      items.forEach(item => {
        if (!itemsByJob[item.service_job_id]) {
          itemsByJob[item.service_job_id] = [];
        }
        itemsByJob[item.service_job_id].push(item);
      });

      const employeeQuery = "SELECT idEmployee, Employee_Name FROM employee WHERE Branch_idBranch = ?";
      db.query(employeeQuery, [branch_id], (empErr, employees) => {
        const empMap = {};
        if (!empErr && employees) {
          employees.forEach(emp => {
            empMap[emp.idEmployee] = emp.Employee_Name;
          });
        }

        const processedJobs = jobs.map(job => {
          const jobItems = itemsByJob[job.id] || [];

          const applianceList = jobItems.filter(item => !item.is_business_item || parseInt(item.is_business_item) === 0);
          const applianceDetails = applianceList.map(item => {
            let detail = item.item_name || "Unknown Appliance";
            const parts = [];
            if (item.brand) parts.push(`Brand: ${item.brand}`);
            if (item.model) parts.push(`Model: ${item.model}`);
            if (item.serial_1) parts.push(`S/N: ${item.serial_1}`);
            if (item.defect_type) parts.push(`Defect: ${item.defect_type}`);
            if (parts.length > 0) {
              detail += ` (${parts.join(', ')})`;
            }
            return detail;
          }).join('; ');

          const serviceCharge = jobItems
            .filter(item => parseInt(item.is_business_item) === 1 && !item.item_id)
            .reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);

          const sparePartsCost = jobItems
            .filter(item => parseInt(item.is_business_item) === 1 && item.item_id)
            .reduce((sum, item) => sum + parseFloat(item.total_amount || 0), 0);

          const totalValue = serviceCharge + sparePartsCost;

          // Extract business items (services and spare parts) details
          const businessList = jobItems.filter(item => parseInt(item.is_business_item) === 1);
          const businessDetails = businessList.map(item => {
            let detail = item.item_name || "Service / Part";
            const itemParts = [];
            if (item.brand) itemParts.push(item.brand);
            if (item.model) itemParts.push(item.model);
            if (itemParts.length > 0) {
              detail += ` (${itemParts.join(' ')})`;
            }
            if (item.qty > 1) {
              detail += ` x${item.qty}`;
            }
            return detail;
          }).join('; ');

          const serviceDetailsValue = businessDetails || job.service_details || "N/A";

          let techIds = [];
          try {
            techIds = job.technician_ids ? JSON.parse(job.technician_ids) : [];
          } catch (_) {
            techIds = [];
          }
          if (!Array.isArray(techIds)) techIds = [];

          let technicianNames = [];
          if (techIds.length > 0) {
            technicianNames = techIds.map(tid => empMap[tid] || job.Technician_Name).filter(Boolean);
          } else if (job.Technician_Name) {
            technicianNames = [job.Technician_Name];
          }
          technicianNames = [...new Set(technicianNames)];

          return {
            id: job.id,
            job_no: job.job_no,
            date: job.date,
            status: job.status,
            customer_name: job.Customer_Name || "N/A",
            service_details: serviceDetailsValue,
            technician_name: technicianNames.join(', ') || "Unassigned",
            technician_ids: techIds,
            technician_id: job.technician_id,
            appliances: applianceDetails || "N/A",
            service_charge: serviceCharge,
            spare_parts_cost: sparePartsCost,
            total_value: totalValue
          };
        });

        const techSummaryMap = {};

        if (technician_id && empMap[technician_id]) {
          techSummaryMap[technician_id] = {
            technician_name: empMap[technician_id],
            jobs_assigned: 0,
            jobs_completed: 0,
            jobs_pending: 0,
            service_revenue: 0,
            total_revenue: 0
          };
        }

        processedJobs.forEach(job => {
          const tids = job.technician_ids && job.technician_ids.length > 0
            ? job.technician_ids
            : (job.technician_id ? [job.technician_id] : []);

          tids.forEach(tid => {
            if (technician_id && Number(tid) !== Number(technician_id)) {
              return;
            }

            if (!techSummaryMap[tid]) {
              const name = empMap[tid] || "Unassigned";
              techSummaryMap[tid] = {
                technician_name: name,
                jobs_assigned: 0,
                jobs_completed: 0,
                jobs_pending: 0,
                service_revenue: 0,
                total_revenue: 0
              };
            }

            techSummaryMap[tid].jobs_assigned += 1;
            if (job.status === "Completed") {
              techSummaryMap[tid].jobs_completed += 1;
              techSummaryMap[tid].service_revenue += job.service_charge;
              techSummaryMap[tid].total_revenue += job.total_value;
            } else {
              techSummaryMap[tid].jobs_pending += 1;
            }
          });
        });

        const technicianSummary = Object.values(techSummaryMap);

        res.status(200).json({
          jobs: processedJobs,
          technicianSummary
        });
      });
    });
  });
};

module.exports = {
  createServiceJob,
  getServiceJobs,
  getServiceJobById,
  updateServiceJob,
  updateServiceJobStatus,
  deleteServiceJob,
  convertEstimateToServiceJob,
  getSettings,
  updateSettings,
  getPrefixSettings,
  getServiceJobReport
};
