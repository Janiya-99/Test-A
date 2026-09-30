const jwt = require("jsonwebtoken");
const db = require("../db/db");
const bcrypt = require("bcryptjs");
const dbService = require("../services/branchDBService");
const employeeDBService = require("../services/employeeDBService");
const customerDBService = require("../services/customerDBService");
const zoneDBService = require("../services/zoneDBService");
const itemCategory = require("../services/productDBService");
const transporter = require("../utils/emailTransporter");
const { OAuth2Client } = require("google-auth-library");
const axios = require("axios");
const axiosClient = require("../utils/axiosClient");
const db2 = require("../db/db2");

const failedPinAttempts = new Map();

const saltRounds = 10;
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID ||
    "442803762706-tdmaqjr331obmnhrl9p48o3iuej7kvk8.apps.googleusercontent.com",
);

// Default all-zero privileges object for Staff users who have no privileges row yet.
// Prevents the "missing row = full access" bug where undefined fields bypass hasPermission checks.
const DEFAULT_STAFF_PRIVILEGES = {
  Account: 0, Customer_Management: 0, Add_Customer: 0, Edit_Customer: 0,
  Change_Customer_Status: 0, Customer_Credit_Logs: 0, Record_Payment: 0,
  Customer_Returns: 0, Add_Customer_Return: 0, Edit_Customer_Return: 0,
  Process_Customer_Return: 0, Quotation_Management: 0, Add_Quotation: 0,
  Edit_Quotation: 0, Delete_Quotation: 0, Invoices: 0, Add_Invoices: 0,
  Edit_Invoices: 0, Delete_Invoices: 0, Installment_Invoices: 0, Due_Payments: 0, Process_Due_Payments: 0,
  Products_Management: 0, Product_Category_Management: 0,
  Add_Edit_Product_Category_Management: 0, Add_Products: 0, Edit_Products: 0,
  Adjust_Quantity: 0, Add_Quantity: 0, Change_Status_Products: 0,
  GRN: 0, Add_Grns: 0, Edit_Grns: 0, Process_Grns: 0, Barcodes: 0,
  Damage_Note: 0, Add_Damage_Note: 0, Suppliers_Management: 0,
  Add_Suppliers_Management: 0, Edit_Suppliers_Management: 0,
  Change_Suppliers_Management_Status: 0, Delete_Suppliers_Management: 0,
  Supplier_Credit_Logs: 0, Purchase_Returns: 0, Add_Purchase_Returns: 0,
  Edit_Purchase_Returns: 0, Process_Purchase_Returns: 0,
  Salesmen: 0, Add_Salesmen: 0, Edit_Salesmen: 0, Change_Salesmen_Status: 0,
  Earnings_Expenses: 0, Add_Earnings_Expenses: 0, Earnings_Expenses_Cateogry: 0,
  Reports: 0, Item_Reports: 0, Customer_Credit_Log_Reports: 0,
  Invoice_Detail_Reports: 0, Stock_Card_Reports: 0, PL_Reports: 0,
  Stock_Detail_Reports: 0, Supplier_Reports: 0, Earning_Reports: 0,
  Expenses_Reports: 0, Customer_Reports: 0, User_Reports: 0,
  Product_Reports: 0, Payment_Reports: 0, Return_Reports: 0,
  Monthly_Sales_Reports: 0, Daily_Sales_Reports: 0,
  Apps: 0, POS: 0, Maximum_Item_Discount: 0, Maximum_Bill_Discount: 0,
  Service_Jobs: 0, Add_Service_Job: 0, Edit_Service_Job: 0,
  Estimates: 0, Add_Estimate: 0, Edit_Estimate: 0,
  Purchase_Order: 0, Add_Purchase_Order: 0, Edit_Purchase_Order: 0,
  Manufacturing: 0, Add_Manufacturing_Job: 0, Edit_Manufacturing_Job: 0,
  Material_Issues: 0, Add_Material_Issue: 0, Edit_Material_Issue: 0,
  Store_Approvals: 0, SMS_App: 0, Projects_App: 0, Documents_App: 0,
  Appointments_App: 0, Edit_Payment: 0, Delete_Payment: 0,
  Quotation_Settings: 0, Service_Job_Settings: 0, Estimate_Settings: 0,
  Invoice_Settings: 0, PO_Settings: 0, GRN_Settings: 0,
  Custom_Configurations: 0, Advance_Report_Generation: 0,
  Invoice_Item_Reports: 0, Serial_No_Reports: 0, Customer_Return_Report: 0,
  Accounts: 0, Add_Accounts: 0, Delivery: 0, Cheque_Management: 0, Designations: 0,
};

const checkEmailExists = (email) => {
  return new Promise((resolve, reject) => {
    const emailCheckSql = "SELECT COUNT(*) AS count FROM user WHERE Email = ?";
    db.query(emailCheckSql, [email], (emailCheckErr, emailCheckResult) => {
      if (emailCheckErr) {
        return reject(emailCheckErr);
      }
      const emailExists = emailCheckResult[0].count > 0;
      resolve(emailExists);
    });
  });
};

const checkuserEmailExists = (email, branchId) => {
  return new Promise((resolve, reject) => {
    const emailCheckSql = `
      SELECT COUNT(*) AS count 
      FROM user 
      WHERE Email = ? AND Branch_idBranch = ? AND Role = 2
    `;
    db.query(emailCheckSql, [email, branchId], (err, result) => {
      if (err) {
        return reject(err);
      }
      const emailExists = result[0].count > 0;
      resolve(emailExists);
    });
  });
};

const googleLogin = async (req, res, next) => {
  const { token, companyId } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience:
        process.env.GOOGLE_CLIENT_ID ||
        "442803762706-tdmaqjr331obmnhrl9p48o3iuej7kvk8.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Helper to promisify DB queries
    const query = (conn, sql, params) => {
      return new Promise((resolve, reject) => {
        conn.query(sql, params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
    };

    // Check if the user exists in asipiya_user table
    const findUserQuery =
      "SELECT * FROM asipiya_user WHERE Email = ? AND Status = '1' LIMIT 1";
    const results = await query(db2, findUserQuery, [email]);

    if (results.length === 0) {
      return res.status(200).json({
        email: email,
        newUser: true,
      });
    }

    const user = results[0];

    // Load active companies
    const companiesSql = `
        SELECT c.idCompany AS companyId, c.Name AS companyName, chau.Role AS userRole
        FROM company_has_asipiya_user chau
        JOIN company c ON c.idCompany = chau.Company_idCompany
        WHERE chau.Asipiya_User_idAsipiya_User = ?
          AND chau.Status = '1'
          AND c.Status = '1'
        ORDER BY c.idCompany ASC
      `;
    let companyRows = await query(db2, companiesSql, [user.idAsipiya_User]);

    if (!companyRows || companyRows.length === 0) {
      return res
        .status(404)
        .json({ message: "No active company found for this user" });
    }

    // Augment with logos
    try {
      const companyIds = companyRows.map((r) => r.companyId);
      if (companyIds.length > 0) {
        const placeholders = companyIds.map(() => "?").join(",");
        const logoSql = `
              SELECT c.idCompany AS companyId,
                (SELECT ims.logo_url
                 FROM invoice_main_settings ims
                 JOIN branch b ON ims.Branch_idBranch = b.idBranch
                 WHERE b.Company_idCompany = c.idCompany AND b.Status = '1' AND ims.logo_url IS NOT NULL
                 LIMIT 1) AS logo
              FROM company c
              WHERE c.idCompany IN (${placeholders})
            `;
        const logoRows = await query(db, logoSql, companyIds);

        const logoMap = {};
        for (const lr of logoRows) {
          if (lr.logo) {
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            logoMap[lr.companyId] = `${baseUrl}/uploads/${lr.logo}`;
          } else {
            logoMap[lr.companyId] = null;
          }
        }

        companyRows = companyRows.map((r) => ({
          ...r,
          logoUrl: logoMap[r.companyId] || null,
        }));
      }
    } catch (logoErr) {
      console.warn("Failed to load company logos:", logoErr);
    }

    // Choose company logic
    if (!companyId && companyRows.length > 1) {
      return res.status(200).json({
        chooseCompany: true,
        companies: companyRows,
        userPreview: {
          userId: user.idAsipiya_User,
          email: user.Email,
          firstName: user.First_Name,
          lastName: user.Last_Name,
          picture: picture,
          Trial_Expire_On: user.trialExpireOn,
          Pro_Expire_On: user.proExpireOn,
          Grace_Period_Expire_On: user.gracePeriodExpireOn,
          Email_Verficiation_Status: user.Email_Verfication_Status,
        },
      });
    }

    const selectedCompanyId =
      companyId || (companyRows.length > 0 ? companyRows[0].companyId : null);

    if (!selectedCompanyId) {
      return res
        .status(400)
        .json({ message: "Company selection required for login" });
    }

    const selectedCompany =
      companyRows.find((r) => r.companyId === Number(selectedCompanyId)) ||
      companyRows[0];

    // Fetch active branch
    const getBranchSQL = `
          SELECT idBranch
          FROM branch
          WHERE Company_idCompany = ? AND Status = '1'
          ORDER BY idBranch ASC
          LIMIT 1
        `;
    const bRows = await query(db2, getBranchSQL, [selectedCompany.companyId]);

    if (!bRows || bRows.length === 0) {
      return res.status(404).json({
        message: "Active branch not found for this company",
      });
    }

    const branchId = bRows[0].idBranch;

    // Auto-heal: Ensure branch defaults exist (e.g. if user registered via Flow / Project Management)
    if (branchId) {
      await ensureBranchDefaults(
        branchId,
        user.idAsipiya_User,
        selectedCompany.Company_Category_idCompany_Category || 1,
      );
    }

    // Get privileges — filter by the branch the user is logging into (same fix as loginUser).
    // Prevents stale rows from other companies granting unintended access.
    let userPrivileges = [];
    try {
      userPrivileges = await dbService.getUsersPrivilages(user.idAsipiya_User, branchId);
      if (userPrivileges.length === 0) {
        userPrivileges = await dbService.getUsersPrivilages(user.idAsipiya_User, null);
      }
    } catch (privError) {
      console.error("Error fetching user privileges:", privError);
    }

    // For Staff users with no privileges row, default to all-zero to prevent silent full access.
    const userIsStaff = selectedCompany.userRole !== "Admin" && selectedCompany.userRole !== "Owner";
    if (userIsStaff && userPrivileges.length === 0) {
      userPrivileges = [DEFAULT_STAFF_PRIVILEGES];
    }

    // Fetch subscription dates from companyhassoftware table
    const subscriptionSQL = `
          SELECT Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On, plan_name
          FROM companyhassoftware
          WHERE company_id = ? AND software_id = 1
          LIMIT 1
        `;
    let subscriptionDates = {};
    try {
      const subRows = await query(db2, subscriptionSQL, [
        selectedCompany.companyId,
      ]);
      if (subRows && subRows.length > 0) {
        subscriptionDates = {
          Trial_Expire_On: subRows[0].Trial_Expire_On,
          Pro_Expire_On: subRows[0].Pro_Expire_On,
          Grace_Period_Expire_On: subRows[0].Grace_Period_Expire_On,
          plan_name: subRows[0].plan_name,
        };
      }
    } catch (subErr) {
      console.error("Error fetching subscription dates:", subErr);
    }

    // Generate JWT
    const authToken = jwt.sign(
      { userId: user.idAsipiya_User },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "1h" },
    );

    // Save login log
    const insertLogSQL = `
          INSERT INTO user_log (user_id, action, app, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?)
        `;
    const logData = [
      user.idAsipiya_User,
      "login",
      "asipbook",
      req.ip || null,
      req.headers["user-agent"] || null,
    ];

    try {
      await query(db2, insertLogSQL, logData);
    } catch (logErr) {
      console.error("Error inserting user log:", logErr);
    }

    res.status(200).json({
      token: authToken,
      user: {
        userId: user.idAsipiya_User,
        email: user.Email,
        firstName: user.First_Name,
        lastName: user.Last_Name,
        contact: user.Contact_No_01,
        companyid: selectedCompany.companyId,
        companyName: selectedCompany.companyName,
        branch: branchId,
        picture: picture,
        ...subscriptionDates,
        ...(userPrivileges[0] || {}),
        Email_Verficiation_Status: user.Email_Verfication_Status,
        Role: selectedCompany.userRole === "Admin" || selectedCompany.userRole === "Owner" ? 1 : 2,
      },
    });
  } catch (error) {
    console.error("Google login error:", error);
    next(error); // Pass to global handler
  }
};

const facebookLogin = async (req, res, next) => {
  const { accessToken, companyId } = req.body;

  console.log(
    `[facebookLogin] Starting login attempt. CompanyId: ${companyId || "Not Provided"}`,
  );

  try {
    // Verify Facebook Token
    console.log(`[facebookLogin] Verifying Facebook token...`);
    const fbRes = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`,
      { timeout: 10000 }, // T01: Add timeout to prevent hanging
    );
    const { email, name, picture: picObj, id } = fbRes.data;
    console.log(`[facebookLogin] Token verified. Email: ${email}, ID: ${id}`);

    // Facebook picture structure is data.url
    const picture = picObj?.data?.url;

    // Helper to promisify DB queries (reused from googleLogin, ideally should be outside or imported)
    const query = (conn, sql, params) => {
      return new Promise((resolve, reject) => {
        conn.query(sql, params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
    };

    // Check if the user exists
    const findUserQuery =
      "SELECT * FROM asipiya_user WHERE Email = ? AND Status = '1' LIMIT 1";
    const results = await query(db2, findUserQuery, [email]);

    if (results.length === 0) {
      console.log(`[facebookLogin] User not found (New User). Email: ${email}`);
      return res.status(200).json({
        email: email,
        newUser: true,
      });
    }

    const user = results[0];
    console.log(`[facebookLogin] User found. ID: ${user.idAsipiya_User}`);

    // Load active companies
    const companiesSql = `
        SELECT c.idCompany AS companyId, c.Name AS companyName, chau.Role AS userRole
        FROM company_has_asipiya_user chau
        JOIN company c ON c.idCompany = chau.Company_idCompany
        WHERE chau.Asipiya_User_idAsipiya_User = ?
          AND chau.Status = '1'
          AND c.Status = '1'
        ORDER BY c.idCompany ASC
      `;
    let companyRows = await query(db2, companiesSql, [user.idAsipiya_User]);

    if (!companyRows || companyRows.length === 0) {
      console.warn(
        `[facebookLogin] No active company found for user ${user.idAsipiya_User}`,
      );
      return res
        .status(404)
        .json({ message: "No active company found for this user" });
    }

    // Augment with logos
    try {
      const companyIds = companyRows.map((r) => r.companyId);
      if (companyIds.length > 0) {
        const placeholders = companyIds.map(() => "?").join(",");
        const logoSql = `
              SELECT c.idCompany AS companyId,
                (SELECT ims.logo_url
                 FROM invoice_main_settings ims
                 JOIN branch b ON ims.Branch_idBranch = b.idBranch
                 WHERE b.Company_idCompany = c.idCompany AND b.Status = '1' AND ims.logo_url IS NOT NULL
                 LIMIT 1) AS logo
              FROM company c
              WHERE c.idCompany IN (${placeholders})
            `;
        const logoRows = await query(db, logoSql, companyIds);

        const logoMap = {};
        for (const lr of logoRows) {
          if (lr.logo) {
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            logoMap[lr.companyId] = `${baseUrl}/uploads/${lr.logo}`;
          } else {
            logoMap[lr.companyId] = null;
          }
        }

        companyRows = companyRows.map((r) => ({
          ...r,
          logoUrl: logoMap[r.companyId] || null,
        }));
      }
    } catch (logoErr) {
      console.warn("Failed to load company logos:", logoErr);
    }

    // Choose company logic
    if (!companyId && companyRows.length > 1) {
      console.log(
        `[facebookLogin] Multiple companies found, requesting selection.`,
      );
      return res.status(200).json({
        chooseCompany: true,
        companies: companyRows,
        userPreview: {
          userId: user.idAsipiya_User,
          email: user.Email,
          firstName: user.First_Name,
          lastName: user.Last_Name,
          picture: picture,
          Trial_Expire_On: user.trialExpireOn,
          Pro_Expire_On: user.proExpireOn,
          Grace_Period_Expire_On: user.gracePeriodExpireOn,
          Email_Verficiation_Status: user.Email_Verfication_Status,
        },
      });
    }

    const selectedCompanyId =
      companyId || (companyRows.length > 0 ? companyRows[0].companyId : null);

    if (!selectedCompanyId) {
      return res
        .status(400)
        .json({ message: "Company selection required for login" });
    }

    const selectedCompany =
      companyRows.find((r) => r.companyId === Number(selectedCompanyId)) ||
      companyRows[0];

    console.log(
      `[facebookLogin] Selected Company: ${selectedCompany.companyId}`,
    );

    // Fetch active branch
    const getBranchSQL = `
          SELECT idBranch
          FROM branch
          WHERE Company_idCompany = ? AND Status = '1'
          ORDER BY idBranch ASC
          LIMIT 1
        `;
    const bRows = await query(db2, getBranchSQL, [selectedCompany.companyId]);

    if (!bRows || bRows.length === 0) {
      return res.status(404).json({
        message: "Active branch not found for this company",
      });
    }

    const branchId = bRows[0].idBranch;

    // Auto-heal: Ensure branch defaults exist (e.g. if user registered via Flow / Project Management)
    if (branchId) {
      await ensureBranchDefaults(
        branchId,
        user.idAsipiya_User,
        selectedCompany.Company_Category_idCompany_Category || 1,
      );
    }

    // Get privileges
    let userPrivileges = {};
    try {
      userPrivileges = await dbService.getUsersPrivilages(user.idAsipiya_User, branchId);
      if (!userPrivileges || userPrivileges.length === 0) {
        userPrivileges = await dbService.getUsersPrivilages(user.idAsipiya_User, null);
      }
    } catch (privError) {
      console.error("Error fetching user privileges:", privError);
    }

    // Fetch subscription dates from companyhassoftware table
    const subscriptionSQL = `
          SELECT Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On, plan_name
          FROM companyhassoftware
          WHERE company_id = ? AND software_id = 1
          LIMIT 1
        `;
    let subscriptionDates = {};
    try {
      const subRows = await query(db2, subscriptionSQL, [
        selectedCompany.companyId,
      ]);
      if (subRows && subRows.length > 0) {
        subscriptionDates = {
          Trial_Expire_On: subRows[0].Trial_Expire_On,
          Pro_Expire_On: subRows[0].Pro_Expire_On,
          Grace_Period_Expire_On: subRows[0].Grace_Period_Expire_On,
          plan_name: subRows[0].plan_name,
        };
      }
    } catch (subErr) {
      console.error("Error fetching subscription dates:", subErr);
    }

    // Generate JWT
    const authToken = jwt.sign(
      { userId: user.idAsipiya_User },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "1h" },
    );

    // Save login log
    const insertLogSQL = `
          INSERT INTO user_log (user_id, action, app, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?)
        `;
    const logData = [
      user.idAsipiya_User,
      "login",
      "asipbook",
      req.ip || null,
      req.headers["user-agent"] || null,
    ];

    try {
      await query(db2, insertLogSQL, logData);
    } catch (logErr) {
      console.error("Error inserting user log:", logErr);
    }

    console.log(
      `[facebookLogin] Login successful for user ${user.idAsipiya_User}`,
    );

    res.status(200).json({
      token: authToken,
      user: {
        userId: user.idAsipiya_User,
        email: user.Email,
        firstName: user.First_Name,
        lastName: user.Last_Name,
        contact: user.Contact_No_01,
        companyid: selectedCompany.companyId,
        companyName: selectedCompany.companyName,
        branch: branchId,
        picture: picture,
        ...subscriptionDates,
        ...(userPrivileges[0] || {}),
        Email_Verficiation_Status: user.Email_Verfication_Status,
        Role: selectedCompany.userRole === "Admin" || selectedCompany.userRole === "Owner" ? 1 : 2,
      },
    });
  } catch (error) {
    console.error("Facebook login error details:", {
      message: error.message,
      stack: error.stack,
      code: error.code,
      response: error.response?.data,
    });

    // Check for timeout specifically
    if (error.code === "ECONNABORTED") {
      return res
        .status(504)
        .json({ message: "Connection to Facebook timed out" });
    }

    res.status(500).json({ message: "Facebook login failed" });
  }
};

// Transporter imported from shared utils/emailTransporter.js


// Register a new user under a specific branch (AddUser page)
const registerBranchUser = async (req, res) => {
  const {
    Email,
    Branch_idBranch,
    Title,
    First_Name,
    Last_Name,
    Contact_No_01,
    Contact_No_02,
    Country,
    State,
    District,
    City,
    Street_Address,
    customFields,
    companyid,
    RoleId,
    RoleName,
    Access_All_Branches, // Extract from frontend
    Access_All_Companies, // Extract from frontend
  } = req.body;

  const profilePic = req.file ? req.file.filename : null;

  // Parse customFields
  let parsedCustomFields = [];
  try {
    if (customFields) {
      parsedCustomFields =
        typeof customFields === "string"
          ? JSON.parse(customFields)
          : customFields;
    }
  } catch (err) {
    console.error("Invalid customFields JSON:", err);
    return res.status(400).json({ message: "Invalid customFields format" });
  }

  // Check if email already exists
  const emailExists = await checkuserEmailExists(Email, Branch_idBranch);
  if (emailExists) {
    return res.status(409).json({ message: "User already exists" });
  }

  try {
    // Step 1: Call external API to register user into `asipiya_user`
    const regResponse = await axiosClient.post("/asipbook-login/staff", {
      Email,
      Title,
      First_Name,
      Last_Name,
      Contact_No_01,
      Contact_No_02,
      Country,
      State,
      District,
      City,
      Street_Address,
      companyid,
      RoleId,
      RoleName,
      Branch_idBranch,
      Access_All_Branches, // Forward to AccountCenter backend
      Access_All_Companies, // Forward to AccountCenter backend
    });

    const insertedUserId = regResponse.data.userId;

    // Step 2: Begin local DB transaction to save custom fields & privileges
    db.getConnection((connErr, connection) => {
      if (connErr) {
        console.error("Error getting DB connection:", connErr);
        return res.status(500).json({ message: "Database connection failed" });
      }

      connection.beginTransaction((beginErr) => {
        if (beginErr) {
          connection.release();
          return res.status(500).json({ message: "Transaction start failed" });
        }

        (async () => {
          try {
            // Step 3: Insert custom fields if any
            if (parsedCustomFields.length > 0) {
              const fieldSql = `
              INSERT INTO staff_field_data (user_id, field_id, value)
              VALUES ?
            `;
              const fieldValues = parsedCustomFields.map((field) => [
                insertedUserId,
                field.fieldId,
                Array.isArray(field.value)
                  ? field.value.join(",")
                  : field.value,
              ]);

              await new Promise((resolve, reject) => {
                connection.query(fieldSql, [fieldValues], (fieldErr) => {
                  if (fieldErr) return reject(fieldErr);
                  resolve();
                });
              });
            }

            // Step 4: Get privileges from userdesignation table by RoleId (if RoleId is provided)
            // If no role is assigned yet, skip privilege assignment - it will be handled later
            if (RoleId) {
              const getRoleSql = `SELECT * FROM userdesignation WHERE id = ? LIMIT 1`;
              const roleRow = await new Promise((resolve, reject) => {
                connection.query(getRoleSql, [RoleId], (err, rows) => {
                  if (err) return reject(err);
                  resolve(rows && rows.length ? rows[0] : null);
                });
              });

              if (roleRow) {
                // Build privileges in the exact order that createUserPrivileges INSERT column list expects
                const privilegeFieldsInCreateOrder = [
                  "Account",
                  "Customer_Management",
                  "Add_Customer",
                  "Edit_Customer",
                  "Change_Customer_Status",
                  "Customer_Credit_Logs",
                  "Record_Payment",
                  "Customer_Returns",
                  "Add_Customer_Return",
                  "Edit_Customer_Return",
                  "Process_Customer_Return",
                  "Quotation_Management",
                  "Add_Quotation",
                  "Edit_Quotation",
                  "Delete_Quotation",
                  "Invoices",
                  "Add_Invoices",
                  "Edit_Invoices",
                  "Delete_Invoices",
                  "Due_Payments",
                  "Process_Due_Payments",
                  "Product_Category_Management",
                  "Add_Edit_Product_Category_Management",
                  "Products_Management",
                  "Add_Products",
                  "Edit_Products",
                  "Add_Quantity",
                  "Adjust_Quantity",
                  "Change_Status_Products",
                  "GRN",
                  "Add_Grns",
                  "Edit_Grns",
                  "Process_Grns",
                  "Barcodes",
                  "Damage_Note",
                  "Add_Damage_Note",
                  "Suppliers_Management",
                  "Add_Suppliers_Management",
                  "Edit_Suppliers_Management",
                  "Change_Suppliers_Management_Status",
                  "Delete_Suppliers_Management",
                  "Supplier_Credit_Logs",
                  "Purchase_Returns",
                  "Add_Purchase_Returns",
                  "Edit_Purchase_Returns",
                  "Process_Purchase_Returns",
                  "Salesmen",
                  "Add_Salesmen",
                  "Edit_Salesmen",
                  "Change_Salesmen_Status",
                  "Earnings_Expenses",
                  "Add_Earnings_Expenses",
                  "Earnings_Expenses_Cateogry",
                  "Reports",
                  "Item_Reports",
                  "Customer_Credit_Log_Reports",
                  "Invoice_Detail_Reports",
                  "Stock_Card_Reports",
                  "PL_Reports",
                  "Apps",
                  "Stock_Detail_Reports",
                  "Supplier_Reports",
                  "Earning_Reports",
                  "Expenses_Reports",
                  "Customer_Reports",
                  "User_Reports",
                  "Product_Reports",
                  "Payment_Reports",
                  "Return_Reports",
                  "Monthly_Sales_Reports",
                  "Daily_Sales_Reports",
                  "Service_Jobs",
                  "Add_Service_Job",
                  "Edit_Service_Job",
                  "Estimates",
                  "Add_Estimate",
                  "Edit_Estimate",
                  "Purchase_Order",
                  "Add_Purchase_Order",
                  "Edit_Purchase_Order",
                  "Manufacturing",
                  "Add_Manufacturing_Job",
                  "Edit_Manufacturing_Job",
                  "Material_Issues",
                  "Add_Material_Issue",
                  "Edit_Material_Issue",
                  "Store_Approvals",
                  "SMS_App",
                  "Projects_App",
                  "Documents_App",
                  "Appointments_App",
                  "Edit_Payment",
                  "Delete_Payment",
                  "Quotation_Settings",
                  "Service_Job_Settings",
                  "Estimate_Settings",
                  "Invoice_Settings",
                  "PO_Settings",
                  "GRN_Settings",
                ];

                // Map basic privileges (first 71 fields)
                const basicPrivileges = privilegeFieldsInCreateOrder.slice(0, 71).map((f) =>
                  roleRow[f] ? 1 : 0,
                );
                // Map migration 68 privileges (next 28 fields)
                const migration68Privileges = privilegeFieldsInCreateOrder.slice(71).map((f) =>
                  roleRow[f] ? 1 : 0,
                );

                const privilegeValues = [
                  ...basicPrivileges,
                  roleRow.Maximum_Item_Discount || 0,
                  roleRow.Maximum_Bill_Discount || 0,
                  ...migration68Privileges,
                  roleRow.Custom_Configurations ? 1 : 0,
                  roleRow.Advance_Report_Generation ? 1 : 0,
                  roleRow.Invoice_Item_Reports ? 1 : 0,
                  roleRow.Serial_No_Reports ? 1 : 0,
                  roleRow.Customer_Return_Report ? 1 : 0,
                  roleRow.Accounts ? 1 : 0,
                  roleRow.Add_Accounts ? 1 : 0,
                  roleRow.Delivery ? 1 : 0,
                  roleRow.Cheque_Management ? 1 : 0,
                  roleRow.Designations ? 1 : 0,
                ];

                // Save privileges
                await dbService.createUserPrivileges(
                  insertedUserId,
                  Branch_idBranch,
                  ...privilegeValues,
                );

                // Update POS, Route Management, Daily Route View, and Show Only User Data if present in role
                const extraRoleUpdates = [];
                const extraRoleVals = [];
                if (typeof roleRow.POS !== "undefined") {
                  extraRoleUpdates.push("POS = ?");
                  extraRoleVals.push(roleRow.POS ? 1 : 0);
                }
                if (typeof roleRow.Route_Management !== "undefined") {
                  extraRoleUpdates.push("Route_Management = ?");
                  extraRoleVals.push(roleRow.Route_Management ? 1 : 0);
                }
                if (typeof roleRow.Daily_Route_View !== "undefined") {
                  extraRoleUpdates.push("Daily_Route_View = ?");
                  extraRoleVals.push(roleRow.Daily_Route_View ? 1 : 0);
                }
                if (typeof roleRow.Show_Only_User_Data !== "undefined") {
                  extraRoleUpdates.push("Show_Only_User_Data = ?");
                  extraRoleVals.push(roleRow.Show_Only_User_Data ? 1 : 0);
                }
                if (typeof roleRow.Installment_Invoices !== "undefined") {
                  extraRoleUpdates.push("Installment_Invoices = ?");
                  extraRoleVals.push(roleRow.Installment_Invoices ? 1 : 0);
                }
                if (extraRoleUpdates.length > 0) {
                  await new Promise((resolve, reject) => {
                    connection.query(
                      `UPDATE user_privilages SET ${extraRoleUpdates.join(", ")} WHERE User_idUser = ? AND Branch_idBranch = ?`,
                      [...extraRoleVals, insertedUserId, Branch_idBranch],
                      (err) => (err ? reject(err) : resolve()),
                    );
                  });
                }
              } else {
                console.log(
                  `Role ${RoleId} not found in userdesignation table. Skipping privilege assignment for user ${insertedUserId}.`,
                );
              }
            } else {
              console.log(
                `No RoleId provided for user ${insertedUserId}. Skipping privilege assignment.`,
              );
            }

            // Step 6: Send setup email
            const rawOrigin = process.env.FRONTEND_URL || req.get("origin") || "https://invoice.asipbook.com";
            const origin = rawOrigin.replace(/\/+$/, "");
            const mailOptions = {
              from: `"AsipBook" <${process.env.EMAIL_USER || "security@asipbook.com"}>`,
              to: Email,
              subject: "Set up your account password",
              html: `
              <p>Hi ${First_Name},</p>
              <p>Welcome to our platform! Your account has been created.</p>
              <p><strong>Your User ID:</strong> ${insertedUserId}</p>
              <p>Please click the button below to set up your password:</p>
              <a href="${origin}/Userdetails/${encodeURIComponent(
                Email,
              )}/${Branch_idBranch || 0}/${companyid || 0}" 
                style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                Set Password
              </a>
              <p>If you did not request this, please ignore this email.</p>
              <p>Thanks,<br/>The Team</p>
            `,
            };
            // Step 7: Commit transaction
            connection.commit((commitErr) => {
              if (commitErr) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ message: "Commit failed" });
                });
              }

              connection.release();
              res.status(200).json({ Status: "Success" });

              transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                  console.error("Failed to send email:", error);
                } else {
                  console.log("Email sent:", info.response);
                }
              });
            });
          } catch (err) {
            console.error("Transaction logic failed:", err);
            connection.rollback(() => {
              connection.release();
              res.status(500).json({ message: "Registration failed" });
            });
          }
        })();
      });
    });
  } catch (apiError) {
    console.error(
      "Error calling regStaff API:",
      apiError.response?.data || apiError.message,
    );
    return res.status(500).json({ message: "Failed to register user via API" });
  }
};

// Add or update password for a user by email and branch
const setOrUpdatePassword = async (req, res) => {
  const { Email, Branch_idBranch, Password } = req.body;
  if (!Email || !Branch_idBranch || !Password) {
    return res
      .status(400)
      .json({ message: "Email, Branch_idBranch, and Password are required" });
  }

  bcrypt.hash(Password, saltRounds, (hashErr, hash) => {
    if (hashErr) {
      return res.status(500).json({ Error: "Error hashing password" });
    }

    const updateSql = `
      UPDATE user SET Password = ? 
      WHERE Email = ? AND Branch_idBranch = ? AND Role = 2
    `;
    db.query(updateSql, [hash, Email, Branch_idBranch], (err, result) => {
      if (err) {
        return res.status(500).json({ Error: "Error updating password" });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      return res
        .status(200)
        .json({ message: "Password set/updated successfully" });
    });
  });
};

const deleteBranchUser = async (req, res) => {
  const { userId, branchId } = req.params;

  // Check if user exists in the given branch (mapping is in db2 account center)
  const checkSql = `SELECT * FROM user_has_branch WHERE User_idUser = ? AND Branch_idBranch = ?`;
  db2.query(checkSql, [userId, branchId], (checkErr, checkResults) => {
    if (checkErr) {
      return res.status(500).json({ error: "Error checking user" });
    }

    if (checkResults.length === 0) {
      return res.status(404).json({ message: "User not found in this branch" });
    }

    // Get Company ID from branch
    const getCompanySql = `SELECT Company_idCompany FROM branch WHERE idBranch = ?`;
    db2.query(getCompanySql, [branchId], (compErr, compResults) => {
      if (compErr || compResults.length === 0) {
        return res.status(500).json({ error: "Error fetching company details" });
      }
      const companyId = compResults[0].Company_idCompany;

      // Update status to '0' in company_has_asipiya_user to break company link
      const updateLinkSql = `UPDATE company_has_asipiya_user SET Status = '0' WHERE Asipiya_User_idAsipiya_User = ? AND Company_idCompany = ?`;
      db2.query(updateLinkSql, [userId, companyId], (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ error: "Error dropping company user link" });
        }

        // Delete user branch association from db2 user_has_branch
        const deleteSql = `DELETE FROM user_has_branch WHERE User_idUser = ? AND Branch_idBranch = ?`;
        db2.query(deleteSql, [userId, branchId], (deleteErr, result) => {
          if (deleteErr) {
            return res.status(500).json({ error: "Error deleting user branch assignment" });
          }

          // Clean up local user privileges in db
          const deletePrivSql = `DELETE FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ?`;
          db.query(deletePrivSql, [userId, branchId], (privErr) => {
            if (privErr) {
              console.error("Error deleting local user privileges:", privErr);
            }
            return res.status(200).json({ message: "User deleted successfully" });
          });
        });
      });
    });
  });
};

const createDefaultCompanyData = async (
  Branch_idBranch,
  insertedUserId,
  Company_Category_idCompany_Category,
  Email, // Needed for setup email if we wanted to send it, but maybe optional here
  connection,
) => {
  console.error(
    `[createDefaultCompanyData] Starting default data creation for userId: ${insertedUserId}, branch: ${Branch_idBranch}`,
  );

  const dbConn = connection || db; // Use passed connection or fallback to pool

  const queryAsync = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      dbConn.query(sql, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });
  };

  // ✅ Step 1: Wallet categories
  try {
    console.error(
      `[createDefaultCompanyData] Step 1: Checking/Inserting wallet categories...`,
    );
    const existingWallet = await queryAsync(
      "SELECT COUNT(*) AS count FROM wallet_category WHERE Branch_idBranch = ?",
      [Branch_idBranch],
    );
    if (existingWallet && existingWallet[0] && existingWallet[0].count > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Wallet categories already exist for branch ${Branch_idBranch} (${existingWallet[0].count} found). Skipping.`,
      );
    } else {
      const defaultEarnings = [
        "Default",
        "Rental Income",
        "Interest Income",
        "Dividend Income",
        "Selling Used Assets",
        "Installation Charges",
        "Software License Fees",
        "Lease Income",
        "Insurance Claim",
        "Sponsorship Income",
        "Consultation Fee",
      ];
      const defaultExpenses = [
        "Default",
        "Electricity Bill",
        "Water Bill",
        "Telephone Bill",
        "Internet Charges",
        "Transportation",
        "Rental Fees",
        "Salary Payments",
        "Maintenance & Repairs",
        "Taxes",
        "Events",
        "Insurance",
        "Medical Expenses",
        "Stationery/Office supplies",
      ];
      for (const desc of defaultEarnings) {
        await queryAsync(
          `INSERT INTO wallet_category (Type, Description, Branch_idBranch) VALUES (?, ?, ?)`,
          [1, desc, Branch_idBranch],
        );
      }
      for (const desc of defaultExpenses) {
        await queryAsync(
          `INSERT INTO wallet_category (Type, Description, Branch_idBranch) VALUES (?, ?, ?)`,
          [2, desc, Branch_idBranch],
        );
      }
      console.error(
        `[createDefaultCompanyData] ✓ Wallet categories inserted successfully`,
      );
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 1 (Wallet Categories):`,
      err.message,
    );
  }

  // ✅ Step 2: Quantity Types
  try {
    console.error(
      `[createDefaultCompanyData] Step 2: Checking/Inserting quantity types...`,
    );
    const existingQty = await queryAsync(
      "SELECT COUNT(*) AS count FROM quantity_type WHERE Branch_idBranch = ?",
      [Branch_idBranch],
    );
    if (existingQty && existingQty[0] && existingQty[0].count > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Quantity types already exist for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      const quantities = [
        "Kilogram(kg)",
        "Gram(g)",
        "Liter(l)",
        "Milileter(ml)",
        "No. Of Items",
        "Centimeters (cm)",
        "Meter (m)",
        "Inches (in)",
        "Feet (ft)",
        "Yard (yd)",
        "Square Meters",
        "Square Feet",
        "Gallons",
        "Tonnes",
        "Pack",
        "Boxes",
        "Linear Feet",
      ];
      const qtyValues = quantities.map((d) => [d, Branch_idBranch]);
      await queryAsync(
        `INSERT INTO quantity_type (Description, Branch_idBranch) VALUES ?`,
        [qtyValues],
      );
      console.error(`[createDefaultCompanyData] ✓ Quantity types inserted`);
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 2 (Quantity Types):`,
      err.message,
    );
  }

  // ✅ Step 3: Default Employee
  try {
    console.error(
      `[createDefaultCompanyData] Step 3: Checking/Inserting default employee...`,
    );
    const existingEmp = await queryAsync(
      "SELECT idEmployee FROM employee WHERE Branch_idBranch = ? LIMIT 1",
      [Branch_idBranch],
    );
    if (existingEmp && existingEmp.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Employee already exists for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      await employeeDBService.insertEmployee(
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        Branch_idBranch,
        dbConn,
      );
      console.error(`[createDefaultCompanyData] ✓ Default employee inserted`);
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 3 (Default Employee):`,
      err.message,
    );
  }

  // ✅ Step 4: Default Zone
  try {
    console.error(
      `[createDefaultCompanyData] Step 4: Checking/Inserting default zone...`,
    );
    const existingZone = await queryAsync(
      "SELECT idZone FROM zone WHERE Branch_idBranch = ? LIMIT 1",
      [Branch_idBranch],
    );
    if (existingZone && existingZone.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Zone already exists for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      await zoneDBService.insertZone("Default", Branch_idBranch, dbConn);
      console.error(`[createDefaultCompanyData] ✓ Default zone inserted`);
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 4 (Default Zone):`,
      err.message,
    );
  }

  // ✅ Step 5: Item Categories
  try {
    console.error(
      `[createDefaultCompanyData] Step 5: Checking/Inserting item categories...`,
    );
    const existingCat = await queryAsync(
      "SELECT idItem_Category FROM item_category WHERE Branch_idBranch = ? LIMIT 1",
      [Branch_idBranch],
    );
    if (existingCat && existingCat.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Item categories already exist for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      const itemCat = await itemCategory.SignupinsertCategory(
        "Item Default",
        Branch_idBranch,
        1,
        dbConn,
      );
      const serviceCat = await itemCategory.SignupinsertCategory(
        "Service Default",
        Branch_idBranch,
        2,
        dbConn,
      );
      await itemCategory.insertSubCategory(
        "Default",
        Branch_idBranch,
        itemCat.insertId,
        dbConn,
      );
      await itemCategory.insertSubCategory(
        "Default",
        Branch_idBranch,
        serviceCat.insertId,
        dbConn,
      );
      console.error(
        `[createDefaultCompanyData] ✓ Item categories and subcategories inserted`,
      );
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 5 (Item Categories):`,
      err.message,
    );
  }

  // ✅ Step 6: Default Customer
  try {
    console.error(
      `[createDefaultCompanyData] Step 6: Checking/Inserting default customer...`,
    );
    const existingCust = await queryAsync(
      "SELECT idCustomer FROM customer WHERE Branch_idBranch = ? LIMIT 1",
      [Branch_idBranch],
    );
    if (existingCust && existingCust.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Customer already exists for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      await customerDBService.insertCustomer(
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        "Default",
        Branch_idBranch,
        null, // agentId
        0, // creditLimit
        dbConn,
      );
      console.error(`[createDefaultCompanyData] ✓ Default customer inserted`);
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 6 (Default Customer):`,
      err.message,
    );
  }

  // ✅ Step 7: Rules
  try {
    console.error(
      `[createDefaultCompanyData] Step 7: Checking/Inserting rules...`,
    );
    const existingRules = await queryAsync(
      "SELECT idRules FROM rules WHERE Branch_idBranch = ? LIMIT 1",
      [Branch_idBranch],
    );
    if (existingRules && existingRules.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Rules already exist for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      await queryAsync("INSERT INTO rules SET ?", {
        Branch_idBranch,
        Invoice_No_Start_With: "INV",
        Invoice_No_Strat_From: 1000,
        Invoice_template: "1",
        Order_No_Start_With: "ORD",
        Order_No_Strat_From: 1000,
        Order_template: "1",
        Return_No_Start_With: "RTN",
        Return_No_Strat_From: "1000",
        Return_template: "1",
        GRN_No_Start_With: "GRN",
        GRN_No_Strat_From: "1000",
        GRN_template: "1",
        Quotations_No_Start_With: "QUO",
        Quotations_No_Start_From: 1000,
        Quotation_template: "1",
        PO_No_Start_With: "PO-",
        PO_No_Start_From: 1,
      });
      console.error(`[createDefaultCompanyData] ✓ Rules inserted`);
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 7 (Rules):`,
      err.message,
    );
  }

  // ✅ Step 8: Company Payment Details
  try {
    console.error(
      `[createDefaultCompanyData] Step 8: Checking/Inserting company payment details...`,
    );
    const existingPayment = await queryAsync(
      "SELECT idcompany_payment_details FROM company_payment_details WHERE Branch_idBranch = ? LIMIT 1",
      [Branch_idBranch],
    );
    if (existingPayment && existingPayment.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ Company payment details already exist for branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      await queryAsync("INSERT INTO company_payment_details SET ?", {
        Penalty_Percentage: 0,
        Interest_Rate: 0,
        Branch_idBranch,
      });
      console.error(
        `[createDefaultCompanyData] ✓ Company payment details inserted`,
      );
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 8 (Company Payment Details):`,
      err.message,
    );
  }

  // ✅ Step 9: Default Project (Reuse existing project if branch came from Flow/PM)
  let projectId;
  try {
    console.error(
      `[createDefaultCompanyData] Step 9: Checking/Inserting default project...`,
    );
    const existingPro = await queryAsync(
      "SELECT id FROM pro WHERE Branch_idBranch = ? ORDER BY id ASC LIMIT 1",
      [Branch_idBranch],
    );
    if (existingPro && existingPro.length > 0) {
      projectId = existingPro[0].id;
      console.error(
        `[createDefaultCompanyData] ✓ Project already exists for branch ${Branch_idBranch}, reusing projectId: ${projectId}`,
      );
    } else {
      const defaultProjectValues = [
        "Default Project",
        "This is your first project",
        "default",
        `KEY-${insertedUserId}-${Branch_idBranch}-${Date.now()}`,
        Branch_idBranch,
      ];
      const projResult = await queryAsync(
        "INSERT INTO pro (project_name, description, team_name, project_key, Branch_idBranch) VALUES (?, ?, ?, ?, ?)",
        defaultProjectValues,
      );
      projectId = projResult.insertId;
      console.error(
        `[createDefaultCompanyData] ✓ Default project inserted, projectId: ${projectId}`,
      );
    }
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 9 (Default Project):`,
      err.message,
    );
  }

  // ✅ Step 10: Boards
  if (projectId) {
    try {
      console.error(
        `[createDefaultCompanyData] Step 10: Checking/Inserting boards...`,
      );
      const existingBoards = await queryAsync(
        "SELECT id FROM boards WHERE project_id = ? LIMIT 1",
        [projectId],
      );
      if (existingBoards && existingBoards.length > 0) {
        console.error(
          `[createDefaultCompanyData] ✓ Boards already exist for projectId ${projectId}. Skipping.`,
        );
      } else {
        let boards = ["Todo", "In Progress", "Done"];
        if (Number(Company_Category_idCompany_Category) === 16) {
          boards = ["Todo", "In Progress", "Under review", "Done", "handover"];
        }
        const boardVals = boards.map((name) => [
          name,
          projectId,
          Branch_idBranch,
        ]);
        await queryAsync(
          "INSERT INTO boards (name, project_id, Branch_idBranch) VALUES ?",
          [boardVals],
        );
        console.error(
          `[createDefaultCompanyData] ✓ Boards inserted: ${boards.join(", ")}`,
        );
      }
    } catch (err) {
      console.error(
        `[createDefaultCompanyData] ERROR at Step 10 (Boards):`,
        err.message,
      );
    }
  }

  // ✅ Step 11: Custom fields if company category 16
  if (projectId && Number(Company_Category_idCompany_Category) === 16) {
    try {
      console.error(
        `[createDefaultCompanyData] Step 11: Checking/Inserting custom fields for company category 16...`,
      );
      const existingFields = await queryAsync(
        "SELECT id FROM CustomFields WHERE project_id = ? LIMIT 1",
        [projectId],
      );
      if (existingFields && existingFields.length > 0) {
        console.error(
          `[createDefaultCompanyData] ✓ Custom fields already exist for projectId ${projectId}. Skipping.`,
        );
      } else {
        const now = new Date().toISOString().slice(0, 19).replace("T", " ");
        const customFields = [
          [
            projectId,
            "Date",
            "Collected Date",
            "Mobile collected Date",
            "",
            insertedUserId,
            1,
            0,
            now,
          ],
          [
            projectId,
            "Short text",
            "Client Name",
            "Name of client",
            "",
            insertedUserId,
            1,
            0,
            now,
          ],
          [
            projectId,
            "RadioButton",
            "WHAT WE HAVE TO DONE",
            "What kind of service?",
            "",
            insertedUserId,
            1,
            0,
            now,
          ],
          [
            projectId,
            "Short text",
            "EMI NUMBER",
            "",
            "",
            insertedUserId,
            1,
            0,
            now,
          ],
        ];
        await queryAsync(
          `INSERT INTO CustomFields (project_id, field_type, field_name, description, tags, created_by, active, required, created_at) VALUES ?`,
          [customFields],
        );
        console.error(`[createDefaultCompanyData] ✓ Custom fields inserted`);
      }
    } catch (err) {
      console.error(
        `[createDefaultCompanyData] ERROR at Step 11 (Custom Fields):`,
        err.message,
      );
    }
  }

  // ✅ Step 12: Privileges
  try {
    console.error(
      `[createDefaultCompanyData] Step 12: Checking/Creating user privileges...`,
    );
    const existingPrivs = await queryAsync(
      "SELECT idUser_privilages FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ? LIMIT 1",
      [insertedUserId, Branch_idBranch],
    );
    if (existingPrivs && existingPrivs.length > 0) {
      console.error(
        `[createDefaultCompanyData] ✓ User privileges already exist for userId ${insertedUserId}, branch ${Branch_idBranch}. Skipping.`,
      );
    } else {
      await dbService.createUserPrivileges(
        insertedUserId,
        Branch_idBranch,
        ...Array(71).fill(1),
        100,
        100,
        ...Array(38).fill(1),
        dbConn,
      );
      console.error(`[createDefaultCompanyData] ✓ User privileges created`);
    }

    const user_privileges = await queryAsync(
      "SELECT * FROM user_privilages WHERE User_idUser = ? AND Branch_idBranch = ?",
      [insertedUserId, Branch_idBranch],
    );
    return JSON.parse(JSON.stringify(user_privileges));
  } catch (err) {
    console.error(
      `[createDefaultCompanyData] ERROR at Step 12 (Privileges):`,
      err.message,
    );
    return [];
  }
};

const ensureBranchDefaults = async (branchId, userId, categoryId = 1) => {
  if (!branchId) return;
  try {
    const rulesRows = await new Promise((resolve) => {
      db.query(
        "SELECT idRules FROM rules WHERE Branch_idBranch = ? LIMIT 1",
        [branchId],
        (err, results) => resolve(results || []),
      );
    });
    if (!rulesRows || rulesRows.length === 0) {
      console.warn(
        `[ensureBranchDefaults] Branch ${branchId} missing initial configuration. Auto-seeding defaults...`,
      );
      await createDefaultCompanyData(branchId, userId, categoryId || 1);
      console.warn(
        `[ensureBranchDefaults] ✓ Auto-seeding completed for branch ${branchId}`,
      );
    }
  } catch (err) {
    console.error(
      `[ensureBranchDefaults] Auto-seed check error (non-fatal):`,
      err.message,
    );
  }
};

const setupCompanyDefaults = async (req, res) => {
  const {
    Branch_idBranch,
    insertedUserId,
    Company_Category_idCompany_Category,
  } = req.body;

  if (!Branch_idBranch) {
    return res.status(400).json({ message: "Missing Branch_idBranch" });
  }

  let finalUserId = insertedUserId;
  // If insertedUserId not provided, resolve owner/admin from DB2
  if (!finalUserId) {
    try {
      const bRows = await new Promise((resolve, reject) => {
        db2.query(
          "SELECT Company_idCompany FROM branch WHERE idBranch = ? LIMIT 1",
          [Branch_idBranch],
          (err, rows) => (err ? reject(err) : resolve(rows || [])),
        );
      });
      if (bRows && bRows.length > 0) {
        const compId = bRows[0].Company_idCompany;
        const uRows = await new Promise((resolve, reject) => {
          db2.query(
            "SELECT Asipiya_User_idAsipiya_User FROM company_has_asipiya_user WHERE Company_idCompany = ? AND Status = '1' ORDER BY (Role = 'Owner' OR Role = 'Admin') DESC, idCompany_has_Asipiya_User ASC LIMIT 1",
            [compId],
            (err, rows) => (err ? reject(err) : resolve(rows || [])),
          );
        });
        if (uRows && uRows.length > 0) {
          finalUserId = uRows[0].Asipiya_User_idAsipiya_User;
        }
      }
    } catch (lookupErr) {
      console.warn(
        "[setupCompanyDefaults] User lookup fallback warning:",
        lookupErr.message,
      );
    }
  }

  if (!finalUserId) {
    return res
      .status(400)
      .json({ message: "Missing insertedUserId and could not auto-resolve user" });
  }

  try {
    await createDefaultCompanyData(
      Branch_idBranch,
      finalUserId,
      Company_Category_idCompany_Category || 1,
    );
    return res.status(200).json({
      status: "Success",
      message: "Company defaults setup successfully",
    });
  } catch (error) {
    console.error("Setup Company Defaults Error:", error);
    return res.status(500).json({
      message: "Failed to setup company defaults",
      error: error.message,
    });
  }
};

const registerUser = async (req, res) => {
  const {
    Password,
    Email,
    Branch_idBranch,
    Title,
    First_Name,
    Last_Name,
    Contact_No_01,
    Contact_No_02,
    Country,
    State,
    District,
    City,
    Street_Address,
    insertedUserId, // ✅ already provided from outside
    Company_Category_idCompany_Category,
  } = req.body;

  console.error(
    `[registerUser] START - UserId: ${insertedUserId}, Email: ${Email}, Branch: ${Branch_idBranch}`,
  );

  const profilePic = req.file ? req.file.filename : null;

  // Validate required fields
  if (!insertedUserId || !Email || !Branch_idBranch) {
    console.error(
      `[registerUser] ERROR: Missing required fields - insertedUserId: ${insertedUserId}, Email: ${Email}, Branch_idBranch: ${Branch_idBranch}`,
    );
    return res.status(400).json({
      Error:
        "Missing required fields: insertedUserId, Email, or Branch_idBranch",
    });
  }

  // You may still want to hash the password for OTP or other use
  bcrypt.hash(Password, saltRounds, (hashErr, hash) => {
    if (hashErr) {
      console.error(`[registerUser] ERROR: Password hashing failed -`, hashErr);
      return res.status(500).json({ Error: "Error hashing password" });
    }

    db.getConnection((connErr, connection) => {
      if (connErr) {
        console.error(`[registerUser] ERROR: Connection failed -`, connErr);
        return res.status(500).json({
          Error: "Database connection failed",
          message: connErr.message,
        });
      }

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          console.error(
            `[registerUser] ERROR: Transaction start failed -`,
            beginErr,
          );
          return res.status(500).json({
            Error: "Transaction start failed",
            message: beginErr.message,
          });
        }

        try {
          // Use the refactored function with connection
          const user_privileges = await createDefaultCompanyData(
            Branch_idBranch,
            insertedUserId,
            Company_Category_idCompany_Category,
            Email,
            connection,
          );

          // OTP
          console.error(`[registerUser] Step 13: Generating and saving OTP...`);
          const otp = generateOTP();
          const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
          const otpSql = `INSERT INTO otp_table (email, otp, expires_at) VALUES (?, ?, ?)`;

          await new Promise((resolve, reject) => {
            connection.query(
              otpSql,
              [Email, otp, otpExpiresAt],
              (otpErr, otpResult) => {
                if (otpErr) return reject(otpErr);
                resolve(otpResult);
              },
            );
          });
          console.error(`[registerUser] ✓ OTP saved successfully`);

          // Commit transaction
          connection.commit((commitErr) => {
            if (commitErr) {
              return connection.rollback(() => {
                connection.release();
                console.error(
                  `[registerUser] ERROR: Commit failed -`,
                  commitErr,
                );
                res.status(500).json({ Error: "Transaction commit failed" });
              });
            }

            connection.release();

            // Send response - success
            res.status(200).json({
              message:
                "User registered successfully. All default data created. OTP sent.",
              // otpId: otpErr ? null : otpResult.insertId, // otpResult is inside promise scope, but we know it succeeded
              user: {
                userName: Email,
                email: Email,
                userId: insertedUserId,
                branch: Branch_idBranch,
                ...(user_privileges[0] || {}),
              },
            });

            // Send OTP email (async, doesn't block response)
            (async () => {
              try {
                await sendOTP(Email, otp);
                console.error(`[registerUser] ✓ OTP email sent to ${Email}`);
              } catch (mailErr) {
                console.error(
                  `[registerUser] ERROR: Failed to send OTP email -`,
                  mailErr.message,
                );
              }
            })();

            console.error(
              `[registerUser] COMPLETE - User registration successful for userId: ${insertedUserId}`,
            );
          });
        } catch (err) {
          connection.rollback(() => {
            connection.release();
            console.error(
              `[registerUser] !!!!! FATAL ERROR DURING DEFAULT DATA CREATION !!!!!`,
            );
            console.error(`[registerUser] Error Type: ${err.constructor.name}`);
            console.error(`[registerUser] Error Message: ${err.message}`);
            console.error(
              `[registerUser] SQL Message: ${err.sqlMessage || "N/A"}`,
            );
            console.error(`[registerUser] Error Code: ${err.code || "N/A"}`);
            console.error(`[registerUser] Stack Trace:`, err.stack);
            return res.status(500).json({
              Error: "Default data creation failed",
              message: err.sqlMessage || err.message,
              code: err.code,
            });
          });
        }
      });
    });
  });
};

// Generates a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendOTP = async (email, otp) => {
  // Uses shared transporter from utils/emailTransporter.js


  const mailOptions = {
    from: `"Asipiya Account Center" <${
      process.env.EMAIL_USER || "security@asipbook.com"
    }>`,
    to: email,
    subject: "Your Verification Code - Asipiya Invoice",
    html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <div style="padding: 20px; background-color: #f7f7f7; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #444;">Your Verification Code</h2>
          <p>Hello,</p>
          <p>Use the following code to verify your email address:</p>
          <p style="font-size: 24px; font-weight: bold; color: #2c3e50;">${otp}</p>
          <p>This code will expire in 10 minutes.</p>
          <p>If you did not request this, please ignore this email.</p>
          <br/>
          <strong>Asipiya Soft Solutions</strong>
        </div>
        <div style="text-align: center; font-size: 12px; color: #888; margin-top: 20px;">
          &copy; 2024 Asipiya Invoice. All rights reserved.
        </div>
      </div>
    `,
  };

  // Log sending attempt for debugging / audit
  console.log(`Sending OTP ${otp} to ${email}`);

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(
      "OTP email sent to",
      email,
      "messageId:",
      info.messageId || info.response,
    );
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Failed to send OTP email");
  }
};

// resend OTP to user email based on OTP ID
const resendOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  // Check if email exists in the system (optional validation step)
  const checkSql = `SELECT 1 FROM otp_table WHERE email = ? LIMIT 1`;
  db.query(checkSql, [email], async (checkErr, checkResults) => {
    if (checkErr) {
      console.error("DB check error:", checkErr);
      return res.status(500).json({ message: "Database error" });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const insertSql = `INSERT INTO otp_table (email, otp, expires_at) VALUES (?, ?, ?)`;

    // If no existing OTP row, create a new one. If exists, still create a fresh row (rotate OTPs).
    if (checkResults.length === 0) {
      console.log(`No OTP record found for ${email}. Creating new OTP record.`);
    } else {
      console.log(
        `Existing OTP record found for ${email}. Inserting new OTP record (rotate).`,
      );
    }

    db.query(
      insertSql,
      [email, otp, expiresAt],
      async (insertErr, insertResult) => {
        if (insertErr) {
          console.error("Insert error:", insertErr);
          return res.status(500).json({ message: "Failed to create new OTP" });
        }

        try {
          await sendOTP(email, otp);
          console.log(
            `OTP id=${insertResult.insertId} created and sent to ${email}`,
          );
          return res.status(200).json({
            message:
              checkResults.length === 0
                ? "OTP created and sent"
                : "OTP resent successfully",
            otpId: insertResult.insertId,
          });
        } catch (mailErr) {
          console.error("Error sending OTP email:", mailErr);
          return res.status(500).json({ message: "Failed to send OTP email" });
        }
      },
    );
  });
};

const updateUserPassword = (req, res) => {
  const { idUser, oldPassword, newPassword, rePassword } = req.body;

  if (newPassword !== rePassword) {
    return res.status(400).json({ Error: "Passwords do not match" });
  }

  // Fetch the user's current password from the asipiya_user table
  const getPasswordQuery =
    "SELECT Password FROM asipiya_user WHERE idAsipiya_User = ?";
  db2.query(getPasswordQuery, [idUser], (err, results) => {
    if (err) {
      console.error("Error fetching user password:", err);
      return res.status(500).json({ Error: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ Error: "User not found" });
    }

    const hashedPassword = results[0].Password;

    // Compare the provided old password with the hashed password from the database
    bcrypt.compare(oldPassword, hashedPassword, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ Error: "Error comparing passwords" });
      }

      if (!isMatch) {
        return res.status(400).json({ Error: "Incorrect old password" });
      }

      // Hash the new password
      bcrypt.hash(newPassword, saltRounds, (err, hash) => {
        if (err) {
          return res.status(500).json({ Error: "Error hashing password" });
        }

        // Update the password in the asipiya_user database
        const updatePasswordQuery =
          "UPDATE asipiya_user SET Password = ? WHERE idAsipiya_User = ?";
        db2.query(updatePasswordQuery, [hash, idUser], (err, result) => {
          if (err) {
            console.error("Error updating user password:", err);
            return res.status(500).json({ Error: "Error updating password" });
          }
          return res
            .status(200)
            .json({ Status: "Password updated successfully" });
        });
      });
    });
  });
};

const loginUser = async (req, res) => {
  try {
    const { email, password, companyId } = req.body;

    // Call Account Center Login API (pass companyId if provided)
    const response = await axiosClient.post("/asipbook-login", {
      email,
      password,
      companyId,
    });

    // If the user must choose a company, bubble this up to the client
    if (response.data?.chooseCompany) {
      // augment external companies list with logo URLs from our DB if possible
      const extCompanies = response.data.companies || [];
      try {
        const companyIds = extCompanies.map((c) => c.companyId).filter(Boolean);
        if (companyIds.length > 0) {
          const placeholders = companyIds.map(() => "?").join(",");
          const logoSql = `
            SELECT c.idCompany AS companyId,
              (SELECT ims.logo_url
               FROM invoice_main_settings ims
               JOIN branch b ON ims.Branch_idBranch = b.idBranch
               WHERE b.Company_idCompany = c.idCompany AND b.Status = '1' AND ims.logo_url IS NOT NULL
               LIMIT 1) AS logo
            FROM company c
            WHERE c.idCompany IN (${placeholders})
          `;
          const logoRows = await new Promise((resolve, reject) => {
            db.query(logoSql, companyIds, (lErr, lRes) => {
              if (lErr) return reject(lErr);
              resolve(lRes || []);
            });
          });

          const baseUrl = `${req.protocol}://${req.get("host")}`;
          const logoMap = {};
          for (const lr of logoRows) {
            logoMap[lr.companyId] = lr.logo
              ? `${baseUrl}/uploads/${lr.logo}`
              : null;
          }

          // merge
          const merged = extCompanies.map((c) => ({
            ...c,
            logoUrl: logoMap[c.companyId] || null,
          }));
          return res.status(200).json({
            chooseCompany: true,
            companies: merged,
            email, // pass back to re-use (avoid keeping password)
          });
        }
      } catch (logoErr) {
        console.warn("Failed to augment companies with logos:", logoErr);
      }

      return res.status(200).json({
        chooseCompany: true,
        companies: extCompanies,
        email,
      });
    }

    const { token: asipbookToken, user: asipUser } = response.data;

    // Fetch privileges — filter by the exact branch the user logged into.
    // This is critical: users who belong to multiple companies have one privilege row
    // per branch. Without branch filtering, a stale full-access row from their old
    // company would be returned, granting unintended access in the new company.
    let user_privileges = [];
    const loginBranchId = asipUser.branch; // Set by Account Center's asipbookLogin

    // Auto-heal: Ensure branch defaults exist (e.g. if user registered via Flow / Project Management)
    if (loginBranchId) {
      await ensureBranchDefaults(
        loginBranchId,
        asipUser.userId,
        asipUser.Company_Category_idCompany_Category || 1,
      );
    }

    try {
      // Try branch-specific first
      user_privileges = await dbService.getUsersPrivilages(asipUser.userId, loginBranchId);

      // If no branch-specific row found, fall back to any row for this user
      // (handles legacy rows with Branch_idBranch=0 or other placeholder values)
      if (user_privileges.length === 0) {
        console.log(`⚠️ No privileges row for user ${asipUser.userId} branch ${loginBranchId} — trying branch-agnostic fallback`);
        user_privileges = await dbService.getUsersPrivilages(asipUser.userId, null);
      }
    } catch (privErr) {
      console.warn("⚠️ Privilege fetching failed or empty:", privErr);
    }

    // For Staff users (Role=2) with no privileges row at all, default everything to 0.
    // This prevents the "missing row = full access" bypass where undefined privilege
    // properties caused hasPermission to silently allow all menu items.
    const isStaffUser = asipUser.Role === 2;
    if (isStaffUser && user_privileges.length === 0) {
      console.log(`⚠️ Staff user ${asipUser.userId} has no privileges row — defaulting all privileges to 0.`);
      user_privileges = [DEFAULT_STAFF_PRIVILEGES];
    }


    // Fetch subscription dates from companyhassoftware table
    let subscriptionDates = {};
    if (asipUser.companyid) {
      const subscriptionSQL = `
        SELECT Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On, plan_name
        FROM companyhassoftware
        WHERE company_id = ? AND software_id = 1
        LIMIT 1
      `;
      try {
        const subRows = await new Promise((resolve, reject) => {
          db2.query(subscriptionSQL, [asipUser.companyid], (err, results) => {
            if (err) return reject(err);
            resolve(results || []);
          });
        });
        if (subRows && subRows.length > 0) {
          subscriptionDates = {
            Trial_Expire_On: subRows[0].Trial_Expire_On,
            Pro_Expire_On: subRows[0].Pro_Expire_On,
            Grace_Period_Expire_On: subRows[0].Grace_Period_Expire_On,
            plan_name: subRows[0].plan_name,
          };
          console.log(
            "✅ Subscription dates fetched for company",
            asipUser.companyid,
            ":",
            subscriptionDates,
          );
        } else {
          console.log(
            "⚠️ No subscription data found for company",
            asipUser.companyid,
          );
        }
      } catch (subErr) {
        console.error("❌ Error fetching subscription dates:", subErr);
      }
    } else {
      console.log("⚠️ No companyid in asipUser object");
    }

    // Create Invoice API token
    const finalToken = jwt.sign(
      { userId: asipUser.userId },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "1h" },
    );

    // Automatically award Daily Login XP upon successful login
    try {
      const loyaltyService = require("../services/loyaltyService");
      await loyaltyService.awardUserXp(asipUser.userId, "DAILY_LOGIN");
      console.log(`[Loyalty] Successfully awarded daily login XP to user ${asipUser.userId}`);
    } catch (xpErr) {
      console.error("[Loyalty] Failed to award login XP:", xpErr);
    }

    return res.status(200).json({
      token: finalToken,
      user: {
        ...asipUser,
        ...subscriptionDates,
        ...(user_privileges[0] || {}),
      },
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const checkToken = (req, res) => {
  if (req.userId) {
    return res.json({
      Status: "Authentication Success .Token is valid. ",
      LoggedUserId: req.userId,
    });
  } else {
    return res
      .status(401)
      .json({ Error: "Authentication failed. Token is not valid." });
  }
};

const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  // SQL to check if OTP is valid and not expired
  const otpSql = `SELECT idOTP FROM otp_table WHERE email = ? AND otp = ? AND expires_at > NOW()`;

  db.query(otpSql, [email, otp], (otpErr, otpResult) => {
    if (otpErr || otpResult.length === 0) {
      return res.status(400).json({ Error: "Invalid or expired OTP" });
    }

    // SQL to update user status
    const updateUserSql = `UPDATE asipiya_user SET 	Email_Verfication_Status = 1 WHERE Email = ?`;

    db2.query(updateUserSql, [email], (updateErr, updateResult) => {
      if (updateErr || updateResult.affectedRows === 0) {
        return res.status(500).json({ Error: "Error updating user status" });
      }

      // Delete OTP after successful verification
      db.query(
        `DELETE FROM otp_table WHERE email = ? `,
        [email, otp],
        (deleteErr) => {
          if (deleteErr) {
            return res.status(500).json({ Error: "Error deleting OTP" });
          }

          res.status(200).json({
            message: "OTP verified successfully. User status updated.",
          });
        },
      );
    });
  });
};

// Get user by ID
const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    // Call the new API to get user details
    const userResponse = await axiosClient.get(`/user/${id}`);
    const user = userResponse.data;

    // Fetch custom fields for this user (direct DB query or another API)
    // const db = require("../config/db");
    const customFieldQuery = `
      SELECT 
        sfd.field_id AS fieldId,
        sf.field_name AS fieldName,
        sf.field_type AS fieldType,
        sfd.value
      FROM staff_field_data sfd
      LEFT JOIN staff_fields sf ON sfd.field_id = sf.id
      WHERE sfd.user_id = ?
    `;

    db.query(customFieldQuery, [id], (fieldErr, fieldResults) => {
      if (fieldErr) {
        console.error("Custom field query error:", fieldErr);
        return res.status(500).json({ error: "Error fetching custom fields" });
      }

      // Attach custom fields
      user.customFields = fieldResults || [];
      return res.status(200).json(user);
    });
  } catch (error) {
    console.error("Error fetching user from API:", error.message);
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

// 🔄 Update user profile by ID
const multer = require("multer");
const path = require("path");

// ========== MULTER CONFIG ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

const updateUserProfile = async (req, res) => {
  const userId = req.params.id;
  const imageFile = req.file;

  // Validate user ID
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  let data;
  try {
    data = req.body.data ? JSON.parse(req.body.data) : req.body;
  } catch (err) {
    console.error("Invalid JSON data:", err);
    return res
      .status(400)
      .json({ success: false, message: "Invalid JSON format" });
  }

  const {
    First_Name,
    Last_Name,
    Email,
    Contact_No_01,
    Contact_No_02,
    Country,
    State,
    District,
    City,
    Street_Address,
    customFields = [],
  } = data;

  // 1) Update asipiya_user
  try {
    const payload = {
      idAsipiya_User: userId,
      First_Name,
      Last_Name,
      Email,
      Contact_No_01,
      Contact_No_02,
      Country,
      State,
      District,
      City,
      Street_Address,
      Pro_Pic: imageFile ? imageFile.filename : undefined,
    };

    const { data: profileResp } = await axiosClient.post(
      //`https://admincentertestbackend.asipbook.com/api/user/update`,
      `/user/update`,
      payload,
      {
        headers: {
          "x-api-key": process.env.PROFILE_API_KEY,
        },
      },
    );

    if (!profileResp?.success) {
      return res.status(502).json({
        success: false,
        message: "Profile service failed to update user",
        serviceResponse: profileResp,
      });
    }
  } catch (apiErr) {
    console.error(
      "Error calling Profile Service:",
      apiErr?.response?.data || apiErr.message,
    );
    return res.status(502).json({
      success: false,
      message: "Failed to call profile service",
      error: apiErr?.response?.data || apiErr.message,
    });
  }

  // 2) Update custom fields
  if (Array.isArray(customFields) && customFields.length > 0) {
    try {
      const updatePromises = customFields.map((field) => {
        const value = Array.isArray(field.value)
          ? field.value.join(",")
          : field.value;
        const fieldSql = `UPDATE staff_field_data SET value = ? WHERE user_id = ? AND field_id = ?`;
        return new Promise((resolve, reject) => {
          db.query(fieldSql, [value, userId, field.fieldId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });

      await Promise.all(updatePromises);

      return res.json({
        success: true,
        message: "User and custom fields updated successfully",
      });
    } catch (fieldErr) {
      console.error("Error updating custom fields:", fieldErr);
      return res.status(500).json({
        success: false,
        message: "User updated but some custom fields failed",
        error: fieldErr.message,
      });
    }
  }

  return res.json({ success: true, message: "User updated successfully" });
};

const switchCompany = async (req, res) => {
  try {
    const { userId, companyId } = req.body;
    if (!userId || !companyId) {
      return res
        .status(400)
        .json({ message: "userId and companyId are required" });
    }

    // Ask Account Center to build the new user context
    const acRes = await axiosClient.post(
      "/asipbook-login/switch",
      //"https://admincentertestbackend.asipbook.com/api/asipbook-login/switch",
      {
        userId,
        companyId,
      },
    );

    const { user: acUser } = acRes.data || {};
    if (!acUser) {
      return res.status(500).json({ message: "Failed to switch company" });
    }

    // Re-load privileges for the (same) userId (if company-specific, adjust here)
    let user_privileges = [];
    try {
      user_privileges = await dbService.getUsersPrivilages(acUser.userId);
    } catch (privErr) {
      console.warn("⚠️ Privilege fetching failed or empty:", privErr);
    }

    // New token for Invoice app
    const finalToken = jwt.sign(
      { userId: acUser.userId },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      {
        expiresIn: "1h",
      },
    );

    return res.status(200).json({
      token: finalToken,
      user: {
        ...acUser,
        ...(user_privileges[0] || {}),
      },
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("Switch company error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Check if there's a still-valid OTP for an email
const otpStatus = (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ active: false });

  // get the latest OTP row for the email
  const sql = `SELECT expires_at FROM otp_table
               WHERE email = ?
               ORDER BY idOTP DESC
               LIMIT 1`;

  db.query(sql, [email], (err, rows) => {
    if (err) {
      console.error("otpStatus DB error:", err);
      return res.status(500).json({ active: false });
    }
    if (!rows.length) return res.json({ active: false });

    const expMs = new Date(rows[0].expires_at).getTime();
    if (Number.isFinite(expMs) && Date.now() < expMs) {
      return res.json({ active: true, expiresAt: expMs });
    }
    return res.json({ active: false });
  });
};

// Save user designation (role with privileges)
const saveUserDesignation = async (req, res) => {
  const {
    name,
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
    Installment_Invoices,
    Due_Payments,
    Process_Due_Payments,
    Products_Management,
    Product_Category_Management,
    Add_Edit_Product_Category_Management,
    Add_Products,
    Edit_Products,
    Adjust_Quantity,
    Add_Quantity,
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
    Apps,
    POS,
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
    Route_Management,
    Daily_Route_View,
    Show_Only_User_Data,
    companyid,
    branch_id,
  } = req.body;

  try {
    // Check if role name already exists
    const checkSql =
      "SELECT id FROM userdesignation WHERE name = ? AND companyid = ?";
    db.query(checkSql, [name, companyid], (checkErr, checkResults) => {
      if (checkErr) {
        console.error("Error checking role existence:", checkErr);
        return res.status(500).json({
          error: checkErr.message || "Database error",
          details: checkErr,
        });
      }

      const fields = [
        "Account",
        "Customer_Management",
        "Add_Customer",
        "Edit_Customer",
        "Change_Customer_Status",
        "Customer_Credit_Logs",
        "Record_Payment",
        "Customer_Returns",
        "Add_Customer_Return",
        "Edit_Customer_Return",
        "Process_Customer_Return",
        "Quotation_Management",
        "Add_Quotation",
        "Edit_Quotation",
        "Delete_Quotation",
        "Invoices",
        "Add_Invoices",
        "Edit_Invoices",
        "Delete_Invoices",
        "Installment_Invoices",
        "Due_Payments",
        "Process_Due_Payments",
        "Products_Management",
        "Product_Category_Management",
        "Add_Edit_Product_Category_Management",
        "Add_Products",
        "Edit_Products",
        "Adjust_Quantity",
        "Add_Quantity",
        "Change_Status_Products",
        "GRN",
        "Add_Grns",
        "Edit_Grns",
        "Process_Grns",
        "Barcodes",
        "Damage_Note",
        "Add_Damage_Note",
        "Suppliers_Management",
        "Add_Suppliers_Management",
        "Edit_Suppliers_Management",
        "Change_Suppliers_Management_Status",
        "Delete_Suppliers_Management",
        "Supplier_Credit_Logs",
        "Purchase_Returns",
        "Add_Purchase_Returns",
        "Edit_Purchase_Returns",
        "Process_Purchase_Returns",
        "Salesmen",
        "Add_Salesmen",
        "Edit_Salesmen",
        "Change_Salesmen_Status",
        "Earnings_Expenses",
        "Add_Earnings_Expenses",
        "Earnings_Expenses_Cateogry",
        "Reports",
        "Item_Reports",
        "Customer_Credit_Log_Reports",
        "Invoice_Detail_Reports",
        "Stock_Card_Reports",
        "PL_Reports",
        "Stock_Detail_Reports",
        "Supplier_Reports",
        "Earning_Reports",
        "Expenses_Reports",
        "Customer_Reports",
        "User_Reports",
        "Product_Reports",
        "Payment_Reports",
        "Return_Reports",
        "Monthly_Sales_Reports",
        "Daily_Sales_Reports",
        "Apps",
        "POS",
        "Maximum_Item_Discount",
        "Maximum_Bill_Discount",
        "Service_Jobs",
        "Add_Service_Job",
        "Edit_Service_Job",
        "Estimates",
        "Add_Estimate",
        "Edit_Estimate",
        "Purchase_Order",
        "Add_Purchase_Order",
        "Edit_Purchase_Order",
        "Manufacturing",
        "Add_Manufacturing_Job",
        "Edit_Manufacturing_Job",
        "Material_Issues",
        "Add_Material_Issue",
        "Edit_Material_Issue",
        "Store_Approvals",
        "SMS_App",
        "Projects_App",
        "Documents_App",
        "Appointments_App",
        "Edit_Payment",
        "Delete_Payment",
        "Quotation_Settings",
        "Service_Job_Settings",
        "Estimate_Settings",
        "Invoice_Settings",
        "PO_Settings",
        "GRN_Settings",
        "Custom_Configurations",
        "Advance_Report_Generation",
        "Invoice_Item_Reports",
        "Serial_No_Reports",
        "Customer_Return_Report",
        "Accounts",
        "Add_Accounts",
        "Delivery",
        "Cheque_Management",
        "Designations",
        "Route_Management",
        "Daily_Route_View",
        "Show_Only_User_Data",
      ];

      if (checkResults.length > 0) {
        // Role exists, update it
        const updateFields = fields.map((f) => `${f} = ?`).join(", ");
        const updateSql = `UPDATE userdesignation SET ${updateFields} WHERE name = ? AND companyid = ?`;
        const updateValues = [
          Account ? 1 : 0,
          Customer_Management ? 1 : 0,
          Add_Customer ? 1 : 0,
          Edit_Customer ? 1 : 0,
          Change_Customer_Status ? 1 : 0,
          Customer_Credit_Logs ? 1 : 0,
          Record_Payment ? 1 : 0,
          Customer_Returns ? 1 : 0,
          Add_Customer_Return ? 1 : 0,
          Edit_Customer_Return ? 1 : 0,
          Process_Customer_Return ? 1 : 0,
          Quotation_Management ? 1 : 0,
          Add_Quotation ? 1 : 0,
          Edit_Quotation ? 1 : 0,
          Delete_Quotation ? 1 : 0,
          Invoices ? 1 : 0,
          Add_Invoices ? 1 : 0,
          Edit_Invoices ? 1 : 0,
          Delete_Invoices ? 1 : 0,
          Installment_Invoices ? 1 : 0,
          Due_Payments ? 1 : 0,
          Process_Due_Payments ? 1 : 0,
          Products_Management ? 1 : 0,
          Product_Category_Management ? 1 : 0,
          Add_Edit_Product_Category_Management ? 1 : 0,
          Add_Products ? 1 : 0,
          Edit_Products ? 1 : 0,
          Adjust_Quantity ? 1 : 0,
          Add_Quantity ? 1 : 0,
          Change_Status_Products ? 1 : 0,
          GRN ? 1 : 0,
          Add_Grns ? 1 : 0,
          Edit_Grns ? 1 : 0,
          Process_Grns ? 1 : 0,
          Barcodes ? 1 : 0,
          Damage_Note ? 1 : 0,
          Add_Damage_Note ? 1 : 0,
          Suppliers_Management ? 1 : 0,
          Add_Suppliers_Management ? 1 : 0,
          Edit_Suppliers_Management ? 1 : 0,
          Change_Suppliers_Management_Status ? 1 : 0,
          Delete_Suppliers_Management ? 1 : 0,
          Supplier_Credit_Logs ? 1 : 0,
          Purchase_Returns ? 1 : 0,
          Add_Purchase_Returns ? 1 : 0,
          Edit_Purchase_Returns ? 1 : 0,
          Process_Purchase_Returns ? 1 : 0,
          Salesmen ? 1 : 0,
          Add_Salesmen ? 1 : 0,
          Edit_Salesmen ? 1 : 0,
          Change_Salesmen_Status ? 1 : 0,
          Earnings_Expenses ? 1 : 0,
          Add_Earnings_Expenses ? 1 : 0,
          Earnings_Expenses_Cateogry ? 1 : 0,
          Reports ? 1 : 0,
          Item_Reports ? 1 : 0,
          Customer_Credit_Log_Reports ? 1 : 0,
          Invoice_Detail_Reports ? 1 : 0,
          Stock_Card_Reports ? 1 : 0,
          PL_Reports ? 1 : 0,
          Stock_Detail_Reports ? 1 : 0,
          Supplier_Reports ? 1 : 0,
          Earning_Reports ? 1 : 0,
          Expenses_Reports ? 1 : 0,
          Customer_Reports ? 1 : 0,
          User_Reports ? 1 : 0,
          Product_Reports ? 1 : 0,
          Payment_Reports ? 1 : 0,
          Return_Reports ? 1 : 0,
          Monthly_Sales_Reports ? 1 : 0,
          Daily_Sales_Reports ? 1 : 0,
          Apps ? 1 : 0,
          POS ? 1 : 0,
          Maximum_Item_Discount || 0,
          Maximum_Bill_Discount || 0,
          Service_Jobs ? 1 : 0,
          Add_Service_Job ? 1 : 0,
          Edit_Service_Job ? 1 : 0,
          Estimates ? 1 : 0,
          Add_Estimate ? 1 : 0,
          Edit_Estimate ? 1 : 0,
          Purchase_Order ? 1 : 0,
          Add_Purchase_Order ? 1 : 0,
          Edit_Purchase_Order ? 1 : 0,
          Manufacturing ? 1 : 0,
          Add_Manufacturing_Job ? 1 : 0,
          Edit_Manufacturing_Job ? 1 : 0,
          Material_Issues ? 1 : 0,
          Add_Material_Issue ? 1 : 0,
          Edit_Material_Issue ? 1 : 0,
          Store_Approvals ? 1 : 0,
          SMS_App ? 1 : 0,
          Projects_App ? 1 : 0,
          Documents_App ? 1 : 0,
          Appointments_App ? 1 : 0,
          Edit_Payment ? 1 : 0,
          Delete_Payment ? 1 : 0,
          Quotation_Settings ? 1 : 0,
          Service_Job_Settings ? 1 : 0,
          Estimate_Settings ? 1 : 0,
          Invoice_Settings ? 1 : 0,
          PO_Settings ? 1 : 0,
          GRN_Settings ? 1 : 0,
          Custom_Configurations ? 1 : 0,
          Advance_Report_Generation ? 1 : 0,
          Invoice_Item_Reports ? 1 : 0,
          Serial_No_Reports ? 1 : 0,
          Customer_Return_Report ? 1 : 0,
          Accounts ? 1 : 0,
          Add_Accounts ? 1 : 0,
          Delivery ? 1 : 0,
          Cheque_Management ? 1 : 0,
          Designations ? 1 : 0,
          Route_Management ? 1 : 0,
          Daily_Route_View ? 1 : 0,
          Show_Only_User_Data ? 1 : 0,
          name,
          companyid,
        ];
        db.query(updateSql, updateValues, async (updateErr, updateResult) => {
          if (updateErr) {
            console.error("Error updating user designation:", updateErr);
            return res.status(500).json({
              error: updateErr.message || "Failed to update user designation",
              details: updateErr,
            });
          }

          // --- NEW PART: Update all users with this role ---
          try {
            // 1. Get all users with this role in this company from db2
            const db2Sql = `
              SELECT Asipiya_User_idAsipiya_User, Company_idCompany
              FROM company_has_asipiya_user
              WHERE Company_idCompany = ? AND Role = ? AND Status = '1'
            `;
            db2.query(db2Sql, [companyid, name], async (db2Err, db2Results) => {
              if (db2Err) {
                console.error("Error querying db2 for role users:", db2Err);
                // Don't block main response
              } else if (db2Results.length > 0) {
                // 2. For each user, update their privileges in main DB
                const privilegeFields = [
                  "Account",
                  "Customer_Management",
                  "Add_Customer",
                  "Edit_Customer",
                  "Change_Customer_Status",
                  "Customer_Credit_Logs",
                  "Record_Payment",
                  "Customer_Returns",
                  "Add_Customer_Return",
                  "Edit_Customer_Return",
                  "Process_Customer_Return",
                  "Quotation_Management",
                  "Add_Quotation",
                  "Edit_Quotation",
                  "Delete_Quotation",
                  "Invoices",
                  "Add_Invoices",
                  "Edit_Invoices",
                  "Delete_Invoices",
                  "Installment_Invoices",
                  "Due_Payments",
                  "Process_Due_Payments",
                  "Products_Management",
                  "Product_Category_Management",
                  "Add_Edit_Product_Category_Management",
                  "Add_Products",
                  "Edit_Products",
                  "Adjust_Quantity",
                  "Add_Quantity",
                  "Change_Status_Products",
                  "GRN",
                  "Add_Grns",
                  "Edit_Grns",
                  "Process_Grns",
                  "Barcodes",
                  "Damage_Note",
                  "Add_Damage_Note",
                  "Suppliers_Management",
                  "Add_Suppliers_Management",
                  "Edit_Suppliers_Management",
                  "Change_Suppliers_Management_Status",
                  "Delete_Suppliers_Management",
                  "Supplier_Credit_Logs",
                  "Purchase_Returns",
                  "Add_Purchase_Returns",
                  "Edit_Purchase_Returns",
                  "Process_Purchase_Returns",
                  "Salesmen",
                  "Add_Salesmen",
                  "Edit_Salesmen",
                  "Change_Salesmen_Status",
                  "Earnings_Expenses",
                  "Add_Earnings_Expenses",
                  "Earnings_Expenses_Cateogry",
                  "Reports",
                  "Item_Reports",
                  "Customer_Credit_Log_Reports",
                  "Invoice_Detail_Reports",
                  "Stock_Card_Reports",
                  "PL_Reports",
                  "Stock_Detail_Reports",
                  "Supplier_Reports",
                  "Earning_Reports",
                  "Expenses_Reports",
                  "Customer_Reports",
                  "User_Reports",
                  "Product_Reports",
                  "Payment_Reports",
                  "Return_Reports",
                  "Monthly_Sales_Reports",
                  "Daily_Sales_Reports",
                  "Apps",
                  "POS",
                  "Maximum_Item_Discount",
                  "Maximum_Bill_Discount",
                  "Service_Jobs",
                  "Add_Service_Job",
                  "Edit_Service_Job",
                  "Estimates",
                  "Add_Estimate",
                  "Edit_Estimate",
                  "Purchase_Order",
                  "Add_Purchase_Order",
                  "Edit_Purchase_Order",
                  "Manufacturing",
                  "Add_Manufacturing_Job",
                  "Edit_Manufacturing_Job",
                  "Material_Issues",
                  "Add_Material_Issue",
                  "Edit_Material_Issue",
                  "Store_Approvals",
                  "SMS_App",
                  "Projects_App",
                  "Documents_App",
                  "Appointments_App",
                  "Edit_Payment",
                  "Delete_Payment",
                  "Quotation_Settings",
                  "Service_Job_Settings",
                  "Estimate_Settings",
                  "Invoice_Settings",
                  "PO_Settings",
                  "GRN_Settings",
                  "Custom_Configurations",
                  "Advance_Report_Generation",
                  "Invoice_Item_Reports",
                  "Serial_No_Reports",
                  "Customer_Return_Report",
                  "Accounts",
                  "Add_Accounts",
                  "Delivery",
                  "Cheque_Management",
                  "Designations",
                  "Route_Management",
                  "Daily_Route_View",
                  "Show_Only_User_Data",
                ];
                const privilegeValues = [
                  Account ? 1 : 0,
                  Customer_Management ? 1 : 0,
                  Add_Customer ? 1 : 0,
                  Edit_Customer ? 1 : 0,
                  Change_Customer_Status ? 1 : 0,
                  Customer_Credit_Logs ? 1 : 0,
                  Record_Payment ? 1 : 0,
                  Customer_Returns ? 1 : 0,
                  Add_Customer_Return ? 1 : 0,
                  Edit_Customer_Return ? 1 : 0,
                  Process_Customer_Return ? 1 : 0,
                  Quotation_Management ? 1 : 0,
                  Add_Quotation ? 1 : 0,
                  Edit_Quotation ? 1 : 0,
                  Delete_Quotation ? 1 : 0,
                  Invoices ? 1 : 0,
                  Add_Invoices ? 1 : 0,
                  Edit_Invoices ? 1 : 0,
                  Delete_Invoices ? 1 : 0,
                  Installment_Invoices ? 1 : 0,
                  Due_Payments ? 1 : 0,
                  Process_Due_Payments ? 1 : 0,
                  Products_Management ? 1 : 0,
                  Product_Category_Management ? 1 : 0,
                  Add_Edit_Product_Category_Management ? 1 : 0,
                  Add_Products ? 1 : 0,
                  Edit_Products ? 1 : 0,
                  Adjust_Quantity ? 1 : 0,
                  Add_Quantity ? 1 : 0,
                  Change_Status_Products ? 1 : 0,
                  GRN ? 1 : 0,
                  Add_Grns ? 1 : 0,
                  Edit_Grns ? 1 : 0,
                  Process_Grns ? 1 : 0,
                  Barcodes ? 1 : 0,
                  Damage_Note ? 1 : 0,
                  Add_Damage_Note ? 1 : 0,
                  Suppliers_Management ? 1 : 0,
                  Add_Suppliers_Management ? 1 : 0,
                  Edit_Suppliers_Management ? 1 : 0,
                  Change_Suppliers_Management_Status ? 1 : 0,
                  Delete_Suppliers_Management ? 1 : 0,
                  Supplier_Credit_Logs ? 1 : 0,
                  Purchase_Returns ? 1 : 0,
                  Add_Purchase_Returns ? 1 : 0,
                  Edit_Purchase_Returns ? 1 : 0,
                  Process_Purchase_Returns ? 1 : 0,
                  Salesmen ? 1 : 0,
                  Add_Salesmen ? 1 : 0,
                  Edit_Salesmen ? 1 : 0,
                  Change_Salesmen_Status ? 1 : 0,
                  Earnings_Expenses ? 1 : 0,
                  Add_Earnings_Expenses ? 1 : 0,
                  Earnings_Expenses_Cateogry ? 1 : 0,
                  Reports ? 1 : 0,
                  Item_Reports ? 1 : 0,
                  Customer_Credit_Log_Reports ? 1 : 0,
                  Invoice_Detail_Reports ? 1 : 0,
                  Stock_Card_Reports ? 1 : 0,
                  PL_Reports ? 1 : 0,
                  Stock_Detail_Reports ? 1 : 0,
                  Supplier_Reports ? 1 : 0,
                  Earning_Reports ? 1 : 0,
                  Expenses_Reports ? 1 : 0,
                  Customer_Reports ? 1 : 0,
                  User_Reports ? 1 : 0,
                  Product_Reports ? 1 : 0,
                  Payment_Reports ? 1 : 0,
                  Return_Reports ? 1 : 0,
                  Monthly_Sales_Reports ? 1 : 0,
                  Daily_Sales_Reports ? 1 : 0,
                  Apps ? 1 : 0,
                  POS ? 1 : 0,
                  Maximum_Item_Discount || 0,
                  Maximum_Bill_Discount || 0,
                  Service_Jobs ? 1 : 0,
                  Add_Service_Job ? 1 : 0,
                  Edit_Service_Job ? 1 : 0,
                  Estimates ? 1 : 0,
                  Add_Estimate ? 1 : 0,
                  Edit_Estimate ? 1 : 0,
                  Purchase_Order ? 1 : 0,
                  Add_Purchase_Order ? 1 : 0,
                  Edit_Purchase_Order ? 1 : 0,
                  Manufacturing ? 1 : 0,
                  Add_Manufacturing_Job ? 1 : 0,
                  Edit_Manufacturing_Job ? 1 : 0,
                  Material_Issues ? 1 : 0,
                  Add_Material_Issue ? 1 : 0,
                  Edit_Material_Issue ? 1 : 0,
                  Store_Approvals ? 1 : 0,
                  SMS_App ? 1 : 0,
                  Projects_App ? 1 : 0,
                  Documents_App ? 1 : 0,
                  Appointments_App ? 1 : 0,
                  Edit_Payment ? 1 : 0,
                  Delete_Payment ? 1 : 0,
                  Quotation_Settings ? 1 : 0,
                  Service_Job_Settings ? 1 : 0,
                  Estimate_Settings ? 1 : 0,
                  Invoice_Settings ? 1 : 0,
                  PO_Settings ? 1 : 0,
                  GRN_Settings ? 1 : 0,
                  Custom_Configurations ? 1 : 0,
                  Advance_Report_Generation ? 1 : 0,
                  Invoice_Item_Reports ? 1 : 0,
                  Serial_No_Reports ? 1 : 0,
                  Customer_Return_Report ? 1 : 0,
                  Accounts ? 1 : 0,
                  Add_Accounts ? 1 : 0,
                  Delivery ? 1 : 0,
                  Cheque_Management ? 1 : 0,
                  Designations ? 1 : 0,
                  Route_Management ? 1 : 0,
                  Daily_Route_View ? 1 : 0,
                  Show_Only_User_Data ? 1 : 0,
                ];

                for (const row of db2Results) {
                  // You may need to get branch_id for each user if not provided
                  // If branch_id is same for all, use branch_id from request
                  const userId = row.Asipiya_User_idAsipiya_User;
                  const branchIdToUse = branch_id || null; // Use branch_id from request or fetch per user if needed

                  // Update privileges in main DB
                  const updatePrivSql = `UPDATE user_privilages SET ${privilegeFields
                    .map((f) => `${f} = ?`)
                    .join(", ")} WHERE User_idUser = ? AND Branch_idBranch = ?`;
                  db.query(
                    updatePrivSql,
                    [...privilegeValues, userId, branchIdToUse],
                    (privErr) => {
                      if (privErr) {
                        console.error(
                          `Failed to update privileges for user ${userId}:`,
                          privErr,
                        );
                      }
                    },
                  );
                }
              }
            });
          } catch (e) {
            console.error("Error updating role members privileges:", e);
          }
          // --- END NEW PART ---

          return res.status(200).json({
            message: "User designation updated successfully",
            id: checkResults[0].id,
          });
        });
      } else {
        // Insert new role
        const insertSql = `
            INSERT INTO userdesignation (
              name, Account, Customer_Management, Add_Customer, Edit_Customer,
              Change_Customer_Status, Customer_Credit_Logs, Record_Payment,
              Customer_Returns, Add_Customer_Return, Edit_Customer_Return,
              Process_Customer_Return, Quotation_Management, Add_Quotation,
              Edit_Quotation, Delete_Quotation, Invoices, Add_Invoices,
              Edit_Invoices, Delete_Invoices, Installment_Invoices, Due_Payments, Process_Due_Payments,
              Products_Management, Product_Category_Management,
              Add_Edit_Product_Category_Management, Add_Products, Edit_Products,
              Adjust_Quantity, Add_Quantity, Change_Status_Products, GRN,
              Add_Grns, Edit_Grns, Process_Grns, Barcodes, Damage_Note,
              Add_Damage_Note, Suppliers_Management, Add_Suppliers_Management,
              Edit_Suppliers_Management, Change_Suppliers_Management_Status,
              Delete_Suppliers_Management, Supplier_Credit_Logs, Purchase_Returns,
              Add_Purchase_Returns, Edit_Purchase_Returns, Process_Purchase_Returns,
              Salesmen, Add_Salesmen, Edit_Salesmen, Change_Salesmen_Status,
              Earnings_Expenses, Add_Earnings_Expenses, Earnings_Expenses_Cateogry,
              Reports, Item_Reports, Customer_Credit_Log_Reports,
              Invoice_Detail_Reports, Stock_Card_Reports, PL_Reports,
              Stock_Detail_Reports, Supplier_Reports, Earning_Reports,
              Expenses_Reports, Customer_Reports, User_Reports, Product_Reports,
              Payment_Reports, Return_Reports, Monthly_Sales_Reports,
              Daily_Sales_Reports, Apps, POS, Maximum_Item_Discount, Maximum_Bill_Discount,
              Service_Jobs, Add_Service_Job, Edit_Service_Job, Estimates, Add_Estimate, Edit_Estimate,
              Purchase_Order, Add_Purchase_Order, Edit_Purchase_Order, Manufacturing, Add_Manufacturing_Job,
              Edit_Manufacturing_Job, Material_Issues, Add_Material_Issue, Edit_Material_Issue, Store_Approvals,
              SMS_App, Projects_App, Documents_App, Appointments_App, Edit_Payment, Delete_Payment,
              Quotation_Settings, Service_Job_Settings, Estimate_Settings, Invoice_Settings, PO_Settings, GRN_Settings,
              Custom_Configurations, Advance_Report_Generation, Invoice_Item_Reports, Serial_No_Reports, Customer_Return_Report, Accounts, Add_Accounts, Delivery, Cheque_Management, Designations,
              Route_Management, Daily_Route_View, Show_Only_User_Data,
              companyid
            )
            VALUES (${Array(118).fill("?").join(", ")})
          `;

        const values = [
          name,
          Account ? 1 : 0,
          Customer_Management ? 1 : 0,
          Add_Customer ? 1 : 0,
          Edit_Customer ? 1 : 0,
          Change_Customer_Status ? 1 : 0,
          Customer_Credit_Logs ? 1 : 0,
          Record_Payment ? 1 : 0,
          Customer_Returns ? 1 : 0,
          Add_Customer_Return ? 1 : 0,
          Edit_Customer_Return ? 1 : 0,
          Process_Customer_Return ? 1 : 0,
          Quotation_Management ? 1 : 0,
          Add_Quotation ? 1 : 0,
          Edit_Quotation ? 1 : 0,
          Delete_Quotation ? 1 : 0,
          Invoices ? 1 : 0,
          Add_Invoices ? 1 : 0,
          Edit_Invoices ? 1 : 0,
          Delete_Invoices ? 1 : 0,
          Installment_Invoices ? 1 : 0,
          Due_Payments ? 1 : 0,
          Process_Due_Payments ? 1 : 0,
          Products_Management ? 1 : 0,
          Product_Category_Management ? 1 : 0,
          Add_Edit_Product_Category_Management ? 1 : 0,
          Add_Products ? 1 : 0,
          Edit_Products ? 1 : 0,
          Adjust_Quantity ? 1 : 0,
          Add_Quantity ? 1 : 0,
          Change_Status_Products ? 1 : 0,
          GRN ? 1 : 0,
          Add_Grns ? 1 : 0,
          Edit_Grns ? 1 : 0,
          Process_Grns ? 1 : 0,
          Barcodes ? 1 : 0,
          Damage_Note ? 1 : 0,
          Add_Damage_Note ? 1 : 0,
          Suppliers_Management ? 1 : 0,
          Add_Suppliers_Management ? 1 : 0,
          Edit_Suppliers_Management ? 1 : 0,
          Change_Suppliers_Management_Status ? 1 : 0,
          Delete_Suppliers_Management ? 1 : 0,
          Supplier_Credit_Logs ? 1 : 0,
          Purchase_Returns ? 1 : 0,
          Add_Purchase_Returns ? 1 : 0,
          Edit_Purchase_Returns ? 1 : 0,
          Process_Purchase_Returns ? 1 : 0,
          Salesmen ? 1 : 0,
          Add_Salesmen ? 1 : 0,
          Edit_Salesmen ? 1 : 0,
          Change_Salesmen_Status ? 1 : 0,
          Earnings_Expenses ? 1 : 0,
          Add_Earnings_Expenses ? 1 : 0,
          Earnings_Expenses_Cateogry ? 1 : 0,
          Reports ? 1 : 0,
          Item_Reports ? 1 : 0,
          Customer_Credit_Log_Reports ? 1 : 0,
          Invoice_Detail_Reports ? 1 : 0,
          Stock_Card_Reports ? 1 : 0,
          PL_Reports ? 1 : 0,
          Stock_Detail_Reports ? 1 : 0,
          Supplier_Reports ? 1 : 0,
          Earning_Reports ? 1 : 0,
          Expenses_Reports ? 1 : 0,
          Customer_Reports ? 1 : 0,
          User_Reports ? 1 : 0,
          Product_Reports ? 1 : 0,
          Payment_Reports ? 1 : 0,
          Return_Reports ? 1 : 0,
          Monthly_Sales_Reports ? 1 : 0,
          Daily_Sales_Reports ? 1 : 0,
          Apps ? 1 : 0,
          POS ? 1 : 0,
          Maximum_Item_Discount || 0,
          Maximum_Bill_Discount || 0,
          Service_Jobs ? 1 : 0,
          Add_Service_Job ? 1 : 0,
          Edit_Service_Job ? 1 : 0,
          Estimates ? 1 : 0,
          Add_Estimate ? 1 : 0,
          Edit_Estimate ? 1 : 0,
          Purchase_Order ? 1 : 0,
          Add_Purchase_Order ? 1 : 0,
          Edit_Purchase_Order ? 1 : 0,
          Manufacturing ? 1 : 0,
          Add_Manufacturing_Job ? 1 : 0,
          Edit_Manufacturing_Job ? 1 : 0,
          Material_Issues ? 1 : 0,
          Add_Material_Issue ? 1 : 0,
          Edit_Material_Issue ? 1 : 0,
          Store_Approvals ? 1 : 0,
          SMS_App ? 1 : 0,
          Projects_App ? 1 : 0,
          Documents_App ? 1 : 0,
          Appointments_App ? 1 : 0,
          Edit_Payment ? 1 : 0,
          Delete_Payment ? 1 : 0,
          Quotation_Settings ? 1 : 0,
          Service_Job_Settings ? 1 : 0,
          Estimate_Settings ? 1 : 0,
          Invoice_Settings ? 1 : 0,
          PO_Settings ? 1 : 0,
          GRN_Settings ? 1 : 0,
          Custom_Configurations ? 1 : 0,
          Advance_Report_Generation ? 1 : 0,
          Invoice_Item_Reports ? 1 : 0,
          Serial_No_Reports ? 1 : 0,
          Customer_Return_Report ? 1 : 0,
          Accounts ? 1 : 0,
          Add_Accounts ? 1 : 0,
          Delivery ? 1 : 0,
          Cheque_Management ? 1 : 0,
          Designations ? 1 : 0,
          Route_Management ? 1 : 0,
          Daily_Route_View ? 1 : 0,
          Show_Only_User_Data ? 1 : 0,
          companyid,
        ];

        db.query(insertSql, values, (insertErr, result) => {
          if (insertErr) {
            console.error("Error saving user designation:", insertErr);
            return res.status(500).json({
              error: insertErr.message || "Failed to save user designation",
              details: insertErr,
            });
          }

          return res.status(200).json({
            message: "User designation created successfully",
            id: result.insertId,
          });
        });
      }
    });
  } catch (error) {
    console.error("Error in save User Designation:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getUserDesignationsByCompany = (req, res) => {
  const { companyid } = req.params;
  if (!companyid) {
    return res.status(400).json({ error: "companyid is required" });
  }
  const sql = "SELECT * FROM userdesignation WHERE companyid = ?";
  db.query(sql, [companyid], (err, results) => {
    if (err) {
      console.error("Error fetching user designations:", err);
      return res
        .status(500)
        .json({ error: err.message || "Database error", details: err });
    }
    return res.status(200).json(results);
  });
};

const deleteUserDesignation = (req, res) => {
  const { roleId } = req.params;

  // Validate ID
  if (!roleId || isNaN(roleId) || roleId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID provided",
    });
  }

  // SQL query to delete the user designation
  const query = "DELETE FROM userdesignation WHERE id = ?";

  // Execute the query
  db.query(query, [roleId], (error, results) => {
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        success: false,
        message: "Database error occurred",
        error: error.message,
      });
    }

    // Check if any row was affected
    if (results.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User designation not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User designation deleted successfully",
      affectedRows: results.affectedRows,
    });
  });
};

const microsoftLogin = async (req, res, next) => {
  const { accessToken, companyId } = req.body;

  try {
    // Verify Microsoft Token via Graph API
    const msRes = await axios.get("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const {
      id: microsoftId,
      displayName,
      mail,
      userPrincipalName,
    } = msRes.data;
    const email = mail || userPrincipalName;

    if (!email) {
      return res
        .status(400)
        .json({ message: "Microsoft account does not have an email." });
    }

    // Helper to promisify DB queries (reused from googleLogin, ideally should be outside or imported)
    const query = (conn, sql, params) => {
      return new Promise((resolve, reject) => {
        conn.query(sql, params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
    };

    // Check if the user exists in asipiya_user table
    const findUserQuery =
      "SELECT * FROM asipiya_user WHERE Email = ? AND Status = '1' LIMIT 1";
    const results = await query(db2, findUserQuery, [email]);

    if (results.length === 0) {
      return res.status(200).json({
        email: email,
        newUser: true,
      });
    }

    const user = results[0];

    // Load active companies
    const companiesSql = `
        SELECT c.idCompany AS companyId, c.Name AS companyName
        FROM company_has_asipiya_user chau
        JOIN company c ON c.idCompany = chau.Company_idCompany
        WHERE chau.Asipiya_User_idAsipiya_User = ?
          AND chau.Status = '1'
          AND c.Status = '1'
        ORDER BY c.idCompany ASC
      `;
    let companyRows = await query(db2, companiesSql, [user.idAsipiya_User]);

    if (!companyRows || companyRows.length === 0) {
      return res
        .status(404)
        .json({ message: "No active company found for this user" });
    }

    // Augment with logos
    try {
      const companyIds = companyRows.map((r) => r.companyId);
      if (companyIds.length > 0) {
        const placeholders = companyIds.map(() => "?").join(",");
        const logoSql = `
              SELECT c.idCompany AS companyId,
                (SELECT ims.logo_url
                 FROM invoice_main_settings ims
                 JOIN branch b ON ims.Branch_idBranch = b.idBranch
                 WHERE b.Company_idCompany = c.idCompany AND b.Status = '1' AND ims.logo_url IS NOT NULL
                 LIMIT 1) AS logo
              FROM company c
              WHERE c.idCompany IN (${placeholders})
            `;
        const logoRows = await query(db, logoSql, companyIds);

        const logoMap = {};
        for (const lr of logoRows) {
          if (lr.logo) {
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            logoMap[lr.companyId] = `${baseUrl}/uploads/${lr.logo}`;
          } else {
            logoMap[lr.companyId] = null;
          }
        }

        companyRows = companyRows.map((r) => ({
          ...r,
          logoUrl: logoMap[r.companyId] || null,
        }));
      }
    } catch (logoErr) {
      console.warn("Failed to load company logos:", logoErr);
    }

    // Choose company logic
    if (!companyId && companyRows.length > 1) {
      return res.status(200).json({
        chooseCompany: true,
        companies: companyRows,
        userPreview: {
          userId: user.idAsipiya_User,
          email: user.Email,
          firstName: user.First_Name,
          lastName: user.Last_Name,
          // Microsoft doesn't always provide a picture URL in the basic /me profile (unlike Google/FB)
          // You'd need a separate call to /me/photo/$value. For now, leave undefined/null.
          picture: null,
          Trial_Expire_On: user.trialExpireOn,
          Pro_Expire_On: user.proExpireOn,
          Grace_Period_Expire_On: user.gracePeriodExpireOn,
          Email_Verficiation_Status: user.Email_Verfication_Status,
        },
      });
    }

    const selectedCompanyId =
      companyId || (companyRows.length > 0 ? companyRows[0].companyId : null);

    if (!selectedCompanyId) {
      return res
        .status(400)
        .json({ message: "Company selection required for login" });
    }

    const selectedCompany =
      companyRows.find((r) => r.companyId === Number(selectedCompanyId)) ||
      companyRows[0];

    // Fetch active branch
    const getBranchSQL = `
          SELECT idBranch
          FROM branch
          WHERE Company_idCompany = ? AND Status = '1'
          ORDER BY idBranch ASC
          LIMIT 1
        `;
    const bRows = await query(db2, getBranchSQL, [selectedCompany.companyId]);

    if (!bRows || bRows.length === 0) {
      return res.status(404).json({
        message: "Active branch not found for this company",
      });
    }

    const branchId = bRows[0].idBranch;

    // Auto-heal: Ensure branch defaults exist (e.g. if user registered via Flow / Project Management)
    if (branchId) {
      await ensureBranchDefaults(
        branchId,
        user.idAsipiya_User,
        selectedCompany.Company_Category_idCompany_Category || 1,
      );
    }

    // Get privileges
    let userPrivileges = {};
    try {
      userPrivileges = await dbService.getUsersPrivilages(user.idAsipiya_User, branchId);
      if (!userPrivileges || userPrivileges.length === 0) {
        userPrivileges = await dbService.getUsersPrivilages(user.idAsipiya_User, null);
      }
    } catch (privError) {
      console.error("Error fetching user privileges:", privError);
    }

    // Generate JWT
    const authToken = jwt.sign(
      { userId: user.idAsipiya_User },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "1h" },
    );

    // Save login log
    const insertLogSQL = `
          INSERT INTO user_log (user_id, action, app, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?)
        `;
    const logData = [
      user.idAsipiya_User,
      "login",
      "asipbook",
      req.ip || null,
      req.headers["user-agent"] || null,
    ];

    try {
      await query(db2, insertLogSQL, logData);
    } catch (logErr) {
      console.error("Error inserting user log:", logErr);
    }

    res.status(200).json({
      token: authToken,
      user: {
        userId: user.idAsipiya_User,
        email: user.Email,
        firstName: user.First_Name,
        lastName: user.Last_Name,
        contact: user.Contact_No_01,
        companyid: selectedCompany.companyId,
        companyName: selectedCompany.companyName,
        branch: branchId,
        picture: null,
        ...(userPrivileges[0] || {}),
        Email_Verficiation_Status: user.Email_Verfication_Status,
        Role: selectedCompany.userRole === "Admin" || selectedCompany.userRole === "Owner" ? 1 : 2,
      },
    });
  } catch (error) {
    console.error("Microsoft login error:", error);
    res.status(500).json({ message: "Microsoft login failed" });
  }
};

// Helper to process login (jwt generation etc)
const processLogin = (user, companyId, res) => {
  // Generate token logic (copy from loginUser)
  const token = jwt.sign(
    {
      email: user.Email,
      userId: user.idUser,
      companyId: companyId,
      role: user.Role,
    },
    "importantsecret", // Using hardcoded secret as per other controllers likely
    { expiresIn: "1h" },
  );

  const refreshToken = jwt.sign(
    {
      email: user.Email,
      userId: user.idUser,
      companyId: companyId,
      role: user.Role,
    },
    "importantsecret",
    { expiresIn: "24h" },
  );

  return res.json({
    message: "Auth successful",
    token: token,
    refreshToken: refreshToken,
    user: {
      id: user.idUser,
      email: user.Email,
      firstName: user.First_Name,
      lastName: user.Last_Name,
      role: user.Role,
      companyId: companyId,
    },
  });
};

const sendForgotPasswordOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  // Check if email exists in asipiya_user
  const checkUserSql =
    "SELECT idAsipiya_User FROM asipiya_user WHERE Email = ?";
  const userRows = await new Promise((resolve, reject) => {
    db2.query(checkUserSql, [email], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });

  if (userRows.length === 0) {
    return res
      .status(404)
      .json({ message: "User with this email does not exist" });
  }

  // Generate and save OTP
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const insertOtpSql =
    "INSERT INTO otp_table (email, otp, expires_at) VALUES (?, ?, ?)";
  db.query(insertOtpSql, [email, otp, expiresAt], async (insertErr) => {
    if (insertErr) {
      console.error("Error saving OTP:", insertErr);
      return res.status(500).json({ message: "Failed to generate OTP" });
    }

    try {
      await sendOTP(email, otp);
      return res
        .status(200)
        .json({ success: true, message: "OTP sent successfully" });
    } catch (mailErr) {
      console.error("Error sending OTP email:", mailErr);
      return res.status(500).json({ message: "Failed to send OTP email" });
    }
  });
};

const verifyForgotPasswordOTP = (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  const otpSql =
    "SELECT idOTP FROM otp_table WHERE email = ? AND otp = ? AND expires_at > NOW()";
  db.query(otpSql, [email, otp], (err, results) => {
    if (err) {
      console.error("Error verifying OTP:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });
    }

    return res.status(200).json({ success: true, message: "OTP verified" });
  });
};

const resetForgottenPassword = (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res
      .status(400)
      .json({ message: "Email, OTP, and New Password are required" });
  }

  // Verify OTP again before resetting
  const otpSql =
    "SELECT idOTP FROM otp_table WHERE email = ? AND otp = ? AND expires_at > NOW()";
  db.query(otpSql, [email, otp], (err, results) => {
    if (err) {
      console.error("Error verifying OTP:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired OTP" });
    }

    // Hash new password
    bcrypt.hash(newPassword, saltRounds, (hashErr, hash) => {
      if (hashErr) {
        return res.status(500).json({ message: "Error hashing password" });
      }

      // Update password in asipiya_user
      const updateSql = "UPDATE asipiya_user SET Password = ? WHERE Email = ?";
      db2.query(updateSql, [hash, email], (updateErr, updateResult) => {
        if (updateErr) {
          console.error("Error updating password:", updateErr);
          return res.status(500).json({ message: "Error updating password" });
        }

        if (updateResult.affectedRows === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        // Delete used OTP
        db.query("DELETE FROM otp_table WHERE email = ?", [email], (delErr) => {
          if (delErr) console.error("Error deleting OTP:", delErr);
        });

        return res
          .status(200)
          .json({ success: true, message: "Password reset successfully" });
      });
    });
  });
};

// Refresh token — issues a new JWT if the current one is still valid
const refreshToken = (req, res) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ success: false, message: "No token provided" });
  }

  const token = authHeader.substring(7);
  jwt.verify(
    token,
    process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
    (err, decoded) => {
      if (err) {
        return res
          .status(401)
          .json({ success: false, message: "Token expired or invalid" });
      }

      // Issue a fresh token with the same userId
      const newToken = jwt.sign(
        { userId: decoded.userId },
        process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
        { expiresIn: "1h" },
      );

      res.status(200).json({ success: true, token: newToken });
    },
  );
};

// Generate a short-lived cross-auth token for SSO to Account Center
const generateCrossAuthToken = async (req, res) => {
  try {
    const { userId, email, companyId } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ message: "userId and email are required" });
    }

    const crossToken = jwt.sign(
      { userId, email, companyId, purpose: "cross-auth" },
      process.env.JWT_SECRET || "ASIPBOOK_SECRET",
      { expiresIn: "5m" },
    );

    return res.status(200).json({
      crossAuthToken: crossToken,
      accountCenterUrl:
        process.env.ACCOUNT_CENTER_URL ||
        "https://asipiyaaccountcenter.asipbook.com",
    });
  } catch (error) {
    console.error("Cross-auth token generation error:", error);
    return res
      .status(500)
      .json({ message: "Failed to generate cross-auth token" });
  }
};

const validateManagerPin = async (req, res) => {
  try {
    const { username, pin, companyId, branchId } = req.body;
    const cacheKey = `${username}_${companyId}`;
    
    // Check rate limit
    const attempt = failedPinAttempts.get(cacheKey);
    if (attempt && attempt.lockUntil > Date.now()) {
      return res.status(429).json({ message: "Too many failed attempts. Try again in 15 minutes." });
    }
    
    // Auth against Account Center
    const response = await axiosClient.post("/asipbook-login", {
      email: username,
      password: pin,
      companyId
    });
    
    if (response.data && response.data.token) {
      // Success, clear attempts
      failedPinAttempts.delete(cacheKey);
      return res.json({ valid: true });
    } else {
       throw new Error("Invalid credentials");
    }
    
  } catch (err) {
    // Increment failed attempts
    const { username, companyId } = req.body;
    const cacheKey = `${username}_${companyId}`;
    const attempt = failedPinAttempts.get(cacheKey) || { count: 0, lockUntil: 0 };
    attempt.count += 1;
    if (attempt.count >= 5) {
      attempt.lockUntil = Date.now() + 15 * 60 * 1000;
    }
    failedPinAttempts.set(cacheKey, attempt);
    
    return res.status(401).json({ message: "Invalid credentials or unauthorized", valid: false });
  }
};

module.exports = {
  registerUser,
  loginUser,
  checkToken,
  updateUserPassword,
  registerBranchUser,
  verifyOTP,
  resendOTP,
  googleLogin,
  setupCompanyDefaults,
  getUserById,
  updateUserProfile,
  deleteBranchUser,
  setOrUpdatePassword,
  sendForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetForgottenPassword,
  switchCompany,
  otpStatus,
  saveUserDesignation,
  getUserDesignationsByCompany,
  deleteUserDesignation,
  facebookLogin,
  microsoftLogin,
  refreshToken,
  generateCrossAuthToken,
  validateManagerPin,
};
