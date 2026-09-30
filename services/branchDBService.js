const db = require("../db/db");
const db2 = require("../db/db2");

const fetchBranch = (branch_id) => {
  const query = `
    SELECT 
      cb.Name AS Company, 
      branch.*
    FROM branch 
    INNER JOIN company cb  
      ON branch.Company_idCompany = cb.idCompany 
    WHERE branch.idBranch = ?`;

  return new Promise((resolve, reject) => {
    db2.query(query, [branch_id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchCompany = (company_id) => {
  const query = "SELECT * FROM company WHERE idCompany = ?";
  return new Promise((resolve, reject) => {
    db2.query(query, [company_id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const insertBranch = (
  Name,
  Address1,
  Address2,
  Address3,
  Contact_No,
  Company_idCompany,
  stock_type = "general",
  created_from_branch_id = null
) => {
  // Set default name to "Main" if not provided
  const branchName = Name && Name.trim() !== "" ? Name : "Main Branch";

  return new Promise((resolve, reject) => {
    // First, check if this is the first branch for this company in account_center database
    const checkQuery =
      "SELECT COUNT(*) as count FROM branch WHERE Company_idCompany = ?";

    // Check count from account_center database (db2)
    db2.query(checkQuery, [Company_idCompany], (checkErr, checkResults) => {
      if (checkErr) {
        return reject(checkErr);
      }

      const isFirstBranch = checkResults[0].count === 0;
      const isMainBranch = isFirstBranch ? 1 : 0;
      const fullAddress = [Address1, Address2, Address3]
        .filter(Boolean)
        .join(", ");

      // 1. Insert into asipbook_account_center database (db2) first to get canonical ID
      const accountCenterQuery =
        "INSERT INTO branch (Name, email, Company_idCompany, Registered_Date, Expire_On, Address, Contact_no, status, isMainBranch, stock_type, created_from_branch_id) VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), ?, ?, ?, ?, ?, ?)";

      db2.query(
        accountCenterQuery,
        [
          branchName,
          "", // email - empty for now
          Company_idCompany,
          fullAddress,
          Contact_No,
          1, // status active
          isMainBranch,
          stock_type || "general",
          created_from_branch_id || null,
        ],
        (err2, res2) => {
          if (err2) {
            console.error("Error inserting branch into account center:", err2);
            return reject(err2);
          }

          const canonicalBranchId = res2.insertId;

          // 2. Insert into asipiya_test database (db) with the matching canonicalBranchId
          const query =
            "INSERT INTO branch (idBranch, Name, Address1, Address2, Address3, Contact_No, Status, Company_idCompany, isMainBranch, stock_type, created_from_branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

          db.query(
            query,
            [
              canonicalBranchId,
              branchName,
              Address1,
              Address2,
              Address3,
              Contact_No,
              1,
              Company_idCompany,
              isMainBranch,
              stock_type || "general",
              created_from_branch_id || null,
            ],
            (err, results) => {
              if (err) {
                console.error("Error inserting branch into local db:", err);
                // Even if local insert has duplicate key or warning, continue with canonical ID
              }
              resolve({ insertId: canonicalBranchId });
            },
          );
        },
      );
    });
  });
};


const updateBranch = (
  idBranch,
  Name,
  Address1,
  Address2,
  Address3,
  Contact_No,
) => {
  console.log(Address1);
  // Update in account_center database (db2) - primary source of truth
  const query =
    "UPDATE branch SET Name = ?, Address = ?, Contact_no = ? WHERE idBranch = ?";
  const fullAddress = [Address1, Address2, Address3].filter(Boolean).join(", ");

  return new Promise((resolve, reject) => {
    db2.query(
      query,
      [Name, fullAddress, Contact_No, idBranch],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          // Also update in asipiya_test for sync
          const localQuery =
            "UPDATE branch SET Name = ?, Address1 = ?, Address2 = ?, Address3 = ?, Contact_No = ? WHERE idBranch = ?";
          db.query(
            localQuery,
            [Name, Address1, Address2, Address3, Contact_No, idBranch],
            (localErr) => {
              if (localErr) {
                console.error("Error updating branch in local db:", localErr);
              }
              resolve(results);
            },
          );
        }
      },
    );
  });
};

const updateCompany = (idCompany, Name) => {
  // Update in account_center database (db2) - primary source of truth
  const query = "UPDATE company SET Name = ? WHERE idCompany = ?";
  return new Promise((resolve, reject) => {
    db2.query(query, [Name, idCompany], (err, results) => {
      if (err) {
        reject(err);
      } else {
        // Also update in asipiya_test for sync
        db.query(query, [Name, idCompany], (localErr) => {
          if (localErr) {
            console.error("Error updating company in local db:", localErr);
          }
          resolve(results);
        });
      }
    });
  });
};

const insertPaymentDetails = (Branch_idBranch) => {
  const query =
    "INSERT INTO company_payment_details (Branch_idBranch) VALUES (?)";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchPaymentDetails = (Branch_idBranch) => {
  const query =
    "SELECT * FROM company_payment_details WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updatePaymentDatails = (
  Branch_idBranch,
  Penalty_Percentage,
  Interest_Rate,
) => {
  const query = `UPDATE company_payment_details 
    SET Penalty_Percentage = ?, Interest_Rate = ? 
    WHERE Branch_idBranch = ?`;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [Penalty_Percentage, Interest_Rate, Branch_idBranch],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const updateCompanyImage = (idCompany, Logo) => {
  const query = `UPDATE company SET Logo = ? WHERE idCompany = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [Logo, idCompany], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchRuleDetails = (Branch_idBranch) => {
  const query = "SELECT * FROM rules WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateRuleDetails = (
  Branch_idBranch,
  Invoice_No_Strat_From,
  Invoice_No_Start_With,
  Quotations_No_Start_With,
  Quotations_No_Start_From,
  Order_No_Strat_From,
  Order_No_Start_With,
  Invoice_Has_Header,
  Print_Type,
  POS,
  vat_enabled,
  vat_percentage,
  vat_type,
  salesman_enabled,
  salesman_required,
  salesman_invoice_update,
  Explicit_Stock_Check,
  Automatic_Categorization,
  Explicit_Warehouse_Deduct,
  advanced_invoice_generation,
  advanced_invoice_number,
  salesman_type,
  allow_bonus_products,
) => {
  const query = `UPDATE rules 
    SET Invoice_No_Strat_From = ?, Invoice_No_Start_With = ?, 
        Quotations_No_Start_With = ?, Quotations_No_Start_From = ?, 
        Order_No_Strat_From = ?, Order_No_Start_With = ?, 
        Invoice_Has_Header = ?, Print_Type = ?, POS = ?, 
        vat_enabled = ?, vat_percentage = ?, vat_type = ?,
        salesman_enabled = ?, salesman_required = ?, salesman_invoice_update = ?, Explicit_Stock_Check = ?, Automatic_Categorization = ?, Explicit_Warehouse_Deduct = ?,
        advanced_invoice_generation = ?,
        advanced_invoice_number = ?,
        salesman_type = ?,
        allow_bonus_products = ?
    WHERE Branch_idBranch = ?`;

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Invoice_No_Strat_From,
        Invoice_No_Start_With,
        Quotations_No_Start_With,
        Quotations_No_Start_From,
        Order_No_Strat_From,
        Order_No_Start_With,
        Invoice_Has_Header,
        Print_Type,
        POS,
        vat_enabled,
        vat_percentage,
        vat_type,
        salesman_enabled,
        salesman_required,
        salesman_invoice_update,
        Explicit_Stock_Check,
        Automatic_Categorization,
        Explicit_Warehouse_Deduct,
        advanced_invoice_generation,
        advanced_invoice_number,
        salesman_type,
        allow_bonus_products,
        Branch_idBranch, // last param matches WHERE placeholder
      ],
      (err, results) => {
        if (err) return reject(err);

        // If no rows updated, try INSERT
        if (results.affectedRows === 0) {
          const insertQuery = `INSERT INTO rules (
            Branch_idBranch, Invoice_No_Strat_From, Invoice_No_Start_With, 
            Quotations_No_Start_With, Quotations_No_Start_From, 
            Order_No_Strat_From, Order_No_Start_With, 
            Invoice_Has_Header, Print_Type, POS, 
            vat_enabled, vat_percentage, 
            salesman_enabled, salesman_required, salesman_invoice_update, Explicit_Stock_Check, Automatic_Categorization, Explicit_Warehouse_Deduct,
            advanced_invoice_generation,
            advanced_invoice_number,
            salesman_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

          db.query(
            insertQuery,
            [
              Branch_idBranch,
              Invoice_No_Strat_From,
              Invoice_No_Start_With,
              Quotations_No_Start_With,
              Quotations_No_Start_From,
              Order_No_Strat_From,
              Order_No_Start_With,
              Invoice_Has_Header,
              Print_Type,
              POS,
              vat_enabled,
              vat_percentage,
              salesman_enabled,
              salesman_required,
              salesman_invoice_update,
              Explicit_Stock_Check,
              Automatic_Categorization,
              Explicit_Warehouse_Deduct,
              advanced_invoice_generation,
              advanced_invoice_number,
              salesman_type,
            ],
            (insertErr, insertResults) => {
              if (insertErr) {
                // If insert fails due to duplicate entry, it means the row existed
                // but the UPDATE affected 0 rows (no changes needed).
                if (insertErr.code === "ER_DUP_ENTRY") {
                   return resolve(results);
                }
                return reject(insertErr);
              }
              resolve(insertResults);
            },
          );
        } else {
          resolve(results);
        }
      },
    );
  });
};

const updateRuleDetailsWithHeaderAndFooter = (
  Branch_idBranch,
  Invoice_No_Strat_From,
  Invoice_No_Start_With,
  Quotations_No_Start_With,
  Quotations_No_Start_From,
  Order_No_Strat_From,
  Order_No_Start_With,
  Invoice_Has_Header,
  Print_Type,
  POS,
  Invoice_Header,
  Invoice_Footer,
  vat_enabled,
  vat_percentage,
  vat_type,
  salesman_enabled,
  salesman_required,
  salesman_invoice_update,
  Explicit_Stock_Check,
  Automatic_Categorization,
  Explicit_Warehouse_Deduct,
  advanced_invoice_generation,
  advanced_invoice_number,
  salesman_type,
) => {
  const query = `UPDATE rules 
    SET Invoice_No_Strat_From = ?, Invoice_No_Start_With = ? , Quotations_No_Start_With = ? , Quotations_No_Start_From = ? , Order_No_Strat_From = ?, Order_No_Start_With = ?, Invoice_Has_Header=?, Print_Type=?, POS=?, Invoice_Header=?, Invoice_Footer=?, vat_enabled=?, vat_percentage=?, vat_type=?, salesman_enabled=?, salesman_required=?, salesman_invoice_update=?, Explicit_Stock_Check=?, Automatic_Categorization=?, Explicit_Warehouse_Deduct=?, advanced_invoice_generation=?, advanced_invoice_number=?, salesman_type=?
    WHERE Branch_idBranch = ?`;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Invoice_No_Strat_From,
        Invoice_No_Start_With,
        Quotations_No_Start_With,
        Quotations_No_Start_From,
        Order_No_Strat_From,
        Order_No_Start_With,
        Invoice_Has_Header,
        Print_Type,
        POS,
        Invoice_Header,
        Invoice_Footer,
        vat_enabled,
        vat_percentage,
        vat_type,
        salesman_enabled,
        salesman_required,
        salesman_invoice_update,
        Explicit_Stock_Check,
        Automatic_Categorization,
        Explicit_Warehouse_Deduct,
        advanced_invoice_generation,
        advanced_invoice_number,
        salesman_type,
        Branch_idBranch,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};
const updateRuleDetailsWithHeader = (
  Branch_idBranch,
  Invoice_No_Strat_From,
  Invoice_No_Start_With,
  Quotations_No_Start_With,
  Quotations_No_Start_From,
  Order_No_Strat_From,
  Order_No_Start_With,
  Invoice_Has_Header,
  Print_Type,
  POS,
  Invoice_Header,
  vat_enabled,
  vat_percentage,
  vat_type,
  salesman_enabled,
  salesman_required,
  salesman_invoice_update,
  Explicit_Stock_Check,
  Automatic_Categorization,
  Explicit_Warehouse_Deduct,
  advanced_invoice_generation,
  advanced_invoice_number,
  salesman_type,
) => {
  const query = `UPDATE rules 
    SET Invoice_No_Strat_From = ?, Invoice_No_Start_With = ? , Quotations_No_Start_With = ? , Quotations_No_Start_From = ? , Order_No_Strat_From = ?, Order_No_Start_With = ?, Invoice_Has_Header=?, Invoice_Header=?,  Print_Type=?, POS=?, vat_enabled=?, vat_percentage=?, vat_type=?, salesman_enabled=?, salesman_required=?, salesman_invoice_update=?, Explicit_Stock_Check=?, Automatic_Categorization=?, Explicit_Warehouse_Deduct=?, advanced_invoice_generation=?, advanced_invoice_number=?, salesman_type=?
    WHERE Branch_idBranch = ?`;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Invoice_No_Strat_From,
        Invoice_No_Start_With,
        Quotations_No_Start_With,
        Quotations_No_Start_From,
        Order_No_Strat_From,
        Order_No_Start_With,
        Invoice_Has_Header,
        Invoice_Header,
        Print_Type,
        POS,
        vat_enabled,
        vat_percentage,
        vat_type,
        salesman_enabled,
        salesman_required,
        salesman_invoice_update,
        Explicit_Stock_Check,
        Automatic_Categorization,
        Explicit_Warehouse_Deduct,
        advanced_invoice_generation,
        advanced_invoice_number,
        salesman_type,
        Branch_idBranch,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};
const updateRuleDetailsWithFooter = (
  Branch_idBranch,
  Invoice_No_Strat_From,
  Invoice_No_Start_With,
  Quotations_No_Start_With,
  Quotations_No_Start_From,
  Order_No_Strat_From,
  Order_No_Start_With,
  Invoice_Has_Header,
  Print_Type,
  POS,
  Invoice_Footer,
  vat_enabled,
  vat_percentage,
  vat_type,
  salesman_enabled,
  salesman_required,
  salesman_invoice_update,
  Explicit_Stock_Check,
  Automatic_Categorization,
  Explicit_Warehouse_Deduct,
  advanced_invoice_generation,
  advanced_invoice_number,
  salesman_type,
) => {
  const query = `UPDATE rules 
    SET Invoice_No_Strat_From = ?, Invoice_No_Start_With = ? , Quotations_No_Start_With = ? , Quotations_No_Start_From = ? , Order_No_Strat_From = ?, Order_No_Start_With = ?, Invoice_Has_Header=?, Print_Type=?, POS=?, Invoice_Footer=?, vat_enabled=?, vat_percentage=?, vat_type=?, salesman_enabled=?, salesman_required=?, salesman_invoice_update=?, Explicit_Stock_Check=?, Automatic_Categorization=?, Explicit_Warehouse_Deduct=?, advanced_invoice_generation=?, advanced_invoice_number=?, salesman_type=?
    WHERE Branch_idBranch = ?`;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Invoice_No_Strat_From,
        Invoice_No_Start_With,
        Quotations_No_Start_With,
        Quotations_No_Start_From,
        Order_No_Strat_From,
        Order_No_Start_With,
        Invoice_Has_Header,
        Print_Type,
        POS,
        Invoice_Footer,
        vat_enabled,
        vat_percentage,
        vat_type,
        salesman_enabled,
        salesman_required,
        salesman_invoice_update,
        Explicit_Stock_Check,
        Automatic_Categorization,
        Explicit_Warehouse_Deduct,
        advanced_invoice_generation,
        advanced_invoice_number,
        salesman_type,
        Branch_idBranch,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const getUsersByBranch = (Branch_idBranch) => {
  return new Promise((resolve, reject) => {
    const userQuery = `
      SELECT * FROM user WHERE Branch_idBranch = ?
    `;

    db.query(userQuery, [Branch_idBranch], async (err, users) => {
      if (err) return reject(err);

      try {
        const userIds = users.map((user) => user.idUser);
        if (userIds.length === 0) return resolve([]);

        const fieldQuery = `
          SELECT 
            sfd.user_id,
            sfd.field_id,
            sfd.value,
            sf.field_name as field_name
          FROM staff_field_data sfd
          LEFT JOIN staff_fields sf ON sfd.field_id = sf.id
          WHERE sfd.user_id IN (?)
        `;

        db.query(fieldQuery, [userIds], (fieldErr, fieldResults) => {
          if (fieldErr) return reject(fieldErr);

          // Organize custom fields by user_id
          const customFieldsMap = {};
          for (const field of fieldResults) {
            if (!customFieldsMap[field.user_id]) {
              customFieldsMap[field.user_id] = [];
            }

            customFieldsMap[field.user_id].push({
              fieldId: field.field_id,
              fieldName: field.field_name,
              value: field.value,
            });
          }

          // Append custom fields to each user
          const usersWithCustomFields = users.map((user) => ({
            ...user,
            customFields: customFieldsMap[user.idUser] || [],
          }));

          resolve(usersWithCustomFields);
        });
      } catch (innerErr) {
        reject(innerErr);
      }
    });
  });
};

const getUsersPrivilages = (User_idUser, Branch_idBranch) => {
  // When Branch_idBranch is supplied, filter to the exact row for this company's branch.
  // This prevents stale privilege rows from other companies/branches being returned
  // for users who belong to multiple companies.
  const query = Branch_idBranch != null
    ? "SELECT * FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ? LIMIT 1"
    : "SELECT * FROM user_privilages WHERE User_idUser = ? LIMIT 1";
  const params = Branch_idBranch != null ? [User_idUser, Branch_idBranch] : [User_idUser];
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

/**
 * Check if a user is an Owner, Admin, or Main Account
 * @param {number|string} userId
 * @param {number|string} branchId
 * @param {number|string} userRole
 * @returns {Promise<boolean>}
 */
const isOwnerOrAdminUser = async (userId, branchId = null, userRole = null) => {
  if (!userId) return false;

  // 1. Explicit Role from frontend/cookie/token
  if (
    Number(userRole) === 1 ||
    String(userRole) === "1" ||
    userRole === "Admin" ||
    userRole === "Owner" ||
    userRole === "admin" ||
    userRole === "owner"
  ) {
    return true;
  }

  // 2. Resolve companyId if branchId provided
  let companyId = null;
  if (branchId) {
    try {
      companyId = await getCompanyIdByBranch(branchId);
    } catch (_) {}
  }

  // 3. Check company_has_asipiya_user in db2 (central account center)
  try {
    let query = "SELECT Role FROM company_has_asipiya_user WHERE Asipiya_User_idAsipiya_User = ? AND Status = '1'";
    const params = [userId];
    if (companyId) {
      query += " AND Company_idCompany = ?";
      params.push(companyId);
    }
    const [roles] = await db2.promise().query(query, params);
    const hasAdminOrOwnerRole = roles.some(
      (r) =>
        r.Role === "Owner" ||
        r.Role === "Admin" ||
        r.Role === "owner" ||
        r.Role === "admin" ||
        Number(r.Role) === 1
    );
    if (hasAdminOrOwnerRole) {
      return true;
    }
  } catch (e) {
    console.error("Error checking db2 company_has_asipiya_user:", e);
  }

  // 4. Check user table in local tenant db
  try {
    const [localUser] = await db.promise().query(
      "SELECT Role FROM user WHERE idUser = ? LIMIT 1",
      [userId]
    );
    if (localUser && localUser.length > 0) {
      const r = localUser[0].Role;
      if (
        Number(r) === 1 ||
        String(r) === "1" ||
        r === "Admin" ||
        r === "Owner" ||
        r === "admin" ||
        r === "owner"
      ) {
        return true;
      }
    }
  } catch (e) {}

  // 5. Check user_privilages in local tenant db for Route_Management
  try {
    const [privRows] = await db.promise().query(
      "SELECT Route_Management FROM user_privilages WHERE User_idUser = ? AND (Branch_idBranch = ? OR Branch_idBranch = 0 OR Branch_idBranch IS NULL) ORDER BY Branch_idBranch DESC LIMIT 1",
      [userId, branchId || 0]
    );
    if (privRows && privRows.length > 0 && privRows[0].Route_Management === 1) {
      return true;
    }
  } catch (e) {}

  return false;
};

/**
 * Check if the given user is restricted to viewing only their own created/assigned data
 */
const getUserDataScope = async (userId, branchId, userRole = null) => {
  if (!userId) return { isRestricted: false, userId: null };

  const isOwnerOrAdmin = await isOwnerOrAdminUser(userId, branchId, userRole);
  if (isOwnerOrAdmin) {
    return {
      isRestricted: false,
      showOnlyUserData: false,
      isRouteStaff: false,
      userId,
    };
  }

  return new Promise((resolve) => {
    const query = branchId != null
      ? "SELECT Show_Only_User_Data, Route_Management, Daily_Route_View FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ? LIMIT 1"
      : "SELECT Show_Only_User_Data, Route_Management, Daily_Route_View FROM user_privilages WHERE User_idUser = ? LIMIT 1";
    const params = branchId != null ? [userId, branchId] : [userId];
    db.query(query, params, (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return resolve({ isRestricted: false, userId });
      }
      const showOnlyUserData = rows[0].Show_Only_User_Data === 1;
      const isRouteStaff = rows[0].Daily_Route_View === 1 && rows[0].Route_Management === 0;
      resolve({
        isRestricted: showOnlyUserData || isRouteStaff,
        showOnlyUserData,
        isRouteStaff,
        userId,
      });
    });
  });
};

const updateUserPrivileges = (
  User_idUser,
  Account,
  Customer_Management,
  Add_Customer,
  Edit_Customer,
  Change_Customer_Status,
  Customer_Credit_Logs,
  Record_Payment,
  Customer_Returns,
  Add_Customer_Return,
  Edit_Customer_Return,
  Process_Customer_Return,
  Quotation_Management,
  Add_Quotation,
  Edit_Quotation,
  Delete_Quotation,
  Invoices,
  Add_Invoices,
  Edit_Invoices,
  Delete_Invoices,
  Due_Payments,
  Process_Due_Payments,
  Product_Category_Management,
  Add_Edit_Product_Category_Management,
  Products_Management,
  Add_Products,
  Edit_Products,
  Add_Quantity,
  Adjust_Quantity,
  Change_Status_Products,
  GRN,
  Add_Grns,
  Edit_Grns,
  Process_Grns,
  Barcodes,
  Damage_Note,
  Add_Damage_Note,
  Suppliers_Management,
  Add_Suppliers_Management,
  Edit_Suppliers_Management,
  Change_Suppliers_Management_Status,
  Delete_Suppliers_Management,
  Supplier_Credit_Logs,
  Purchase_Returns,
  Add_Purchase_Returns,
  Edit_Purchase_Returns,
  Process_Purchase_Returns,
  Salesmen,
  Add_Salesmen,
  Edit_Salesmen,
  Change_Salesmen_Status,
  Earnings_Expenses,
  Add_Earnings_Expenses,
  Earnings_Expenses_Cateogry,
  Reports,
  Item_Reports,
  Customer_Credit_Log_Reports,
  Invoice_Detail_Reports,
  Stock_Card_Reports,
  PL_Reports,
  Apps,
  Stock_Detail_Reports,
  Supplier_Reports,
  Earning_Reports,
  Expenses_Reports,
  Customer_Reports,
  User_Reports,
  Product_Reports,
  Payment_Reports,
  Return_Reports,
  Monthly_Sales_Reports,
  Daily_Sales_Reports,
  POS,
) => {
  const query = `UPDATE 
    user_privilages 
    SET 
    Account = ?, 
    Customer_Management = ?, 
    Add_Customer  = ?,
    Edit_Customer  = ?,
    Change_Customer_Status  = ?,
    Customer_Credit_Logs = ?, 
    Record_Payment = ?, 
    Customer_Returns = ?, 
    Add_Customer_Return = ?,
    Edit_Customer_Return = ?,
    Process_Customer_Return = ?,
    Quotation_Management = ?, 
    Add_Quotation = ?,
    Edit_Quotation = ?,
    Delete_Quotation = ?,
    Invoices = ?, 
    Add_Invoices = ?,
    Edit_Invoices = ?,
    Delete_Invoices = ?,
    Due_Payments = ?, 
    Process_Due_Payments = ?,
    Product_Category_Management = ?,
    Add_Edit_Product_Category_Management = ?,
    Products_Management = ?, 
    Add_Products = ?,
    Edit_Products = ?,
    Add_Quantity = ?,
    Adjust_Quantity = ?,
    Change_Status_Products = ?,
    GRN = ?, 
    Add_Grns = ?,
    Edit_Grns = ?,
    Process_Grns = ?,
    Barcodes = ?, 
    Damage_Note = ?,
    Add_Damage_Note = ?,
    Suppliers_Management = ?,
    Add_Suppliers_Management = ?,
    Edit_Suppliers_Management = ?,
    Change_Suppliers_Management_Status = ?,
    Delete_Suppliers_Management = ?,
    Supplier_Credit_Logs = ?, 
    Purchase_Returns = ?, 
    Add_Purchase_Returns = ?,
    Edit_Purchase_Returns = ?,
    Process_Purchase_Returns = ?,
    Salesmen = ?, 
    Add_Salesmen = ?,
    Edit_Salesmen = ?,
    Change_Salesmen_Status = ?,
    Earnings_Expenses = ?, 
    Add_Earnings_Expenses = ?,
    Earnings_Expenses_Cateogry = ?,
    Reports = ?, 
    Item_Reports = ?,
    Customer_Credit_Log_Reports = ?,
    Invoice_Detail_Reports = ?,
    Stock_Card_Reports = ?,
    PL_Reports = ?,
    Apps = ?,
    Stock_Detail_Reports = ?,
    Supplier_Reports = ?, 
    Earning_Reports = ?,
    Expenses_Reports = ?,
    Customer_Reports = ?,
    User_Reports = ?,
    Product_Reports = ?,
    Payment_Reports = ?,
    Return_Reports = ?,
    Monthly_Sales_Reports = ?,
    Daily_Sales_Reports = ?,
    POS=?
    WHERE User_idUser = ?`;

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Account,
        Customer_Management,
        Add_Customer,
        Edit_Customer,
        Change_Customer_Status,
        Customer_Credit_Logs,
        Record_Payment,
        Customer_Returns,
        Add_Customer_Return,
        Edit_Customer_Return,
        Process_Customer_Return,
        Quotation_Management,
        Add_Quotation,
        Edit_Quotation,
        Delete_Quotation,
        Invoices,
        Add_Invoices,
        Edit_Invoices,
        Delete_Invoices,
        Due_Payments,
        Process_Due_Payments,
        Product_Category_Management,
        Add_Edit_Product_Category_Management,
        Products_Management,
        Add_Products,
        Edit_Products,
        Add_Quantity,
        Adjust_Quantity,
        Change_Status_Products,
        GRN,
        Add_Grns,
        Edit_Grns,
        Process_Grns,
        Barcodes,
        Damage_Note,
        Add_Damage_Note,
        Suppliers_Management,
        Add_Suppliers_Management,
        Edit_Suppliers_Management,
        Change_Suppliers_Management_Status,
        Delete_Suppliers_Management,
        Supplier_Credit_Logs,
        Purchase_Returns,
        Add_Purchase_Returns,
        Edit_Purchase_Returns,
        Process_Purchase_Returns,
        Salesmen,
        Add_Salesmen,
        Edit_Salesmen,
        Change_Salesmen_Status,
        Earnings_Expenses,
        Add_Earnings_Expenses,
        Earnings_Expenses_Cateogry,
        Reports,
        Item_Reports,
        Customer_Credit_Log_Reports,
        Invoice_Detail_Reports,
        Stock_Card_Reports,
        PL_Reports,
        Apps,
        Stock_Detail_Reports,
        Supplier_Reports,
        Earning_Reports,
        Expenses_Reports,
        Customer_Reports,
        User_Reports,
        Product_Reports,
        Payment_Reports,
        Return_Reports,
        Monthly_Sales_Reports,
        Daily_Sales_Reports,
        POS,
        User_idUser,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};
const createUserPrivileges = (
  User_idUser,
  Branch_idBranch,
  Account,
  Customer_Management,
  Add_Customer,
  Edit_Customer,
  Change_Customer_Status,
  Customer_Credit_Logs,
  Record_Payment,
  Customer_Returns,
  Add_Customer_Return,
  Edit_Customer_Return,
  Process_Customer_Return,
  Quotation_Management,
  Add_Quotation,
  Edit_Quotation,
  Delete_Quotation,
  Invoices,
  Add_Invoices,
  Edit_Invoices,
  Delete_Invoices,
  Due_Payments,
  Process_Due_Payments,
  Product_Category_Management,
  Add_Edit_Product_Category_Management,
  Products_Management,
  Add_Products,
  Edit_Products,
  Add_Quantity,
  Adjust_Quantity,
  Change_Status_Products,
  GRN,
  Add_Grns,
  Edit_Grns,
  Process_Grns,
  Barcodes,
  Damage_Note,
  Add_Damage_Note,
  Suppliers_Management,
  Add_Suppliers_Management,
  Edit_Suppliers_Management,
  Change_Suppliers_Management_Status,
  Delete_Suppliers_Management,
  Supplier_Credit_Logs,
  Purchase_Returns,
  Add_Purchase_Returns,
  Edit_Purchase_Returns,
  Process_Purchase_Returns,
  Salesmen,
  Add_Salesmen,
  Edit_Salesmen,
  Change_Salesmen_Status,
  Earnings_Expenses,
  Add_Earnings_Expenses,
  Earnings_Expenses_Cateogry,
  Reports,
  Item_Reports,
  Customer_Credit_Log_Reports,
  Invoice_Detail_Reports,
  Stock_Card_Reports,
  PL_Reports,
  Apps,
  Stock_Detail_Reports,
  Supplier_Reports,
  Earning_Reports,
  Expenses_Reports,
  Customer_Reports,
  User_Reports,
  Product_Reports,
  Payment_Reports,
  Return_Reports,
  Monthly_Sales_Reports,
  Daily_Sales_Reports,
  Maximum_Item_Discount,
  Maximum_Bill_Discount,
  Service_Jobs,
  Add_Service_Job,
  Edit_Service_Job,
  Estimates,
  Add_Estimate,
  Edit_Estimate,
  Purchase_Order,
  Add_Purchase_Order,
  Edit_Purchase_Order,
  Manufacturing,
  Add_Manufacturing_Job,
  Edit_Manufacturing_Job,
  Material_Issues,
  Add_Material_Issue,
  Edit_Material_Issue,
  Store_Approvals,
  SMS_App,
  Projects_App,
  Documents_App,
  Appointments_App,
  Edit_Payment,
  Delete_Payment,
  Quotation_Settings,
  Service_Job_Settings,
  Estimate_Settings,
  Invoice_Settings,
  PO_Settings,
  GRN_Settings,
  Custom_Configurations,
  Advance_Report_Generation,
  Invoice_Item_Reports,
  Serial_No_Reports,
  Customer_Return_Report,
  Accounts,
  Add_Accounts,
  Delivery,
  Cheque_Management,
  Designations,
  connection,
) => {
  console.log(Apps);
  const query = `INSERT INTO 
    user_privilages (
      User_idUser,
      Branch_idBranch,
  Account,
  Customer_Management,
  Add_Customer,
  Edit_Customer,
  Change_Customer_Status,
  Customer_Credit_Logs,
  Record_Payment,
  Customer_Returns,
  Add_Customer_Return,
  Edit_Customer_Return,
  Process_Customer_Return,
  Quotation_Management,
  Add_Quotation,
  Edit_Quotation,
  Delete_Quotation,
  Invoices,
  Add_Invoices,
  Edit_Invoices,
  Delete_Invoices,
  Due_Payments,
  Process_Due_Payments,
  Product_Category_Management,
  Add_Edit_Product_Category_Management,
  Products_Management,
  Add_Products,
  Edit_Products,
  Add_Quantity,
  Adjust_Quantity,
  Change_Status_Products,
  GRN,
  Add_Grns,
  Edit_Grns,
  Process_Grns,
  Barcodes,
  Damage_Note,
  Add_Damage_Note,
  Suppliers_Management,
  Add_Suppliers_Management,
  Edit_Suppliers_Management,
  Change_Suppliers_Management_Status,
  Delete_Suppliers_Management,
  Supplier_Credit_Logs,
  Purchase_Returns,
  Add_Purchase_Returns,
  Edit_Purchase_Returns,
  Process_Purchase_Returns,
  Salesmen,
  Add_Salesmen,
  Edit_Salesmen,
  Change_Salesmen_Status,
  Earnings_Expenses,
  Add_Earnings_Expenses,
  Earnings_Expenses_Cateogry,
  Reports,
  Item_Reports,
  Customer_Credit_Log_Reports,
  Invoice_Detail_Reports,
  Stock_Card_Reports,
  PL_Reports,
  Apps,
  Stock_Detail_Reports,
  Supplier_Reports,
  Earning_Reports,
  Expenses_Reports,
  Customer_Reports,
  User_Reports,
  Product_Reports,
  Payment_Reports,
  Return_Reports,
  Monthly_Sales_Reports,
  Daily_Sales_Reports,
  Maximum_Item_Discount,
  Maximum_Bill_Discount,
  Service_Jobs,
  Add_Service_Job,
  Edit_Service_Job,
  Estimates,
  Add_Estimate,
  Edit_Estimate,
  Purchase_Order,
  Add_Purchase_Order,
  Edit_Purchase_Order,
  Manufacturing,
  Add_Manufacturing_Job,
  Edit_Manufacturing_Job,
  Material_Issues,
  Add_Material_Issue,
  Edit_Material_Issue,
  Store_Approvals,
  SMS_App,
  Projects_App,
  Documents_App,
  Appointments_App,
  Edit_Payment,
  Delete_Payment,
  Quotation_Settings,
  Service_Job_Settings,
  Estimate_Settings,
  Invoice_Settings,
  PO_Settings,
  GRN_Settings,
  Custom_Configurations,
  Advance_Report_Generation,
  Invoice_Item_Reports,
  Serial_No_Reports,
  Customer_Return_Report,
  Accounts,
  Add_Accounts,
  Delivery,
  Cheque_Management,
  Designations
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        User_idUser,
        Branch_idBranch,
        Account,
        Customer_Management,
        Add_Customer,
        Edit_Customer,
        Change_Customer_Status,
        Customer_Credit_Logs,
        Record_Payment,
        Customer_Returns,
        Add_Customer_Return,
        Edit_Customer_Return,
        Process_Customer_Return,
        Quotation_Management,
        Add_Quotation,
        Edit_Quotation,
        Delete_Quotation,
        Invoices,
        Add_Invoices,
        Edit_Invoices,
        Delete_Invoices,
        Due_Payments,
        Process_Due_Payments,
        Product_Category_Management,
        Add_Edit_Product_Category_Management,
        Products_Management,
        Add_Products,
        Edit_Products,
        Add_Quantity,
        Adjust_Quantity,
        Change_Status_Products,
        GRN,
        Add_Grns,
        Edit_Grns,
        Process_Grns,
        Barcodes,
        Damage_Note,
        Add_Damage_Note,
        Suppliers_Management,
        Add_Suppliers_Management,
        Edit_Suppliers_Management,
        Change_Suppliers_Management_Status,
        Delete_Suppliers_Management,
        Supplier_Credit_Logs,
        Purchase_Returns,
        Add_Purchase_Returns,
        Edit_Purchase_Returns,
        Process_Purchase_Returns,
        Salesmen,
        Add_Salesmen,
        Edit_Salesmen,
        Change_Salesmen_Status,
        Earnings_Expenses,
        Add_Earnings_Expenses,
        Earnings_Expenses_Cateogry,
        Reports,
        Item_Reports,
        Customer_Credit_Log_Reports,
        Invoice_Detail_Reports,
        Stock_Card_Reports,
        PL_Reports,
        Apps,
        Stock_Detail_Reports,
        Supplier_Reports,
        Earning_Reports,
        Expenses_Reports,
        Customer_Reports,
        User_Reports,
        Product_Reports,
        Payment_Reports,
        Return_Reports,
        Monthly_Sales_Reports,
        Daily_Sales_Reports,
        Maximum_Item_Discount,
        Maximum_Bill_Discount,
        Service_Jobs,
        Add_Service_Job,
        Edit_Service_Job,
        Estimates,
        Add_Estimate,
        Edit_Estimate,
        Purchase_Order,
        Add_Purchase_Order,
        Edit_Purchase_Order,
        Manufacturing,
        Add_Manufacturing_Job,
        Edit_Manufacturing_Job,
        Material_Issues,
        Add_Material_Issue,
        Edit_Material_Issue,
        Store_Approvals,
        SMS_App,
        Projects_App,
        Documents_App,
        Appointments_App,
        Edit_Payment,
        Delete_Payment,
        Quotation_Settings,
        Service_Job_Settings,
        Estimate_Settings,
        Invoice_Settings,
        PO_Settings,
        GRN_Settings,
        Custom_Configurations,
        Advance_Report_Generation,
        Invoice_Item_Reports,
        Serial_No_Reports,
        Customer_Return_Report,
        Accounts,
        Add_Accounts,
        Delivery,
        Cheque_Management,
        Designations,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const getAllBranchesByCompany = (Company_idCompany) => {
  const query = `
    SELECT 
      b.idBranch,
      b.Name,
      b.Address AS Address1,
      '' AS Address2,
      '' AS Address3,
      b.Contact_no AS Contact_No,
      'A4' AS Print_Size,
      b.status AS Status,
      b.Company_idCompany,
      c.Name AS CompanyName,
      COALESCE(b.isMainBranch, 0) AS isMainBranch,
      COALESCE(b.stock_type, 'general') AS stock_type,
      b.created_from_branch_id
    FROM branch b
    INNER JOIN company c ON b.Company_idCompany = c.idCompany
    WHERE b.Company_idCompany = ?
    ORDER BY b.isMainBranch DESC, b.idBranch ASC`;

  return new Promise((resolve, reject) => {
    db2.query(query, [Company_idCompany], async (err, results) => {
      if (err) {
        reject(err);
      } else {
        const branches = JSON.parse(JSON.stringify(results));
        if (branches.length === 0) return resolve([]);

        try {
          const branchIds = branches.map((b) => b.idBranch);
          const [stockStats] = await db.promise().query(
            `SELECT Branch_idBranch, COUNT(*) as total_items, COALESCE(SUM(CAST(Qty AS DECIMAL(10,2))), 0) as total_stock
             FROM item
             WHERE Branch_idBranch IN (?)
             GROUP BY Branch_idBranch`,
            [branchIds]
          );

          const statsMap = {};
          (stockStats || []).forEach((s) => {
            statsMap[s.Branch_idBranch] = {
              total_items: s.total_items,
              total_stock: parseFloat(s.total_stock) || 0,
            };
          });

          branches.forEach((b) => {
            b.total_items = statsMap[b.idBranch]?.total_items || 0;
            b.total_stock = statsMap[b.idBranch]?.total_stock || 0;
          });
        } catch (stockErr) {
          console.error("Error fetching branch stock stats:", stockErr);
        }

        resolve(branches);
      }
    });
  });
};

/**
 * Creates a default warehouse for a newly registered branch if one does not already exist
 */
const createDefaultWarehouse = async (branchId, branchName, userId) => {
  return new Promise(async (resolve) => {
    try {
      const [existing] = await db.promise().query(
        "SELECT id FROM warehouses WHERE branch_id = ? LIMIT 1",
        [branchId]
      );
      if (existing && existing.length > 0) {
        return resolve(existing[0].id);
      }

      const whName = `${branchName || "Branch"} Main Warehouse`;
      const [insertRes] = await db.promise().query(
        "INSERT INTO warehouses (branch_id, Branch_BranchId, name, warehouse_code, stock_count, item_count, created_by) VALUES (?, ?, ?, ?, 0, 0, ?)",
        [branchId, branchId, whName, `WH-${branchId}`, userId || 1]
      );
      resolve(insertRes.insertId);
    } catch (err) {
      console.error("[createDefaultWarehouse] Error creating warehouse:", err);
      resolve(null);
    }
  });
};

/**
 * Clones all catalog items from a source branch (usually Main Branch) to a new target branch.
 * Copies items, item_variations, product_barcodes, product_images, and product_field_data.
 */
const cloneCatalogForBranch = async (
  sourceBranchId,
  targetBranchId,
  { copyQuantities = false, userId = null } = {}
) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!sourceBranchId || !targetBranchId) {
        return resolve({ success: true, clonedCount: 0 });
      }

      // Fetch all items from source branch
      const [sourceItems] = await db.promise().query(
        "SELECT * FROM item WHERE Branch_idBranch = ?",
        [sourceBranchId]
      );

      if (!sourceItems || sourceItems.length === 0) {
        return resolve({ success: true, clonedCount: 0 });
      }

      console.log(
        `[cloneCatalogForBranch] Cloning ${sourceItems.length} items from Branch ${sourceBranchId} to Branch ${targetBranchId} (copyQuantities: ${copyQuantities})`
      );

      let clonedCount = 0;

      for (const item of sourceItems) {
        const sourceItemId = item.idItem;
        const itemCopy = { ...item };
        delete itemCopy.idItem;
        itemCopy.Branch_idBranch = targetBranchId;
        itemCopy.Qty = copyQuantities ? (itemCopy.Qty || 0) : 0;
        itemCopy.Status = itemCopy.Status !== undefined ? itemCopy.Status : 1;

        const [itemResult] = await db
          .promise()
          .query("INSERT INTO item SET ?", [itemCopy]);
        const newItemId = itemResult.insertId;
        clonedCount++;

        // 1. Clone item_variations
        const [variations] = await db
          .promise()
          .query("SELECT * FROM item_variations WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const v of variations) {
          const vCopy = { ...v };
          delete vCopy.id;
          delete vCopy.created_at;
          delete vCopy.updated_at;
          vCopy.item_id = newItemId;
          vCopy.qty = copyQuantities ? (vCopy.qty || 0) : 0;
          await db.promise().query("INSERT INTO item_variations SET ?", [vCopy]);
        }

        // 2. Clone product_barcodes
        const [barcodes] = await db
          .promise()
          .query("SELECT * FROM product_barcodes WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const b of barcodes) {
          const bCopy = { ...b };
          delete bCopy.id;
          delete bCopy.created_at;
          bCopy.item_id = newItemId;
          await db.promise().query("INSERT INTO product_barcodes SET ?", [bCopy]);
        }

        // 3. Clone product_images
        const [images] = await db
          .promise()
          .query("SELECT * FROM product_images WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const img of images) {
          const imgCopy = { ...img };
          delete imgCopy.id;
          imgCopy.item_id = newItemId;
          await db.promise().query("INSERT INTO product_images SET ?", [imgCopy]);
        }

        // 4. Clone product_field_data
        const [fields] = await db
          .promise()
          .query("SELECT * FROM product_field_data WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const f of fields) {
          const fCopy = { ...f };
          delete fCopy.id;
          delete fCopy.created_at;
          delete fCopy.updated_at;
          fCopy.item_id = newItemId;
          await db.promise().query("INSERT INTO product_field_data SET ?", [fCopy]);
        }

        // 5. Audit log if opening stock was copied
        if (copyQuantities && parseFloat(itemCopy.Qty) > 0) {
          try {
            await db.promise().query(
              `INSERT INTO product_history_log 
               (Product_idProduct, Date_Time, Type, Description, Quantity_Change, Old_Quantity, New_Quantity, User_idUser, Branch_idBranch, Reference_ID)
               VALUES (?, NOW(), ?, ?, ?, 0, ?, ?, ?, ?)`,
              [
                newItemId,
                "Branch Cloned Stock",
                `Catalog cloned from Branch ${sourceBranchId} with opening stock`,
                parseFloat(itemCopy.Qty),
                parseFloat(itemCopy.Qty),
                userId || null,
                targetBranchId,
                sourceItemId,
              ]
            );
          } catch (logErr) {
            console.warn("Could not log to product_history_log:", logErr.message);
          }
        }
      }

      resolve({ success: true, clonedCount });
    } catch (err) {
      console.error("[cloneCatalogForBranch] Error:", err);
      reject(err);
    }
  });
};

/**
 * Syncs any newly created products from source branch into target branch (for General Stock branches).
 */
const syncCatalogToBranch = async (
  sourceBranchId,
  targetBranchId,
  { copyQuantities = false, userId = null } = {}
) => {
  return new Promise(async (resolve, reject) => {
    try {
      const [sourceItems] = await db.promise().query(
        "SELECT * FROM item WHERE Branch_idBranch = ?",
        [sourceBranchId]
      );
      if (!sourceItems || sourceItems.length === 0) {
        return resolve({ success: true, syncedCount: 0, message: "No source items found" });
      }

      const [targetItems] = await db.promise().query(
        "SELECT Description, Item_Code FROM item WHERE Branch_idBranch = ?",
        [targetBranchId]
      );
      const existingKeys = new Set(
        targetItems.map(
          (t) => `${(t.Item_Code || "").trim().toLowerCase()}_${(t.Description || "").trim().toLowerCase()}`
        )
      );

      const missingItems = sourceItems.filter((s) => {
        const key = `${(s.Item_Code || "").trim().toLowerCase()}_${(s.Description || "").trim().toLowerCase()}`;
        return !existingKeys.has(key);
      });

      if (missingItems.length === 0) {
        return resolve({
          success: true,
          syncedCount: 0,
          message: "All items from Main Branch are already in this branch catalog",
        });
      }

      let syncedCount = 0;
      for (const item of missingItems) {
        const sourceItemId = item.idItem;
        const itemCopy = { ...item };
        delete itemCopy.idItem;
        itemCopy.Branch_idBranch = targetBranchId;
        itemCopy.Qty = copyQuantities ? (itemCopy.Qty || 0) : 0;
        itemCopy.Status = itemCopy.Status !== undefined ? itemCopy.Status : 1;

        const [itemResult] = await db
          .promise()
          .query("INSERT INTO item SET ?", [itemCopy]);
        const newItemId = itemResult.insertId;
        syncedCount++;

        const [variations] = await db
          .promise()
          .query("SELECT * FROM item_variations WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const v of variations) {
          const vCopy = { ...v };
          delete vCopy.id;
          delete vCopy.created_at;
          delete vCopy.updated_at;
          vCopy.item_id = newItemId;
          vCopy.qty = copyQuantities ? (vCopy.qty || 0) : 0;
          await db.promise().query("INSERT INTO item_variations SET ?", [vCopy]);
        }

        const [barcodes] = await db
          .promise()
          .query("SELECT * FROM product_barcodes WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const b of barcodes) {
          const bCopy = { ...b };
          delete bCopy.id;
          delete bCopy.created_at;
          bCopy.item_id = newItemId;
          await db.promise().query("INSERT INTO product_barcodes SET ?", [bCopy]);
        }

        const [images] = await db
          .promise()
          .query("SELECT * FROM product_images WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const img of images) {
          const imgCopy = { ...img };
          delete imgCopy.id;
          imgCopy.item_id = newItemId;
          await db.promise().query("INSERT INTO product_images SET ?", [imgCopy]);
        }

        const [fields] = await db
          .promise()
          .query("SELECT * FROM product_field_data WHERE item_id = ?", [
            sourceItemId,
          ]);
        for (const f of fields) {
          const fCopy = { ...f };
          delete fCopy.id;
          delete fCopy.created_at;
          delete fCopy.updated_at;
          fCopy.item_id = newItemId;
          await db.promise().query("INSERT INTO product_field_data SET ?", [fCopy]);
        }
      }

      resolve({
        success: true,
        syncedCount,
        message: `Successfully synced ${syncedCount} new item(s) to branch`,
      });
    } catch (err) {
      console.error("[syncCatalogToBranch] Error:", err);
      reject(err);
    }
  });
};

/**
 * Returns inventory and stock summary for a specific branch
 */
const getBranchStockSummary = async (branchId) => {
  return new Promise(async (resolve, reject) => {
    try {
      const [stats] = await db.promise().query(
        `SELECT 
           COUNT(*) as total_items, 
           COALESCE(SUM(CAST(Qty AS DECIMAL(10,2))), 0) as total_stock,
           COALESCE(SUM(CAST(Qty AS DECIMAL(10,2)) * CAST(Cost AS DECIMAL(10,2))), 0) as total_valuation
         FROM item 
         WHERE Branch_idBranch = ?`,
        [branchId]
      );
      resolve(stats[0] || { total_items: 0, total_stock: 0, total_valuation: 0 });
    } catch (err) {
      console.error("[getBranchStockSummary] Error:", err);
      reject(err);
    }
  });
};


const updateBranchStatus = (idBranch, Status) => {
  // Update in account_center database (db2) - primary source of truth
  const query = "UPDATE branch SET status = ? WHERE idBranch = ?";
  return new Promise((resolve, reject) => {
    db2.query(query, [Status, idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        // Also update in asipiya_test for sync
        const localQuery = "UPDATE branch SET Status = ? WHERE idBranch = ?";
        db.query(localQuery, [Status, idBranch], (localErr) => {
          if (localErr) {
            console.error(
              "Error updating branch status in local db:",
              localErr,
            );
          }
          resolve(results);
        });
      }
    });
  });
};

const deleteBranch = (idBranch) => {
  // Soft delete in account_center database (db2) - primary source of truth
  const query = "UPDATE branch SET isDeleted = 1 WHERE idBranch = ?";
  return new Promise((resolve, reject) => {
    db2.query(query, [idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        // Also update in asipiya_test for sync
        db.query(query, [idBranch], (localErr) => {
          if (localErr) {
            console.error("Error deleting branch in local db:", localErr);
          }
          resolve(results);
        });
      }
    });
  });
};

// Create default rules and settings for a new branch (copy from sibling or use defaults)
const createDefaultRules = async (
  Branch_idBranch,
  Company_idCompany,
  User_idUser,
) => {
  try {
    let siblingId = null;
    console.log(
      `[createDefaultRules] Starting for Branch: ${Branch_idBranch}, Company: ${Company_idCompany}, User: ${User_idUser}`,
    );

    if (Company_idCompany) {
      // 1. Find a sibling branch from LOCAL DB (db) to copy rules from
      const siblingQuery =
        "SELECT idBranch FROM branch WHERE Company_idCompany = ? AND idBranch != ? LIMIT 1";
      const siblingBranches = await new Promise((resolve) => {
        db.query(
          siblingQuery,
          [Company_idCompany, Branch_idBranch],
          (err, res) => {
            if (err) {
              console.error(
                "[createDefaultRules] Error querying local DB for sibling:",
                err,
              );
              resolve([]);
            } else {
              console.log(
                `[createDefaultRules] Local DB sibling query result:`,
                res,
              );
              resolve(JSON.parse(JSON.stringify(res)));
            }
          },
        );
      });

      if (siblingBranches.length > 0) {
        siblingId = siblingBranches[0].idBranch;
        console.log(
          `[createDefaultRules] Found sibling in local DB: ${siblingId}`,
        );
      } else {
        // Fallback: Try finding sibling in db2 (company_has_branches or specific table? usually 'branch' exists in db2 too)
        // Assuming db2 has 'branch' table with Company_idCompany
        console.log(
          `[createDefaultRules] No sibling found in local DB. Checking db2...`,
        );
        const siblingQuery2 =
          "SELECT idBranch FROM branch WHERE Company_idCompany = ? AND idBranch != ? LIMIT 1";
        // Note: Validating if db2 'branch' table is the correct one. The user context mentioned 'db2' is Asipiya_AccountcenterAdmin_Backend.
        // In previous code 'getActiveBranchCount' uses 'db2.query(..., FROM branch ...)' so it seems valid.
        const siblingBranches2 = await new Promise((resolve) => {
          db2.query(
            siblingQuery2,
            [Company_idCompany, Branch_idBranch],
            (err, res) => {
              if (err) {
                console.error(
                  "[createDefaultRules] Error querying db2 for sibling:",
                  err,
                );
                resolve([]);
              } else {
                console.log(
                  `[createDefaultRules] db2 sibling query result:`,
                  res,
                );
                resolve(JSON.parse(JSON.stringify(res)));
              }
            },
          );
        });

        if (siblingBranches2.length > 0) {
          siblingId = siblingBranches2[0].idBranch;
          console.log(
            `[createDefaultRules] Found sibling in db2: ${siblingId}`,
          );
        }
      }
    }

    // --- COPIER HELPER ---
    const copyTable = async (tableName, defaultValues) => {
      let sourceData = null;
      console.log(`[copyTable] Processing table: ${tableName}`);

      if (siblingId) {
        const selectQuery = `SELECT * FROM ${tableName} WHERE Branch_idBranch = ?`;
        console.log(
          `[copyTable] Querying sibling ${siblingId} for ${tableName}...`,
        );
        const rows = await new Promise((resolve) => {
          db.query(selectQuery, [siblingId], (err, res) => {
            if (err) {
              console.error(
                `[copyTable] Error fetching from ${tableName}:`,
                err,
              );
              resolve([]);
            } else {
              console.log(
                `[copyTable] ${tableName} query returned ${res.length} rows`,
              );
              if (res.length > 0) {
                console.log(
                  `[copyTable] ${tableName} source data:`,
                  JSON.stringify(res[0], null, 2),
                );
              }
              resolve(JSON.parse(JSON.stringify(res)));
            }
          });
        });
        if (rows.length > 0) {
          sourceData = rows[0];
        }
      }

      let finalData = {};
      if (sourceData) {
        finalData = { ...sourceData, Branch_idBranch: Branch_idBranch };
        delete finalData.id;
        delete finalData.ID;
        // If copying from sibling, ensure user_id is updated to current creator if it exists in source
        if (finalData.user_id && User_idUser) {
          finalData.user_id = User_idUser;
        }
        console.log(`[copyTable] Using copied data for ${tableName}`);
      } else {
        finalData = { ...defaultValues, Branch_idBranch: Branch_idBranch };
        console.log(`[copyTable] Using default values for ${tableName}`);
      }

      console.log(
        `[copyTable] Final data to insert into ${tableName}:`,
        JSON.stringify(finalData, null, 2),
      );

      return new Promise((resolve, reject) => {
        const insertQuery = `INSERT INTO ${tableName} SET ?`;
        db.query(insertQuery, finalData, (err, res) => {
          if (err) {
            console.error(
              `[copyTable] Error inserting into ${tableName}:`,
              err,
            );
            resolve(null);
          } else {
            console.log(
              `[copyTable] Successfully inserted into ${tableName}, insertId: ${res.insertId}`,
            );
            resolve(res);
          }
        });
      });
    };

    // --- 1. Rules ---
    await copyTable("rules", {
      Invoice_No_Start_With: "INV",
      Invoice_No_Strat_From: 1,
      Invoice_template: null,
      Invoice_Has_Header: 0,
      Invoice_Header: null,
      Invoice_Footer: null,
      Order_No_Start_With: "ORD",
      Order_No_Strat_From: 1,
      Order_template: null,
      Return_No_Start_With: "RTN",
      Return_No_Strat_From: 1,
      Return_template: null,
      GRN_No_Start_With: "GRN",
      GRN_No_Strat_From: 1,
      GRN_template: null,
      Print_Type: 0,
      POS: 1,
      Quotations_No_Start_With: "QUO",
      Quotations_No_Start_From: 1000,
      Quotation_template: "1",
      vat_enabled: 0,
      vat_percentage: 0,
      salesman_enabled: 0,
      salesman_required: 0,
      Explicit_Stock_Check: 0,
      Automatic_Categorization: 0,
      PO_No_Start_With: "PO-",
      PO_No_Start_From: 1,
    });

    // --- 2. Invoice Header Settings ---
    // Removed 'invoice_number' as it is not a valid column
    await copyTable("invoice_header_settings", {
      header_type: "text",
      business_name: "Your Business Name",
      address: "123 Main Street",
      website: "www.example.com",
      email: "info@example.com",
      phone: "+1234567890",
      bill_to: "Customer",
      ship_to: "Shipping Address",
      datee: null, // "date" might be reserved or specific column name "datee" seen in controller
      visibility: JSON.stringify({
        business_name: true,
        logo: true,
        address: true,
        website: true,
        email: true,
        phone: true,
        bill_to: true,
        ship_to: true,
        date: true,
        invoice_number: true,
        additional_note: true,
        show_thermal_footer: true,
      }),
      thermal_footer_message: "හොදම දේ අඩුම මිලට",
      fontSizes: JSON.stringify({}),
    });

    // --- 3. Invoice Main Settings ---
    await copyTable("invoice_main_settings", {
      template: "Classic",
      termalprinttemplate: "Classic",
      logo_url: null,
      theme_color: "#A7C7E7",
      text_color: "#000000",
      print_margins: JSON.stringify({
        top: 10,
        bottom: 10,
        left: 10,
        right: 10,
      }),
      paper_size: null,
      thermal_font_size: "medium",
      thermal_font_family: null,
      thermal_paper_width: "80mm",
    });

    // --- 4. Invoice Table Settings ---
    // Added user_id
    await copyTable("invoice_table_settings", {
      show_invoice: 1,
      selected_columns: JSON.stringify([]),
      user_id: User_idUser || 0, // Default to 0 or valid ID if provided
    });

    // --- 5. Invoice Footer Settings (Also commonly needed) ---
    // User didn't explicitly ask for footer, but it complements header/main/table.
    // 'rules' table has 'Invoice_Footer' filename, but there's likely an 'invoice_footer_settings' table too?
    // Based on Invoicesettings.js line 197: "SELECT * FROM invoice_footer_settings ..."
    // Yes, let's copy that too for completeness.
    await copyTable("invoice_footer_settings", {
      footer_type: "text",
      footer_image: null,
      notes: "",
      payment_details: "",
      footer_text: "",
      visibility: JSON.stringify({
        discounts: true,
        deposit: true,
        estimateSummary: true,
        tax: true,
      }),
    });

    return true;
  } catch (err) {
    console.error("Error in createDefaultRules:", err);
    throw err;
  }
};

// Create default user privileges with all permissions set to 1
const createDefaultUserPrivileges = (User_idUser, Branch_idBranch) => {
  const query = `INSERT INTO user_privilages (
    User_idUser,
    Branch_idBranch,
    Account,
    Customer_Management,
    Add_Customer,
    Edit_Customer,
    Change_Customer_Status,
    Customer_Credit_Logs,
    Record_Payment,
    Customer_Returns,
    Add_Customer_Return,
    Edit_Customer_Return,
    Process_Customer_Return,
    Quotation_Management,
    Add_Quotation,
    Edit_Quotation,
    Delete_Quotation,
    Invoices,
    Add_Invoices,
    Edit_Invoices,
    Delete_Invoices,
    Due_Payments,
    Process_Due_Payments,
    Product_Category_Management,
    Add_Edit_Product_Category_Management,
    Products_Management,
    Add_Products,
    Edit_Products,
    Add_Quantity,
    Adjust_Quantity,
    Change_Status_Products,
    GRN,
    Add_Grns,
    Edit_Grns,
    Process_Grns,
    Barcodes,
    Damage_Note,
    Add_Damage_Note,
    Suppliers_Management,
    Add_Suppliers_Management,
    Edit_Suppliers_Management,
    Change_Suppliers_Management_Status,
    Delete_Suppliers_Management,
    Supplier_Credit_Logs,
    Purchase_Returns,
    Add_Purchase_Returns,
    Edit_Purchase_Returns,
    Process_Purchase_Returns,
    Salesmen,
    Add_Salesmen,
    Edit_Salesmen,
    Change_Salesmen_Status,
    Earnings_Expenses,
    Add_Earnings_Expenses,
    Earnings_Expenses_Cateogry,
    Reports,
    Item_Reports,
    Customer_Credit_Log_Reports,
    Invoice_Detail_Reports,
    Stock_Card_Reports,
    PL_Reports,
    Apps,
    Stock_Detail_Reports,
    Supplier_Reports,
    Earning_Reports,
    Expenses_Reports,
    Customer_Reports,
    User_Reports,
    Product_Reports,
    Payment_Reports,
    Return_Reports,
    Monthly_Sales_Reports,
    Daily_Sales_Reports,
    Maximum_Item_Discount,
    Maximum_Bill_Discount,
    POS,
    Route_Management,
    Daily_Route_View,
    Show_Only_User_Data
  ) VALUES (?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 100, 100, 1, 1, 1, 0)`;

  return new Promise((resolve, reject) => {
    db.query(query, [User_idUser, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

// Get active branch count for limit checking
const getActiveBranchCount = (Company_idCompany) => {
  const query =
    "SELECT COUNT(*) as count FROM branch WHERE Company_idCompany = ? AND status = '1'";
  return new Promise((resolve, reject) => {
    db2.query(query, [Company_idCompany], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results[0].count);
      }
    });
  });
};

// Get branch limit from companyhassoftware
const getBranchLimit = (company_id) => {
  const query =
    "SELECT branch_limit FROM companyhassoftware WHERE company_id = ? ORDER BY id DESC LIMIT 1";
  return new Promise((resolve, reject) => {
    db2.query(query, [company_id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        // Return limit or default to 1 if not found
        resolve(results.length > 0 ? results[0].branch_limit : 1);
      }
    });
  });
};

/**
 * Get company ID from branch ID
 * @param {number} branchId - Branch ID
 * @returns {Promise<number|null>} Company ID or null if not found
 */
const getCompanyIdByBranch = (branchId) => {
  const query = "SELECT Company_idCompany FROM branch WHERE idBranch = ?";
  return new Promise((resolve, reject) => {
    db2.query(query, [branchId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length > 0 ? results[0].Company_idCompany : null);
      }
    });
  });
};

/**
 * Check if a branch is the main branch
 * @param {number} branchId - Branch ID
 * @returns {Promise<boolean>} True if main branch, false otherwise
 */
const checkIsMainBranch = (branchId) => {
  const query = "SELECT isMainBranch FROM branch WHERE idBranch = ?";
  return new Promise((resolve, reject) => {
    db2.query(query, [branchId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length > 0 && results[0].isMainBranch === 1);
      }
    });
  });
};

/**
 * Get the main branch for a company
 * @param {number} companyId - Company ID
 * @returns {Promise<object|null>} Main branch object or null if not found
 */
const getMainBranchByCompany = (companyId) => {
  const query =
    "SELECT * FROM branch WHERE Company_idCompany = ? AND isMainBranch = 1";
  return new Promise((resolve, reject) => {
    db2.query(query, [companyId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length > 0 ? results[0] : null);
      }
    });
  });
};

/**
 * Transfer main branch designation to a new branch
 * @param {number} newMainBranchId - ID of the branch to become main
 * @param {number} companyId - Company ID
 * @returns {Promise<void>}
 */
const transferMainBranch = (newMainBranchId, companyId) => {
  return new Promise((resolve, reject) => {
    // Get connection from db2 pool
    db2.getConnection((err, connection) => {
      if (err) {
        return reject(err);
      }

      // Start transaction on the connection
      connection.beginTransaction((err) => {
        if (err) {
          connection.release();
          return reject(err);
        }

        // First, remove main status from all branches in this company in db2
        const unsetQuery =
          "UPDATE branch SET isMainBranch = 0 WHERE Company_idCompany = ?";
        connection.query(unsetQuery, [companyId], (err1) => {
          if (err1) {
            return connection.rollback(() => {
              connection.release();
              reject(err1);
            });
          }

          // Then set the new main branch in db2
          const setQuery =
            "UPDATE branch SET isMainBranch = 1 WHERE idBranch = ?";
          connection.query(setQuery, [newMainBranchId], (err2) => {
            if (err2) {
              return connection.rollback(() => {
                connection.release();
                reject(err2);
              });
            }

            // Commit transaction in db2
            connection.commit((err3) => {
              if (err3) {
                return connection.rollback(() => {
                  connection.release();
                  reject(err3);
                });
              }

              // Release connection after successful commit
              connection.release();

              // Sync to db (asipiya_test) - SECONDARY
              // db is a pool, so we can use it directly for single queries (auto-commit)
              db.query(unsetQuery, [companyId], (localErr1) => {
                if (localErr1) {
                  console.error(
                    "Error syncing unset main branch to local db:",
                    localErr1,
                  );
                }

                db.query(setQuery, [newMainBranchId], (localErr2) => {
                  if (localErr2) {
                    console.error(
                      "Error syncing set main branch to local db:",
                      localErr2,
                    );
                  }

                  // Resolve successfully regardless of local sync result
                  resolve();
                });
              });
            });
          });
        });
      });
    });
  });
};

const updateValuationMethod = (Branch_idBranch, method) => {
  const query = "UPDATE rules SET inventory_valuation_method = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [method, Branch_idBranch], (err, results) => {
      if (err) return reject(err);

      // If no rows updated, insert a new rule row
      if (results.affectedRows === 0) {
        const insertQuery = "INSERT INTO rules (Branch_idBranch, inventory_valuation_method) VALUES (?, ?)";
        db.query(insertQuery, [Branch_idBranch, method], (insertErr, insertResults) => {
          if (insertErr) {
            if (insertErr.code === "ER_DUP_ENTRY") {
              return resolve(results);
            }
            return reject(insertErr);
          }
          resolve(insertResults);
        });
      } else {
        resolve(results);
      }
    });
  });
};

const updateProfitLossByPaidAmount = (Branch_idBranch, val) => {
  const query = "UPDATE rules SET profit_loss_by_paid_amount = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [val, Branch_idBranch], (err, results) => {
      if (err) return reject(err);

      // If no rows updated, insert a new rule row
      if (results.affectedRows === 0) {
        const insertQuery = "INSERT INTO rules (Branch_idBranch, profit_loss_by_paid_amount) VALUES (?, ?)";
        db.query(insertQuery, [Branch_idBranch, val], (insertErr, insertResults) => {
          if (insertErr) {
            if (insertErr.code === "ER_DUP_ENTRY") {
              return resolve(results);
            }
            return reject(insertErr);
          }
          resolve(insertResults);
        });
      } else {
        resolve(results);
      }
    });
  });
};

const updateNetItemsRule = (Branch_idBranch, enable_net_items_post_discount) => {
  const query = "UPDATE rules SET enable_net_items_post_discount = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [enable_net_items_post_discount, Branch_idBranch], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const updateGeminiApiKey = (Branch_idBranch, gemini_api_key) => {
  const query = "UPDATE rules SET gemini_api_key = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [gemini_api_key, Branch_idBranch], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const updateLoyaltyStatus = (Branch_idBranch, val) => {
  const query = "UPDATE rules SET enable_loyalty = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [val, Branch_idBranch], (err, results) => {
      if (err) return reject(err);

      // If no rows updated, insert a new rule row
      if (results.affectedRows === 0) {
        const insertQuery = "INSERT INTO rules (Branch_idBranch, enable_loyalty) VALUES (?, ?)";
        db.query(insertQuery, [Branch_idBranch, val], (insertErr, insertResults) => {
          if (insertErr) {
            if (insertErr.code === "ER_DUP_ENTRY") {
              return resolve(results);
            }
            return reject(insertErr);
          }
          resolve(insertResults);
        });
      } else {
        resolve(results);
      }
    });
  });
};

const updateGiftVoucherStatus = (Branch_idBranch, val) => {
  const query = "UPDATE rules SET enable_gift_voucher = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [val, Branch_idBranch], (err, results) => {
      if (err) return reject(err);

      if (results.affectedRows === 0) {
        const insertQuery = "INSERT INTO rules (Branch_idBranch, enable_gift_voucher) VALUES (?, ?)";
        db.query(insertQuery, [Branch_idBranch, val], (insertErr, insertResults) => {
          if (insertErr) {
            if (insertErr.code === "ER_DUP_ENTRY") {
              return resolve(results);
            }
            return reject(insertErr);
          }
          resolve(insertResults);
        });
      } else {
        resolve(results);
      }
    });
  });
};

const updateStockManagementMode = (Branch_idBranch, val) => {
  const query = "UPDATE rules SET stock_management_mode = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [val, Branch_idBranch], (err, results) => {
      if (err) return reject(err);

      if (results.affectedRows === 0) {
        const insertQuery = "INSERT INTO rules (Branch_idBranch, stock_management_mode) VALUES (?, ?)";
        db.query(insertQuery, [Branch_idBranch, val], (insertErr, insertResults) => {
          if (insertErr) {
            if (insertErr.code === "ER_DUP_ENTRY") {
              return resolve(results);
            }
            return reject(insertErr);
          }
          resolve(insertResults);
        });
      } else {
        resolve(results);
      }
    });
  });
};

const updateRouteManagementStatus = (Branch_idBranch, val) => {
  const query = "UPDATE rules SET enable_route_management = ? WHERE Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [val, Branch_idBranch], (err, results) => {
      if (err) return reject(err);

      if (results.affectedRows === 0) {
        const insertQuery = "INSERT INTO rules (Branch_idBranch, enable_route_management) VALUES (?, ?)";
        db.query(insertQuery, [Branch_idBranch, val], (insertErr, insertResults) => {
          if (insertErr) {
            if (insertErr.code === "ER_DUP_ENTRY") {
              return resolve(results);
            }
            return reject(insertErr);
          }
          resolve(insertResults);
        });
      } else {
        resolve(results);
      }
    });
  });
};

module.exports = {
  isOwnerOrAdminUser,
  updateRouteManagementStatus,
  updateStockManagementMode,
  updateGiftVoucherStatus,
  updateLoyaltyStatus,
  updateGeminiApiKey,
  updateProfitLossByPaidAmount,
  updateValuationMethod,
  fetchBranch,
  insertBranch,
  updateCompanyImage,
  fetchCompany,
  updateBranch,
  updatePaymentDatails,
  insertPaymentDetails,
  fetchPaymentDetails,
  fetchRuleDetails,
  updateRuleDetails,
  updateCompany,
  updateRuleDetailsWithHeaderAndFooter,
  updateRuleDetailsWithFooter,
  updateRuleDetailsWithHeader,
  getUsersByBranch,
  getUsersPrivilages,
  getUserDataScope,
  updateUserPrivileges,
  createUserPrivileges,
  getAllBranchesByCompany,
  updateBranchStatus,
  deleteBranch,
  createDefaultUserPrivileges,
  createDefaultRules,
  getActiveBranchCount,
  getBranchLimit,
  getCompanyIdByBranch,
  checkIsMainBranch,
  getMainBranchByCompany,
  transferMainBranch,
  updateNetItemsRule,
  createDefaultWarehouse,
  cloneCatalogForBranch,
  syncCatalogToBranch,
  getBranchStockSummary,
};
