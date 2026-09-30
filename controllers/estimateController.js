const db = require("../db/db");
const fs = require("fs");
const path = require("path");
const approvalService = require("../services/approvalService"); // 🆕 Added approvalService


// Helper: Save Base64 Photo
const saveBase64Photo = (base64String, estimateId) => {
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

    const fileName = `est_${estimateId || 'temp'}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const uploadDir = path.join(__dirname, "../uploads/estimates");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return `uploads/estimates/${fileName}`;
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

// Helper: Generate next Estimate No
const getNextEstimateNo = (branch_id) => {
  return new Promise((resolve, reject) => {
    db.query("SELECT prefix, next_number FROM estimate_settings WHERE branch_id = ?", [branch_id], (err, settingsResult) => {
      if (err) return reject(err);
      
      let prefix = "EST";
      let startFrom = 1000;
      if (settingsResult && settingsResult.length > 0) {
        prefix = settingsResult[0].prefix || prefix;
        startFrom = settingsResult[0].next_number || startFrom;
      }

      db.query("SELECT estimate_no FROM estimates WHERE branch_id = ? AND estimate_no LIKE ? ORDER BY id DESC LIMIT 1", [branch_id, `${prefix}%`], (err, estResult) => {
        if (err) return reject(err);

        let nextEstNo = `${prefix}-${startFrom}`;
        if (estResult && estResult.length > 0) {
          const lastEstNo = estResult[0].estimate_no;
          const match = lastEstNo.match(/-(\d+)$/);
          if (match && match[1]) {
            const nextNum = parseInt(match[1]) + 1;
            nextEstNo = `${prefix}-${nextNum}`;
          }
        }
        resolve(nextEstNo);
      });
    });
  });
};

// Helper: Resolve Root Parent Estimate ID recursively
const getRootParentEstimateId = (connection, id) => {
  return new Promise((resolve, reject) => {
    if (!id) return resolve(null);
    connection.query("SELECT id, parent_estimate_id FROM estimates WHERE id = ?", [id], (err, results) => {
      if (err) return reject(err);
      if (results.length === 0) return resolve(null);
      const row = results[0];
      if (row.parent_estimate_id) {
        getRootParentEstimateId(connection, row.parent_estimate_id)
          .then(resolve)
          .catch(reject);
      } else {
        resolve(row.id);
      }
    });
  });
};

// ─── SETTINGS ───────────────────────────────────────────────────────────────

// ─── DEFAULT CUSTOM FIELD CATALOG ────────────────────────────────────────────
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
  { key: "claim_number",     label: "Claim Number",        type: "text",   group: "Insurance / Claim",enabled: false, custom_label: "" },
  { key: "policy_number",    label: "Policy Number",       type: "text",   group: "Insurance / Claim",enabled: false, custom_label: "" },
  { key: "incident_date",    label: "Incident Date",       type: "date",   group: "Insurance / Claim",enabled: false, custom_label: "" },
  // Customer / Admin
  { key: "customer_nic",     label: "Customer NIC / ID No",type: "text",   group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "technician_name",  label: "Technician Assigned", type: "text",   group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "job_order_started_date", label: "Job Order Started Date", type: "date", group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "job_order_completed_date", label: "Job Order Completed Date", type: "date", group: "Customer / Admin", enabled: false, custom_label: "" },
];

const getSettings = (req, res) => {
  const branch_id = req.params.branch_id;
  db.query("SELECT * FROM estimate_settings WHERE branch_id = ?", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (results.length === 0) {
      return res.status(200).json({
        insurance_label: 'Insurance Company',
        max_photos: 5,
        show_company_logo: 1,
        show_terms: 1,
        terms_conditions: '1. This estimate is based on visual inspection only.\n2. Hidden or additional damages discovered during teardown will be subject to a supplemental estimate.\n3. Prices are valid for 30 days from estimate date.',
        prefix: 'EST',
        next_number: 1000,
        show_name: 1,
        show_address: 1,
        show_phone: 1,
        show_email: 1,
        show_website: 1,
        show_vat_no: 1,
        show_reg_no: 1,
        show_reference_section: 1,
        show_insurance_field: 1,
        show_status_field: 1,
        custom_fields_config: JSON.stringify(DEFAULT_CUSTOM_FIELDS),
        enable_photos: 1
      });
    }

    const row = results[0];
    if (row.enable_photos === undefined || row.enable_photos === null) {
      row.enable_photos = 1;
    }
    // Merge saved config with default catalog so newly added catalog fields appear
    let savedFields = [];
    try { savedFields = JSON.parse(row.custom_fields_config || '[]'); } catch(_) {}
    const mergedFields = DEFAULT_CUSTOM_FIELDS.map(def => {
      const saved = savedFields.find(f => f.key === def.key);
      return saved ? { ...def, ...saved } : def;
    });
    // Append any saved custom fields that aren't in the default catalog (future-proof)
    savedFields.forEach(sf => {
      if (!mergedFields.find(f => f.key === sf.key)) mergedFields.push(sf);
    });
    row.custom_fields_config = JSON.stringify(mergedFields);
    res.status(200).json(row);
  });
};

const updateSettings = (req, res) => {
  const branch_id = req.params.branch_id;
  const {
    insurance_label,
    max_photos,
    show_company_logo,
    show_terms,
    terms_conditions,
    prefix,
    next_number,
    show_name,
    show_address,
    show_phone,
    show_email,
    show_website,
    show_vat_no,
    show_reg_no,
    show_reference_section,
    show_insurance_field,
    show_status_field,
    custom_fields_config,
    enable_photos
  } = req.body;

  const cfJson = custom_fields_config
    ? (typeof custom_fields_config === 'string' ? custom_fields_config : JSON.stringify(custom_fields_config))
    : JSON.stringify(DEFAULT_CUSTOM_FIELDS);

  db.query("SELECT id FROM estimate_settings WHERE branch_id = ?", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length === 0) {
      const query = `
        INSERT INTO estimate_settings 
        (branch_id, insurance_label, max_photos, show_company_logo, show_terms, terms_conditions, prefix, next_number,
         show_name, show_address, show_phone, show_email, show_website, show_vat_no, show_reg_no, 
         show_reference_section, show_insurance_field, show_status_field, custom_fields_config, enable_photos) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.query(query, [
        branch_id, 
        insurance_label || 'Insurance Company', 
        max_photos !== undefined ? max_photos : 5, 
        show_company_logo !== undefined ? show_company_logo : 1, 
        show_terms !== undefined ? show_terms : 1, 
        terms_conditions || '',
        prefix || 'EST',
        next_number !== undefined ? next_number : 1000,
        show_name !== undefined ? show_name : 1,
        show_address !== undefined ? show_address : 1,
        show_phone !== undefined ? show_phone : 1,
        show_email !== undefined ? show_email : 1,
        show_website !== undefined ? show_website : 1,
        show_vat_no !== undefined ? show_vat_no : 1,
        show_reg_no !== undefined ? show_reg_no : 1,
        show_reference_section !== undefined ? show_reference_section : 1,
        show_insurance_field !== undefined ? show_insurance_field : 1,
        show_status_field !== undefined ? show_status_field : 1,
        cfJson,
        enable_photos !== undefined ? enable_photos : 1
      ], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json({ message: "Settings created successfully" });
      });
    } else {
      const query = `
        UPDATE estimate_settings SET 
        insurance_label = ?, max_photos = ?, show_company_logo = ?, show_terms = ?, terms_conditions = ?,
        prefix = ?, next_number = ?, show_name = ?, show_address = ?, show_phone = ?, show_email = ?,
        show_website = ?, show_vat_no = ?, show_reg_no = ?, show_reference_section = ?, 
        show_insurance_field = ?, show_status_field = ?, custom_fields_config = ?, enable_photos = ?
        WHERE branch_id = ?
      `;
      db.query(query, [
        insurance_label, 
        max_photos, 
        show_company_logo, 
        show_terms, 
        terms_conditions,
        prefix,
        next_number,
        show_name !== undefined ? show_name : 1,
        show_address !== undefined ? show_address : 1,
        show_phone !== undefined ? show_phone : 1,
        show_email !== undefined ? show_email : 1,
        show_website !== undefined ? show_website : 1,
        show_vat_no !== undefined ? show_vat_no : 1,
        show_reg_no !== undefined ? show_reg_no : 1,
        show_reference_section !== undefined ? show_reference_section : 1,
        show_insurance_field !== undefined ? show_insurance_field : 1,
        show_status_field !== undefined ? show_status_field : 1,
        cfJson,
        enable_photos !== undefined ? enable_photos : 1,
        branch_id
      ], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json({ message: "Settings updated successfully" });
      });
    }
  });
};

// ─── INSURANCE COMPANIES ─────────────────────────────────────────────────────

const getInsuranceCompanies = (req, res) => {
  const branch_id = req.params.branch_id;
  db.query("SELECT * FROM estimate_insurance_companies WHERE branch_id = ? ORDER BY name ASC", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json(results);
  });
};

const addInsuranceCompany = (req, res) => {
  const branch_id = req.params.branch_id;
  const { name } = req.body;
  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Name is required" });
  }

  db.query("INSERT INTO estimate_insurance_companies (branch_id, name) VALUES (?, ?)", [branch_id, name.trim()], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId, name: name.trim(), message: "Company added successfully" });
  });
};

const deleteInsuranceCompany = (req, res) => {
  const id = req.params.id;
  db.query("DELETE FROM estimate_insurance_companies WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json({ message: "Company deleted successfully" });
  });
};

// ─── ESTIMATES CRUD ─────────────────────────────────────────────────────────

const createEstimate = async (req, res) => {
  // APPROVAL ENGINE INTERCEPTOR
  const isBypass = req.headers['x-bypass-approval'] === 'true' || req.body._from_webhook;
  if (!isBypass) {
    try {
      const { branch_id, user_id } = req.body;
      const approvalService = require("../services/approvalService");
      const branchDBService = require("../services/branchDBService");
      const companyId = await branchDBService.getCompanyIdByBranch(branch_id) || 1;
      const approvalNeeded = await approvalService.isApprovalRequired(companyId, branch_id, 'CREATE_ESTIMATE');
      
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'CREATE_ESTIMATE',
          module_name: 'Estimate',
          erp_record_id: 'pending_' + Date.now(),
          company_id: companyId,
          branch_id: branch_id,
          initiated_by: user_id || 1,
          payload_summary: { pending_updates: req.body }
        });
        return res.status(202).json({
          message: "Estimate creation submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Create Estimate"
        });
      }
    } catch (e) {
      console.error("Error checking approval for Estimate Creation:", e);
    }
  }

  const {
    date,
    customer_id,
    insurance_company_id,
    remarks,
    branch_id,
    user_id,
    items, // Array of estimate items
    photos, // Array of base64 strings
    custom_fields_data, // Object of enabled custom field values
    parent_estimate_id
  } = req.body;

  db.getConnection((err, connection) => {
    if (err) return res.status(500).json({ error: "DB Connection failed" });

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const estimate_no = await getNextEstimateNo(branch_id);
        const resolvedParentId = await getRootParentEstimateId(connection, parent_estimate_id);

        // APPROVAL ENGINE: Check if approval is required for CREATE_ESTIMATE
        const companyId = req.user?.company_id || req.headers["company_id"] || 1;
        const createdBy = req.user?.idUser || req.user?.id || user_id || 1;

        let approvalRequired = false;
        try {
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            branch_id,
            "CREATE_ESTIMATE"
          );
        } catch (appErr) {
          console.error("Approval check failed for CREATE_ESTIMATE:", appErr);
        }

        if (approvalRequired) {
          const pendingUpdates = req.body;
          connection.release(); // Release DB connection early

          try {
            let customerName = pendingUpdates.customer_name || 'Unknown Customer';
            if (customer_id && customerName === 'Unknown Customer') {
              try {
                const custName = await new Promise((resolve) => {
                  db.query("SELECT Customer_Name, FirstName FROM customer WHERE idCustomer = ?", [customer_id], (err, res) => {
                    if (err || !res || res.length === 0) resolve('Unknown Customer');
                    else resolve(res[0].Customer_Name || res[0].FirstName || 'Unknown Customer');
                  });
                });
                customerName = custName;
              } catch (e) {}
            }

            await approvalService.triggerApprovalRequest({
              action_type: "CREATE_ESTIMATE",
              module_name: "Estimates / Quotations",
              erp_record_id: null,
              company_id: companyId,
              branch_id: branch_id,
              initiated_by: createdBy,
              payload_summary: {
                estimate_no,
                action: "CREATE_ESTIMATE",
                items: items,
                remarks: remarks,
                date: date,
                customer_id: customer_id,
                customer_name: customerName,
                insurance_company_id: insurance_company_id,
                pending_updates: pendingUpdates,
              },
            });
            console.log(`[ESTIMATE] Triggered approval request for creating estimate ${estimate_no}`);
          } catch (approvalErr) {
            console.error("[ESTIMATE] Error triggering approval webhook for CREATE_ESTIMATE:", approvalErr);
          }

          return res.status(200).json({
            success: true,
            message: "Estimate creation submitted for approval. It will be created once approved.",
            approval_required: true,
            approval_status: "PENDING_APPROVAL",
          });
        }

        const cfDataJson = custom_fields_data
          ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
          : null;

        const insertEstQuery = `
          INSERT INTO estimates (
            estimate_no, date, customer_id, insurance_company_id, remarks, branch_id, user_id, custom_fields_data, parent_estimate_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const estValues = [
          estimate_no, 
          date, 
          customer_id || null, 
          insurance_company_id || null, 
          remarks || null, 
          branch_id, 
          user_id,
          cfDataJson,
          resolvedParentId || null
        ];

        connection.query(insertEstQuery, estValues, (err, estResult) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to create estimate: " + err.message });
            });
          }

          const estId = estResult.insertId;

          // Save items if any
          const executeSaveItems = () => {
            return new Promise((resolve, reject) => {
              if (!items || items.length === 0) return resolve();
              
              const insertItemsQuery = `
                INSERT INTO estimate_items (
                  estimate_id, item_name, qty, unit_price, total_amount, remarks, category, sub_heading, item_type
                ) VALUES ?
              `;
              const itemsValues = items.map(itm => [
                estId,
                itm.item_name || '',
                itm.qty !== undefined ? itm.qty : 1,
                itm.unit_price !== undefined ? itm.unit_price : 0,
                itm.total_amount !== undefined ? itm.total_amount : 0,
                itm.remarks || '',
                itm.category || 'SERVICES',
                itm.sub_heading || '',
                itm.item_type || ''
              ]);

              connection.query(insertItemsQuery, [itemsValues], (err) => {
                if (err) return reject(err);
                resolve();
              });
            });
          };

          // Save photos if any
          const executeSavePhotos = () => {
            return new Promise((resolve, reject) => {
              if (!photos || photos.length === 0) return resolve();

              const savedPaths = photos.map(p => saveBase64Photo(p, estId)).filter(Boolean);
              if (savedPaths.length === 0) return resolve();

              const insertPhotosQuery = `
                INSERT INTO estimate_photos (estimate_id, photo_path) VALUES ?
              `;
              const photoValues = savedPaths.map(p => [estId, p]);

              connection.query(insertPhotosQuery, [photoValues], (err) => {
                if (err) {
                  // Rollback filesystem writes
                  savedPaths.forEach(deletePhotoFile);
                  return reject(err);
                }
                resolve();
              });
            });
          };

          Promise.all([executeSaveItems(), executeSavePhotos()])
            .then(() => {
              connection.commit((commitErr) => {
                if (commitErr) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: "Commit failed" });
                  });
                }
                connection.release();

                // Notify CRM if dealId is provided
                const dealIdParam = req.body.deal_id || req.body.dealId;
                if (dealIdParam) {
                  try {
                    const { notifyCrmDocumentCreated } = require("../services/crmWebhookService");
                    const origin = req.headers.origin || "http://localhost:3000";
                    const estTotal = Array.isArray(items)
                      ? items.reduce((sum, itm) => sum + (parseFloat(itm.amount) || (parseFloat(itm.rate || itm.price || 0) * parseFloat(itm.qty || itm.quantity || 1))), 0)
                      : 0;
                    notifyCrmDocumentCreated({
                      type: "ESTIMATE",
                      asipBookDocumentId: estId,
                      documentNumber: estimate_no,
                      amount: estTotal,
                      currency: "LKR",
                      status: "created",
                      dealId: dealIdParam,
                      branchId: branch_id,
                      documentDate: date || new Date().toISOString().split("T")[0],
                      viewUrl: `${origin}/estimates/print/${estId}`,
                    });
                  } catch (notifyErr) {
                    console.warn("[CRM Webhook] Error calling notifyCrmDocumentCreated for estimate:", notifyErr);
                  }
                }

                res.status(200).json({ message: "Estimate created successfully", estimate_no, id: estId });
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

const getEstimates = (req, res) => {
  const branch_id = req.params.branch_id;
  const { estimate_no, customer_id, date } = req.query;

  let query = `
    SELECT est.*, c.displayName as Customer_Name, c.phoneNumber as Customer_Phone,
           ic.name as Insurance_Company_Name, pest.estimate_no as parent_estimate_no
    FROM estimates est
    LEFT JOIN customer c ON est.customer_id = c.idCustomer
    LEFT JOIN estimate_insurance_companies ic ON est.insurance_company_id = ic.id
    LEFT JOIN estimates pest ON est.parent_estimate_id = pest.id
    WHERE est.branch_id = ? AND (est.approval_status IS NULL OR est.approval_status NOT IN ('PENDING_APPROVAL', 'REJECTED'))
  `;
  const params = [branch_id];

  if (estimate_no) {
    query += " AND est.estimate_no LIKE ?";
    params.push(`%${estimate_no}%`);
  }
  if (customer_id) {
    query += " AND est.customer_id = ?";
    params.push(customer_id);
  }
  if (date) {
    query += " AND est.date = ?";
    params.push(date);
  }

  query += " ORDER BY est.id DESC";

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json(results);
  });
};

const getEstimateById = (req, res) => {
  const id = req.params.id;
  const queryEst = `
    SELECT est.*, c.displayName as Customer_Name, c.billingAddress1 as Customer_Address,
           c.phoneNumber as Customer_Phone, ic.name as Insurance_Company_Name,
           pest.estimate_no as parent_estimate_no
    FROM estimates est
    LEFT JOIN customer c ON est.customer_id = c.idCustomer
    LEFT JOIN estimate_insurance_companies ic ON est.insurance_company_id = ic.id
    LEFT JOIN estimates pest ON est.parent_estimate_id = pest.id
    WHERE est.id = ?
  `;
  
  db.query(queryEst, [id], (err, estResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (estResults.length === 0) return res.status(404).json({ error: "Estimate not found" });

    const estimate = estResults[0];
    // Parse custom_fields_data JSON
    try {
      estimate.custom_fields_data = estimate.custom_fields_data
        ? JSON.parse(estimate.custom_fields_data)
        : {};
    } catch(_) { estimate.custom_fields_data = {}; }

    const rootId = estimate.parent_estimate_id || estimate.id;

    db.query("SELECT * FROM estimate_items WHERE estimate_id = ?", [id], (err, itemsResult) => {
      if (err) return res.status(500).json({ error: err.message });
      estimate.items = itemsResult;
      
      db.query(
        "SELECT * FROM estimate_items WHERE estimate_id = ? OR estimate_id IN (SELECT id FROM estimates WHERE parent_estimate_id = ?)",
        [rootId, rootId],
        (err, allLinkedResult) => {
          if (err) return res.status(500).json({ error: err.message });
          estimate.all_linked_items = allLinkedResult || [];

          db.query("SELECT * FROM estimate_photos WHERE estimate_id = ?", [id], (err, photosResult) => {
            if (err) return res.status(500).json({ error: err.message });
            estimate.photos = photosResult;
            res.status(200).json(estimate);
          });
        }
      );
    });
  });
};

const updateEstimate = async (req, res) => {
  // APPROVAL ENGINE INTERCEPTOR
  const isBypass = req.headers['x-bypass-approval'] === 'true' || req.body._from_webhook;
  if (!isBypass) {
    try {
      const { branch_id, user_id } = req.body;
      const { id } = req.params;
      const approvalService = require("../services/approvalService");
      const branchDBService = require("../services/branchDBService");
      const companyId = await branchDBService.getCompanyIdByBranch(branch_id) || 1;
      const approvalNeeded = await approvalService.isApprovalRequired(companyId, branch_id, 'EDIT_ESTIMATE');
      
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'EDIT_ESTIMATE',
          module_name: 'Estimate',
          erp_record_id: id,
          company_id: companyId,
          branch_id: branch_id,
          initiated_by: user_id || 1,
          payload_summary: { pending_updates: req.body }
        });
        return res.status(202).json({
          message: "Estimate update submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Edit Estimate"
        });
      }
    } catch (e) {
      console.error("Error checking approval for Estimate Update:", e);
    }
  }

  const id = req.params.id;
  const {
    date,
    customer_id,
    insurance_company_id,
    remarks,
    items,
    photos, // array of items, some might be existing paths, some new base64s
    removed_photo_ids, // list of photo IDs to delete
    custom_fields_data // Object of enabled custom field values
  } = req.body;

  db.getConnection((err, connection) => {
    if (err) return res.status(500).json({ error: "DB Connection failed" });

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const cfDataJson = custom_fields_data
          ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
          : null;

        const updateEstQuery = `
          UPDATE estimates SET 
            date = ?, customer_id = ?, insurance_company_id = ?, remarks = ?, custom_fields_data = ?
          WHERE id = ?
        `;
        
        const estValues = [
          (date && date !== "" && date !== "null") ? date.split('T')[0] : null, 
          customer_id || null, 
          insurance_company_id || null, 
          remarks || null,
          cfDataJson,
          id
        ];

        connection.query(updateEstQuery, estValues, (err) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to update estimate: " + err.message });
            });
          }

          // 1. Manage Items: delete and insert
          connection.query("DELETE FROM estimate_items WHERE estimate_id = ?", [id], (err) => {
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
                  INSERT INTO estimate_items (
                    estimate_id, item_name, qty, unit_price, total_amount, remarks, category, sub_heading, item_type
                  ) VALUES ?
                `;
                const itemsValues = items.map(itm => [
                  id,
                  itm.item_name || '',
                  itm.qty !== undefined ? itm.qty : 1,
                  itm.unit_price !== undefined ? itm.unit_price : 0,
                  itm.total_amount !== undefined ? itm.total_amount : 0,
                  itm.remarks || '',
                  itm.category || 'SERVICES',
                  itm.sub_heading || '',
                  itm.item_type || ''
                ]);

                connection.query(insertItemsQuery, [itemsValues], (err) => {
                  if (err) return reject(err);
                  resolve();
                });
              });
            };

            // 2. Manage Photos: delete removed ones, save new ones
            const executePhotoUpdates = () => {
              return new Promise((resolve, reject) => {
                // Fetch photo records to delete from filesystem and DB
                const deleteRemovedPhotos = () => {
                  return new Promise((resolveDel, rejectDel) => {
                    if (!removed_photo_ids || removed_photo_ids.length === 0) return resolveDel();

                    connection.query("SELECT photo_path FROM estimate_photos WHERE id IN (?)", [removed_photo_ids], (err, rows) => {
                      if (err) return rejectDel(err);
                      
                      // Delete from filesystem
                      rows.forEach(row => deletePhotoFile(row.photo_path));

                      connection.query("DELETE FROM estimate_photos WHERE id IN (?)", [removed_photo_ids], (err) => {
                        if (err) return rejectDel(err);
                        resolveDel();
                      });
                    });
                  });
                };

                const insertNewPhotos = () => {
                  return new Promise((resolveIns, rejectIns) => {
                    if (!photos || photos.length === 0) return resolveIns();

                    // Filter base64 strings only (new photos)
                    const base64s = photos.filter(p => typeof p === 'string' && p.startsWith("data:"));
                    if (base64s.length === 0) return resolveIns();

                    const savedPaths = base64s.map(p => saveBase64Photo(p, id)).filter(Boolean);
                    if (savedPaths.length === 0) return resolveIns();

                    const insertPhotosQuery = `
                      INSERT INTO estimate_photos (estimate_id, photo_path) VALUES ?
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
                      res.status(500).json({ error: "Commit failed" });
                    });
                  }
                  connection.release();
                  res.status(200).json({ message: "Estimate updated successfully" });
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

const updateEstimateStatus = (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  db.query("UPDATE estimates SET status = ? WHERE id = ?", [status, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json({ message: `Estimate status updated to ${status}` });
  });
};

const deleteEstimate = async (req, res) => {
  // APPROVAL ENGINE INTERCEPTOR
  const isBypass = req.headers['x-bypass-approval'] === 'true' || req.body._from_webhook;
  if (!isBypass) {
    try {
      const { branch_id, user_id } = req.body;
      const { id } = req.params;
      const approvalService = require("../services/approvalService");
      const branchDBService = require("../services/branchDBService");
      const companyId = await branchDBService.getCompanyIdByBranch(branch_id) || 1;
      const approvalNeeded = await approvalService.isApprovalRequired(companyId, branch_id, 'DELETE_ESTIMATE');
      
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'DELETE_ESTIMATE',
          module_name: 'Estimate',
          erp_record_id: id,
          company_id: companyId,
          branch_id: branch_id,
          initiated_by: user_id || 1,
          payload_summary: { pending_updates: req.body }
        });
        return res.status(202).json({
          message: "Estimate deletion submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Delete Estimate"
        });
      }
    } catch (e) {
      console.error("Error checking approval for Estimate Delete:", e);
    }
  }

  const id = req.params.id;
  // Get photos to delete from filesystem
  db.query("SELECT photo_path FROM estimate_photos WHERE estimate_id = ?", [id], (err, photos) => {
    if (err) return res.status(500).json({ error: err.message });

    db.query("DELETE FROM estimate_photos WHERE estimate_id = ?", [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Delete filesystem photo files
      photos.forEach(p => deletePhotoFile(p.photo_path));

      db.query("DELETE FROM estimate_items WHERE estimate_id = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query("DELETE FROM estimates WHERE id = ?", [id], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.status(200).json({ message: "Estimate deleted successfully" });
        });
      });
    });
  });
};

const applyPendingEstimateCreate = async (pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[ESTIMATE] No pending updates found for estimate creation`);
    return;
  }

  const {
    date,
    customer_id,
    insurance_company_id,
    remarks,
    branch_id,
    user_id,
    items,
    photos,
    custom_fields_data,
    parent_estimate_id
  } = pendingUpdates;

  return new Promise((resolve, reject) => {
    db.getConnection((err, connection) => {
      if (err) return reject(new Error("DB Connection failed"));

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          return reject(new Error("Failed to start transaction"));
        }

        try {
          const estimate_no = await getNextEstimateNo(branch_id);
          const resolvedParentId = await getRootParentEstimateId(connection, parent_estimate_id);

          const cfDataJson = custom_fields_data
            ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
            : null;

          const insertEstQuery = `
            INSERT INTO estimates (
              estimate_no, date, customer_id, insurance_company_id, remarks, branch_id, user_id, custom_fields_data, parent_estimate_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          const estValues = [
            estimate_no, 
            date, 
            customer_id || null, 
            insurance_company_id || null, 
            remarks || null, 
            branch_id, 
            user_id,
            cfDataJson,
            resolvedParentId || null
          ];

          connection.query(insertEstQuery, estValues, (err, estResult) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                reject(err);
              });
            }

            const estId = estResult.insertId;

            const executeSaveItems = () => {
              return new Promise((resolveItems, rejectItems) => {
                if (!items || items.length === 0) return resolveItems();
                
                const insertItemsQuery = `
                  INSERT INTO estimate_items (
                    estimate_id, item_name, qty, unit_price, total_amount, remarks, category, sub_heading, item_type
                  ) VALUES ?
                `;
                const itemsValues = items.map(itm => [
                  estId,
                  itm.item_name || '',
                  itm.qty !== undefined ? itm.qty : 1,
                  itm.unit_price !== undefined ? itm.unit_price : 0,
                  itm.total_amount !== undefined ? itm.total_amount : 0,
                  itm.remarks || '',
                  itm.category || 'SERVICES',
                  itm.sub_heading || '',
                  itm.item_type || ''
                ]);

                connection.query(insertItemsQuery, [itemsValues], (err) => {
                  if (err) return rejectItems(err);
                  resolveItems();
                });
              });
            };

            const executeSavePhotos = () => {
              return new Promise((resolvePhotos, rejectPhotos) => {
                if (!photos || photos.length === 0) return resolvePhotos();

                const savedPaths = photos.map(p => saveBase64Photo(p, estId)).filter(Boolean);
                if (savedPaths.length === 0) return resolvePhotos();

                const insertPhotosQuery = `
                  INSERT INTO estimate_photos (estimate_id, photo_path) VALUES ?
                `;
                const photoValues = savedPaths.map(p => [estId, p]);

                connection.query(insertPhotosQuery, [photoValues], (err) => {
                  if (err) {
                    savedPaths.forEach(deletePhotoFile);
                    return rejectPhotos(err);
                  }
                  resolvePhotos();
                });
              });
            };

            Promise.all([executeSaveItems(), executeSavePhotos()])
              .then(() => {
                connection.commit((commitErr) => {
                  if (commitErr) {
                    return connection.rollback(() => {
                      connection.release();
                      reject(commitErr);
                    });
                  }
                  connection.release();
                  resolve(estId);
                });
              })
              .catch((err) => {
                connection.rollback(() => {
                  connection.release();
                  reject(err);
                });
              });
          });
        } catch (err) {
          connection.rollback(() => {
            connection.release();
            reject(err);
          });
        }
      });
    });
  });
};

module.exports = {
  getSettings,
  updateSettings,
  getInsuranceCompanies,
  addInsuranceCompany,
  deleteInsuranceCompany,
  createEstimate,
  getEstimates,
  getEstimateById,
  updateEstimate,
  updateEstimateStatus,
  deleteEstimate,
  applyPendingEstimateCreate,
};
