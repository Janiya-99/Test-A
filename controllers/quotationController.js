const dbService = require("../services/quotaionDBService");
const rulesDbService = require("../services/rulesDBService");
const userLogDbService = require("../services/userLogDBService");
const branchDBService = require("../services/branchDBService");
const { currentDate } = require("../utils/currentData");
const { checkPlanLimit } = require("../utils/planLimits");
const approvalService = require("../services/approvalService");
const db = require("../db/db");

const createQuotation = async (req, res) => {
  // APPROVAL ENGINE INTERCEPTOR
  const isBypass = req.headers['x-bypass-approval'] === 'true' || req.body._from_webhook;
  if (!isBypass) {
    try {
      const { Branch_idBranch, User_idUser } = req.body;
      const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch) || 1;
      const approvalNeeded = await approvalService.isApprovalRequired(companyId, Branch_idBranch, 'CREATE_QUOTATION');
      
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'CREATE_QUOTATION',
          module_name: 'Quotation',
          erp_record_id: 'pending_' + Date.now(),
          company_id: companyId,
          branch_id: Branch_idBranch,
          initiated_by: User_idUser || 1,
          payload_summary: { pending_updates: req.body }
        });
        return res.status(202).json({
          message: "Quotation creation submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Create Quotation"
        });
      }
    } catch (e) {
      console.error("Error checking approval for Quotation Creation:", e);
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

      let Quotation_idQuotation = null; // Track ID for rollback

      try {
        const {
          Customer_idCustomer,
          service_job_id,
          estimate_id,
          Date,
          Expire_Date,
          SubTotal,
          Discount_Type,
          Discount,
          Total,
          Note,
          User_idUser,
          Branch_idBranch,
          items,
          Address,
          Extra_Charge,
          Extra_Charge_Label,
          custom_fields_data,
          Is_Multi_Option,
          Options_Data,
        } = req.body;

        // Check plan limits for Free plan
        try {
          const companyId =
            await branchDBService.getCompanyIdByBranch(Branch_idBranch);
          if (companyId) {
            const limitCheck = await checkPlanLimit(
              companyId,
              "quotation",
              Branch_idBranch,
            );
            if (!limitCheck.allowed) {
              connection.release(); // Release connection before returning
              return res.status(403).json({
                success: false,
                limitExceeded: true,
                title: "📋 Free Plan Limit Reached",
                message: `You've reached your ${limitCheck.plan} plan limit of ${limitCheck.limit} quotations for this month.`,
                description: `You have created ${limitCheck.current} out of ${limitCheck.limit} quotations available in Month ${limitCheck.month} of your Free plan.`,
                upgradeMessage:
                  "Want to create unlimited quotations? Upgrade to our Professional plan for unlimited access and premium features!",
                callToAction: "Upgrade to Pro",
                limit: limitCheck.limit,
                current: limitCheck.current,
                remaining: 0,
                plan: limitCheck.plan,
                month: limitCheck.month,
              });
            }
          }
        } catch (limitError) {
          console.error("Error checking quotation limit:", limitError);
          // Continue with quotation creation if limit check fails
        }

        const rules =
          await rulesDbService.getQuotationNumberDetails(Branch_idBranch);

        const letter_part = rules[0].Quotations_No_Start_With;
        const starting_number = rules[0].Quotations_No_Start_From;

        let saved = false;
        let quotation;
        let next_quotation_number = "";

        if (req.body.isQuotationNoEditable && req.body.Quotation_Number) {
          // Double check if manual quotation number already exists
          const existingQuotations = await dbService.checkQuotation(req.body.Quotation_Number, Branch_idBranch);
          if (existingQuotations && existingQuotations.length > 0) {
            connection.rollback(() => {
              connection.release();
              res.status(400).json({
                message: `Quotation number ${req.body.Quotation_Number} already exists.`,
              });
            });
            return;
          }
          next_quotation_number = req.body.Quotation_Number;

          const cfDataJson = custom_fields_data
            ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
            : null;

          const optionsDataJson = Options_Data
            ? (typeof Options_Data === 'string' ? Options_Data : JSON.stringify(Options_Data))
            : null;

          quotation = await dbService.insertQuotation(
            next_quotation_number,
            Customer_idCustomer,
            Date,
            Expire_Date || null,
            SubTotal,
            Discount_Type,
            Discount,
            Total,
            Note,
            Address,
            Branch_idBranch,
            Extra_Charge_Label,
            Extra_Charge,
            items,
            connection,
            cfDataJson,
            Is_Multi_Option || 0,
            optionsDataJson,
          );
        } else {
          let retries = 0;
          const maxRetries = 3;
          while (!saved && retries < maxRetries) {
            try {
              next_quotation_number = `${letter_part}${starting_number}`;

              const last_quotation =
                await dbService.getLastQuotation(Branch_idBranch);

              if (last_quotation.length !== 0) {
                const last_quotation_number = last_quotation[0].Quotation_Number;

                const match = last_quotation_number.match(/\d/);
                if (match) {
                  const digitPosition = match.index;
                  const nonNumericPart = last_quotation_number.slice(
                    0,
                    digitPosition,
                  );
                  const numericPart = parseInt(
                    last_quotation_number.slice(digitPosition),
                  );

                  const nextNumericPart = numericPart + 1;

                  next_quotation_number = `${nonNumericPart}${nextNumericPart}`;
                }
              }
              console.log(Address);
              console.log(Branch_idBranch);

              const cfDataJson = custom_fields_data
                ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
                : null;

              const optionsDataJson = Options_Data
                ? (typeof Options_Data === 'string' ? Options_Data : JSON.stringify(Options_Data))
                : null;

              quotation = await dbService.insertQuotation(
                next_quotation_number,
                Customer_idCustomer,
                Date,
                Expire_Date || null, // Handle optional Expire_Date
                SubTotal,
                Discount_Type,
                Discount,
                Total,
                Note,
                Address,
                Branch_idBranch,
                Extra_Charge_Label,
                Extra_Charge,
                items,
                connection, // 🆕
                cfDataJson,
                Is_Multi_Option || 0,
                optionsDataJson,
              );
              saved = true;
            } catch (err) {
              if (err.code === "ER_DUP_ENTRY") {
                retries++;
                console.warn(
                  `Duplicate Quotation Number detected. Retrying... (${retries}/${maxRetries})`,
                );
                if (retries === maxRetries)
                  throw new Error(
                    "Failed to generate unique Quotation Number after multiple attempts.",
                  );
              } else {
                throw err;
              }
            }
          }
        }

        Quotation_idQuotation = quotation.insertId;

        if (service_job_id) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE service_jobs SET status = 'Completed', quotation_id = ? WHERE id = ?",
              [Quotation_idQuotation, service_job_id],
              (err) => {
                if (err) return reject(err);
                resolve();
              }
            );
          });
        }

        if (estimate_id) {
          await new Promise((resolve, reject) => {
            connection.query(
              "SELECT id, parent_estimate_id FROM estimates WHERE id = ?",
              [estimate_id],
              (err, results) => {
                if (err) return reject(err);
                if (results.length === 0) return resolve();
                
                const rootParentId = results[0].parent_estimate_id || results[0].id;
                
                connection.query(
                  "UPDATE estimates SET status = 'Completed', quotation_no = ? WHERE id = ? OR parent_estimate_id = ?",
                  [next_quotation_number, rootParentId, rootParentId],
                  (err2) => {
                    if (err2) return reject(err2);
                    resolve();
                  }
                );
              }
            );
          });
        }

        if (!Is_Multi_Option && items && items.length > 0) {
          try {
            await Promise.all(
              items.map(async (item) => {
                const itemResult = await dbService.insertQuotationItem(
                  Quotation_idQuotation,
                  item.Item_idItem,
                  item.Rate,
                  item.Qty_Type,
                  item.Qty,
                  item.Amount,
                  item.Discount_Type,
                  item.Discount,
                  item.Total_Amount,
                  item.Long_Description,
                  Branch_idBranch,
                  item.Variation_Id, // ✅ Pass Variation_Id from frontend
                  connection, // 🆕
                  item.is_material_issue || 0,
                  item.issue_item_id || null,
                  item.issue_note_id || null,
                );

                if (item.Item_idItem <= 0 && (item.manual_supplier_name || item.manual_cost)) {
                  const insertedItemId = itemResult.insertId;
                  const manualSql = `
                    INSERT INTO quotation_has_item_manual_details (quotation_has_item_id, Branch_idBranch, supplier_name, cost)
                    VALUES (?, ?, ?, ?)
                  `;
                  await new Promise((resolve, reject) => {
                    connection.query(
                      manualSql,
                      [insertedItemId, Branch_idBranch, item.manual_supplier_name || null, item.manual_cost || null],
                      (err) => (err ? reject(err) : resolve())
                    );
                  });
                }
              }),
            );
          } catch (itemError) {
            console.error(
              "Error inserting items, performing rollback...",
              itemError,
            );
            // Rollback handled by main catch block
            throw new Error(`Failed to save items: ${itemError.message}`);
          }
        }

        // Non-fatal logging
        try {
          await userLogDbService.insertLog(
            User_idUser,
            currentDate(),
            "Quotation",
            Quotation_idQuotation,
            "create",
            Branch_idBranch,
            connection, // 🆕
          );
        } catch (logError) {
          console.error(
            "Failed to create user log, but quotation was saved.",
            logError,
          );
          // Do not throw, allow success response
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
            return;
          }

          connection.release();
          
          // Trigger SMS Notifications
          try {
            const customerDb = require("../services/customerDBService");
            const smsService = require("../services/smsService");
            
            customerDb.fetchCustomerById(Customer_idCustomer)
              .then(async (customerList) => {
                if (customerList && customerList.length > 0) {
                  const customer = customerList[0];
                  const recipientPhone = customer.phoneNumber || customer.Tp;
                  const customerName = `${customer.First_Name || ""} ${customer.lastName || ""}`.trim() || customer.displayName;
                  
                  // Compute dynamic quotation public URL
                  const origin = req.headers.origin || "https://invoice.asipbook.com";
                  const publicUrl = `${origin}/public/quotation/${Quotation_idQuotation}`;
                  
                  const smsData = {
                    name: customerName,
                    quotation_no: next_quotation_number,
                    amount: parseFloat(Total).toFixed(2),
                    url: publicUrl,
                    date: Date || new Date().toISOString().split("T")[0],
                  };

                  // Trigger Event 2: Quotation Generation
                  await smsService.triggerSMSNotification(Branch_idBranch, "quotation_generation", recipientPhone, smsData, User_idUser);

                  // Trigger Event 11: Service job converted to quotation (if service_job_id is present)
                  if (service_job_id) {
                    const dbQuery = require("../db/db");
                    dbQuery.query("SELECT job_no FROM service_jobs WHERE id = ?", [service_job_id], async (sjErr, sjResults) => {
                      if (!sjErr && sjResults && sjResults.length > 0) {
                        const convertedData = {
                          ...smsData,
                          job_no: sjResults[0].job_no,
                        };
                        await smsService.triggerSMSNotification(Branch_idBranch, "service_job_converted", recipientPhone, convertedData, User_idUser);
                      }
                    });
                  }
                }
              })
              .catch(err => console.error("[SMS-Trigger] Error fetching customer for SMS:", err));
          } catch (smsErr) {
            console.error("[SMS-Trigger] Error triggering SMS notification:", smsErr);
          }

          // Notify CRM if dealId is provided
          const dealIdParam = req.body.deal_id || req.body.dealId;
          if (dealIdParam) {
            try {
              const { notifyCrmDocumentCreated } = require("../services/crmWebhookService");
              const origin = req.headers.origin || "http://localhost:3000";
              notifyCrmDocumentCreated({
                type: "QUOTATION",
                asipBookDocumentId: Quotation_idQuotation,
                documentNumber: next_quotation_number,
                amount: parseFloat(Total) || 0,
                currency: "LKR",
                status: "active",
                dealId: dealIdParam,
                branchId: Branch_idBranch,
                documentDate: Date || new Date().toISOString().split("T")[0],
                viewUrl: `${origin}/quotation/view/${Quotation_idQuotation}`,
              });
            } catch (notifyErr) {
              console.warn("[CRM Webhook] Error calling notifyCrmDocumentCreated:", notifyErr);
            }
          }

          res.json({
            message: "Quotation added successfully",
            quotation_id: Quotation_idQuotation,
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Create Quotation Error:", err);
          res
            .status(500)
            .json({ message: "Error creating quotation", error: err.message });
        });
      }
    });
  });
};

const updateQuotation = async (req, res) => {
  // APPROVAL ENGINE INTERCEPTOR
  const isBypass = req.headers['x-bypass-approval'] === 'true' || req.body._from_webhook;
  if (!isBypass) {
    try {
      const { Branch_idBranch, User_idUser } = req.body;
      const { id } = req.params;
      const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch) || 1;
      const approvalNeeded = await approvalService.isApprovalRequired(companyId, Branch_idBranch, 'EDIT_QUOTATION');
      
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'EDIT_QUOTATION',
          module_name: 'Quotation',
          erp_record_id: id,
          company_id: companyId,
          branch_id: Branch_idBranch,
          initiated_by: User_idUser || 1,
          payload_summary: { pending_updates: req.body }
        });
        return res.status(202).json({
          message: "Quotation update submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Edit Quotation"
        });
      }
    } catch (e) {
      console.error("Error checking approval for Quotation Update:", e);
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
        const {
          Customer_idCustomer,
          Date,
          Expire_Date,
          SubTotal,
          Discount_Type,
          Discount,
          Total,
          Note,
          User_idUser,
          Branch_idBranch,
          items,
          Extra_Charge,
          Extra_Charge_Label,
          Address,
          custom_fields_data,
          Is_Multi_Option,
          Options_Data,
        } = req.body;

        const { idQuotation } = req.params;

        const cfDataJson = custom_fields_data
          ? (typeof custom_fields_data === 'string' ? custom_fields_data : JSON.stringify(custom_fields_data))
          : null;

        const optionsDataJson = Options_Data
          ? (typeof Options_Data === 'string' ? Options_Data : JSON.stringify(Options_Data))
          : null;

        await dbService.updateQuotation(
          Customer_idCustomer,
          Date,
          Expire_Date || null,
          SubTotal,
          Discount_Type,
          Discount,
          Total,
          Note,
          Extra_Charge_Label,
          Extra_Charge,
          Address,
          idQuotation,
          connection, // 🆕
          cfDataJson,
          Is_Multi_Option || 0,
          optionsDataJson,
        );

        const Quotation_idQuotation = idQuotation;

        if (!Is_Multi_Option) {
          await dbService.deleteQuotationItems(Quotation_idQuotation, connection); // 🆕

          if (items && items.length > 0) {
            await Promise.all(
              items.map(async (item) => {
                const itemResult = await dbService.insertQuotationItem(
                  idQuotation,
                  item.Item_idItem,
                  item.Rate,
                  item.Qty_Type,
                  item.Qty,
                  item.Amount,
                  item.Discount_Type,
                  item.Discount,
                  item.Total_Amount,
                  item.Long_Description, // ✅ Added Long_Description
                  Branch_idBranch,
                  item.Variation_Id, // ✅ Pass Variation_Id from frontend
                  connection, // 🆕
                  item.is_material_issue || 0,
                  item.issue_item_id || null,
                  item.issue_note_id || null,
                );

                if (item.Item_idItem <= 0 && (item.manual_supplier_name || item.manual_cost)) {
                  const insertedItemId = itemResult.insertId;
                  const manualSql = `
                    INSERT INTO quotation_has_item_manual_details (quotation_has_item_id, Branch_idBranch, supplier_name, cost)
                    VALUES (?, ?, ?, ?)
                  `;
                  await new Promise((resolve, reject) => {
                    connection.query(
                      manualSql,
                      [insertedItemId, Branch_idBranch, item.manual_supplier_name || null, item.manual_cost || null],
                      (err) => (err ? reject(err) : resolve())
                    );
                  });
                }
              }),
            );
          }
        }

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Quotation",
          Quotation_idQuotation,
          "edit",
          Branch_idBranch,
          connection, // 🆕
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
            return;
          }

          connection.release();
          res.json({
            message: "Quotation updated successfully",
            quotation_id: Quotation_idQuotation,
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating quotation:", err);
          res
            .status(500)
            .json({ message: "Error updating quotation", error: err.message });
        });
      }
    });
  });
};

const getNextQuotationId = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    // 🔍 DEBUG
    console.log(
      `[GET-NEXT-QUOTATION-ID] Request received for Branch ID: ${Branch_idBranch}`,
    );

    const rules =
      await rulesDbService.getQuotationNumberDetails(Branch_idBranch);

    if (!rules || rules.length === 0) {
      console.error(
        `[GET-NEXT-QUOTATION-ID] ❌ No quotation number rules found for branch ${Branch_idBranch}`,
      );
      throw new Error("Quotation number rules not found");
    }

    const letter_part = rules[0].Quotations_No_Start_With;
    const starting_number = rules[0].Quotations_No_Start_From;

    let next_quotation_number = `${letter_part}${starting_number}`;

    const last_quotation = await dbService.getLastQuotation(Branch_idBranch);

    if (last_quotation.length !== 0) {
      const last_quotation_number = last_quotation[0].Quotation_Number;

      const match = last_quotation_number.match(/\d/);
      if (match) {
        const digitPosition = match.index;
        const nonNumericPart = last_quotation_number.slice(0, digitPosition);
        const numericPart = parseInt(
          last_quotation_number.slice(digitPosition),
        );

        const nextNumericPart = numericPart + 1;

        next_quotation_number = `${nonNumericPart}${nextNumericPart}`;
      }
    }

    console.log(
      `[GET-NEXT-QUOTATION-ID] ✅ Generated Next Quotation Number: ${next_quotation_number}`,
    );
    res.json(next_quotation_number);
  } catch (err) {
    console.error(
      `[GET-NEXT-QUOTATION-ID] ❌ Error generating quotation number:`,
      err,
    );
    res
      .status(500)
      .json({ message: "Error getting quotation number", error: err.message });
  }
};

const checkQuotation = async (req, res) => {
  try {
    const { quotation_id, Branch_idBranch } = req.params;
    const quotations = await dbService.checkQuotation(quotation_id, Branch_idBranch);

    if (quotations?.length !== 0) {
      return res.status(201).json({ message: "Quotation number already exists." });
    } else {
      return res.status(200).json({ message: "Quotation number is available." });
    }
  } catch (err) {
    res.status(500).json({
      message: "Error fetching quotations",
      error: err.message,
    });
  }
};

const getAllQuotations = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const {
      page = 1,
      pageSize = 10,
      search = "",
      dateFrom,
      dateTo,
      status,
      customerId,
    } = req.query;

    const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
    const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];
    let scopedUserId = null;
    if (currentUserId) {
      try {
        const userScope = await branchDBService.getUserDataScope(currentUserId, Branch_idBranch, currentUserRole);
        if (userScope.isRestricted) {
          scopedUserId = currentUserId;
        }
      } catch (scopeErr) {
        console.error("Error checking user scope for quotations:", scopeErr);
      }
    }

    const { data, total } = await dbService.fetchQuotations(
      Branch_idBranch,
      parseInt(page),
      parseInt(pageSize),
      search,
      dateFrom,
      dateTo,
      status,
      customerId,
      scopedUserId,
    );

    res.json({
      data,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      totalPages: Math.ceil(total / parseInt(pageSize)),
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching quotations",
      error: err.message,
    });
  }
};

const getQuotationById = async (req, res) => {
  try {
    const { idQuotation } = req.params;

    const quotation = await dbService.fetchQuotation(idQuotation);
    if (quotation.length === 0) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    const items = await dbService.fetchQuotationItems(idQuotation);
    if (items.length === 0 && quotation[0].Is_Multi_Option !== 1) {
      return res.status(404).json({ message: "Quotation items not found" });
    }

    // Parse custom_fields_data JSON
    try {
      quotation[0].custom_fields_data = quotation[0].custom_fields_data
        ? (typeof quotation[0].custom_fields_data === 'string' ? JSON.parse(quotation[0].custom_fields_data) : quotation[0].custom_fields_data)
        : {};
    } catch(_) { quotation[0].custom_fields_data = {}; }

    // Map customer fields to expected format for print component
    const mappedQuotation = {
      ...quotation[0],
      Name: quotation[0].displayName,
      Email: quotation[0].companyEmail || quotation[0].Email,
      Tp: quotation[0].mobileNumber || quotation[0].phoneNumber,
    };

    res.json({
      quotation: mappedQuotation,
      items: items,
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching quotations",
      error: err.message,
    });
  }
};

const quotationDelete = async (req, res) => {
  // APPROVAL ENGINE INTERCEPTOR
  const isBypass = req.headers['x-bypass-approval'] === 'true' || req.body._from_webhook;
  if (!isBypass) {
    try {
      const { Branch_idBranch, User_idUser } = req.body;
      const { idQuotation } = req.params;
      const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch) || 1;
      const approvalNeeded = await approvalService.isApprovalRequired(companyId, Branch_idBranch, 'DELETE_QUOTATION');
      
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'DELETE_QUOTATION',
          module_name: 'Quotation',
          erp_record_id: idQuotation,
          company_id: companyId,
          branch_id: Branch_idBranch,
          initiated_by: User_idUser || 1,
          payload_summary: { pending_updates: req.body }
        });
        return res.status(202).json({
          message: "Quotation deletion submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Delete Quotation"
        });
      }
    } catch (e) {
      console.error("Error checking approval for Quotation Delete:", e);
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
        const { idQuotation } = req.params;
        const { User_idUser, Branch_idBranch } = req.body;

        await dbService.deleteQuotationItems(idQuotation, connection); // 🆕
        await dbService.deleteQuotation(idQuotation, connection); // 🆕

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Quotation",
          idQuotation,
          "delete",
          Branch_idBranch,
          connection, // 🆕
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
          res.json({
            message: "Quotation deleted successfully",
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            message: "Error deleting quotations",
            error: err.message,
          });
        });
      }
    });
  });
};

const getQuotationByCustomerId = async (req, res) => {
  try {
    const { Customer_idCustomer } = req.params;

    const quotations =
      await dbService.fetchQuotationByCustomerId(Customer_idCustomer);
    if (quotations.length === 0) {
      return res.status(404).json({ message: "Quotations not found" });
    }
    res.json(quotations);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching quotations",
      error: err.message,
    });
  }
};

const getPublicQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const quotation = await dbService.fetchQuotation(id);
    if (!quotation || quotation.length === 0) {
      return res.status(404).json({ message: "Quotation not found" });
    }
    res.json({
      success: true,
      quotation: quotation[0]
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching public quotation",
      error: err.message,
    });
  }
};

const selectPublicQuotationOption = async (req, res) => {
  const { id } = req.params;
  const { optionId } = req.body;

  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        await dbService.finalizeQuotationOption(id, optionId, connection);

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit option selection" });
            });
          }
          connection.release();
          res.json({
            success: true,
            message: "Option selected and quotation finalized successfully"
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            message: "Error selecting option",
            error: err.message
          });
        });
      }
    });
  });
};

const selectManualQuotationOption = async (req, res) => {
  const { id } = req.params;
  const { optionId } = req.body;

  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        await dbService.finalizeQuotationOption(id, optionId, connection);

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit option selection" });
            });
          }
          connection.release();
          res.json({
            success: true,
            message: "Option selected manually and quotation finalized successfully"
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            message: "Error selecting option",
            error: err.message
          });
        });
      }
    });
  });
};

module.exports = {
  createQuotation,
  getNextQuotationId,
  getAllQuotations,
  getQuotationById,
  quotationDelete,
  getQuotationByCustomerId,
  updateQuotation,
  checkQuotation,
  getPublicQuotation,
  selectPublicQuotationOption,
  selectManualQuotationOption,
};
