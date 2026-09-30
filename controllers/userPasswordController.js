// controllers/userPasswordController.js
const db = require("../db/db");   // asipiya_test
const db2 = require("../db/db2"); // asipbook_account_center
const bcrypt = require("bcrypt");
const dbService = require("../services/branchDBService"); // <-- Add this at the top if not already imported

// Check email and login/register user in company_has_asipiya_user
exports.checkEmailLogin = async (req, res) => {
  const email = req.params.email ? decodeURIComponent(req.params.email).trim() : "";

  if (!email) {
    return res.status(400).json({ message: "Email is required", exists: false });
  }

  try {
    // 1️⃣ Check if user exists in asipiya_user (case-insensitive, trimmed)
    const userQuery = "SELECT * FROM asipiya_user WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?)) LIMIT 1";
    db2.query(userQuery, [email], (err, users) => {
      if (err) {
        console.error("DB error (asipiya_user):", err);
        return res.status(500).json({ message: "Database error" });
      }
      if (users.length === 0)
        return res.status(404).json({ message: "Email does not exist", exists: false });

      const user = users[0];

      // 2️⃣ Find the company for this user in company_has_asipiya_user (db2)
      const checkCompanyQuery =
        "SELECT * FROM company_has_asipiya_user WHERE Asipiya_User_idAsipiya_User = ? ORDER BY Status = '1' DESC, Company_idCompany ASC LIMIT 1";
      db2.query(checkCompanyQuery, [user.idAsipiya_User], (err2, mapping) => {
        if (err2) {
          console.error("DB error (company_has_asipiya_user):", err2);
          return res.status(500).json({ message: "Database error" });
        }

        const userProfile = {
          First_Name: user.First_Name,
          Last_Name: user.Last_Name,
          Contact_No_01: user.Contact_No_01,
          Contact_No_02: user.Contact_No_02,
          Country: user.Country,
          State: user.State,
          District: user.District,
          City: user.City,
          Street_Address: user.Street_Address,
          Title: user.Title,
        };

        if (mapping && mapping.length > 0) {
          // Already mapped → user exists
          return res.json({
            exists: true,
            email: user.Email,
            user_id: user.idAsipiya_User,
            company_id: mapping[0].Company_idCompany,
            hasPassword: Boolean(user.password),
            user: userProfile,
          });
        } else {
          // Not mapped yet → create mapping (default role = Staff, status = 1)
          const insertMappingQuery =
            "INSERT INTO company_has_asipiya_user (Company_idCompany, Asipiya_User_idAsipiya_User, Role, Created_Date, Status) VALUES (?, ?, 'Staff', NOW(), '1')";

          db2.query(insertMappingQuery, [1, user.idAsipiya_User], (err3, result) => {
            if (err3) {
              console.error("Mapping insert error:", err3);
              return res.status(500).json({ message: "Failed to map user to company" });
            }

            return res.json({
              exists: true,
              email: user.Email,
              user_id: user.idAsipiya_User,
              company_id: 1,
              hasPassword: Boolean(user.password),
              user: userProfile,
            });
          });
        }
      });
    });
  } catch (error) {
    console.error("Error in checkEmailLogin:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Update user password and profile details
exports.updatePassword = async (req, res) => {
  const {
    Email,
    Password,
    First_Name,
    Last_Name,
    Contact_No_01,
    Contact_No_02,
    Country,
    State,
    District,
    City,
    Street_Address,
    Title,
  } = req.body;

  const rawEmail = Email || req.body.email;
  if (!rawEmail) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }
  const cleanEmail = decodeURIComponent(rawEmail).trim().toLowerCase();

  // Accept Password in uppercase, lowercase, or newPassword
  const rawPassword =
    Password !== undefined
      ? Password
      : req.body.password !== undefined
      ? req.body.password
      : req.body.newPassword;

  try {
    const updateFields = {};
    if (First_Name !== undefined) updateFields.First_Name = First_Name;
    if (Last_Name !== undefined) updateFields.Last_Name = Last_Name;
    if (Contact_No_01 !== undefined) updateFields.Contact_No_01 = Contact_No_01;
    if (Contact_No_02 !== undefined) updateFields.Contact_No_02 = Contact_No_02;
    if (Country !== undefined) updateFields.Country = Country;
    if (State !== undefined) updateFields.State = State;
    if (District !== undefined) updateFields.District = District;
    if (City !== undefined) updateFields.City = City;
    if (Street_Address !== undefined) updateFields.Street_Address = Street_Address;
    if (Title !== undefined) updateFields.Title = Title;

    if (rawPassword) {
      if (String(rawPassword).length < 6) {
        return res
          .status(400)
          .json({ success: false, message: "Password must be at least 6 characters long" });
      }
      updateFields.password = await bcrypt.hash(rawPassword, 10);
      // When password is setup/updated via this link, activate user and verify email
      updateFields.Status = "1";
      updateFields.Email_Verfication_Status = "Verified";
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const query = "UPDATE asipiya_user SET ? WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?))";
    db2.query(query, [updateFields, cleanEmail], (err, result) => {
      if (err) {
        console.error("Error updating asipiya_user:", err);
        return res.status(500).json({ success: false, message: "Database error" });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "User not found with this email" });
      }

      // If password was set, ensure company_has_asipiya_user relationship status is active (1)
      if (rawPassword) {
        const activateChauSql = `
          UPDATE company_has_asipiya_user 
          SET Status = '1' 
          WHERE Asipiya_User_idAsipiya_User = (
            SELECT idAsipiya_User FROM asipiya_user WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?)) LIMIT 1
          )
        `;
        db2.query(activateChauSql, [cleanEmail], (chauErr) => {
          if (chauErr) {
            console.warn("Notice: Warning activating company user relationship:", chauErr.message);
          }
        });

        // Also sync to local DB user table if a record exists for this email
        if (updateFields.password) {
          const localUserUpdate = `
            UPDATE user 
            SET Password = ?, First_Name = IFNULL(?, First_Name), Last_Name = IFNULL(?, Last_Name), Status = '1' 
            WHERE LOWER(TRIM(Email)) = LOWER(TRIM(?))
          `;
          db.query(
            localUserUpdate,
            [updateFields.password, First_Name || null, Last_Name || null, cleanEmail],
            (localErr) => {
              if (localErr) {
                // benign if table doesn't have this column or user
                console.warn("Notice: local user table sync:", localErr.message);
              }
            },
          );
        }
      }

      return res.status(200).json({
        success: true,
        message: "User profile and password updated successfully",
      });
    });
  } catch (error) {
    console.error("Error updating user details:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Create new user and map to company_has_asipiya_user
exports.createUserAndMap = async (req, res) => {
  const { Email, Password, First_Name, Last_Name, Contact_No_01, Branch_idBranch,Company_idCompany} = req.body;
  if (!Email || !Password || !First_Name || !Last_Name || !Contact_No_01 || !Branch_idBranch || !Company_idCompany)
    return res.status(400).json({ message: "All fields are required (including branch)" });

  try {
    // Encrypt the password
    const hashedPassword = await bcrypt.hash(Password, 10);

    // 1. Insert into asipiya_user
    const insertUserQuery = `
      INSERT INTO asipiya_user (Email, password, First_Name, Last_Name, Contact_No_01, Status)
      VALUES (?, ?, ?, ?, ?, 1)
    `;
    db2.query(
      insertUserQuery,
      [Email, hashedPassword, First_Name, Last_Name, Contact_No_01],
      async (err, result) => {
        if (err) {
          console.error("User insert error:", err);
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Email already exists" });
          }
          return res.status(500).json({ message: "Database error (user insert)" });
        }
        const userId = result.insertId;
        if (!userId) {
          return res.status(500).json({ message: "User ID not returned after insert" });
        }

        // 2. Map to company_has_asipiya_user (company_id = Branch_idBranch)
        const insertMappingQuery = `
          INSERT INTO company_has_asipiya_user (Company_idCompany, Asipiya_User_idAsipiya_User, Role, Created_Date, Status)
          VALUES (?, ?, 'Staff', NOW(), '1')
        `;
        db2.query(insertMappingQuery, [Company_idCompany, userId], async (err2, result2) => {
          if (err2) {
            console.error("Mapping insert error:", err2);
            return res.status(500).json({ message: "Database error (mapping insert)" });
          }

          // --- ADD PRIVILEGES FOR STAFF USER ---
          // Use the same order as in branchDBService.js and authController.js registerBranchUser
          try {
            await dbService.createUserPrivileges(
              userId,
              Branch_idBranch, // Branch_idBranch
              1, // Account
              0, // Customer_Management
              0, // Add_Customer
              0, // Edit_Customer
              0, // Change_Customer_Status
              0, // Customer_Credit_Logs
              0, // Record_Payment
              1, // Customer_Returns
              1, // Add_Customer_Return
              1, // Edit_Customer_Return
              1, // Process_Customer_Return
              1, // Quotation_Management
              1, // Add_Quotation
              1, // Edit_Quotation
              1, // Delete_Quotation
              1, // Invoices
              1, // Add_Invoices
              1, // Edit_Invoices
              1, // Delete_Invoices
              1, // Due_Payments
              1, // Process_Due_Payments
              1, // Product_Category_Management
              1, // Add_Edit_Product_Category_Management
              1, // Products_Management
              1, // Add_Products
              1, // Edit_Products
              1, // Add_Quantity
              1, // Adjust_Quantity
              1, // Change_Status_Products
              1, // GRN
              1, // Add_Grns
              1, // Edit_Grns
              1, // Process_Grns
              1, // Barcodes
              1, // Damage_Note
              1, // Add_Damage_Note
              1, // Suppliers_Management
              1, // Add_Suppliers_Management
              1, // Edit_Suppliers_Management
              1, // Change_Suppliers_Management_Status
              1, // Delete_Suppliers_Management
              1, // Supplier_Credit_Logs
              1, // Purchase_Returns
              1, // Add_Purchase_Returns
              1, // Edit_Purchase_Returns
              1, // Process_Purchase_Returns
              1, // Salesmen
              1, // Add_Salesmen
              1, // Edit_Salesmen
              1, // Change_Salesmen_Status
              1, // Earnings_Expenses
              1, // Add_Earnings_Expenses
              1, // Earnings_Expenses_Cateogry
              1, // Reports
              1, // Item_Reports
              1, // Customer_Credit_Log_Reports
              1, // Invoice_Detail_Reports
              1, // Stock_Card_Reports
              1, // PL_Reports
              1, // Apps
              1, // Stock_Detail_Reports
              1, // Supplier_Reports
              1, // Earning_Reports
              1, // Expenses_Reports
              1, // Customer_Reports
              1, // User_Reports
              0, // Product_Reports
              0, // Payment_Reports
              0, // Return_Reports
              0, // Monthly_Sales_Reports
              0, // Daily_Sales_Reports
              100, // Maximum_Item_Discount
              100, // Maximum_Bill_Discount
              0, // Service_Jobs
              0, // Add_Service_Job
              0, // Edit_Service_Job
              0, // Estimates
              0, // Add_Estimate
              0, // Edit_Estimate
              0, // Purchase_Order
              0, // Add_Purchase_Order
              0, // Edit_Purchase_Order
              0, // Manufacturing
              0, // Add_Manufacturing_Job
              0, // Edit_Manufacturing_Job
              0, // Material_Issues
              0, // Add_Material_Issue
              0, // Edit_Material_Issue
              0, // Store_Approvals
              0, // SMS_App
              0, // Projects_App
              0, // Documents_App
              0, // Appointments_App
              0, // Edit_Payment
              0, // Delete_Payment
              0, // Quotation_Settings
              0, // Service_Job_Settings
              0, // Estimate_Settings
              0, // Invoice_Settings
              0, // PO_Settings
              0, // GRN_Settings
              0, // Custom_Configurations
              0, // Advance_Report_Generation
              0, // Invoice_Item_Reports
              0, // Serial_No_Reports
              0, // Customer_Return_Report
              0, // Accounts
              0, // Add_Accounts
              0, // Delivery
              0, // Cheque_Management
              0  // Designations
            );
          } catch (privErr) {
            console.error("Failed to create staff privileges:", privErr);
            // Optionally: return error or just log and continue
          }

          res.json({ message: "User created and mapped successfully" });
        });
      }
    );
  } catch (error) {
    console.error("Internal error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Map existing user to company_has_asipiya_user
exports.mapUserToCompany = async (req, res) => {
  const { user_id, Branch_idBranch,Company_idCompany } = req.body;
  if (!user_id || !Branch_idBranch || !Company_idCompany)
    return res.status(400).json({ message: "user_id and Branch_idBranch required" });

  // Check if mapping already exists
  const checkQuery = `
    SELECT * FROM company_has_asipiya_user
    WHERE Asipiya_User_idAsipiya_User = ? AND Company_idCompany = ?
  `;
  db2.query(checkQuery, [user_id, Company_idCompany], (err, rows) => {
    if (err) return res.status(500).json({ message: "Database error (check mapping)" });
    if (rows.length > 0) return res.json({ message: "User already mapped to company" });

    // Insert mapping
    const insertQuery = `
      INSERT INTO company_has_asipiya_user (Company_idCompany, Asipiya_User_idAsipiya_User, Role, Status)
      VALUES (?, ?, 'User', '1')
    `;
    db2.query(insertQuery, [Company_idCompany, user_id], (err2, result) => {
      if (err2) return res.status(500).json({ message: "Failed to map user to company" });
      res.json({ message: "User mapped to company successfully" });
    });
  });
};

// services/branchDBService.js
async function createUserPrivileges(
  userId,
  Branch_idBranch,
  ...privileges // all privilege values in order
) {
  const sql = `
    INSERT INTO user_privilages (
      User_idUser, Account, Customer_Management, Add_Customer, Edit_Customer, Change_Customer_Status,
      Customer_Credit_Logs, Record_Payment, Customer_Returns, Add_Customer_Return, Edit_Customer_Return,
      Process_Customer_Return, Quotation_Management, Add_Quotation, Edit_Quotation, Delete_Quotation,
      Invoices, Add_Invoices, Edit_Invoices, Delete_Invoices, Maximum_Item_Discount, Maximum_Bill_Discount,
      Due_Payments, Product_Category_Management, Add_Edit_Product_Category_Management, Process_Due_Payments,
      Products_Management, Add_Products, Edit_Products, Change_Status_Products, GRN, Add_Grns, Edit_Grns,
      Process_Grns, Barcodes, Damage_Note, Add_Damage_Note, Suppliers_Management, Add_Suppliers_Management,
      Edit_Suppliers_Management, Change_Suppliers_Management_Status, Delete_Suppliers_Management,
      Supplier_Credit_Logs, Purchase_Returns, Add_Purchase_Returns, Edit_Purchase_Returns, Process_Purchase_Returns,
      Salesmen, Add_Salesmen, Edit_Salesmen, Change_Salesmen_Status, Earnings_Expenses, Add_Earnings_Expenses,
      Earnings_Expenses_Cateogry, Reports, Item_Reports, Customer_Credit_Log_Reports, Invoice_Detail_Reports,
      Stock_Card_Reports, PL_Reports, Apps,  Stock_Detail_Reports, Supplier_Reports, Earning_Reports,
      Expenses_Reports, Customer_Reports, User_Reports, Product_Reports, Payment_Reports, Return_Reports,
      Monthly_Sales_Reports, Daily_Sales_Reports, Add_Quantity, Adjust_Quantity,
      Service_Jobs, Add_Service_Job, Edit_Service_Job, Estimates, Add_Estimate, Edit_Estimate,
      Purchase_Order, Add_Purchase_Order, Edit_Purchase_Order, Manufacturing, Add_Manufacturing_Job,
      Edit_Manufacturing_Job, Material_Issues, Add_Material_Issue, Edit_Material_Issue, Store_Approvals,
      SMS_App, Projects_App, Documents_App, Appointments_App, Edit_Payment, Delete_Payment,
      Quotation_Settings, Service_Job_Settings, Estimate_Settings, Invoice_Settings, PO_Settings, GRN_Settings,
      Custom_Configurations, Advance_Report_Generation, Invoice_Item_Reports, Serial_No_Reports, Customer_Return_Report, Accounts, Add_Accounts, Delivery, Cheque_Management, Designations,
      Branch_idBranch
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `;
  await db2.promise().query(sql, [userId, ...privileges, Branch_idBranch]);
}

// Check user privileges
exports.checkUserPrivileges = async (userId, branchId) => {
  const sql = `SELECT * FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ?`;
  const [rows] = await db2.promise().query(sql, [userId, branchId]);
  return rows;
};

// Example privilege fetch (in your controller or middleware)
const getUserPrivileges = async (userId, Branch_idBranch) => {
  return new Promise((resolve, reject) => {
    db2.query(
      "SELECT * FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ?",
      [userId, Branch_idBranch],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows[0]);
      }
    );
  });
};

exports.someProtectedRoute = async (req, res) => {
  const userId = req.user.id; // or wherever you get user id
  const branchId = req.user.branchId; // or from req.body/query

  try {
    const privileges = await getUserPrivileges(userId, branchId);
    if (!privileges || privileges.Account !== 1) {
      return res.status(403).json({ message: "No privilege" });
    }
    // ...proceed with action...
    res.json({ message: "Allowed!" });
  } catch (err) {
    res.status(500).json({ message: "Privilege check failed" });
  }
};

exports.addCustomer = async (req, res) => {
  const userId = req.user.id; // get from JWT/session
  const branchId = req.user.branchId; // get from JWT/session

  // Fetch privileges
  const privileges = await getUserPrivileges(userId, branchId);

  // Check Add_Customer privilege
  if (!privileges || privileges.Add_Customer !== 1) {
    return res.status(403).json({ message: "No privilege to add customer" });
  }

  // ...proceed to add customer...
  res.json({ message: "Customer added!" });
};
