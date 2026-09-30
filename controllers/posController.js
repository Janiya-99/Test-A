const db = require("../db/db");
const db2 = require("../db/db2");
const dbService = require("../services/posDBService");
const invoiceDBService = require("../services/invoiceDBService");
const customerDBService = require("../services/customerDBService");
const employeeDbService = require("../services/employeeDBService");
const userLogDbService = require("../services/userLogDBService");
const itemDbService = require("../services/productDBService");
const { productHistoryLogHelper } = itemDbService;
const branchDBService = require("../services/branchDBService");
const stockCardDbService = require("../services/stockCardDBService");
const rulesDbService = require("../services/rulesDBService");
const customerLogDbService = require("../services/customerCreditLogDBService");
const installmentLogDbService = require("../services/installmentDBService");
const bankAccountDBService = require("../services/bankAccountDBService");
const bankAccountLogDBService = require("../services/bankAccountLogDBService");
const quotationDbService = require("../services/quotaionDBService");
const { findAccountByNameAndGroup, creditDebitLogHelper, ensureAccountExists } = require("./accountingController");
const { currentDate, currentDateTime, resolveDateTime } = require("../utils/currentData");
const { checkPlanLimit } = require("../utils/planLimits");
const approvalService = require("../services/approvalService");


const formatDate = (iso) => {
  if (!iso) return null;
  return iso.replace("T", " ").replace("Z", "").split(".")[0];
};

const generateAdvancedInvoiceNumber = (format, sequenceNumber, businessName) => {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  
  const monthNamesMMM = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthMMM = monthNamesMMM[now.getMonth()];

  const bizShort = (businessName || "ASIP").replace(/\s+/g, "").substring(0, 4).toUpperCase();

  let result = format || "";
  result = result.replace(/YYYY/g, yyyy);
  result = result.replace(/YY/g, yy);
  result = result.replace(/MMMM/g, monthMMM);
  result = result.replace(/MMM/g, monthMMM);
  result = result.replace(/MM/g, mm);
  result = result.replace(/DD/g, dd);
  result = result.replace(/QQQQ/g, bizShort);

  const matchX = result.match(/X+/);
  if (matchX) {
    const xLength = matchX[0].length;
    const paddedSeq = String(sequenceNumber).padStart(xLength, "0");
    result = result.replace(/X+/, paddedSeq);
  } else {
    result = result + sequenceNumber;
  }
  return result;
};

const createCustomer = async (req, res) => {
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
          Title,
          First_Name,
          lastName,
          Name,
          Tp,
          Email,
          NIC,
          Birthday,
          Address1,
          Address2,
          Address3,
          Company,
          Company_Contact,
          Branch_idBranch,
          User_idUser,
          VAT,
          GST,
          City,
          State,
          branches,
        } = req.body;

        const check = await customerDBService.checkCustomerExist(
          Tp,
          Branch_idBranch,
          connection,
        );

        if (check.length > 0) {
          connection.rollback(() => connection.release());
          res.status(409).json({ message: "Customer already exist" });
          return;
        }

        const customer = await customerDBService.insertCustomer(
          Title, // 1
          First_Name, // 2
          "", // middleName (3)
          lastName || "", // lastName (4)
          Name, // displayName (5)
          Company, // companyName (6)
          Email, // companyEmail (7)
          Tp, // phoneNumber (8)
          "", // mobileNumber (9)
          "", // fax (10)
          [
            NIC ? `NIC: ${NIC}` : '',
            Birthday ? `Birthday: ${Birthday}` : '',
            Company_Contact ? `Contact: ${Company_Contact}` : ''
          ].filter(Boolean).join(', ') || "", // other (11)
          "", // website (12)
          GST, // gstNo (13)
          VAT, // vatNo (14)
          Address1, // billingAddress1 (15)
          Address2, // billingAddress2 (16)
          Address3, // billingAddress3 (17)
          City, // billingCity (18)
          State, // billingProvince (19)
          "", // billingCountry (20)
          Address1, // shippingAddress1 (21)
          Address2, // shippingAddress2 (22)
          Address3, // shippingAddress3 (23)
          City, // shippingCity (24)
          State, // shippingProvince (25)
          "", // shippingPostalCode (26)
          "", // shippingCountry (27)
          Branch_idBranch, // branchId (28)
          null, // agentId (29)
          0, // creditLimit (30)
          connection, // (31)
        );

        const customer_id = customer.insertId;

        await Promise.all(
          (branches || []).map(async (customer_branch) => {
            await customerDBService.insertCustomerBranch(
              customer_id,
              customer_branch.Branch_Name,
              customer_branch.Branch_Address,
              customer_branch.Branch_Contact,
              connection,
            );
          }),
        );

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Customer",
          customer_id,
          "pos-create",
          Branch_idBranch,
          connection,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
            return;
          }

          connection.release();
          try {
            const smsService = require("../services/smsService");
            smsService.triggerSMSNotification(
              Branch_idBranch,
              "customer_add",
              Tp,
              {
                name: `${First_Name || ""} ${lastName || ""}`.trim() || Name,
                date: new Date().toISOString().split("T")[0]
              },
              User_idUser || req.user?.id || req.user?.userId || null
            );
          } catch (smsErr) {
            console.error("[SMS-Trigger] POS Customer add SMS failed:", smsErr);
          }
          res.status(200).json({ message: "Customer added successfully", idCustomer: customer_id });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res
            .status(500)
            .json({ message: "Error creating customer", error: err.message });
        });
      }
    });
  });
};

const getCustomers = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { salesmanId } = req.query;
    const customers = await dbService.fetchCustomer(Branch_idBranch, salesmanId || null);
    res.status(200).json({ data: customers });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching customer", error: err.message });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const { idCustomer } = req.params;
    const customer = await customerDBService.fetchCustomerById(idCustomer);

    if (customer.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customer_branches =
      await customerDBService.getCustomerbranches(idCustomer);

    const cus_obj = {
      ...customer,
      customer_branches,
    };

    res.json(cus_obj);
  } catch (err) {
    console.error("Error fetching customer by ID:", err);
    res
      .status(500)
      .json({ message: "Error fetching customer by ID", error: err.message });
  }
};

const updateCustomerById = async (req, res) => {
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
        const { idCustomer } = req.params;
        const {
          Title,
          First_Name,
          Name,
          Tp,
          Email,
          NIC,
          Birthday,
          Address1,
          Address2,
          Address3,
          Company,
          Company_Contact,
          Branch_idBranch,
          City,
          VAT,
          GST,
          State,
          User_idUser,
          customer_branches,
        } = req.body;

        await customerDBService.updateCustomer(
          idCustomer, // 1
          Title, // 2
          First_Name, // 3
          "", // middleName (4)
          "", // lastName (5)
          Name, // displayName (6)
          Branch_idBranch, // Branch_idBranch (7)
          Company, // companyName (8)
          Email, // companyEmail (9)
          Tp, // phoneNumber (10)
          "", // mobileNumber (11)
          "", // fax (12)
          `NIC: ${NIC || ""}, Birthday: ${Birthday || ""}, Contact: ${Company_Contact || ""}`, // other (13)
          "", // website (14)
          GST, // gstNo (15)
          VAT, // vatNo (16)
          Address1, // billingAddress1 (17)
          Address2, // billingAddress2 (18)
          Address3, // billingAddress3 (19)
          City, // billingCity (20)
          State, // billingProvince (21)
          "", // billingCountry (22)
          Address1, // shippingAddress1 (23)
          Address2, // shippingAddress2 (24)
          Address3, // shippingAddress3 (25)
          City, // shippingCity (26)
          State, // shippingProvince (27)
          "", // shippingPostalCode (28)
          "", // shippingCountry (29)
          "", // officialPhone (30)
          "", // officialEmail (31)
          null, // agentId (32)
          0, // creditLimit (33)
          null, // imageName (34)
          connection, // (35)
        );

        await Promise.all(
          (customer_branches || []).map(async (customer_branch) => {
            if (customer_branch.idCustomer_Branch === 0) {
              await customerDBService.insertCustomerBranch(
                idCustomer,
                customer_branch.Branch_Name,
                customer_branch.Branch_Address,
                customer_branch.Branch_Contact,
                connection,
              );
            } else {
              await customerDBService.updateCustomerBranch(
                customer_branch.idCustomer_Branch,
                idCustomer,
                customer_branch.Branch_Name,
                customer_branch.Branch_Address,
                customer_branch.Branch_Contact,
                connection,
              );
            }
          }),
        );

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Customer",
          idCustomer,
          "pos-edit",
          Branch_idBranch,
          connection,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
            return;
          }

          connection.release();
          res.json({ message: "Customer updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating customer:", err);
          res
            .status(500)
            .json({ message: "Error updating customer", error: err.message });
        });
      }
    });
  });
};

const getItems = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { page, limit, search, category } = req.query;

    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20; // Default to 20 for POS grid
      const offset = (pageNum - 1) * limitNum;

      const result = await dbService.fetchItemsPaginated(
        Branch_idBranch,
        limitNum,
        offset,
        search,
        category,
      );

      return res.status(200).json({
        data: result.items,
        total: result.total,
        page: pageNum,
        totalPages: Math.ceil(result.total / limitNum),
      });
    }

    // Fallback to fetching all items if no pagination params provided (backward compatibility)
    const items = await dbService.fetchItems(Branch_idBranch);
    res.status(200).json({ data: items });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching items", error: err.message });
  }
};

const getItemById = async (req, res) => {
  try {
    const { idItem } = req.params;

    const item = await dbService.getItemById(idItem);

    // Check if item exists
    if (!item || item.length === 0) {
      console.error(`Item not found: ${idItem}`);
      return res.status(404).json({ message: "Item not found" });
    }

    const item_serials = await dbService.getItemSerialNumbers(idItem);

    // Fetch variations for the item using the correct function name
    const variations = await itemDbService.fetchProductVariations(idItem);

    const data = {
      item: {
        ...item[0],
        variations: variations || [], // Add variations to the item object
      },
      item_serials,
    };

    res.status(200).json({ data });
  } catch (err) {
    console.error("Error in getItemById:", err);
    res
      .status(500)
      .json({ message: "Error fetching items", error: err.message });
  }
};

const getItemByBarcode = async (req, res) => {
  try {
    const { barcode, branchId } = req.params;

    const item = await dbService.findItemByBarcode(barcode, branchId);

    if (!item) {
      return res.status(404).json({ message: "No product found with this barcode" });
    }

    const item_serials = await dbService.getItemSerialNumbers(item.idItem);
    const variations = await itemDbService.fetchProductVariations(item.idItem);

    const data = {
      item: {
        ...item,
        variations: variations || [],
      },
      item_serials,
    };

    res.status(200).json({ data });
  } catch (err) {
    console.error("Error in getItemByBarcode:", err);
    res
      .status(500)
      .json({ message: "Error looking up barcode", error: err.message });
  }
};

const createPos = async (req, res) => {
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
          idPos,
          Date_Time,
          Employee_idEmployee,
          Total_Item_Count,
          Total,
          Discount_Type,
          Discount_Percentage,
          Discount_Amount,
          Tax,
          Tax_Amount,
          Net_Amount,
          Paid_Amount,
          Balance_Amount,
          Payment_Type,
          Cash_Payment,
          Card_Payment,
          Status, // 1 = Completed/Active, 2 = Suspended
          Branch_idBranch,
          items,
          User_idUser,
          Payment_Note,
          Extra_Charge,
          Extra_Charge_Label,
          custom_fields_data,
          Bank_Account_Id,
          Payment_Method,
          Warehouse_Id,
          gift_voucher_code,
          gift_voucher_codes,
          gift_voucher_amount,
          applied_vouchers,
          invoiced_voucher_ids,
          redeemed_loyalty_points,
          loyalty_discount_amount,
          loyalty_redemption_token,
        } = req.body;

        const sriLankaDateTime = resolveDateTime(Date_Time);

        const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);

        // Proactive Staging for POS
        if (!req.is_approved_webhook) {
          try {
            let actionToApprove = null;

            // 1. Check POS Discount
            if (parseFloat(Discount_Amount) > 0 || parseFloat(Discount_Percentage) > 0) {
              if (await approvalService.isApprovalRequired(companyId, Branch_idBranch, 'POS_APPLY_DISCOUNT')) {
                actionToApprove = 'POS_APPLY_DISCOUNT';
              }
            }

            // 2. Check POS Cheque Payment
            if (!actionToApprove && Payment_Type === "Cheque") {
              if (await approvalService.isApprovalRequired(companyId, Branch_idBranch, 'POS_ACCEPT_CHEQUE')) {
                actionToApprove = 'POS_ACCEPT_CHEQUE';
              }
            }

            if (actionToApprove) {
              await approvalService.triggerApprovalRequest({
                action_type: actionToApprove,
                module_name: 'POS',
                erp_record_id: null,
                company_id: companyId,
                branch_id: Branch_idBranch,
                initiated_by: User_idUser || Employee_idEmployee,
                payload_summary: JSON.stringify({
                  Total, Net_Amount, Customer_idCustomer,
                  pending_updates: {
                     req_body: req.body,
                     req_params: req.params,
                     req_user: req.user
                  }
                })
              });
              connection.rollback(() => connection.release());
              return res.status(202).json({
                message: `${actionToApprove.replace(/_/g, ' ')} submitted for approval. It will take effect once approved.`,
                approval_required: true,
                requires_approval: true,
                approval_name: actionToApprove.replace(/_/g, ' ')
              });
            }
          } catch (err) {
            console.error("Approval Check Error:", err);
            return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
          }
        }


        // Check plan limits for Free plan (only for completed transactions)
        if (Status === 1) {
          try {
            console.log(
              `[POS] Checking plan limits for Status=1, Branch=${Branch_idBranch}`,
            );
            console.log(`[POS] Company ID retrieved: ${companyId}`);

            if (companyId) {
              const limitCheck = await checkPlanLimit(
                companyId,
                "pos",
                Branch_idBranch,
              );
              console.log(`[POS] Limit check result:`, limitCheck);

              if (!limitCheck.allowed) {
                console.log(`[POS] BLOCKING POS creation - limit exceeded`);
                connection.rollback(() => connection.release());
                return res.status(403).json({
                  success: false,
                  limitExceeded: true,
                  title: "🛒 Free Plan Limit Reached",
                  message: `You've reached your ${limitCheck.plan} plan limit of ${limitCheck.limit} sales for this month.`,
                  description: `You have completed ${limitCheck.current} out of ${limitCheck.limit} sales available in Month ${limitCheck.month} of your Free plan.`,
                  upgradeMessage:
                    "Want to process unlimited sales? Upgrade to our Professional plan for unlimited transactions and premium features!",
                  callToAction: "Upgrade to Pro",
                  limit: limitCheck.limit,
                  current: limitCheck.current,
                  remaining: 0,
                  plan: limitCheck.plan,
                  month: limitCheck.month,
                });
              }
              console.log(
                `[POS] ALLOWING POS creation - ${limitCheck.remaining} remaining`,
              );
            } else {
              console.log(`[POS] No company ID found, skipping limit check`);
            }
          } catch (limitError) {
            console.error("Error checking POS limit:", limitError);
            // Continue with POS creation if limit check fails
          }
        } else {
          console.log(
            `[POS] Status=${Status}, skipping limit check (only checking Status=1)`,
          );
        }

        let pos = null;
        if (idPos !== 0) {
          pos = idPos;

          await dbService.updatePos(
            idPos,
            Customer_idCustomer,
            sriLankaDateTime,
            Employee_idEmployee,
            Total_Item_Count,
            Total,
            Discount_Type,
            Discount_Percentage,
            Discount_Amount,
            Tax,
            Tax_Amount,
            Net_Amount,
            Paid_Amount,
            Balance_Amount,
            Payment_Type,
            Cash_Payment,
            Card_Payment,
            Status,
            Branch_idBranch,
            parseFloat(Extra_Charge || 0),
            Extra_Charge_Label || "Extra Charge",
            connection,
          );

          // clear existing items before re-inserting
          await dbService.deletePosItemsByPosId(idPos, connection);
        } else {
          pos = await dbService.insertPos(
            Customer_idCustomer,
            sriLankaDateTime,
            Employee_idEmployee,
            Total_Item_Count,
            Total,
            Discount_Type,
            Discount_Percentage,
            Discount_Amount,
            Tax,
            Tax_Amount,
            Net_Amount,
            Paid_Amount,
            Balance_Amount,
            Payment_Type,
            Cash_Payment,
            Card_Payment,
            Status,
            Branch_idBranch,
            parseFloat(Extra_Charge || 0),
            Extra_Charge_Label || "Extra Charge",
            connection,
          );
        }

        const pos_id = pos;

        // 1. Insert Items into POS Items (always happens for both Draft and Completed)
        await Promise.all(
          (items || []).map(async (posItem) => {
            let serial_discount_percentage = 0;
            let serial_discount_amount = 0;

            if (
              (posItem.Item_Has_Serial === 1 || posItem.Serial_No === 1) &&
              posItem.SelectedSerials?.length > 0
            ) {
              if (posItem.Discount_Type === 1) {
                serial_discount_percentage =
                  (posItem.Discount_Percentage || 0) /
                  posItem.SelectedSerials.length;
              } else {
                serial_discount_amount =
                  (posItem.Discount_Amount || 0) /
                  posItem.SelectedSerials.length;
              }

              // Insert each serial as a POS item line
              await Promise.all(
                posItem.SelectedSerials.map(async (serial_number) => {
                  let serial_no_id = 0;
                  const serial_item = await dbService.selectSerials(
                    serial_number.Serial_No,
                  );

                  if (serial_item) {
                    serial_no_id = serial_item.ID;
                  } else {
                    // Does not exist, insert it into item_has_serial_no as Qty = 1 (available) for Draft/Suspended
                    const insertSerial = await invoiceDBService.insertSerialNumbers(
                      0,
                      posItem.Item_idItem,
                      1, // unsold / available
                      serial_number.Serial_No,
                      Branch_idBranch,
                      connection,
                      posItem.Variation_Id || null,
                    );
                    serial_no_id = insertSerial.insertId;
                  }

                  await dbService.insertPosItem(
                    pos_id,
                    posItem.Item_idItem,
                    1, // Item_Has_Serial
                    serial_no_id,
                    serial_number.Serial_No,
                    posItem.Qty,
                    posItem.Rate,
                    posItem.Amount,
                    posItem.Discount_Type,
                    serial_discount_percentage,
                    serial_discount_amount,
                    posItem.Net_Amount,
                    Branch_idBranch,
                    posItem.Variation_Id || null, // Added Variation_Id
                    connection,
                  );
                }),
              );
            } else {
              // NON-SERIAL ITEMS
              await dbService.insertPosItem(
                pos_id,
                !posItem.Item_idItem || posItem.Item_idItem <= 0 ? 0 : posItem.Item_idItem,
                0, // Item_Has_Serial
                0, // Serial_No_Id
                null, // Serial_Number
                posItem.Qty,
                posItem.Rate,
                posItem.Amount,
                posItem.Discount_Type,
                // IMPORTANT: DB columns are Discount_Percentage then Discount_Amount
                posItem.Discount_Percentage || 0,
                posItem.Discount_Amount || 0,
                posItem.Net_Amount,
                Branch_idBranch,
                posItem.Variation_Id || null, // Added Variation_Id
                connection,
              );
            }
          }),
        );

        // 2. If Status == 1 (Completed), Create INVOICE + Handle Stock
        let Invoice_idInvoice = null;
        let Invoice_Number = null;
        if (Status === 1) {
          // --- Generate Invoice Number ---
          const rules =
            await rulesDbService.getInvoiceNumberDetails(Branch_idBranch);
          const base_letter_part = rules[0].Invoice_No_Start_With;
          const starting_number = rules[0].Invoice_No_Strat_From;
          const salesman_enabled = parseInt(rules[0].salesman_enabled) === 1;
          const salesman_invoice_update =
            parseInt(rules[0].salesman_invoice_update) === 1;

          let letter_part = base_letter_part;

          // If salesman is enabled, salesman_invoice_update is enabled, and an employee is assigned, prefix with first 3 chars of salesman name
          if (
            salesman_enabled &&
            salesman_invoice_update &&
            Employee_idEmployee
          ) {
            try {
              const employee =
                await employeeDbService.fetchEmployeeById(Employee_idEmployee);
              if (employee && employee.length > 0) {
                const salesmanPrefix = employee[0].Employee_Name.replace(
                  /\s+/g,
                  "",
                )
                  .substring(0, 3)
                  .toUpperCase();
                letter_part = `${salesmanPrefix}${base_letter_part}`;
                console.log(
                  `[CREATE-POS-INVOICE] Salesman prefix applied: ${letter_part}`,
                );
              }
            } catch (empErr) {
              console.error(
                `[CREATE-POS-INVOICE] Error fetching employee, using default prefix:`,
                empErr,
              );
            }
          }

          let next_invoice_number;

          if (parseInt(rules[0].advanced_invoice_number) === 1) {
            let branchName = "";
            try {
              const branchDetails = await branchDBService.fetchBranch(Branch_idBranch);
              if (branchDetails && branchDetails.length > 0) {
                branchName = branchDetails[0].Company || branchDetails[0].Name || "";
              }
            } catch (branchErr) {
              console.error("Error fetching branch details:", branchErr);
            }

            const prefixPart = generateAdvancedInvoiceNumber(letter_part, "", branchName).replace(/X+/g, "");
            let last_invoice_adv = await invoiceDBService.getLastInvoiceBySalesmanPrefix(
              Branch_idBranch,
              prefixPart
            );

            let sequence = parseInt(starting_number, 10) || 1;
            if (last_invoice_adv && last_invoice_adv.length > 0) {
              const last_num = last_invoice_adv[0].Invoice_Number;
              const match = last_num.match(/(\d+)$/);
              if (match) {
                sequence = parseInt(match[1], 10) + 1;
              }
            } else {
              const overall_last = await invoiceDBService.getLastInvoice(Branch_idBranch);
              if (overall_last && overall_last.length > 0) {
                const last_num = overall_last[0].Invoice_Number;
                const match = last_num.match(/(\d+)$/);
                if (match) {
                  sequence = parseInt(match[1], 10) + 1;
                }
              }
            }
            next_invoice_number = generateAdvancedInvoiceNumber(letter_part, sequence, branchName);
          } else {
            next_invoice_number = `${letter_part}${starting_number}`;

            let last_invoice = [];
            if (salesman_enabled && Employee_idEmployee && salesman_invoice_update) {
              last_invoice = await invoiceDBService.getLastInvoiceBySalesman(
                Branch_idBranch,
                Employee_idEmployee,
              );
            }

            // Fall back to prefix matching if no invoice exists for this salesman yet, or no salesman selected
            if (!last_invoice || last_invoice.length === 0) {
              last_invoice = await invoiceDBService.getLastInvoiceBySalesmanPrefix(
                Branch_idBranch,
                letter_part,
              );
            }

            if (last_invoice?.length !== 0) {
              const last_invoice_number = last_invoice[0].Invoice_Number;

              // Extract the non-digit prefix and trailing digit sequence to preserve format (e.g. leading zeros, hyphens)
              const match = last_invoice_number.match(/^(.*?)(\d+)$/);
              if (match) {
                const prefixPart = match[1];
                const numericStr = match[2];
                const numericPart = parseInt(numericStr, 10);
                const nextNumericPart = numericPart + 1;
                const nextNumericStr = nextNumericPart.toString().padStart(numericStr.length, "0");
                next_invoice_number = `${prefixPart}${nextNumericStr}`;
              } else {
                const matchOld = last_invoice_number.match(/\d/);
                if (matchOld) {
                  const digitPosition = matchOld.index;
                  const numericPart = parseInt(last_invoice_number.slice(digitPosition), 10);
                  const nextNumericPart = numericPart + 1;
                  next_invoice_number = `${letter_part}${nextNumericPart}`;
                }
              }
            }
          }
          Invoice_Number = next_invoice_number;
          // -------------------------------

          const Created_Date = sriLankaDateTime.split(" ")[0];
          const created_at_db = sriLankaDateTime;
          
          let creditBalance = 0;
          let totalCreditBalance = 0;
          let invoicePaymentType = 1; // Default to Full Payment

          const voucherAmt = parseFloat(gift_voucher_amount) || 0;
          const loyaltyAmt = parseFloat(loyalty_discount_amount) || 0;
          const netAmt = parseFloat(Net_Amount) || 0;
          const cashAmt = parseFloat(Cash_Payment) || 0;
          const cardAmt = parseFloat(Card_Payment) || 0;
          const rawPaid = parseFloat(Paid_Amount) || 0;

          // In POS, total settlement towards this bill comes from funds tendered (cash + card) plus voucher and loyalty points discount.
          // Note: rawPaid from frontend may already include voucher/loyalty discount, so take Math.max to avoid double-counting.
          const effectivePaid = Math.max(rawPaid, cashAmt + cardAmt + voucherAmt + loyaltyAmt);

          if (effectivePaid < netAmt) {
            creditBalance = netAmt - effectivePaid;
            invoicePaymentType = 3; // Credit / Advance sale

            // Fetch last customer credit log to update total balance
            const lastCustomerLog = await customerLogDbService.fetchLastLog(Customer_idCustomer);
            totalCreditBalance = (lastCustomerLog?.length === 0 ? 0 : parseFloat(lastCustomerLog[0].Total_Credit_Balance)) + creditBalance;
          }

          // In the invoice record, Paid_Amount is capped at Net_Amount (in POS excess tendered cash is returned as change)
          const invoicePaidAmount = Math.min(effectivePaid, netAmt);

          const invoicePaymentMethod =
            Payment_Method ||
            (Payment_Type === 3 ? "mixed" : Payment_Type === 2 ? "card" : "cash");

          let finalPaymentNote = Payment_Note || "POS Transaction";
          if (redeemed_loyalty_points && Number(redeemed_loyalty_points) > 0 && !finalPaymentNote.includes("Loyalty Points Redeemed")) {
            const lValFormatted = parseFloat(loyalty_discount_amount || 0).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            const loyaltyStr = `Loyalty Points Redeemed: ${redeemed_loyalty_points} pts (Val: ${lValFormatted} LKR)`;
            finalPaymentNote = `${finalPaymentNote} [${loyaltyStr}]`;
          }

          // Create Invoice Record
          const invoice = await invoiceDBService.insertInvoice(
            Invoice_Number,
            0, // Quotation_idQuotation
            sriLankaDateTime.split(" ")[0],
            Customer_idCustomer,
            "", // Address (POS doesn't usually take address on fly)
            Employee_idEmployee,
            Total,
            Discount_Type,
            Discount_Percentage,
            Discount_Amount,
            "percentage", // Discount2_Type
            0, // Discount2_Presentage
            0, // Discount2_Amount
            Net_Amount,
            items.length,
            finalPaymentNote,
            invoicePaymentType, // 1=Full, 3=Credit
            0, // Interest
            0,
            0,
            invoicePaidAmount,
            0, // Balance Amount (change is handled separately via transactions)
            creditBalance, // Credit Balance
            totalCreditBalance, // Total Credit Balance
            Created_Date,
            created_at_db,
            Branch_idBranch,
            invoicePaymentMethod,
            // Card details if available
            Payment_Type === 2 || Payment_Type === 3 ? "Visa/Master" : null, // Placeholder
            null, // Card Number
            null, // Transaction Id
            null, // Receipt
            null, // Cheque Type
            null, // Cheque No
            null, // Cheque Date
            null, // Cheque Name
            Bank_Account_Id || null, // Bank Account Id
            Tax_Amount,
            null, // Vat_Type
            Extra_Charge_Label || "Extra Charge",
            parseFloat(Extra_Charge || 0),
            User_idUser || Employee_idEmployee,
            null, // place_of_supply
            custom_fields_data || null, // custom_fields_data
            connection,
          );
          Invoice_idInvoice = invoice.insertId;

          // Update pos record to associate it with the generated Invoice_Number (if column exists)
          await new Promise((resolve) => {
            connection.query(
              "UPDATE pos SET Invoice_Number = ? WHERE idPos = ?",
              [Invoice_Number, pos_id],
              (err) => {
                if (err) {
                  console.log("[POS] Notice: pos table does not have Invoice_Number column, skipping.");
                }
                resolve();
              }
            );
          });

          // If it's a credit sale, record it in the customer log
          if (creditBalance > 0) {
            await customerLogDbService.insertCustomerCreditLog(
              Customer_idCustomer,
              "INVOICE",
              Invoice_idInvoice,
              creditBalance,
              0, // Credit (payment) is 0 for initial debt
              totalCreditBalance,
              invoicePaymentType,
              invoicePaymentMethod,
              null, // Cheque Type
              null, // Cheque No
              null, // Cheque Date
              null, // Cheque Name
              0, // Cheque Status
              Branch_idBranch,
              null, // Card Type
              null, // Card Number
              null, // Transaction Id
              null, // Receipt
              null, // Debit Account
              null, // Credit Account
              null, // Note
              null, // receipt_number
              connection,
              sriLankaDateTime,
            );
          }

          // --- POS TRANSACTION LOGGING (Cash In / Out / Card / Online) ---
          // Requires registry_id from frontend to link to specific shift
          if (req.body.registry_id) {
            const regId = req.body.registry_id;

            // 1. Record Cash Payment (In)
            if (parseFloat(Cash_Payment) > 0) {
              await dbService.insertPosTransaction(
                pos_id,
                regId,
                "In",
                parseFloat(Cash_Payment),
                `Cash Sales - ${Invoice_Number}`,
                "Cash",
                connection,
              );
            }

            // 2. Record Card / Online Payment (In)
            if (parseFloat(Card_Payment) > 0) {
              const isOnlineTx =
                invoicePaymentMethod === "online" ||
                invoicePaymentMethod.includes("online");
              await dbService.insertPosTransaction(
                pos_id,
                regId,
                "In",
                parseFloat(Card_Payment),
                isOnlineTx
                  ? `Online Transfer - ${Invoice_Number}`
                  : `Card Sales - ${Invoice_Number}`,
                isOnlineTx ? "Online" : "Card",
                connection,
              );
            }

            // 3. Record Change Given (Out)
            // Balance_Amount is (Paid - Net). Positive means change given.
            if (parseFloat(Balance_Amount) > 0) {
              await dbService.insertPosTransaction(
                pos_id,
                regId,
                "Out",
                parseFloat(Balance_Amount),
                `Change Given - ${Invoice_Number}`,
                "Cash",
                connection,
              );
            }
          }

          // --- Process Items for Invoice & Stock ---
          for (let index = 0; index < items.length; index++) {
            const posItem = items[index];

            // If this is a return credit line or manual/voucher item
            if (!posItem.Item_idItem || posItem.Item_idItem <= 0 || posItem.is_return_credit || posItem.is_gift_voucher_sale) {
              const returnDesc = posItem.Item_Name || (posItem.is_return_credit ? "Customer Return Credit" : "Gift Voucher");
              await invoiceDBService.insertInvoiceItem(
                Invoice_idInvoice,
                0,
                0,
                0,
                returnDesc,
                returnDesc,
                "pcs",
                posItem.Qty || 1,
                posItem.Rate || 0,
                posItem.Amount || 0,
                posItem.Discount_Type || 1,
                0,
                posItem.Net_Amount || 0,
                Branch_idBranch,
                null,
                null,
                connection,
              );
              continue;
            }

            const item = await itemDbService.fetchItem(posItem.Item_idItem, connection);
            const itemDescription = item && item[0] ? item[0].Description : (posItem.Item_Name || "");

            // Handle Serials
            if (
              (posItem.Item_Has_Serial === 1 || posItem.Serial_No === 1) &&
              posItem.SelectedSerials?.length > 0
            ) {
              const serial_discount =
                (posItem.Discount_Amount || 0) /
                posItem.SelectedSerials.length;

              await Promise.all(
                posItem.SelectedSerials.map(async (serial_number) => {
                  let serial_no_id = 0;
                  const serial_item = await dbService.selectSerials(
                    serial_number.Serial_No,
                  );

                  if (serial_item) {
                    // Exists, update it to Qty = 0 (Consume/sold)
                    const serial_update = await invoiceDBService.updateSerials(
                      serial_number.Serial_No,
                      connection,
                    );
                    serial_no_id = serial_update ? serial_update.ID : serial_item.ID;
                  } else {
                    // Does not exist, insert it into item_has_serial_no with Qty = 0 (sold/consumed)
                    const insertSerial = await invoiceDBService.insertSerialNumbers(
                      0,
                      posItem.Item_idItem,
                      0, // sold / consumed
                      serial_number.Serial_No,
                      Branch_idBranch,
                      connection,
                      posItem.Variation_Id || null,
                    );
                    serial_no_id = insertSerial.insertId;
                  }

                  // Insert Invoice Item
                  await invoiceDBService.insertInvoiceItem(
                    Invoice_idInvoice,
                    posItem.Item_idItem,
                    1, // Has Serial
                    serial_no_id,
                    itemDescription,
                    itemDescription,
                    item && item[0] ? item[0].Qty_Type : "pcs",
                    1,
                    posItem.Rate,
                    posItem.Amount / posItem.SelectedSerials.length, // Split amount
                    posItem.Discount_Type,
                    posItem.Discount_Type === 1 || posItem.Discount_Type === "percentage"
                      ? (posItem.Discount_Percentage || 0)
                      : serial_discount,
                    posItem.Net_Amount / posItem.SelectedSerials.length,
                    Branch_idBranch,
                    posItem.Variation_Id,
                    null, // Remarks
                    connection,
                  );
                }),
              );
            } else {
              // Standard Item
              await invoiceDBService.insertInvoiceItem(
                Invoice_idInvoice,
                posItem.Item_idItem,
                0,
                0,
                itemDescription,
                itemDescription,
                item && item[0] ? item[0].Qty_Type : "pcs",
                posItem.Qty,
                posItem.Rate,
                posItem.Amount,
                posItem.Discount_Type,
                posItem.Discount_Type === 1 || posItem.Discount_Type === "percentage"
                  ? (posItem.Discount_Percentage || 0)
                  : (posItem.Discount_Amount || 0),
                posItem.Net_Amount,
                Branch_idBranch,
                posItem.Variation_Id,
                null, // Remarks
                connection,
              );
            }

            // --- STOCK UPDATE LOGIC ---
            if (item && item[0] && item[0].Type === "1") {
              let new_qty = 0;
              let in_qty = 0;
              let out_qty = 0;

              // Variation Product
              if (posItem.Variation_Id && posItem.Variation_Id > 0) {
                // Deduct from variation
                await itemDbService.processInvoiceVariation(
                  posItem.Variation_Id,
                  parseFloat(posItem.Qty),
                  connection,
                );
                out_qty = parseFloat(posItem.Qty);
                new_qty = parseFloat(item[0].Qty);

                // Get current variation qty for log (since it changed)
                const [vData] = await new Promise((resolve, reject) => {
                  connection.query(
                    "SELECT qty FROM item_variations WHERE id = ?",
                    [posItem.Variation_Id],
                    (err, results) => (err ? reject(err) : resolve([results])),
                  );
                });
                const vNewQty = parseFloat(vData[0]?.qty || 0);
                new_qty = vNewQty;
                const vOldQty = vNewQty + out_qty;

                // Log history
                await productHistoryLogHelper({
                  productId: posItem.Item_idItem,
                  variationId: posItem.Variation_Id,
                  quantityChange: -out_qty,
                  oldQty: vOldQty,
                  newQty: vNewQty,
                  type: "POS Sale (Variation)",
                  description: `Stock deducted via POS Sale (Invoice ID: ${Invoice_idInvoice})`,
                  branchId: Branch_idBranch,
                  companyId,
                  userId: User_idUser || Employee_idEmployee,
                  referenceId: Invoice_idInvoice,
                  connection,
                });
              } else {
                // Standard Product
                out_qty = parseFloat(posItem.Qty);
                new_qty = parseFloat(item[0].Qty) - out_qty;
                await itemDbService.itemProcess(
                  item[0].Cost,
                  item[0].Real_Cost,
                  new_qty,
                  posItem.Item_idItem,
                  connection,
                );

                // Log history
                await productHistoryLogHelper({
                  productId: posItem.Item_idItem,
                  variationId: null,
                  quantityChange: -out_qty,
                  oldQty: parseFloat(item[0].Qty),
                  newQty: new_qty,
                  type: "POS Sale",
                  description: `Stock deducted via POS Sale (Invoice ID: ${Invoice_idInvoice})`,
                  branchId: Branch_idBranch,
                  companyId,
                  userId: User_idUser || Employee_idEmployee,
                  referenceId: Invoice_idInvoice,
                  connection,
                });
              }

              // Deduct from batches (direct or automatic FIFO fallback)
              try {
                if (out_qty > 0) {
                  console.log(`[POS] Deducting ${out_qty} from batches for item: ${posItem.Item_idItem}`);
                  await itemDbService.deductStockFromBatches(
                    posItem.Item_idItem,
                    posItem.Variation_Id || null,
                    out_qty,
                    posItem.Batch_Id || posItem.Batch_id || null,
                    Branch_idBranch,
                    connection,
                    Warehouse_Id || null
                  );
                }
              } catch (batchDeductErr) {
                console.error(`[POS] Error during batch stock deduction:`, batchDeductErr);
              }

              // Stock Card
              await stockCardDbService.insertStockCard(
                item[0].idItem,
                item[0].Description,
                "INVOICE", // Logged as INVOICE now, not POS
                Invoice_idInvoice,
                item[0].Cost,
                item[0].Real_Cost,
                item[0].Rate,
                in_qty,
                out_qty,
                new_qty,
                Branch_idBranch,
                connection,
                posItem.Variation_Id || null,
              );
            }
          }

          // If a Customer Return was applied to this POS bill, mark it as Processed (Status = 1)
          const appliedReturnId = req.body.Customer_Return_idCustomer_Return ||
            items.find((i) => i.Customer_Return_idCustomer_Return)?.Customer_Return_idCustomer_Return;

          if (appliedReturnId && appliedReturnId > 0) {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE customer_return SET Status = 1, Invoice_idInvoice = ? WHERE idCustomer_Return = ?",
                [Invoice_idInvoice, appliedReturnId],
                (err, res) => (err ? reject(err) : resolve(res))
              );
            });
            console.log(`[POS] Customer Return #${appliedReturnId} marked as Processed (Status = 1) for Invoice #${Invoice_idInvoice}`);
          }

          // --- BANK & ACCOUNTING DOUBLE ENTRY ---
          try {
            const invoiceCompanyId =
              companyId || (await branchDBService.getCompanyIdByBranch(Branch_idBranch));

            // Determine if the user/company is on a Professional plan
            let isProfessionalPlan = false;
            const reqPlanName = (req.body.plan_name || "").toString().toLowerCase();
            if (reqPlanName.includes("professional") || reqPlanName.includes("pro")) {
              isProfessionalPlan = true;
            } else if (invoiceCompanyId) {
              try {
                const [compSoftware] = await new Promise((resolve, reject) => {
                  db2.query(
                    "SELECT plan_name FROM companyhassoftware WHERE company_id = ? ORDER BY id DESC LIMIT 1",
                    [invoiceCompanyId],
                    (err, res) => (err ? reject(err) : resolve([res]))
                  );
                });
                const dbPlanName = (compSoftware?.[0]?.plan_name || "").toString().toLowerCase();
                if (dbPlanName.includes("professional") || dbPlanName.includes("pro")) {
                  isProfessionalPlan = true;
                }
              } catch (planCheckErr) {
                console.error("[POS] Error checking company plan in db2:", planCheckErr);
              }
            }

            // Case 3: Standard, Basic, or Free users (or no accounting module configured):
            // No accounting logs should be created. Let them create POS invoices normally.
            if (!isProfessionalPlan) {
              console.log(
                `[POS Accounting] Skipping accounting entries: Company ${invoiceCompanyId} is on a Standard/Basic/Free plan.`
              );
            } else {
              // Check if Chart of Accounts / Accounting Module is configured for this company & branch
              const Sales_AccountId = invoiceCompanyId
                ? await findAccountByNameAndGroup(
                    "Sales Revenue",
                    "Income",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  )
                : null;

              if (!Sales_AccountId) {
                console.log(
                  `[POS Accounting] Skipping accounting entries: Accounting module is not configured for Company ${invoiceCompanyId}, Branch ${Branch_idBranch}.`
                );
              } else {
                const netAmt = parseFloat(Net_Amount) || 0;
                const paidAmt = parseFloat(Paid_Amount) || 0;
                const discountAmt = parseFloat(Discount_Amount) || 0;
                const vatAmt = parseFloat(Tax_Amount) || 0;
                const revenueAmt = netAmt + discountAmt - vatAmt;
                const cashAmt = parseFloat(Cash_Payment) || 0;
                const cardAmt = parseFloat(Card_Payment) || 0;
                const loyaltyAmt = parseFloat(loyalty_discount_amount) || 0;

                const pMethodLower = (invoicePaymentMethod || "").toLowerCase();
                const isOnlineTx =
                  pMethodLower === "online" ||
                  pMethodLower.includes("online");
                const isBankPayment =
                  pMethodLower === "card" ||
                  isOnlineTx ||
                  pMethodLower === "mixed";
                const bankDepositAmount = isBankPayment ? cardAmt : 0;

                // In POS, if total tendered (cash + card + voucher + loyalty) > netAmt, change was returned to customer in cash.
                // Retained cash = cashAmt tendered minus change given.
                const totalTendered = Math.max(paidAmt, cashAmt + cardAmt + voucherAmt + loyaltyAmt);
                const changeAmt = Math.max(0, totalTendered - netAmt);
                const netCashReceived = Math.max(0, cashAmt - changeAmt);
                const netBankReceived = Math.max(0, bankDepositAmount - Math.max(0, changeAmt - cashAmt));

                const userId = User_idUser || Employee_idEmployee || 1;

                const AR_AccountId = await findAccountByNameAndGroup(
                  "Accounts Receivable (Debtors)",
                  "Assets",
                  invoiceCompanyId,
                  Branch_idBranch,
                  connection,
                );
                const Cash_AccountId = await findAccountByNameAndGroup(
                  "Cash in Hand",
                  "Assets",
                  invoiceCompanyId,
                  Branch_idBranch,
                  connection,
                );
                let Default_Bank_AccountId = await findAccountByNameAndGroup(
                  "Bank Account",
                  "Assets",
                  invoiceCompanyId,
                  Branch_idBranch,
                  connection,
                );
                if (!Default_Bank_AccountId) {
                  // Fallback: search for general Bank Account by code or name
                  const [fallbackBank] = await new Promise((resolve) => {
                    connection.query(
                      "SELECT idAccounting_Accounts FROM accounting_accounts WHERE (Account_Name LIKE '%Bank Account%' OR Account_Code = '1000-002') AND Branch_idBranch = ? AND (companyId = ? OR companyId IS NULL OR companyId = 0) AND Status = 1 LIMIT 1",
                      [Branch_idBranch, invoiceCompanyId],
                      (err, rows) => resolve([rows])
                    );
                  });
                  if (fallbackBank && fallbackBank.length > 0) {
                    Default_Bank_AccountId = fallbackBank[0].idAccounting_Accounts;
                  }
                }

                let invoicedVouchersTotal = 0;
                if (Array.isArray(invoiced_voucher_ids) && invoiced_voucher_ids.length > 0) {
                  try {
                    const [vRows] = await new Promise((resolveVouchers, rejectVouchers) => {
                      connection.query(
                        `SELECT COALESCE(SUM(amount), 0) as total FROM gift_vouchers WHERE id IN (?)`,
                        [invoiced_voucher_ids],
                        (err, r) => (err ? rejectVouchers(err) : resolveVouchers([r]))
                      );
                    });
                    invoicedVouchersTotal = parseFloat(vRows[0]?.total || 0);
                  } catch (vErr) {
                    console.error("[POS] Error calculating invoiced voucher total:", vErr);
                  }
                }

                // 1. Credit Sales Revenue (Income) for goods (excluding gift voucher liability)
                const goodsRevenue = Math.max(0, revenueAmt - invoicedVouchersTotal);
                if (goodsRevenue > 0 && Sales_AccountId) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Income",
                    amount: goodsRevenue,
                    description: `POS Revenue for Invoice ${Invoice_Number}`,
                    type: "POS Sale",
                    accountId: Sales_AccountId,
                    branchId: Branch_idBranch,
                    userId,
                    companyId: invoiceCompanyId,
                    transactionType: "credit",
                    connection,
                  });
                }

                if (invoicedVouchersTotal > 0) {
                  const Voucher_Liability_AccountId = await ensureAccountExists(
                    "Gift Voucher Liability",
                    "Liabilities",
                    "Liabilities",
                    "2000-004",
                    "Gift Voucher Liability account",
                    invoiceCompanyId,
                    Branch_idBranch,
                    userId || 1,
                    connection
                  );
                  if (Voucher_Liability_AccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Liabilities",
                      amount: invoicedVouchersTotal,
                      description: `Gift Voucher Sale for POS Invoice ${Invoice_Number}`,
                      type: "POS Sale",
                      accountId: Voucher_Liability_AccountId,
                      branchId: Branch_idBranch,
                      userId,
                      companyId: invoiceCompanyId,
                      transactionType: "credit",
                      connection,
                    });
                  }
                }

                // 2. Debit Sales Discount (Contra Income)
                if (discountAmt > 0) {
                  const Discount_AccountId = await findAccountByNameAndGroup(
                    "Sales Discounts",
                    "Contra Accounts",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  );
                  if (Discount_AccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Contra Accounts",
                      amount: discountAmt,
                      description: `Discount applied for POS Invoice ${Invoice_Number}`,
                      type: "POS Sale",
                      accountId: Discount_AccountId,
                      branchId: Branch_idBranch,
                      userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }

                // 3. Credit VAT Payable (Liability)
                if (vatAmt > 0) {
                  const Vat_AccountId = await findAccountByNameAndGroup(
                    "VAT Payable",
                    "Liabilities",
                    invoiceCompanyId,
                    Branch_idBranch,
                    connection,
                  );
                  if (Vat_AccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Liabilities",
                      amount: vatAmt,
                      description: `VAT applied for POS Invoice ${Invoice_Number}`,
                      type: "POS Sale",
                      accountId: Vat_AccountId,
                      branchId: Branch_idBranch,
                      userId,
                      companyId: invoiceCompanyId,
                      transactionType: "credit",
                      connection,
                    });
                  }
                }

                // 4. Debit Cash portion (net cash retained in drawer)
                if (netCashReceived > 0 && Cash_AccountId) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Assets",
                    amount: netCashReceived,
                    description: `Cash Payment for POS Invoice ${Invoice_Number}`,
                    type: "POS Sale",
                    accountId: Cash_AccountId,
                    branchId: Branch_idBranch,
                    userId,
                    companyId: invoiceCompanyId,
                    transactionType: "debit",
                    connection,
                  });
                }

                // 5. Debit Bank portion (Card or Online Transfer)
                // Case 1: If no bank accounts added or none selected (!Bank_Account_Id), record in general Bank Account.
                // Case 2: If a specific bank account was added and selected (Bank_Account_Id), record in that bank account.
                const targetBankAccountId = Bank_Account_Id || Default_Bank_AccountId;
                if (netBankReceived > 0 && targetBankAccountId) {
                  await creditDebitLogHelper({
                    accountType: "Bank Account",
                    group: "Assets",
                    amount: netBankReceived,
                    description: `${isOnlineTx ? "Online Transfer" : "Card Payment"} for POS Invoice ${Invoice_Number}`,
                    type: "POS Sale",
                    accountId: targetBankAccountId,
                    branchId: Branch_idBranch,
                    userId,
                    companyId: invoiceCompanyId,
                    transactionType: "debit",
                    connection,
                  });
                }

                // 6. Debit Accounts Receivable for credit balance
                if (creditBalance > 0 && AR_AccountId) {
                  await creditDebitLogHelper({
                    accountType: "Chartered Account",
                    group: "Assets",
                    amount: creditBalance,
                    description: `Credit Sale for POS Invoice ${Invoice_Number}`,
                    type: "POS Sale",
                    accountId: AR_AccountId,
                    branchId: Branch_idBranch,
                    userId,
                    companyId: invoiceCompanyId,
                    transactionType: "debit",
                    connection,
                  });
                }

                // 7. Debit Gift Voucher Liability for voucher portion
                if (voucherAmt > 0) {
                  const Voucher_AccountId = await ensureAccountExists(
                    "Gift Voucher Liability",
                    "Liabilities",
                    "Liabilities",
                    "2000-004",
                    "Gift Voucher Liability account",
                    invoiceCompanyId,
                    Branch_idBranch,
                    userId || 1,
                    connection,
                  );

                  if (Voucher_AccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Liabilities",
                      amount: voucherAmt,
                      description: `Gift Voucher ${gift_voucher_code || ""} redeemed for POS Invoice ${Invoice_Number}`,
                      type: "POS Sale",
                      accountId: Voucher_AccountId,
                      branchId: Branch_idBranch,
                      userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }

                // 8. Debit Customer Loyalty Discounts for loyalty points redeemed
                if (loyaltyAmt > 0) {
                  const Loyalty_AccountId = await ensureAccountExists(
                    "Customer Loyalty Discounts",
                    "Contra Accounts",
                    "Contra Accounts",
                    "5000-003",
                    "Customer Loyalty Points Redemption Discount account",
                    invoiceCompanyId,
                    Branch_idBranch,
                    userId || 1,
                    connection,
                  );

                  if (Loyalty_AccountId) {
                    await creditDebitLogHelper({
                      accountType: "Chartered Account",
                      group: "Contra Accounts",
                      amount: loyaltyAmt,
                      description: `Customer Loyalty Points Redeemed (${redeemed_loyalty_points || ""} pts) for POS Invoice ${Invoice_Number}`,
                      type: "POS Sale",
                      accountId: Loyalty_AccountId,
                      branchId: Branch_idBranch,
                      userId,
                      companyId: invoiceCompanyId,
                      transactionType: "debit",
                      connection,
                    });
                  }
                }
              }
            }
          } catch (accErr) {
            console.error("[POS] Error in accounting entries:", accErr);
          }

          // --- COMPANY BANK ACCOUNT BALANCE UPDATE & LOGGING ---
          if ((Payment_Method === "bank" || Bank_Account_Id) && parseFloat(Paid_Amount || 0) > 0 && Bank_Account_Id) {
            try {
              const accountDetails = await bankAccountDBService.getAccountById(
                Bank_Account_Id,
                Branch_idBranch
              );
              if (accountDetails && accountDetails.length > 0) {
                const currentBal = parseFloat(accountDetails[0].account_balance || 0);
                const paidVal = parseFloat(Paid_Amount || 0);
                const newBal = currentBal + paidVal;
                await bankAccountDBService.updateCompanyBankAccountBalance(
                  Bank_Account_Id,
                  newBal,
                  Branch_idBranch,
                  connection
                );
                await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
                  Bank_Account_Id,
                  "POS Invoice Payment",
                  `Payment received for POS Invoice ID: ${Invoice_idInvoice}`,
                  `Paid Amount: ${Paid_Amount}`,
                  Paid_Amount,
                  "0.00",
                  newBal,
                  accountDetails[0].user || "System",
                  "paid",
                  `Payment of ${Paid_Amount} received for POS Invoice ID: ${Invoice_idInvoice}`,
                  new Date(),
                  User_idUser || Employee_idEmployee || 1,
                  Invoice_idInvoice,
                  "-",
                  "0",
                  Branch_idBranch,
                  connection
                );
              }
            } catch (bankErr) {
              console.error("[POS] Error updating company bank account balance/log:", bankErr);
            }
          }

          await userLogDbService.insertLog(
            User_idUser || Employee_idEmployee,
            currentDate(),
            "Invoice",
            Invoice_idInvoice,
            "create-pos",
            Branch_idBranch,
            connection,
          );

          // Automatically link invoiced gift vouchers to this invoice
          if (Array.isArray(invoiced_voucher_ids) && invoiced_voucher_ids.length > 0 && Invoice_idInvoice) {
            try {
              await new Promise((resolveLink, rejectLink) => {
                connection.query(
                  `UPDATE gift_vouchers SET issue_type = 'INVOICED', created_invoice_id = ? WHERE id IN (?)`,
                  [Invoice_idInvoice, invoiced_voucher_ids],
                  (err) => (err ? rejectLink(err) : resolveLink())
                );
              });
            } catch (invVoucherErr) {
              console.error("[GiftVoucher] Error linking invoiced vouchers to POS Invoice:", invVoucherErr);
            }
          }
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          const io = req.app.get("io");
          if (io) {
            if (Branch_idBranch) {
              io.to(`branch_${Branch_idBranch}`).emit("refreshNotifications");
            } else {
              io.emit("refreshNotifications");
            }
          }

          // Customer Loyalty: Execute redemption first (if token provided), then award points
          if (Customer_idCustomer && Number(Customer_idCustomer) > 0 && Status === 1 && Invoice_idInvoice) {
            (async () => {
              try {
                const customerLoyaltyService = require("../services/customerLoyaltyService");

                // 1. Redeem points if token provided
                if (loyalty_redemption_token) {
                  try {
                    await customerLoyaltyService.redeemPointsForInvoice({
                      customerId: Customer_idCustomer,
                      branchId: Branch_idBranch,
                      invoiceId: Invoice_idInvoice,
                      invoiceNumber: Invoice_Number,
                      pointsToRedeem: redeemed_loyalty_points,
                      discountAmount: loyalty_discount_amount,
                      redemptionToken: loyalty_redemption_token,
                      userId: User_idUser || Employee_idEmployee,
                    });
                  } catch (loyaltyRedeemErr) {
                    console.error("[CustomerLoyalty] Error redeeming loyalty points in POS:", loyaltyRedeemErr);
                  }
                }

                // 2. Award points for this purchase
                await customerLoyaltyService.awardPointsForInvoice({
                  customerId: Customer_idCustomer,
                  invoiceId: Invoice_idInvoice,
                  invoiceNumber: Invoice_Number,
                  totalAmount: Net_Amount,
                  branchId: Branch_idBranch,
                  userId: User_idUser || Employee_idEmployee,
                });
              } catch (loyaltyErr) {
                console.error("[CustomerLoyalty] Error processing customer loyalty in POS:", loyaltyErr);
              }
            })();
          }

          // Automatically claim Gift Vouchers if applied
          const voucherInvoiceRef = Invoice_idInvoice || pos_id;
          const rawCodes = gift_voucher_codes || gift_voucher_code;
          const codesToClaim = Array.isArray(rawCodes)
            ? rawCodes
            : typeof rawCodes === "string"
            ? rawCodes.split(",").map((s) => s.trim()).filter(Boolean)
            : [];

          if (codesToClaim.length > 0 && Status === 1 && voucherInvoiceRef) {
            try {
              const giftVoucherService = require("../services/giftVoucherService");
              for (const code of codesToClaim) {
                giftVoucherService
                  .claimVoucherForInvoice({
                    voucherCode: code,
                    invoiceId: voucherInvoiceRef,
                    invoiceNumber: Invoice_Number,
                    customerId: Customer_idCustomer,
                    branchId: Branch_idBranch,
                    userId: User_idUser || Employee_idEmployee,
                  })
                  .catch((gvErr) =>
                    console.error(`[GiftVoucher] Error claiming voucher ${code} in POS:`, gvErr)
                  );
              }
            } catch (gvLoadErr) {
              console.error("[GiftVoucher] Failed to load giftVoucherService in POS:", gvLoadErr);
            }
          }

          res
            .status(200)
            .json({ message: "POS added successfully", data: pos_id });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error creating POS:", err);
          res
            .status(500)
            .json({ message: "Error creating POS", error: err.message });
        });
      }
    });
  });
};

const getSuspendedPos = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const pos = await dbService.fetchSuspendedPos(Branch_idBranch);

    const posIds = pos.map((p) => p.idPos);

    if (posIds.length > 0) {
      const allItems = await dbService.fetchPosItemsForPosList(posIds);

      const itemsMap = {};
      allItems.forEach((item) => {
        if (!itemsMap[item.Pos_idPos]) {
          itemsMap[item.Pos_idPos] = [];
        }
        itemsMap[item.Pos_idPos].push(item);
      });

      const data = pos.map((pos_single) => {
        const raw_items = itemsMap[pos_single.idPos] || [];
        const pos_items = raw_items.map((it) => ({
          ...it,
          SelectedSerials:
            it.Item_Has_Serial === 1 && it.Serial_Number
              ? [{ Serial_No: it.Serial_Number }]
              : [],
        }));

        return {
          ...pos_single,
          items: pos_items,
        };
      });
      res.status(200).json({ data });
    } else {
      res.status(200).json({ data: [] });
    }
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching items", error: err.message });
  }
};

const getPosById = async (req, res) => {
  try {
    const { idPos } = req.params;
    const pos = await dbService.getPosById(idPos);

    const posIds = pos.map((p) => p.idPos);

    if (posIds.length > 0) {
      const allItems = await dbService.fetchPosItemsForPosList(posIds);

      const itemsMap = {};
      allItems.forEach((item) => {
        if (!itemsMap[item.Pos_idPos]) {
          itemsMap[item.Pos_idPos] = [];
        }
        itemsMap[item.Pos_idPos].push(item);
      });

      const data = pos.map((pos_single) => {
        const raw_items = itemsMap[pos_single.idPos] || [];
        const pos_items = raw_items.map((it) => ({
          ...it,
          SelectedSerials:
            it.Item_Has_Serial === 1 && it.Serial_Number
              ? [{ Serial_No: it.Serial_Number }]
              : [],
        }));

        return {
          ...pos_single,
          items: pos_items,
        };
      });
      res.status(200).json({ data });
    } else {
      res.status(200).json({ data: [] });
    }
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching items", error: err.message });
  }
};

const createPlot = async (req, res) => {
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
        let { Date_Time, Amount, Branch_idBranch, User_idUser, rows } =
          req.body;

        // Only use date part for duplicate check
        const dateOnly = Date_Time.split("T")[0];
        const check = await dbService.checkPlotExist(dateOnly, Branch_idBranch); // SELECT, no transaction needed strictly but ok
        if (check.length > 0) {
          connection.rollback(() => connection.release());
          res.status(409).json({
            message: "Plot already exist",
          });
          return;
        }

        // Get last closed plot for this branch
        const lastClosedPlot =
          await dbService.getLastClosedPlot(Branch_idBranch);
        let carryForward = 0;
        if (lastClosedPlot && lastClosedPlot.Carry_Forward) {
          carryForward = parseFloat(lastClosedPlot.Carry_Forward) || 0;
          Amount += carryForward;
        }

        // Insert plot
        const plotId = await dbService.insertPlot(
          Date_Time,
          Amount,
          Branch_idBranch,
          connection,
        );

        // Insert each row into plot_amount
        await Promise.all(
          rows.map(async (row) => {
            await dbService.createPlotAmount(
              plotId,
              row.Denomination,
              row.Quantity,
              row.Total,
              Branch_idBranch,
              connection,
            );
          }),
        );

        // Log
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Plot",
          plotId,
          "plot-create",
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
          res
            .status(200)
            .json({ message: "Plot added successfully", plotId, carryForward });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.log("Create Plot Error:", err);
          res
            .status(500)
            .json({ message: "Error creating plot", error: err.message });
        });
      }
    });
  });
};

const updatePlot = async (req, res) => {
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
          idPlot,
          Date_Time,
          Amount,
          Branch_idBranch,
          User_idUser,
          rows,
        } = req.body;

        await dbService.updatePlot(
          idPlot,
          Date_Time,
          Amount,
          Branch_idBranch,
          connection,
        );

        // Only update rows that have idPlot_Amount
        await Promise.all(
          rows
            .filter((row) => row.idPlot_Amount) // <-- skip rows without idPlot_Amount
            .map(async (row) => {
              await dbService.updatePlotAmount(
                row.idPlot_Amount,
                row.Denomination,
                row.Quantity,
                row.Total,
                connection,
              );
            }),
        );

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Plot",
          idPlot,
          "plot-update",
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
          res.status(200).json({ message: "Plot updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating plot:", err);
          res
            .status(500)
            .json({ message: "Error updating plot", error: err.message });
        });
      }
    });
  });
};

const deletePos = async (req, res) => {
  const { idPos } = req.params;

  // Proactive Staging for POS Void/Refund
  if (!req.is_approved_webhook) {
    try {
      const companyId = req.headers["company_id"] || 1; // Or fetch via Branch_idBranch if provided
      const approvalNeeded = await approvalService.isApprovalRequired(
        companyId, 
        null, // Branch not easily available here unless sent in body, we can pass null or try to extract from req
        'POS_VOID_REFUND'
      );
      if (approvalNeeded) {
        await approvalService.submitForApproval({
          action_type: 'POS_VOID_REFUND',
          module_name: 'POS',
          erp_record_id: idPos,
          company_id: companyId,
          branch_id: null,
          initiated_by: req.user ? req.user.id : null,
          payload_summary: JSON.stringify({
            pending_updates: {
               req_body: req.body,
               req_params: req.params,
               req_user: req.user
            }
          })
        });
        return res.status(202).json({ message: "POS Void/Refund requires approval. Sent to approval engine." });
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
        const { idPos } = req.params;
        await dbService.deletePos(idPos, connection);

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(200).json({ message: "POS deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error deleting POS:", err);
          res
            .status(500)
            .json({ message: "Error deleting POS", error: err.message });
        });
      }
    });
  });
};

const closePlot = async (req, res) => {
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
        const { idPlot, Branch_idBranch, User_idUser, closingAmount } =
          req.body;

        // Get previous plot's amount
        const [plot] = await dbService.getPlotById(idPlot);
        if (!plot) {
          connection.rollback(() => connection.release());
          return res.status(404).json({ message: "Plot not found" });
        }
        const previousAmount = parseFloat(plot.Amount) || 0;
        const carryForward = previousAmount - (parseFloat(closingAmount) || 0);

        // Update plot: set Status=1 and Carry_Forward
        await dbService.closePlotWithCarry(idPlot, carryForward, connection);

        // Log the close action
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Plot",
          idPlot,
          "plot-close",
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
          res
            .status(200)
            .json({ message: "Plot closed successfully", carryForward });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res
            .status(500)
            .json({ message: "Error closing plot", error: err.message });
        });
      }
    });
  });
};

const getPlotLogs = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    // Fetch logs for plot actions in this branch
    const logs = await dbService.fetchPlotLogs(Branch_idBranch);
    res.status(200).json({ data: logs });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching plot logs", error: err.message });
  }
};

const getPlotAmount = async (req, res) => {
  try {
    const { idPlot } = req.params;
    const rows = await dbService.fetchPlotAmountRows(idPlot);
    res.status(200).json({ data: rows });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching plot amount rows", error: err.message });
  }
};

const openRegister = async (req, res) => {
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
          user_id,
          branch_id,
          company_id,
          opening_balance,
          denominations,
          notes,
        } = req.body;

        // Check if there's already an open register for this user/branch
        // This is a SELECT, can use global db or connection. Connection ensures read-your-writes if we needed it,
        // but here it's checking state.
        const existing = await dbService.getCashierStatus(user_id, branch_id);
        if (existing) {
          connection.rollback(() => connection.release());
          return res.status(409).json({ message: "Register is already open" });
        }

        const id = await dbService.insertCashierStart(
          user_id,
          branch_id,
          company_id,
          opening_balance,
          JSON.stringify(denominations),
          notes,
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
          res.status(200).json({ message: "Register opened successfully", id });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error opening register:", err);
          res
            .status(500)
            .json({ message: "Error opening register", error: err.message });
        });
      }
    });
  });
};

const closeRegister = async (req, res) => {
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
        const { id, closing_balance, notes } = req.body;

        const result = await dbService.updateCashierStart(
          id,
          closing_balance,
          null,
          notes,
          connection,
        );

        if (result === 0) {
          connection.rollback(() => connection.release());
          return res
            .status(404)
            .json({ message: "Register session not found" });
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(200).json({ message: "Register closed successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error closing register:", err);
          res
            .status(500)
            .json({ message: "Error closing register", error: err.message });
        });
      }
    });
  });
};

const checkRegisterStatus = async (req, res) => {
  try {
    const { user_id, branch_id } = req.query;
    const session = await dbService.getCashierStatus(user_id, branch_id);
    if (!session) {
      return res.status(200).json({ status: "closed" });
    }
    res.status(200).json({ status: "open", session });
  } catch (err) {
    console.error("Error checking register status:", err);
    res
      .status(500)
      .json({ message: "Error checking status", error: err.message });
  }
};

const fetchTodaySales = async (req, res) => {
  try {
    const { userId, branchId, registryId } = req.query;
    if (!userId || !branchId) {
      return res
        .status(400)
        .json({ message: "userId and branchId are required" });
    }

    const data = await dbService.getTodaySales(userId, branchId, registryId ? parseInt(registryId) : null);
    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Error fetching today sales:", err);
    res
      .status(500)
      .json({ message: "Error fetching today sales", error: err.message });
  }
};

const fetchTodayProfit = async (req, res) => {
  try {
    const { userId, branchId } = req.query;
    if (!userId || !branchId) {
      return res
        .status(400)
        .json({ message: "userId and branchId are required" });
    }

    // Fetch VAT settings from rules
    const vatRule = await new Promise((resolve, reject) => {
      db.query(
        "SELECT vat_enabled, vat_percentage, vat_type FROM rules WHERE Branch_idBranch = ? LIMIT 1",
        [branchId],
        (err, results) => {
          if (err) reject(err);
          else resolve(results && results[0] ? results[0] : {});
        }
      );
    });
    const vatEnabled = vatRule.vat_enabled === "1" || vatRule.vat_enabled === 1;
    const vatPercentage = parseFloat(vatRule.vat_percentage || 0);
    const vatType = vatRule.vat_type || "exclusive";

    const data = await dbService.getTodayProfit(userId, branchId, { vatEnabled, vatPercentage, vatType });
    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Error fetching today profit:", err);
    res
      .status(500)
      .json({ message: "Error fetching today profit", error: err.message });
  }
};

const addCashTransaction = async (req, res) => {
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
        const { type, amount, reason, userId, branchId } = req.body;

        if (!userId || !branchId) {
          connection.rollback(() => connection.release());
          return res
            .status(400)
            .json({ message: "User and Branch are required" });
        }
        if (!amount || amount <= 0) {
          connection.rollback(() => connection.release());
          return res.status(400).json({ message: "Valid amount is required" });
        }

        // 1. Get Active Registry Session
        const registry = await dbService.getCashierStatus(userId, branchId);
        if (!registry) {
          connection.rollback(() => connection.release());
          return res
            .status(400)
            .json({ message: "No active register session found" });
        }

        // 2. Format Description
        const typeLabel = type === "in" ? "In" : "Out";
        const description = `Cashier Transaction - ${typeLabel}: ${reason}`;
        const dbType = type === "in" ? "In" : "Out";

        // 3. Insert Transaction
        await dbService.insertPosTransaction(
          0, // pos_id (0 for manual transactions not linked to a bill)
          registry.id,
          dbType,
          parseFloat(amount),
          description,
          "Cash",
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
          res
            .status(200)
            .json({ message: "Transaction recorded successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error adding cash transaction:", err);
          res.status(500).json({
            message: "Error recording transaction",
            error: err.message,
          });
        });
      }
    });
  });
};

const fetchRegisterHistory = async (req, res) => {
  try {
    const { userId, branchId } = req.params;
    const history = await dbService.getRegisterHistory(userId, branchId);
    res.status(200).json({ success: true, data: history });
  } catch (err) {
    console.error("Error fetching register history:", err);
    res
      .status(500)
      .json({ message: "Error fetching history", error: err.message });
  }
};

const fetchRegisterDetails = async (req, res) => {
  try {
    const { registryId } = req.params;
    const details = await dbService.getRegisterDetails(registryId);
    if (!details) {
      return res.status(404).json({ message: "Register session not found" });
    }
    res.status(200).json({ success: true, data: details });
  } catch (err) {
    console.error("Error fetching register details:", err);
    res
      .status(500)
      .json({ message: "Error fetching details", error: err.message });
  }
};


const applyPendingPosCreate = async (pending_updates) => {
  const req = {
    body: pending_updates.req_body,
    params: pending_updates.req_params,
    user: pending_updates.req_user,
    is_approved_webhook: true 
  };
  
  const res = {
    status: function() { return this; },
    json: function(data) { console.log("[WEBHOOK] applyPendingPosCreate result:", data); return data; },
    send: function(data) { console.log("[WEBHOOK] applyPendingPosCreate result:", data); return data; }
  };

  return await createPos(req, res);
};

const applyPendingPosDeletion = async (erp_record_id, pending_updates) => {
  const req = {
    body: pending_updates.req_body,
    params: pending_updates.req_params,
    user: pending_updates.req_user,
    is_approved_webhook: true 
  };
  
  const res = {
    status: function() { return this; },
    json: function(data) { console.log("[WEBHOOK] applyPendingPosDeletion result:", data); return data; },
    send: function(data) { console.log("[WEBHOOK] applyPendingPosDeletion result:", data); return data; }
  };

  return await deletePos(req, res);
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomerById,
  getItems,
  getItemById,
  getItemByBarcode,
  createPos,
  getSuspendedPos,
  getPosById,
  createPlot,
  updatePlot,
  closePlot,
  getPlotLogs,
  getPlotAmount,
  deletePos,
  openRegister,
  closeRegister,
  checkRegisterStatus,
  fetchTodaySales,
  fetchTodayProfit,
  addCashTransaction,
  fetchRegisterHistory,
  fetchRegisterDetails,
  applyPendingPosCreate,
  applyPendingPosDeletion,
};
