const dbService = require("../services/customerDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const { isOwnerOrAdminUser } = require("../services/branchDBService");
const db = require("../db/db");

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const approvalService = require("../services/approvalService");

// Setup upload folder
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../uploads/");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({ storage });

const createCustomer = async (req, res) => {
  const data = req.body;
  const imageName = req.files?.["image"]?.[0]?.filename || null;
  const documents = req.files?.["documents"] || [];

  // APPROVAL ENGINE: PRE-EXECUTION CHECK FOR CREATE
  if (!req.is_approved_webhook) {
    try {
      const companyId = req.user?.company_id || req.headers["company_id"] || 1;
      const approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        data.branchId,
        "CREATE_CUSTOMER"
      );
      if (approvalRequired) {
        await approvalService.triggerApprovalRequest({
          action_type: "CREATE_CUSTOMER",
          module_name: "Customer",
          erp_record_id: null,
          company_id: companyId,
          branch_id: data.branchId,
          initiated_by: req.user?.idUser || req.user?.userId || 1,
          payload_summary: {
            customerName: data.firstName,
            pending_updates: {
               req_body: req.body,
               req_params: req.params,
               req_user: req.user,
               req_files: req.files
            }
          }
        });
        return res.status(202).json({
          message: "Customer creation submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Customer Creation"
        });
      }
    } catch (err) {
      console.error("Approval Check Error:", err);
      return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
    }
  }

  // Parse customFields if they exist
  let customFields = [];
  try {
    if (data.customFields) {
      customFields = JSON.parse(data.customFields);
    }
  } catch (err) {
    console.error("Error parsing customFields:", err);
    return res.status(400).json({ error: "Invalid custom fields data" });
  }

  // Get a connection from the pool
  db.getConnection((connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection from pool:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    // Check for duplicate email within the same branch
    // Only check if at least one email is provided
    const hasCompanyEmail =
      data.companyEmail && data.companyEmail.trim() !== "";
    const hasOfficialEmail =
      data.officialEmail && data.officialEmail.trim() !== "";

    if (!hasCompanyEmail && !hasOfficialEmail) {
      // No emails provided, skip duplicate check and proceed to insert
      return insertCustomer();
    }

    // Build dynamic conditions based on which emails are provided
    let emailConditions = [];
    let checkValues = [data.branchId];

    if (hasCompanyEmail) {
      emailConditions.push("(companyEmail = ? OR officialEmail = ?)");
      checkValues.push(data.companyEmail, data.companyEmail);
    }
    if (hasOfficialEmail) {
      emailConditions.push("(companyEmail = ? OR officialEmail = ?)");
      checkValues.push(data.officialEmail, data.officialEmail);
    }

    const checkEmailSql = `SELECT idCustomer FROM customer WHERE Branch_idBranch = ? AND (${emailConditions.join(" OR ")})`;

    connection.query(checkEmailSql, checkValues, (checkErr, results) => {
      if (checkErr) {
        connection.release();
        console.error("Duplicate email check error:", checkErr);
        return res.status(500).json({ error: "Database query error" });
      }

      if (results.length > 0) {
        connection.release();
        return res.status(400).json({
          error: "Duplicate entry",
          message: "A customer with this email already exists in this branch.",
        });
      }

      insertCustomer();
    });

    function insertCustomer() {
      // Start transaction
      connection.beginTransaction((beginErr) => {
        if (beginErr) {
          connection.release();
          console.error("Transaction begin error:", beginErr);
          return res.status(500).json({ error: "Failed to start transaction" });
        }

        // Insert customer data
        const customerSql = `INSERT INTO customer (
      Title, First_Name, middleName, lastName, displayName, Branch_idBranch,
      companyName, companyEmail, phoneNumber, mobileNumber, fax, other,
      website, gstNo, vatNo,
      billingAddress1, billingAddress2, billingAddress3, billingCity, billingProvince, billingCountry,
      shippingAddress1, shippingAddress2, shippingAddress3, shippingCity, shippingProvince, shippingPostalCode, shippingCountry,
      profileImage, officialEmail, officialPhone, Agent_idEmployee, credit_limit, credit_period, status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
    )`;

        const customerValues = [
          data.title,
          data.firstName,
          data.middleName,
          data.lastName,
          data.displayName,
          data.branchId,
          data.companyName,
          data.companyEmail,
          data.phoneNumber,
          data.mobileNumber,
          data.fax,
          data.other,
          data.website,
          data.gstNo,
          data.vatNo,
          data.billingAddress1,
          data.billingAddress2,
          data.billingAddress3,
          data.billingCity,
          data.billingProvince,
          data.billingCountry,
          data.shippingAddress1,
          data.shippingAddress2,
          data.shippingAddress3,
          data.shippingCity,
          data.shippingProvince,
          data.shippingPostalCode,
          data.shippingCountry,
          imageName,
          data.officialEmail,
          data.officialPhone,
          data.agentId && data.agentId !== "" ? data.agentId : null,
          data.credit_limit && data.credit_limit !== "" ? data.credit_limit : 0,
          data.credit_period && data.credit_period !== "" ? data.credit_period : null,
        ];

        connection.query(
          customerSql,
          customerValues,
          (customerErr, customerResult) => {
            if (customerErr) {
              return connection.rollback(() => {
                connection.release();
                console.error("Customer insert error:", customerErr);
                res.status(500).json({ error: "Failed to create customer" });
              });
            }

            const customerId = customerResult.insertId;
            
            // APPROVAL ENGINE: Check if approval is required
            let approvalRequired = false;
            const companyId = req.user?.company_id || req.headers["company_id"] || 1;
            
            (async () => {
              try {
                if (!req.is_approved_webhook) {
                  approvalRequired = await approvalService.isApprovalRequired(
                    companyId,
                    data.branchId,
                    "CREATE_CUSTOMER"
                  );
                  
                  if (approvalRequired) {
                    await new Promise((resolve) => {
                      connection.query(
                        "UPDATE customer SET approval_status = 'PENDING_APPROVAL', Status = '0' WHERE idCustomer = ?",
                        [customerId],
                        (err) => {
                          if (err) console.error("Error setting customer to PENDING_APPROVAL", err);
                          else console.log(`[CUSTOMER] Customer ${customerId} requires approval (PENDING_APPROVAL, Status: 0)`);
                          resolve();
                        }
                      );
                    });
                  }
                } else {
                  // If approved webhook, just make it ACTIVE
                  await new Promise((resolve) => {
                    connection.query(
                      "UPDATE customer SET approval_status = 'ACTIVE', Status = '1' WHERE idCustomer = ?",
                      [customerId],
                      () => resolve()
                    );
                  });
                }
              } catch (err) {
                console.error("Approval check failed for Customer, defaulting to ACTIVE", err);
              }

              const saveGalleryImages = (idCustomer, conn, next) => {
              const galleryFiles = req.files?.galleryImages || [];
              const galleryImageFilenames = galleryFiles.map((file) => file.filename);
              if (galleryImageFilenames.length > 0) {
                const values = galleryImageFilenames.map((url) => [idCustomer, url]);
                const query = `
                  INSERT INTO customer_images (customer_id, image_url)
                  VALUES ?
                `;
                conn.query(query, [values], (err) => {
                  if (err) {
                    return conn.rollback(() => {
                      conn.release();
                      console.error("Gallery images insert error:", err);
                      res.status(500).json({ error: "Failed to save customer vehicle images" });
                    });
                  }
                  next();
                });
              } else {
                next();
              }
            };

            saveGalleryImages(customerId, connection, () => {
              // Handle custom fields if they exist
              if (customFields.length > 0) {
                const fieldSql = `INSERT INTO customer_field_data 
            (customer_id, field_id, value) 
            VALUES ?`;

                const fieldValues = customFields.map((field) => [
                  customerId,
                  field.fieldId,
                  Array.isArray(field.value)
                    ? field.value.join(",")
                    : field.value,
                ]);

                connection.query(fieldSql, [fieldValues], (fieldErr) => {
                  if (fieldErr) {
                    return connection.rollback(() => {
                      connection.release();
                      console.error("Custom field insert error:", fieldErr);
                      res
                        .status(500)
                        .json({ error: "Failed to save custom fields" });
                    });
                  }

                  // Commit transaction
                  connection.commit((commitErr) => {
                    if (commitErr) {
                      return connection.rollback(() => {
                        connection.release();
                        console.error("Commit error:", commitErr);
                        res
                          .status(500)
                          .json({ error: "Failed to commit transaction" });
                      });
                    }

                    connection.release();
                    try {
                      const smsService = require("../services/smsService");
                      smsService.triggerSMSNotification(
                        data.branchId,
                        "customer_add",
                        data.phoneNumber || data.mobileNumber,
                        {
                          name: `${data.firstName || ""} ${data.lastName || ""}`.trim() || data.displayName,
                          date: new Date().toISOString().split("T")[0]
                        },
                        data.userId || data.User_idUser || req.user?.id || req.user?.userId || null
                      );
                    } catch (smsErr) {
                      console.error("[SMS-Trigger] Customer add SMS failed:", smsErr);
                    }
                    
                    // Trigger Approval Request if needed
                    const companyIdForApproval = req.user?.company_id || req.headers["company_id"] || 1;
                    const createdBy = req.user?.idUser || req.user?.id || data.userId || data.User_idUser || 1;
                    
                    if (approvalRequired) {
                      approvalService.triggerApprovalRequest(
                        "customer",
                        customerId,
                        data.branchId,
                        companyIdForApproval,
                        0, // No specific monetary amount
                        createdBy
                      ).catch(err => console.error("[CUSTOMER] Error triggering approval webhook:", err));
                    }
                    
                    res.status(201).json({
                      success: true,
                      message: approvalRequired
                        ? "Customer creation submitted for approval. It will take effect once approved."
                        : "Customer added successfully!",
                      approval_required: !!approvalRequired,
                      approval_status: approvalRequired ? "PENDING_APPROVAL" : "ACTIVE",
                      data: {
                        customer_id: customerId,
                        name: `${data.firstName} ${data.lastName}`,
                        image_url: imageName ? `uploads/${imageName}` : null,
                        documents_count: documents.length,
                      },
                    });
                  });
                });
              } else {
                // No custom fields, just commit
                connection.commit((commitErr) => {
                  if (commitErr) {
                    return connection.rollback(() => {
                      connection.release();
                      console.error("Commit error:", commitErr);
                      res
                        .status(500)
                        .json({ error: "Failed to commit transaction" });
                    });
                  }

                  connection.release();
                  try {
                    const smsService = require("../services/smsService");
                    smsService.triggerSMSNotification(
                      data.branchId,
                      "customer_add",
                      data.phoneNumber || data.mobileNumber,
                      {
                        name: `${data.firstName || ""} ${data.lastName || ""}`.trim() || data.displayName,
                        date: new Date().toISOString().split("T")[0]
                      },
                      data.userId || data.User_idUser || req.user?.id || req.user?.userId || null
                    );
                  } catch (smsErr) {
                    console.error("[SMS-Trigger] Customer add SMS failed:", smsErr);
                  }
                  // If customer was not created from CRM, notify CRM via webhook
                  if (data.source !== "CRM") {
                    try {
                      const { notifyCrmCustomerCreated } = require("../services/crmWebhookService");
                      notifyCrmCustomerCreated({
                        asipBookCustomerId: customerId,
                        branchId: data.branchId || data.Branch_idBranch,
                        firstName: data.firstName || data.First_Name,
                        lastName: data.lastName,
                        displayName: data.displayName || `${data.firstName || ""} ${data.lastName || ""}`.trim(),
                        phoneNumber: data.phoneNumber || data.mobileNumber,
                        email: data.companyEmail || data.officialEmail,
                        address: [data.billingAddress1, data.billingAddress2, data.billingCity].filter(Boolean).join(", "),
                      });
                    } catch (crmErr) {
                      console.warn("[CRM Webhook] Customer notify failed:", crmErr);
                    }
                  }
                  
                  // Trigger Approval Request if needed
                  const companyIdForApproval = req.user?.company_id || req.headers["company_id"] || 1;
                  const createdBy = req.user?.idUser || req.user?.id || data.userId || data.User_idUser || 1;
                  
                  if (typeof approvalRequired !== 'undefined' && approvalRequired) {
                    approvalService.triggerApprovalRequest(
                      "customer",
                      customerId,
                      data.branchId,
                      companyIdForApproval,
                      0, // No specific monetary amount
                      createdBy
                    ).catch(err => console.error("[CUSTOMER] Error triggering approval webhook:", err));
                  }

                  res.status(201).json({
                    success: true,
                    message: (typeof approvalRequired !== 'undefined' && approvalRequired)
                      ? "Customer creation submitted for approval. It will take effect once approved."
                      : "Customer added successfully!",
                    approval_required: !!(typeof approvalRequired !== 'undefined' && approvalRequired),
                    approval_status: (typeof approvalRequired !== 'undefined' && approvalRequired) ? "PENDING_APPROVAL" : "ACTIVE",
                    data: {
                      customer_id: customerId,
                      name: `${data.firstName} ${data.lastName}`,
                      image_url: imageName ? `uploads/${imageName}` : null,
                      documents_count: documents.length,
                    },
                  });
                });
              }
            }); // <-- Close the saveGalleryImages callback
            })(); // <-- Close the async IIFE here
          }
        );
      });
    } // end insertCustomer
  });
};

const getFieldUserScopedCustomers = async (userId, branchId, userRole = null) => {
  if (!userId || !branchId) return null;

  try {
    const isOwnerOrAdmin = await isOwnerOrAdminUser(userId, branchId, userRole);
    if (isOwnerOrAdmin) {
      return null; // Owner/Admin/Main account sees all customers across the company/branch
    }
  } catch (err) {
    console.error("Error checking isOwnerOrAdminUser in getFieldUserScopedCustomers:", err);
  }

  return new Promise((resolve) => {
    db.query(
      "SELECT Route_Management, Daily_Route_View, Show_Only_User_Data FROM user_privilages WHERE User_idUser = ? AND (Branch_idBranch = ? OR Branch_idBranch = 0 OR Branch_idBranch IS NULL) ORDER BY Branch_idBranch DESC LIMIT 1",
      [userId, branchId],
      async (err, privRows) => {
        const priv = privRows && privRows.length > 0 ? privRows[0] : null;
        const isRouteManager = priv ? priv.Route_Management === 1 : false;

        // If explicitly a Route Manager (admin), do not restrict
        if (isRouteManager) {
          return resolve(null);
        }

        let isRestricted = false;
        if (priv) {
          isRestricted =
            priv.Show_Only_User_Data === 1 ||
            (priv.Daily_Route_View === 1 && priv.Route_Management === 0);
        }

        if (!isRestricted) {
          // Check if branch has Route-Wise Customer Management enabled
          const ruleRows = await new Promise((resRule) => {
            db.query(
              "SELECT enable_route_management FROM rules WHERE Branch_idBranch = ? LIMIT 1",
              [branchId],
              (rErr, rRows) => resRule(rRows || [])
            );
          });
          if (ruleRows?.[0]?.enable_route_management === 1) {
            isRestricted = true;
          }
        }

        // Also check if this user has assigned routes in distribution_route or route_has_user
        if (!isRestricted) {
          const routeAssignedRows = await new Promise((resAssigned) => {
            db.query(
              `SELECT 1 FROM distribution_route dr 
               WHERE dr.Branch_idBranch = ? AND dr.Status != 0 
               AND (dr.Default_Salesperson_Id = ? OR dr.Default_Driver_Id = ? OR dr.idRoute IN (SELECT Route_idRoute FROM route_has_user WHERE User_idUser = ?))
               LIMIT 1`,
              [branchId, userId, userId, userId],
              (aErr, aRows) => resAssigned(aRows || [])
            );
          });
          if (routeAssignedRows && routeAssignedRows.length > 0) {
            isRestricted = true;
          }
        }

        if (isRestricted) {
          try {
            const routeDBService = require("../services/routeDBService");
            const ids = await routeDBService.getAllCustomerIdsForUser(userId, branchId);
            return resolve(ids);
          } catch (e) {
            console.error("Error getting customer scope for user:", e);
            return resolve([]);
          }
        }
        resolve(null);
      }
    );
  });
};

const getCustomer = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      agentId = null,
      companyName = null,
      customFieldId = null,
      customFieldValue = null,
      routeId = null,
    } = req.query;

    const parsedLimit = Math.min(2000, parseInt(limit, 10) || 10);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);

    const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
    const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];
    const scopedCustomerIds = await getFieldUserScopedCustomers(currentUserId, Branch_idBranch, currentUserRole);

    const result = await dbService.fetchCustomer(
      Branch_idBranch,
      parsedPage,
      parsedLimit,
      search,
      status,
      agentId,
      companyName,
      customFieldId,
      customFieldValue,
      routeId,
      scopedCustomerIds,
    );

    const enrichedData = await Promise.all(
      result.data.map(async (customer) => {
        const customerId = customer.idCustomer;
        const customer_branches =
          await dbService.getCustomerbranches(customerId);
        const custom_fields = await new Promise((resolve, reject) => {
          const customFieldSql = `SELECT cfd.field_id, cfd.value, cf.field_name, cf.field_type FROM customer_field_data cfd JOIN customer_fields cf ON cf.id = cfd.field_id WHERE cfd.customer_id = ?`;
          db.query(customFieldSql, [customerId], (err, results) => {
            if (err) {
              return reject(err);
            }
            if (results.length === 0) {
              return resolve([]);
            }

            const fieldIds = results.map(r => r.field_id);
            const optionSql = `SELECT customer_field_id, option_text FROM customer_field_options WHERE customer_field_id IN (?)`;
            db.query(optionSql, [fieldIds], (err2, optionsResults) => {
              if (err2) {
                return reject(err2);
              }
              const formatted = results.map(row => {
                const opts = optionsResults
                  .filter(o => o.customer_field_id === row.field_id)
                  .map(o => o.option_text);
                return { ...row, options: opts };
              });
              resolve(formatted);
            });
          });
        });
        return { ...customer, customer_branches, custom_fields };
      }),
    );

    res.json({
      data: enrichedData,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  } catch (err) {
    console.error("Error fetching customer:", err);
    res
      .status(500)
      .json({ message: "Error fetching customer", error: err.message });
  }
};

const getActiveCustomer = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { customFieldId = null, customFieldValue = null, routeId = null } = req.query;

    const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
    const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];
    const scopedCustomerIds = await getFieldUserScopedCustomers(currentUserId, Branch_idBranch, currentUserRole);

    const customers = await dbService.fetchActiveCustomer(
      Branch_idBranch,
      customFieldId,
      customFieldValue,
      routeId,
      scopedCustomerIds,
    );
    const enrichedCustomers = await Promise.all(
      customers.map(async (customer) => {
        const customer_branches = await dbService.getCustomerbranches(
          customer.idCustomer,
        );
        return {
          ...customer,
          customer_branches: customer_branches,
        };
      }),
    );

    res.json(enrichedCustomers);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res
      .status(500)
      .json({ message: "Error fetching customer", error: err.message });
  }
};

const deleteCustomer = (req, res) => {
  const customerId = req.params.id;

  try {
    db.query(
      "SELECT COUNT(*) AS count FROM invoice WHERE Customer_idCustomer = ?",
      [customerId],
      (err, invoiceResults) => {
        if (err) {
          console.error("Invoice check error:", err);
          return res
            .status(500)
            .json({ message: "Server Error: Invoice check failed" });
        }

        if (invoiceResults[0].count > 0) {
          return res.status(400).json({
            message:
              "Cannot delete: This customer is referenced in Invoice table.",
          });
        }

        db.query(
          "DELETE FROM customer WHERE idCustomer = ?",
          [customerId],
          (err, result) => {
            if (err) {
              console.error("Delete error:", err);
              return res
                .status(500)
                .json({ message: "Server Error: Deletion failed" });
            }
            return res.json({ message: "Customer deleted successfully." });
          },
        );
      },
    );
  } catch (e) {
    console.error("Unexpected error:", e);
    return res.status(500).json({ message: "Unexpected server error." });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const { idCustomer } = req.params;
    const customer = await dbService.fetchCustomerById(idCustomer);
    if (customer.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const images = await dbService.fetchCustomerImages(idCustomer);

    const custom_fields = await new Promise((resolve, reject) => {
      const customFieldSql = `SELECT cfd.field_id, cfd.value, cf.field_name, cf.field_type FROM customer_field_data cfd JOIN customer_fields cf ON cf.id = cfd.field_id WHERE cfd.customer_id = ?`;
      db.query(customFieldSql, [idCustomer], (err, results) => {
        if (err) {
          return reject(err);
        }
        if (results.length === 0) {
          return resolve([]);
        }

        const fieldIds = results.map(r => r.field_id);
        const optionSql = `SELECT customer_field_id, option_text FROM customer_field_options WHERE customer_field_id IN (?)`;
        db.query(optionSql, [fieldIds], (err2, optionsResults) => {
          if (err2) {
            return reject(err2);
          }
          const formatted = results.map(row => {
            const opts = optionsResults
              .filter(o => o.customer_field_id === row.field_id)
              .map(o => o.option_text);
            return { ...row, options: opts };
          });
          resolve(formatted);
        });
      });
    });

    res.json({
      ...customer[0],
      images: images || [],
      custom_fields: custom_fields || [],
    });
  } catch (err) {
    console.error("Error fetching customer by ID:", err);
    res
      .status(500)
      .json({ message: "Error fetching customer by ID", error: err.message });
  }
};

const updateCustomerById = [
  upload.single("profileImage"),
  async (req, res) => {
    // Get connection from pool
    db.getConnection((connErr, connection) => {
      if (connErr) {
        console.error("Failed to get connection from pool:", connErr);
        return res.status(500).json({ error: "Database connection failed" });
      }

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          console.error("Transaction begin error:", beginErr);
          return res.status(500).json({ error: "Failed to start transaction" });
        }

        try {
          const { idCustomer } = req.params;

          const {
            Title,
            First_Name,
            middleName,
            lastName,
            displayName,
            Branch_idBranch,
            companyName,
            companyEmail,
            phoneNumber,
            mobileNumber,
            fax,
            other,
            website,
            gstNo,
            vatNo,
            billingAddress1,
            billingAddress2,
            billingAddress3,
            billingCity,
            billingProvince,
            billingCountry,
            shippingAddress1,
            shippingAddress2,
            shippingAddress3,
            shippingCity,
            shippingProvince,
            shippingPostalCode,
            shippingCountry,
            officialPhone,
            officialEmail,
            agentId,
            credit_limit,
            credit_period,
            User_idUser,
          } = req.body;

          const customer_branches = JSON.parse(
            req.body.customer_branches || "[]",
          );
          const customFields = JSON.parse(req.body.custom_fields || "[]");

          const imageName = req.file?.filename || null;

          // APPROVAL ENGINE: Check if approval is required for EDIT_CUSTOMER
          const companyId = req.user?.company_id || req.headers["company_id"] || 1;
          const createdBy = req.user?.idUser || req.user?.id || User_idUser || 1;

          let approvalRequired = false;
          try {
            approvalRequired = await approvalService.isApprovalRequired(
              companyId,
              Branch_idBranch,
              "EDIT_CUSTOMER"
            );
          } catch (appErr) {
            console.error("Approval check failed for Customer Edit:", appErr);
          }

          if (approvalRequired) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE customer SET approval_status = 'PENDING_APPROVAL' WHERE idCustomer = ?",
                [idCustomer],
                (err) => (err ? reject(err) : resolve())
              );
            });

            await new Promise((resolve, reject) => {
              connection.commit((err) => (err ? reject(err) : resolve()));
            });
            connection.release();

            const pendingUpdates = {
              customerData: {
                Title, First_Name, middleName, lastName, displayName, Branch_idBranch,
                companyName, companyEmail, phoneNumber, mobileNumber, fax, other,
                website, gstNo, vatNo, billingAddress1, billingAddress2, billingAddress3,
                billingCity, billingProvince, billingCountry, shippingAddress1,
                shippingAddress2, shippingAddress3, shippingCity, shippingProvince,
                shippingPostalCode, shippingCountry, officialPhone, officialEmail,
                agentId: agentId && agentId !== "" ? agentId : null,
                credit_limit: credit_limit && credit_limit !== "" ? credit_limit : 0,
                credit_period: credit_period && credit_period !== "" ? credit_period : null
              },
              customer_branches,
              customFields,
              imageName,
              User_idUser,
              Branch_idBranch,
              companyId
            };

            const oldDataList = await new Promise((resolve, reject) => {
              connection.query("SELECT * FROM customer WHERE idCustomer = ?", [idCustomer], (err, res) => {
                if (err) reject(err); else resolve(res);
              });
            });
            const oldData = oldDataList && oldDataList.length > 0 ? oldDataList[0] : null;

            const changed_fields = {};
            if (oldData) {
               Object.keys(pendingUpdates.customerData).forEach(key => {
                 const newVal = pendingUpdates.customerData[key];
                 const o = (oldData[key] === null || oldData[key] === undefined) ? '' : String(oldData[key]).trim();
                 const n = (newVal === null || newVal === undefined) ? '' : String(newVal).trim();
                 if (o !== n) {
                   changed_fields[key] = { old: oldData[key] || '-', new: newVal || '-' };
                 }
               });
            }

            try {
              await approvalService.triggerApprovalRequest({
                action_type: "EDIT_CUSTOMER",
                module_name: "Customer Management",
                erp_record_id: idCustomer,
                company_id: companyId,
                branch_id: Branch_idBranch,
                initiated_by: createdBy,
                payload_summary: {
                  customer_name: displayName || `${First_Name || ''} ${lastName || ''}`.trim(),
                  action: "EDIT_CUSTOMER",
                  changed_fields,
                  pending_updates: pendingUpdates,
                },
              });
              console.log(`[CUSTOMER] Triggered approval request for editing customer ${idCustomer}`);
            } catch (approvalErr) {
              console.error("[CUSTOMER] Error triggering approval webhook for EDIT_CUSTOMER:", approvalErr);
              return res.status(500).json({ error: "Failed to submit approval request." });
            }

            return res.status(200).json({
              success: true,
              message: "Customer edit submitted for approval. Changes will take effect once approved.",
              approval_required: true,
              approval_status: "PENDING_APPROVAL",
            });
          }

          // ✅ Update base customer data (when no approval is required)
          await dbService.updateCustomer(
            idCustomer,
            Title,
            First_Name,
            middleName,
            lastName,
            displayName,
            Branch_idBranch,
            companyName,
            companyEmail,
            phoneNumber,
            mobileNumber,
            fax,
            other,
            website,
            gstNo,
            vatNo,
            billingAddress1,
            billingAddress2,
            billingAddress3,
            billingCity,
            billingProvince,
            billingCountry,
            shippingAddress1,
            shippingAddress2,
            shippingAddress3,
            shippingCity,
            shippingProvince,
            shippingPostalCode,
            shippingCountry,
            officialPhone,
            officialEmail,
            agentId && agentId !== "" ? agentId : null,
            credit_limit && credit_limit !== "" ? credit_limit : 0,
            credit_period && credit_period !== "" ? credit_period : null,
            imageName,
            connection,
          );

          // ✅ Update or insert customer branches
          for (const branch of customer_branches) {
            if (branch.idCustomer_Branch === 0) {
              await dbService.insertCustomerBranch(
                idCustomer,
                branch.Branch_Name,
                branch.Branch_Address,
                branch.Branch_Contact,
                connection,
              );
            } else {
              await dbService.updateCustomerBranch(
                branch.idCustomer_Branch,
                idCustomer,
                branch.Branch_Name,
                branch.Branch_Address,
                branch.Branch_Contact,
                connection,
              );
            }
          }

          // ✅ Update custom fields if provided
          if (Array.isArray(customFields) && customFields.length > 0) {
            for (const field of customFields) {
              const value = Array.isArray(field.value)
                ? field.value.join(",")
                : field.value;

              const updateSql = `
              UPDATE customer_field_data
              SET value = ?
              WHERE customer_id = ? AND field_id = ?
            `;

              await new Promise((resolve, reject) => {
                connection.query(
                  updateSql,
                  [value, idCustomer, field.field_id],
                  (err, result) => {
                    if (err) {
                      console.error("Custom field update error:", err);
                      return reject(err);
                    }

                    if (result.affectedRows === 0) {
                      const insertSql = `
                        INSERT INTO customer_field_data (customer_id, field_id, value)
                        VALUES (?, ?, ?)
                      `;
                      connection.query(
                        insertSql,
                        [idCustomer, field.field_id, value],
                        (insertErr, insertResult) => {
                          if (insertErr) {
                            console.error("Custom field insert error:", insertErr);
                            return reject(insertErr);
                          }
                          resolve(insertResult);
                        }
                      );
                    } else {
                      resolve(result);
                    }
                  },
                );
              });
            }
          }

          // ✅ Log the update
          await userLogDbService.insertLog(
            User_idUser,
            currentDate(),
            "Customer",
            idCustomer,
            "edit",
            Branch_idBranch,
            connection,
          );

          // ✅ Commit transaction
          connection.commit((commitErr) => {
            if (commitErr) {
              return connection.rollback(() => {
                connection.release();
                console.error("Commit error:", commitErr);
                res.status(500).json({ error: "Failed to commit transaction" });
              });
            }

            connection.release();
            res.status(200).json({ message: "Customer updated successfully" });
          });
        } catch (err) {
          console.error("Error updating customer:", err);
          connection.rollback(() => {
            connection.release();
            res.status(500).json({
              message: "Error updating customer",
              error: err.message,
            });
          });
        }
      });
    });
  },
];

const Customerdelete = async (req, res) => {
  const { idCustomer } = req.params;
  const { Branch_idBranch, User_idUser } = req.body;

  db.getConnection((connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection from pool:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        // APPROVAL ENGINE: Check if approval is required for DELETE_CUSTOMER
        let approvalRequired = false;
        const companyId = req.user?.company_id || req.headers["company_id"] || 1;
        
        try {
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            Branch_idBranch,
            "DELETE_CUSTOMER"
          );
        } catch (appErr) {
          console.error("Approval check failed for Customer Delete:", appErr);
        }

        if (approvalRequired) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE customer SET approval_status = 'PENDING_APPROVAL' WHERE idCustomer = ?",
              [idCustomer],
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
              action_type: "DELETE_CUSTOMER",
              module_name: "Customer Management",
              erp_record_id: idCustomer,
              company_id: companyId,
              branch_id: Branch_idBranch,
              initiated_by: createdBy,
              payload_summary: {
                action: "DELETE_CUSTOMER"
              },
            });
            console.log(`[CUSTOMER] Triggered approval request for deleting customer ${idCustomer}`);
          } catch (approvalErr) {
            console.error("[CUSTOMER] Error triggering approval webhook for DELETE_CUSTOMER:", approvalErr);
          }

          return res.status(200).json({
            success: true,
            message: "Customer deletion submitted for approval. Record will be deleted once approved.",
            approval_required: true,
            approval_status: "PENDING_APPROVAL",
          });
        }

        // Proceed with deletion if no approval required
        await dbService.deleteCustomer(idCustomer, connection);
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Customer",
          idCustomer,
          "delete",
          Branch_idBranch,
          connection,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Customer deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            message: "Error deleting customer status",
            error: err.message,
          });
        });
      }
    });
  });
};

const updateCustomerStatus = async (req, res) => {
  const { idCustomer } = req.params;
  const { Branch_idBranch, User_idUser } = req.body;

  db.getConnection((connErr, connection) => {
    if (connErr) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        await dbService.updateStatus(idCustomer, connection);
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Customer",
          idCustomer,
          "change status",
          Branch_idBranch,
          connection,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Customer status updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            message: "Error updating customer status",
            error: err.message,
          });
        });
      }
    });
  });
};

const getCustomersByBranch = async (req, res) => {
  const { branchId } = req.params;

  try {
    const [customers] = await db.promise().query(
      `
            SELECT 
                id AS idCustomer,
                CONCAT(
                    COALESCE(title, ''), ' ', 
                    COALESCE(displayName, CONCAT(
                        COALESCE(firstName, ''), ' ', 
                        COALESCE(middleName, ''), ' ', 
                        COALESCE(lastName, '')
                    ))
                ) AS Name,
                title AS Title,
                displayName,
                phoneNumber AS Tp,
                companyEmail AS Email,
                (SELECT COUNT(*) FROM invoices WHERE invoices.customer_id = customers.id) AS Invoice_Count,
                (SELECT SUM(total) FROM invoices WHERE invoices.customer_id = customers.id) AS Total_Invoice,
                COALESCE(status, 1) AS Status
            FROM customers
            WHERE Branch_idBranch = ?
            ORDER BY displayName ASC
        `,
      [branchId],
    );

    res.json({
      success: true,
      data: customers,
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

const importExcelCustomers = async (req, res) => {
  try {
    const {
      rows,
      Branch_idBranch,
      customerType = "Individual",
      importWithRoutes,
    } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No rows provided" });
    }

    // Check if route management is enabled for this branch in system settings
    const ruleRows = await new Promise((resolve, reject) => {
      db.query(
        "SELECT enable_route_management FROM rules WHERE Branch_idBranch = ? LIMIT 1",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });

    const isRouteEnabled =
      ruleRows && ruleRows.length > 0 && ruleRows[0].enable_route_management === 1;

    const shouldProcessRoutes = Boolean(
      isRouteEnabled &&
        (importWithRoutes === undefined ||
          importWithRoutes === true ||
          importWithRoutes === "true")
    );

    // Fetch existing customers for duplicate check and update
    const existingCustomers = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idCustomer, displayName, phoneNumber FROM customer WHERE Branch_idBranch = ?`,
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results || [])));
        },
      );
    });

    // Create maps for fast lookup
    const nameMap = new Map();
    const phoneMap = new Map();

    existingCustomers.forEach((c) => {
      if (c.displayName)
        nameMap.set(
          c.displayName.toString().trim().toLowerCase(),
          c.idCustomer,
        );
      if (c.phoneNumber)
        phoneMap.set(
          c.phoneNumber.toString().trim().toLowerCase(),
          c.idCustomer,
        );
    });

    // Fetch existing employees (agents) to avoid duplicate agent creation
    const existingEmployees = await new Promise((resolve, reject) => {
      db.query(
        `SELECT idEmployee, Employee_Name FROM employee WHERE Branch_idBranch = ? AND Status = 1`,
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(JSON.parse(JSON.stringify(results || [])));
        },
      );
    });

    const agentMap = new Map();
    existingEmployees.forEach((emp) => {
      if (emp.Employee_Name) {
        agentMap.set(
          emp.Employee_Name.toString().trim().toLowerCase(),
          emp.idEmployee,
        );
      }
    });

    // Route tracking and lookup maps
    const routeCodeMap = new Map();
    const routeNameMap = new Map();
    const routeStopOrderMap = new Map();
    let routesCreatedCount = 0;

    if (shouldProcessRoutes) {
      const existingRoutes = await new Promise((resolve, reject) => {
        db.query(
          "SELECT idRoute, Route_Code, Route_Name FROM distribution_route WHERE Branch_idBranch = ?",
          [Branch_idBranch],
          (err, results) => {
            if (err) reject(err);
            else resolve(JSON.parse(JSON.stringify(results || [])));
          }
        );
      });

      existingRoutes.forEach((r) => {
        if (r.Route_Code) {
          routeCodeMap.set(
            r.Route_Code.toString().trim().toLowerCase(),
            r.idRoute
          );
        }
        if (r.Route_Name) {
          routeNameMap.set(
            r.Route_Name.toString().trim().toLowerCase(),
            r.idRoute
          );
        }
      });
    }

    const getNextStopOrder = async (routeId) => {
      if (routeStopOrderMap.has(routeId)) {
        const nextOrder = routeStopOrderMap.get(routeId) + 1;
        routeStopOrderMap.set(routeId, nextOrder);
        return nextOrder;
      }
      const maxOrderRes = await new Promise((resolve, reject) => {
        db.query(
          "SELECT MAX(Stop_Order) AS max_order FROM route_has_customer WHERE Route_idRoute = ?",
          [routeId],
          (err, res) => {
            if (err) reject(err);
            else resolve(res?.[0]?.max_order || 0);
          }
        );
      });
      const nextOrder = (maxOrderRes || 0) + 1;
      routeStopOrderMap.set(routeId, nextOrder);
      return nextOrder;
    };

    const resolveOrCreateRoute = async (rawCode, rawName) => {
      let code = (rawCode || "").toString().trim();
      let name = (rawName || "").toString().trim();

      if (!code && !name) return null;

      if (code && !name) name = code;
      if (name && !code) {
        code = `RT-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      const codeKey = code.toLowerCase();
      const nameKey = name.toLowerCase();

      if (routeCodeMap.has(codeKey)) {
        return routeCodeMap.get(codeKey);
      }
      if (routeNameMap.has(nameKey)) {
        return routeNameMap.get(nameKey);
      }

      // Check uniqueness of Route_Code
      let uniqueCode = code;
      let collision = true;
      let counter = 1;
      while (collision && counter <= 10) {
        const check = await new Promise((resolve, reject) => {
          db.query(
            "SELECT idRoute FROM distribution_route WHERE Route_Code = ? LIMIT 1",
            [uniqueCode],
            (err, res) => {
              if (err) reject(err);
              else resolve(res || []);
            }
          );
        });
        if (check.length === 0) {
          collision = false;
        } else {
          uniqueCode = `${code}-${Math.floor(100 + Math.random() * 900)}`;
          counter++;
        }
      }

      const insertResult = await new Promise((resolve, reject) => {
        db.query(
          "INSERT INTO distribution_route (Route_Code, Route_Name, Branch_idBranch, Status) VALUES (?, ?, ?, 1)",
          [uniqueCode, name, Branch_idBranch],
          (err, res) => {
            if (err) reject(err);
            else resolve(res.insertId);
          }
        );
      });

      const newRouteId = insertResult;
      routesCreatedCount++;
      routeCodeMap.set(codeKey, newRouteId);
      routeCodeMap.set(uniqueCode.toLowerCase(), newRouteId);
      routeNameMap.set(nameKey, newRouteId);
      return newRouteId;
    };

    let success = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    for (const row of rows) {
      try {
        let rawName = (row.displayName || row.Name || row.Customer_Name || "")
          .toString()
          .trim();

        const phone = (row.phoneNumber || row.Phone || row.Contact || "")
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

        const email = (row.companyEmail || row.Email || "").toString().trim();
        const discount = (row.other || row.Discount || "").toString().trim();

        if (!rawName) {
          failed++;
          errors.push("Missing customer name in row");
          continue;
        }

        // Parse Agent and Customer Name
        let agentName = "";
        let customerName = rawName;
        const salesmanVal = (
          row.salesman ||
          row.Salesman ||
          row.salesrep ||
          row.Salesperson ||
          row.Agent ||
          ""
        )
          .toString()
          .trim();
        if (salesmanVal !== "") {
          agentName = salesmanVal;
        } else if (rawName.includes(":")) {
          const parts = rawName.split(":");
          agentName = parts[0].trim();
          customerName = parts.slice(1).join(":").trim(); // In case there are multiple colons
        }

        if (!customerName) {
          customerName = rawName; // Fallback if splitting fails
        }

        // Determine if Company or Individual
        const rowType = (
          row.customerType ||
          row.Type ||
          row.Customer_Type ||
          ""
        )
          .toString()
          .trim()
          .toLowerCase();
        let isCompany = false;
        if (rowType) {
          isCompany =
            rowType.includes("comp") ||
            rowType === "c" ||
            rowType === "business";
        } else {
          isCompany =
            (customerType || "").toString().trim().toLowerCase() === "company";
        }

        // Title handling: if company, strictly NO title (null). If individual, default "Mr." or provided title.
        const rowTitle = (row.title || row.Title || "").toString().trim();
        const finalTitle = isCompany ? null : (rowTitle || "Mr.");
        const companyNameVal = isCompany
          ? (row.companyName || customerName || rawName).toString().trim()
          : ((row.companyName || "").toString().trim() || null);

        // Handle Agent Assignment
        let agentId = null;
        if (agentName) {
          const agentKey = agentName.toLowerCase();
          if (agentMap.has(agentKey)) {
            agentId = agentMap.get(agentKey);
          } else {
            // Create new Agent/Employee if not exists
            const insertAgentResult = await new Promise((resolve, reject) => {
              db.query(
                `INSERT INTO employee (Employee_Name, Branch_idBranch, Status) VALUES (?, ?, 1)`,
                [agentName, Branch_idBranch],
                (err, res) => {
                  if (err) reject(err);
                  else resolve(res.insertId);
                },
              );
            });
            agentId = insertAgentResult;
            agentMap.set(agentKey, agentId);
          }
        }

        // Resolve route if route management is active
        let routeId = null;
        if (shouldProcessRoutes) {
          const rawRouteCode = (
            row.routeCode ||
            row.Route_Code ||
            row.Route_Id ||
            row.RouteId ||
            row["Route ID"] ||
            row["Route Code"] ||
            ""
          )
            .toString()
            .trim();
          const rawRouteName = (
            row.routeName ||
            row.Route_Name ||
            row.RouteName ||
            row["Route Name"] ||
            row.Route ||
            ""
          )
            .toString()
            .trim();
          if (rawRouteCode || rawRouteName) {
            routeId = await resolveOrCreateRoute(rawRouteCode, rawRouteName);
          }
        }

        const nameKey = rawName.toLowerCase();
        const phoneKey = finalPhone.toLowerCase();

        // Check if customer exists - Only use phone if it's NOT a placeholder
        const isPhoneValidForCheck =
          !ignorable.includes(phoneKey) && phoneKey.length >= 5;
        const existingId =
          nameMap.get(nameKey) ||
          (isPhoneValidForCheck && phoneMap.get(phoneKey));

        if (existingId) {
          // Update existing customer's other field (Discount) and optionally Agent/Salesman
          if (agentId) {
            await dbService.updateCustomerAgentAndOther(
              existingId,
              agentId,
              discount,
            );
          } else {
            await dbService.updateCustomerOther(existingId, discount);
          }

          // If company, remove any title and set companyName if missing
          if (isCompany) {
            await new Promise((resolve, reject) => {
              db.query(
                "UPDATE customer SET Title = NULL, companyName = COALESCE(companyName, ?) WHERE idCustomer = ?",
                [companyNameVal, existingId],
                (err) => (err ? reject(err) : resolve()),
              );
            });
          }

          // Assign route if resolved
          if (routeId) {
            await new Promise((resolve, reject) => {
              db.query(
                "UPDATE customer SET Route_idRoute = ? WHERE idCustomer = ?",
                [routeId, existingId],
                (err) => (err ? reject(err) : resolve()),
              );
            });
            await new Promise((resolve, reject) => {
              db.query(
                "DELETE FROM route_has_customer WHERE Customer_idCustomer = ? AND Route_idRoute != ?",
                [existingId, routeId],
                (err) => (err ? reject(err) : resolve()),
              );
            });
            const stopOrder = await getNextStopOrder(routeId);
            await new Promise((resolve, reject) => {
              db.query(
                `INSERT INTO route_has_customer (Route_idRoute, Customer_idCustomer, Stop_Order)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE Stop_Order = ?`,
                [routeId, existingId, stopOrder, stopOrder],
                (err) => (err ? reject(err) : resolve()),
              );
            });
          }

          updated++;
          continue;
        }

        // Insert new customer
        const insertRes = await dbService.insertCustomer(
          finalTitle, // Title: null for Company (no title), "Mr." for Individual
          customerName, // First Name
          null, // Middle Name
          "", // Last Name
          rawName, // Display Name
          companyNameVal, // Company Name
          email, // Company Email
          finalPhone, // Phone Number
          null, // Mobile
          null, // Fax
          discount, // Other (Discount)
          null, // Website
          null, // GST
          null, // VAT
          (row.Address1 || row.Address || "").toString().trim(), // Billing Addr 1
          (row.Address2 || "").toString().trim(), // Billing Addr 2
          (row.Address3 || "").toString().trim(), // Billing Addr 3
          null, // Billing City
          null, // Billing Province
          null, // Billing Country
          (row.Address1 || row.Address || "").toString().trim(), // Shipping Addr 1
          (row.Address2 || "").toString().trim(), // Shipping Addr 2
          (row.Address3 || "").toString().trim(), // Shipping Addr 3
          null, // Shipping City
          null, // Shipping Province
          null, // Shipping Postal
          null, // Shipping Country
          Branch_idBranch,
          agentId || null,
          0, // Credit Limit
        );

        let newCustomerId = insertRes?.insertId;
        if (!newCustomerId) {
          const lastInsertIdResult = await new Promise((resolve, reject) => {
            db.query("SELECT LAST_INSERT_ID() as id", (err, res) => {
              if (err) reject(err);
              else resolve(res[0]?.id);
            });
          });
          newCustomerId = lastInsertIdResult;
        }

        // Assign route to newly inserted customer if routeId is present
        if (routeId && newCustomerId) {
          await new Promise((resolve, reject) => {
            db.query(
              "UPDATE customer SET Route_idRoute = ? WHERE idCustomer = ?",
              [routeId, newCustomerId],
              (err) => (err ? reject(err) : resolve()),
            );
          });
          const stopOrder = await getNextStopOrder(routeId);
          await new Promise((resolve, reject) => {
            db.query(
              `INSERT INTO route_has_customer (Route_idRoute, Customer_idCustomer, Stop_Order)
               VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE Stop_Order = ?`,
              [routeId, newCustomerId, stopOrder, stopOrder],
              (err) => (err ? reject(err) : resolve()),
            );
          });
        }

        nameMap.set(nameKey, newCustomerId);
        if (phoneKey) phoneMap.set(phoneKey, newCustomerId);
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
      routesCreated: routesCreatedCount,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    console.error("Error in importExcelCustomers:", err);
    res.status(500).json({
      message: "Error importing customers",
      error: err.message,
    });
  }
};

const getDistinctBranchCompanies = async (req, res) => {
  const { Branch_idBranch } = req.params;

  if (!Branch_idBranch) {
    return res
      .status(400)
      .json({ success: false, message: "Branch ID is required" });
  }

  try {
    const sql = `
      SELECT DISTINCT companyName 
      FROM customer 
      WHERE Branch_idBranch = ? AND companyName IS NOT NULL AND companyName != ''
      ORDER BY companyName ASC
    `;

    db.query(sql, [Branch_idBranch], (err, results) => {
      if (err) {
        console.error("Error fetching distinct companies:", err);
        return res
          .status(500)
          .json({
            success: false,
            message: "Failed to fetch companies",
            error: err.message,
          });
      }

      const companies = results.map((row) => row.companyName);
      res.json({ success: true, data: companies });
    });
  } catch (err) {
    console.error("Unexpected error fetching distinct companies:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

const applyPendingCustomerUpdate = async (idCustomer, pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[CUSTOMER] No pending updates found for customer #${idCustomer}`);
    return;
  }

  const {
    customerData = {},
    customer_branches = [],
    customFields = [],
    imageName = null,
    User_idUser = 1,
    Branch_idBranch = 1,
  } = pendingUpdates;

  const {
    Title, First_Name, middleName, lastName, displayName,
    companyName, companyEmail, phoneNumber, mobileNumber, fax, other,
    website, gstNo, vatNo, billingAddress1, billingAddress2, billingAddress3,
    billingCity, billingProvince, billingCountry, shippingAddress1,
    shippingAddress2, shippingAddress3, shippingCity, shippingProvince,
    shippingPostalCode, shippingCountry, officialPhone, officialEmail,
    agentId, credit_limit, credit_period
  } = customerData;

  return new Promise((resolve, reject) => {
    db.getConnection(async (connErr, connection) => {
      if (connErr) return reject(connErr);

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          return reject(beginErr);
        }

        try {
          // 1. Update core customer data
          await dbService.updateCustomer(
            idCustomer, Title, First_Name, middleName, lastName, displayName, Branch_idBranch,
            companyName, companyEmail, phoneNumber, mobileNumber, fax, other,
            website, gstNo, vatNo, billingAddress1, billingAddress2, billingAddress3,
            billingCity, billingProvince, billingCountry, shippingAddress1,
            shippingAddress2, shippingAddress3, shippingCity, shippingProvince,
            shippingPostalCode, shippingCountry, officialPhone, officialEmail,
            agentId, credit_limit, credit_period, imageName, connection
          );

          // 2. Update or insert customer branches
          for (const branch of customer_branches) {
            if (branch.idCustomer_Branch === 0) {
              await dbService.insertCustomerBranch(
                idCustomer, branch.Branch_Name, branch.Branch_Address, branch.Branch_Contact, connection
              );
            } else {
              await dbService.updateCustomerBranch(
                branch.idCustomer_Branch, idCustomer, branch.Branch_Name, branch.Branch_Address, branch.Branch_Contact, connection
              );
            }
          }

          // 3. Update custom fields
          if (Array.isArray(customFields) && customFields.length > 0) {
            for (const field of customFields) {
              const value = Array.isArray(field.value) ? field.value.join(",") : field.value;
              const updateSql = `UPDATE customer_field_data SET value = ? WHERE customer_id = ? AND field_id = ?`;
              await new Promise((resolveQ, rejectQ) => {
                connection.query(updateSql, [value, idCustomer, field.field_id], (err, result) => {
                  if (err) return rejectQ(err);
                  if (result.affectedRows === 0) {
                    const insertSql = `INSERT INTO customer_field_data (customer_id, field_id, value) VALUES (?, ?, ?)`;
                    connection.query(insertSql, [idCustomer, field.field_id, value], (insertErr, insertResult) => {
                      if (insertErr) return rejectQ(insertErr);
                      resolveQ(insertResult);
                    });
                  } else {
                    resolveQ(result);
                  }
                });
              });
            }
          }

          // 4. Log the update
          await userLogDbService.insertLog(
            User_idUser, currentDate(), "Customer", idCustomer, "edit", Branch_idBranch, connection
          );

          // 5. Restore approval_status to ACTIVE
          await new Promise((resQ, rejQ) => {
             connection.query(
               "UPDATE customer SET approval_status = 'ACTIVE' WHERE idCustomer = ?",
               [idCustomer],
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

const applyPendingCustomerCreate = async (pending_updates) => {
  const req = {
    body: pending_updates.req_body,
    params: pending_updates.req_params,
    user: pending_updates.req_user,
    files: pending_updates.req_files,
    is_approved_webhook: true 
  };
  
  const res = {
    status: function() { return this; },
    json: function(data) { console.log("[WEBHOOK] applyPendingCustomerCreate result:", data); return data; },
    send: function(data) { console.log("[WEBHOOK] applyPendingCustomerCreate result:", data); return data; }
  };

  return await createCustomer(req, res);
};

module.exports = {
  createCustomer,
  getCustomer,
  getActiveCustomer,
  deleteCustomer,
  getCustomerById,
  updateCustomerById,
  Customerdelete,
  updateCustomerStatus,
  getCustomersByBranch,
  importExcelCustomers,
  getDistinctBranchCompanies,
  applyPendingCustomerUpdate,
  applyPendingCustomerCreate,
};
