const dbService = require("../services/supplierDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const supplierCreditLogDbService = require("../services/supplierCreditLogDBService");
const db = require("../db/db");
const approvalService = require("../services/approvalService");

const createSupplier = async (req, res) => {
  // APPROVAL ENGINE: PRE-EXECUTION CHECK FOR CREATE
  if (!req.is_approved_webhook) {
    try {
      const companyId = req.user?.company_id || req.headers["company_id"] || 1;
      const approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        req.body.Branch_idBranch,
        "CREATE_SUPPLIER"
      );
      if (approvalRequired) {
        await approvalService.triggerApprovalRequest({
          action_type: "ADD_SUPPLIER",
          module_name: "Supplier Management",
          erp_record_id: null,
          company_id: companyId,
          branch_id: req.body.Branch_idBranch,
          initiated_by: req.user?.idUser || req.user?.id || req.headers["actor_id"] || 1,
          payload_summary: {
            supplierName: req.body.Company_Name,
            pending_updates: {
               req_body: req.body,
               req_params: req.params,
               req_user: req.user,
               req_files: req.files
            }
          }
        });
        return res.status(202).json({
          message: "Supplier creation submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Supplier Creation"
        });
      }
    } catch (err) {
      console.error("Approval Check Error:", err);
      return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
    }
  }

  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const data = req.body;

        // Parse customFields if they exist
        let customFields = [];
        let contactNumbers = data.contactNumbers || [];
        try {
          if (data.customFields) {
            customFields = JSON.parse(data.customFields);
          }
        } catch (err) {
          console.error("Error parsing customFields:", err);
          connection.rollback(() => connection.release());
          return res.status(400).json({ error: "Invalid custom fields data" });
        }

        const supplierResult = await dbService.insertSupplier(
          data.Company_Name,
          data.Agent_Name,
          data.Contact_No,
          data.Contact_No2,
          data.Email,
          data.Address1,
          data.Address2,
          data.Address3,
          data.Branch_idBranch,
          0, // isDeleted
          connection,
        );

        const supplierId = supplierResult.insertId;

        // APPROVAL ENGINE: Check if approval is required
        let approvalRequired = false;
        const companyId = req.user?.company_id || req.headers["company_id"] || 1;
        
        try {
          if (!req.is_approved_webhook) {
            approvalRequired = await approvalService.isApprovalRequired(
              companyId,
              data.Branch_idBranch,
              "CREATE_SUPPLIER"
            );
            
            if (approvalRequired) {
              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE supplier SET approval_status = 'PENDING_APPROVAL', Status = '0' WHERE idSupplier = ?",
                  [supplierId],
                  (err) => (err ? reject(err) : resolve())
                );
              });
              console.log(`[SUPPLIER] Supplier ${supplierId} requires approval (PENDING_APPROVAL, Status: 0)`);
            }
          } else {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE supplier SET approval_status = 'ACTIVE', Status = '1' WHERE idSupplier = ?",
                [supplierId],
                (err) => (err ? reject(err) : resolve())
              );
            });
          }
        } catch (err) {
          console.error("Approval check failed for Supplier, defaulting to ACTIVE", err);
        }

        await dbService.insertSupplierFieldData(
          supplierId,
          customFields,
          connection,
        );

        await dbService.insertSupplierContactNumbers(
          supplierId,
          contactNumbers,
          connection,
        );

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          
          // Trigger Approval Request if needed
          const createdBy = req.user?.idUser || req.user?.id || req.headers["actor_id"] || 1;
          if (approvalRequired) {
            try {
              await approvalService.triggerApprovalRequest({
                action_type: "ADD_SUPPLIER",
                module_name: "Supplier Management",
                erp_record_id: supplierId,
                company_id: companyId,
                branch_id: data.Branch_idBranch,
                initiated_by: createdBy,
                payload_summary: {
                  company_name: data.Company_Name,
                  agent_name: data.Agent_Name,
                  contact_no: data.Contact_No,
                  contact_no_2: data.Contact_No2 || "-",
                  email: data.Email || "-",
                  address: [data.Address1, data.Address2, data.Address3].filter(Boolean).join(", ") || "-"
                }
              });
            } catch (err) {
              console.error("[SUPPLIER] Error triggering approval webhook:", err);
              return res.status(500).json({ error: "Failed to submit approval request." });
            }
          }
          
          res.status(201).json({
            message: approvalRequired
              ? "Supplier creation submitted for approval. It will be added once approved."
              : "Supplier created successfully",
            approval_required: !!approvalRequired,
            approval_status: approvalRequired ? "PENDING_APPROVAL" : "ACTIVE",
            supplierId,
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error executing transaction:", err);
          res.status(500).json({ error: "Unexpected server error" });
        });
      }
    });
  });
};

// Function to get suppliers by branch ID
// Function to get suppliers by branch ID
const getSupplier = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { page = 1, limit = 10, search = "", status = "" } = req.query;

    const result = await dbService.fetchSupplier(
      Branch_idBranch,
      page,
      limit,
      search,
      status,
    );
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching supplier", error: err.message });
  }
};

// Function to get suppliers by branch ID
const getActiveSupplier = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const supplier = await dbService.fetchActiveSupplier(Branch_idBranch);
    res.json(supplier);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching supplier", error: err.message });
  }
};

// Function to get a supplier by ID
const getSupplierById = async (req, res) => {
  try {
    const { idSupplier } = req.params;

    // Fetch supplier data
    const supplierData = await dbService.fetchSupplierById(idSupplier);
    if (supplierData.length === 0) {
      return res.status(404).json({ message: "Supplier not found" });
    }
    const supplier = supplierData[0];

    // Fetch custom fields for this supplier (staff in this case)
    const custom_fields = await new Promise((resolve, reject) => {
      const customFieldSql = `
        SELECT sfd.field_id, sfd.value, sf.field_name
        FROM supplier_field_data sfd
        JOIN supplier_fields sf ON sf.id = sfd.field_id
        WHERE sfd.supplier_id = ?
      `;
      db.query(customFieldSql, [idSupplier], (err, results) => {
        if (err) {
          console.error("Error fetching custom fields:", err);
          return reject(err);
        }
        resolve(results);
      });
    });

    // Fetch contact numbers
    const contact_numbers = await dbService.fetchSupplierContactNumbers(idSupplier);

    res.json({
      ...supplier,
      custom_fields,
      contact_numbers,
    });
  } catch (err) {
    console.error("Error fetching supplier by ID:", err);
    res.status(500).json({
      message: "Error fetching supplier by ID",
      error: err.message,
    });
  }
};

// Function to update a supplier by ID
const updateSupplierById = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const { idSupplier } = req.params;
        const {
          Company_Name,
          Agent_Name,
          Contact_No,
          Contact_No2,
          Email,
          Address1,
          Address2,
          Address3,
          User_idUser,
          Branch_idBranch,
          custom_fields,
          contactNumbers,
        } = req.body;

        const customFields = custom_fields || [];
        const parsedContactNumbers = contactNumbers || [];

        // APPROVAL ENGINE: Check if approval is required for EDIT_SUPPLIER
        const companyId = req.user?.company_id || req.headers["company_id"] || 1;
        const createdBy = req.user?.idUser || req.user?.id || User_idUser || 1;

        let approvalRequired = false;
        try {
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            Branch_idBranch,
            "EDIT_SUPPLIER"
          );
        } catch (appErr) {
          console.error("Approval check failed for Supplier Edit:", appErr);
        }

        if (approvalRequired) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE supplier SET approval_status = 'PENDING_APPROVAL' WHERE idSupplier = ?",
              [idSupplier],
              (err) => (err ? reject(err) : resolve())
            );
          });

          const oldDataList = await new Promise((resolve, reject) => {
            connection.query("SELECT * FROM supplier WHERE idSupplier = ?", [idSupplier], (err, res) => {
              if (err) reject(err); else resolve(res);
            });
          });
          const oldData = oldDataList && oldDataList.length > 0 ? oldDataList[0] : null;

          await new Promise((resolve, reject) => {
            connection.commit((err) => (err ? reject(err) : resolve()));
          });
          connection.release();

          const pendingUpdates = {
            supplierData: {
              Company_Name, Agent_Name, Contact_No, Contact_No2,
              Email, Address1, Address2, Address3
            },
            customFields,
            contactNumbers: parsedContactNumbers,
            User_idUser,
            Branch_idBranch,
            companyId
          };

          const changed_fields = {};
          if (oldData) {
             Object.keys(pendingUpdates.supplierData).forEach(key => {
               const newVal = pendingUpdates.supplierData[key];
               const o = (oldData[key] === null || oldData[key] === undefined) ? '' : String(oldData[key]).trim();
               const n = (newVal === null || newVal === undefined) ? '' : String(newVal).trim();
               if (o !== n) {
                 changed_fields[key] = { old: oldData[key] || '-', new: newVal || '-' };
               }
             });
          }

          try {
            await approvalService.triggerApprovalRequest({
              action_type: "EDIT_SUPPLIER",
              module_name: "Supplier Management",
              erp_record_id: idSupplier,
              company_id: companyId,
              branch_id: Branch_idBranch,
              initiated_by: createdBy,
              payload_summary: {
                supplier_name: Company_Name,
                action: "EDIT_SUPPLIER",
                changed_fields,
                pending_updates: pendingUpdates,
              },
            });
            console.log(`[SUPPLIER] Triggered approval request for editing supplier ${idSupplier}`);
          } catch (approvalErr) {
            console.error("[SUPPLIER] Error triggering approval webhook for EDIT_SUPPLIER:", approvalErr);
            return res.status(500).json({ error: "Failed to submit approval request." });
          }

          return res.status(200).json({
            success: true,
            message: "Supplier edit submitted for approval. Changes will take effect once approved.",
            approval_required: true,
            approval_status: "PENDING_APPROVAL",
          });
        }

        // Update base supplier using service
        await dbService.updateSupplier(
          idSupplier,
          Company_Name,
          Agent_Name,
          Contact_No,
          Contact_No2,
          Email,
          Address1,
          Address2,
          Address3,
          connection,
        );

        // Update custom fields using service
        await dbService.updateSupplierFieldData(
          idSupplier,
          customFields,
          connection,
        );

        // Update contact numbers
        await dbService.deleteSupplierContactNumbers(idSupplier, connection);
        await dbService.insertSupplierContactNumbers(idSupplier, parsedContactNumbers, connection);

        // Log update
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Supplier",
          idSupplier,
          "edit",
          Branch_idBranch,
          connection,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Supplier updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error during update:", err);
          res.status(500).json({ error: "Failed to update supplier" });
        });
      }
    });
  });
};

// Function to delete a supplier by ID
const deleteSupplierById = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const { idSupplier } = req.params;
        const { User_idUser } = req.body;
        
        // Fetch branch_id for approval check
        const supplierData = await dbService.fetchSupplierById(idSupplier);
        if (!supplierData || supplierData.length === 0) {
          connection.release();
          return res.status(404).json({ message: "Supplier not found" });
        }
        const Branch_idBranch = supplierData[0].Branch_idBranch;
        
        // APPROVAL ENGINE: Check if approval is required for DELETE_SUPPLIER
        let approvalRequired = false;
        const companyId = req.user?.company_id || req.headers["company_id"] || 1;
        
        try {
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            Branch_idBranch,
            "DELETE_SUPPLIER"
          );
        } catch (appErr) {
          console.error("Approval check failed for Supplier Delete:", appErr);
        }

        if (approvalRequired) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE supplier SET approval_status = 'PENDING_APPROVAL' WHERE idSupplier = ?",
              [idSupplier],
              (err) => (err ? reject(err) : resolve())
            );
          });

          await new Promise((resolve, reject) => {
            connection.commit((err) => (err ? reject(err) : resolve()));
          });
          connection.release();

          const createdBy = req.user?.idUser || req.user?.id || User_idUser || 1;
          try {
            await approvalService.triggerApprovalRequest({
              action_type: "DELETE_SUPPLIER",
              module_name: "Supplier Management",
              erp_record_id: idSupplier,
              company_id: companyId,
              branch_id: Branch_idBranch,
              initiated_by: createdBy,
              payload_summary: {
                supplier_name: supplierData[0].Company_Name,
                action: "DELETE_SUPPLIER"
              },
            });
            console.log(`[SUPPLIER] Triggered approval request for deleting supplier ${idSupplier}`);
          } catch (approvalErr) {
            console.error("[SUPPLIER] Error triggering approval webhook for DELETE_SUPPLIER:", approvalErr);
            return res.status(500).json({ error: "Failed to submit approval request." });
          }

          return res.status(200).json({
            success: true,
            message: "Supplier deletion submitted for approval. Record will be deleted once approved.",
            approval_required: true,
            approval_status: "PENDING_APPROVAL",
          });
        }

        await dbService.deleteSupplier(idSupplier, connection);

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Supplier deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res
            .status(500)
            .json({ message: "Error deleting Supplier", error: err.message });
        });
      }
    });
  });
};

const updateSupplierStatus = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const { idSupplier } = req.params;
        const { Branch_idBranch, User_idUser } = req.body;

        await dbService.updateStatus(idSupplier, connection);

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Supplier",
          idSupplier,
          "change status",
          Branch_idBranch,
          connection,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Supplier status updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res
            .status(500)
            .json({
              message: "Error updating supplier status",
              error: err.message,
            });
        });
      }
    });
  });
};

const getSupplierCreditBalance = async (req, res) => {
  try {
    const { idSupplier } = req.params;

    const lastLog = await supplierCreditLogDbService.fetchLastLog(idSupplier);

    let balance = 0;

    if (
      lastLog?.length > 0 &&
      lastLog[0].Total_Credit_Balance !== null &&
      lastLog[0].Total_Credit_Balance !== "-" &&
      !isNaN(parseFloat(lastLog[0].Total_Credit_Balance))
    ) {
      balance = parseFloat(lastLog[0].Total_Credit_Balance);
    }

    res.status(200).json({ Total_Credit_Balance: balance });
  } catch (err) {
    console.error("Error fetching supplier credit balance:", err.message);
    res.status(500).json({
      message: "Error fetching supplier credit balance",
      error: err.message,
    });
  }
};

const importExcelSuppliers = async (req, res) => {
  try {
    const { rows, Branch_idBranch } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No rows provided" });
    }

    // Fetch existing suppliers for duplicate check and update
    const existingSuppliers = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idSupplier, Company_Name, Contact_No FROM supplier WHERE Branch_idBranch = ? AND isDeleted = 0`,
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results || [])));
        },
      );
    });

    // Create maps for fast lookup
    const companyMap = new Map();
    const phoneMap = new Map();

    existingSuppliers.forEach((s) => {
      if (s.Company_Name)
        companyMap.set(
          s.Company_Name.toString().trim().toLowerCase(),
          s.idSupplier,
        );
      if (s.Contact_No)
        phoneMap.set(
          s.Contact_No.toString().trim().toLowerCase(),
          s.idSupplier,
        );
    });

    let success = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const companyName = (row.Company_Name || row.Company || "")
          .toString()
          .trim();

        const agentName = (row.Agent_Name || row.Agent || "")
          .toString()
          .trim();

        const phone = (row.Contact_No || row.Phone || row.Contact || row.Telephone || "")
          .toString()
          .trim();

        // Define common placeholders to ignore for uniqueness but normalize for storage
        const ignorable = [
          "-",
          "0",
          "0000000000",
          "none",
          "n/a",
          ".",
          "null",
          "undefined",
          "",
        ];
        let finalPhone = phone;
        const isPhoneInvalid =
          !phone || ignorable.includes(phone.toLowerCase()) || phone.length < 5;

        if (isPhoneInvalid) {
          finalPhone = "0000000000";
        }

        const email = (row.Email || "").toString().trim();
        const contactNo2 = (row.Contact_No2 || "").toString().trim();
        const address1 = (row.Address1 || row.Address || "").toString().trim();
        const address2 = (row.Address2 || "").toString().trim();
        const address3 = (row.Address3 || "").toString().trim();

        if (!companyName) {
          failed++;
          errors.push("Missing company name in row");
          continue;
        }

        if (!agentName) {
          failed++;
          errors.push("Missing agent name in row");
          continue;
        }

        const companyKey = companyName.toLowerCase();
        const phoneKey = finalPhone.toLowerCase();

        // Check if supplier exists - Only use phone if it's NOT a placeholder
        const isPhoneValidForCheck =
          !ignorable.includes(phoneKey) && phoneKey.length >= 5;
        const existingId =
          companyMap.get(companyKey) ||
          (isPhoneValidForCheck && phoneMap.get(phoneKey));

        if (existingId) {
          // Update existing supplier
          await dbService.updateSupplier(
            existingId,
            companyName,
            agentName,
            finalPhone,
            contactNo2,
            email,
            address1,
            address2,
            address3,
          );
          updated++;
          continue;
        }

        // Insert new supplier
        const insertRes = await dbService.insertSupplier(
          companyName,
          agentName,
          finalPhone,
          contactNo2,
          email,
          address1,
          address2,
          address3,
          Branch_idBranch,
          0, // isDeleted
          null // connection
        );

        const lastInsertId = insertRes.insertId;

        companyMap.set(companyKey, lastInsertId);
        if (phoneKey) phoneMap.set(phoneKey, lastInsertId);
        success++;
      } catch (rowErr) {
        failed++;
        errors.push(`Error importing row: ${rowErr.message}`);
      }
    }

    res.json({
      message: "Import completed",
      total: rows.length,
      success,
      updated,
      failed,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    console.error("Error in importExcelSuppliers:", err);
    res.status(500).json({
      message: "Error importing suppliers",
      error: err.message,
    });
  }
};

// Fetch low stock items for a supplier from GRN history
const getSupplierLowStockItems = async (req, res) => {
  try {
    const { idSupplier } = req.params;
    const { branchId } = req.query;

    if (!idSupplier || !branchId) {
      return res.status(400).json({ error: "Supplier ID and Branch ID are required" });
    }

    const query = `
      SELECT DISTINCT 
        i.idItem, 
        i.Item_Code, 
        i.Description, 
        i.Qty, 
        i.low_stock_level, 
        i.Cost
      FROM item i
      JOIN grn_has_item ghi ON i.idItem = ghi.Item_idItem
      JOIN grn g ON ghi.GRN_idGRN = g.idGRN
      WHERE g.Supplier_idSupplier = ? 
        AND g.Branch_idBranch = ?
        AND i.Qty <= i.low_stock_level
        AND i.Status = 1
    `;

    db.query(query, [idSupplier, branchId], (err, results) => {
      if (err) {
        console.error("Error fetching supplier low stock items:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error in getSupplierLowStockItems:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Fetch distinct item IDs ever received from a supplier (via GRN history)
const getSupplierItemIds = async (req, res) => {
  try {
    const { idSupplier } = req.params;
    const { branchId } = req.query;

    if (!idSupplier || !branchId) {
      return res.status(400).json({ error: "Supplier ID and Branch ID are required" });
    }

    const query = `
      SELECT DISTINCT ghi.Item_idItem AS idItem
      FROM grn_has_item ghi
      JOIN grn g ON ghi.GRN_idGRN = g.idGRN
      WHERE g.Supplier_idSupplier = ?
        AND g.Branch_idBranch = ?
    `;

    db.query(query, [idSupplier, branchId], (err, results) => {
      if (err) {
        console.error("Error fetching supplier item IDs:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(results.map((r) => r.idItem));
    });
  } catch (error) {
    console.error("Error in getSupplierItemIds:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Fetch products ever supplied by a supplier for a branch
const getSupplierProducts = async (req, res) => {
  try {
    const { idSupplier, Branch_idBranch } = req.params;
    const products = await dbService.fetchSupplierProducts(idSupplier, Branch_idBranch);
    res.json(products);
  } catch (err) {
    console.error("Error fetching supplier products:", err);
    res.status(500).json({ error: "Failed to fetch supplier products", message: err.message });
  }
};

const applyPendingSupplierUpdate = async (idSupplier, pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[SUPPLIER] No pending updates found for supplier #${idSupplier}`);
    return;
  }

  const {
    supplierData = {},
    customFields = [],
    contactNumbers = [],
    User_idUser = 1,
    Branch_idBranch = 1,
  } = pendingUpdates;

  const {
    Company_Name, Agent_Name, Contact_No, Contact_No2,
    Email, Address1, Address2, Address3
  } = supplierData;

  return new Promise((resolve, reject) => {
    db.getConnection(async (connErr, connection) => {
      if (connErr) return reject(connErr);

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          return reject(beginErr);
        }

        try {
          await dbService.updateSupplier(
            idSupplier, Company_Name, Agent_Name, Contact_No, Contact_No2,
            Email, Address1, Address2, Address3, connection
          );

          await dbService.updateSupplierFieldData(
            idSupplier, customFields, connection
          );

          await dbService.deleteSupplierContactNumbers(idSupplier, connection);
          await dbService.insertSupplierContactNumbers(idSupplier, contactNumbers, connection);

          await userLogDbService.insertLog(
            User_idUser, currentDate(), "Supplier", idSupplier, "edit", Branch_idBranch, connection
          );

          await new Promise((resQ, rejQ) => {
             connection.query(
               "UPDATE supplier SET approval_status = 'ACTIVE' WHERE idSupplier = ?",
               [idSupplier],
               (err) => err ? rejQ(err) : resQ()
             );
          });

          connection.commit((commitErr) => {
            if (commitErr) {
              return connection.rollback(() => {
                connection.release();
                reject(commitErr);
              });
            }
            connection.release();
            resolve();
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

const applyPendingSupplierCreate = async (pending_updates) => {
  const req = {
    body: pending_updates.req_body,
    params: pending_updates.req_params,
    user: pending_updates.req_user,
    files: pending_updates.req_files,
    is_approved_webhook: true 
  };
  
  const res = {
    status: function() { return this; },
    json: function(data) { console.log("[WEBHOOK] applyPendingSupplierCreate result:", data); return data; },
    send: function(data) { console.log("[WEBHOOK] applyPendingSupplierCreate result:", data); return data; }
  };

  return await createSupplier(req, res);
};

module.exports = {
  getSupplierProducts,
  createSupplier,
  getSupplier,
  getActiveSupplier,
  getSupplierById,
  updateSupplierById,
  deleteSupplierById,
  updateSupplierStatus,
  getSupplierCreditBalance,
  importExcelSuppliers,
  getSupplierLowStockItems,
  getSupplierItemIds,
  applyPendingSupplierUpdate,
  applyPendingSupplierCreate,
};
