const jwt = require("jsonwebtoken");
const db = require("../db/db");
const db2 = require("../db/db2");
const axiosClient = require("../utils/axiosClient");
const branchDBService = require("../services/branchDBService");
const customerDBService = require("../services/customerDBService");
const productDBService = require("../services/productDBService");
const invoiceDBService = require("../services/invoiceDBService");
const rulesDbService = require("../services/rulesDBService");
const customerLogDbService = require("../services/customerCreditLogDBService");
const stockCardDbService = require("../services/stockCardDBService");
const userLogDbService = require("../services/userLogDBService");
const installmentLogDbService = require("../services/installmentDBService");
const employeeDbService = require("../services/employeeDBService");
const { currentDate, currentDateTime } = require("../utils/currentData");
const fs = require("fs");
const path = require("path");

const saveBase64Receipt = (base64String) => {
  if (!base64String) return null;

  try {
    if (
      !base64String.startsWith("data:") &&
      (base64String.startsWith("uploads/") || base64String.startsWith("http"))
    ) {
      return base64String;
    }

    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return base64String; // Return as is if not base64 (e.g. reference number)
    }

    const type = matches[1];
    const data = matches[2];
    const buffer = Buffer.from(data, "base64");

    let extension = type.split("/")[1];
    if (extension === "jpeg") extension = "jpg";
    if (extension === "svg+xml") extension = "svg";

    const fileName = `receipt_${Date.now()}_${Math.floor(
      Math.random() * 1000,
    )}.${extension}`;
    const uploadDir = path.join(__dirname, "../uploads/receipts");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return `uploads/receipts/${fileName}`;
  } catch (error) {
    console.error("Error saving receipt:", error);
    return null;
  }
};

const sanitizeValue = (value) => {
  if (
    value === "" ||
    value === undefined ||
    value === "undefined" ||
    value === null
  ) {
    return null;
  }
  return value;
};

const appLoginUser = async (req, res) => {
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
            email, // pass back to re-use
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

    // Fetch privileges (non-blocking if it fails)
    let user_privileges = [];
    try {
      user_privileges = await branchDBService.getUsersPrivilages(
        asipUser.userId,
      );
    } catch (privErr) {
      console.warn("⚠️ Privilege fetching failed or empty:", privErr);
    }

    // Fetch subscription dates
    let subscriptionDates = {};
    if (asipUser.companyid) {
      const subscriptionSQL = `
        SELECT Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On
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
          };
        }
      } catch (subErr) {
        console.error("❌ Error fetching subscription dates:", subErr);
      }
    }

    // Find the Active Branch for the user's company and fetch customers & products
    let customers = [];
    let products = [];
    let invoices = [];
    let branchId = null;

    if (asipUser.companyid) {
      try {
        const getBranchSQL = `
          SELECT idBranch
          FROM branch
          WHERE Company_idCompany = ? AND Status = '1'
          ORDER BY idBranch ASC
          LIMIT 1
        `;
        const bRows = await new Promise((resolve, reject) => {
          db2.query(getBranchSQL, [asipUser.companyid], (err, results) => {
            if (err) return reject(err);
            resolve(results || []);
          });
        });

        if (bRows && bRows.length > 0) {
          branchId = bRows[0].idBranch;
          customers = await customerDBService.fetchActiveCustomer(branchId);
          products = await productDBService.fetchProducts(branchId);
          invoices = await invoiceDBService.fetchUnpaidInvoicesForApp(branchId);
        }
      } catch (err) {
        console.error(
          "❌ Error fetching active branch, customers, or products:",
          err,
        );
      }
    }

    // Fetch VAT settings from rules table
    let vatSettings = {};
    if (branchId) {
      try {
        const vatSQL = `
          SELECT vat_enabled, vat_percentage, Explicit_Stock_Check
          FROM rules
          WHERE Branch_idBranch = ?
          LIMIT 1
        `;
        const vatRows = await new Promise((resolve, reject) => {
          db.query(vatSQL, [branchId], (err, results) => {
            if (err) return reject(err);
            resolve(results || []);
          });
        });
        if (vatRows && vatRows.length > 0) {
          vatSettings = {
            vat_enabled: vatRows[0].vat_enabled,
            vat_percentage: vatRows[0].vat_percentage,
            Explicit_Stock_Check: vatRows[0].Explicit_Stock_Check,
          };
        }
      } catch (vatErr) {
        console.error("❌ Error fetching VAT settings:", vatErr);
      }
    }

    // Fetch Company details from invoice_header_settings
    let companyDetails = {};
    if (branchId) {
      try {
        const companySQL = `
          SELECT business_name, phone, email, address, company_reg, website
          FROM invoice_header_settings
          WHERE Branch_idBranch = ?
          LIMIT 1
        `;
        const companyRows = await new Promise((resolve, reject) => {
          db.query(companySQL, [branchId], (err, results) => {
            if (err) return reject(err);
            resolve(results || []);
          });
        });
        if (companyRows && companyRows.length > 0) {
          companyDetails = {
            business_name: companyRows[0].business_name || asipUser.companyName || asipUser.company || "AsipBook Partner",
            phone: companyRows[0].phone || "",
            email: companyRows[0].email || "",
            address: companyRows[0].address || "",
            company_reg: companyRows[0].company_reg || "",
            website: companyRows[0].website || "",
          };
        } else {
          companyDetails = {
            business_name: asipUser.companyName || asipUser.company || "AsipBook Partner",
            phone: "",
            email: "",
            address: "",
            company_reg: "",
            website: "",
          };
        }
      } catch (companyErr) {
        console.error("❌ Error fetching company details:", companyErr);
      }
    }

    if (!companyDetails.business_name) {
      companyDetails.business_name = asipUser.companyName || asipUser.company || "AsipBook Partner";
    }

    // Create Invoice API token
    const finalToken = jwt.sign(
      { userId: asipUser.userId },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "7d" }, // Longer token for app usage
    );

    return res.status(200).json({
      token: finalToken,
      user: {
        ...asipUser,
        branchId, // append branch that was found
        company: companyDetails,
        ...subscriptionDates,
        ...(user_privileges[0] || {}),
        ...vatSettings,
      },
      customers,
      products,
      invoices,
      company: companyDetails,
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appGoogleLogin = async (req, res) => {
  try {
    const { token, companyId } = req.body;

    // Helper to promisify DB queries
    const query = (conn, sql, params) => {
      return new Promise((resolve, reject) => {
        conn.query(sql, params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
    };

    // Verify Google ID token directly
    const { OAuth2Client } = require("google-auth-library");
    const googleClient = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID ||
        "442803762706-tdmaqjr331obmnhrl9p48o3iuej7kvk8.apps.googleusercontent.com",
    );

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience:
        process.env.GOOGLE_CLIENT_ID ||
        "442803762706-tdmaqjr331obmnhrl9p48o3iuej7kvk8.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

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

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const logoMap = {};
        for (const lr of logoRows) {
          logoMap[lr.companyId] = lr.logo
            ? `${baseUrl}/uploads/${lr.logo}`
            : null;
        }

        companyRows = companyRows.map((r) => ({
          ...r,
          logoUrl: logoMap[r.companyId] || null,
        }));
      }
    } catch (logoErr) {
      console.warn("Failed to augment companies with logos:", logoErr);
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

    // Fetch privileges
    let user_privileges = [];
    try {
      user_privileges = await branchDBService.getUsersPrivilages(
        user.idAsipiya_User,
      );
    } catch (privErr) {
      console.warn("⚠️ Privilege fetching failed or empty:", privErr);
    }

    // Fetch subscription dates
    let subscriptionDates = {};
    const subscriptionSQL = `
      SELECT Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On
      FROM companyhassoftware
      WHERE company_id = ? AND software_id = 1
      LIMIT 1
    `;
    try {
      const subRows = await query(db2, subscriptionSQL, [
        selectedCompany.companyId,
      ]);
      if (subRows && subRows.length > 0) {
        subscriptionDates = {
          Trial_Expire_On: subRows[0].Trial_Expire_On,
          Pro_Expire_On: subRows[0].Pro_Expire_On,
          Grace_Period_Expire_On: subRows[0].Grace_Period_Expire_On,
        };
      }
    } catch (subErr) {
      console.error("❌ Error fetching subscription dates:", subErr);
    }

    // Fetch customers & products for the branch
    let customers = [];
    let products = [];
    let invoices = [];
    try {
      customers = await customerDBService.fetchActiveCustomer(branchId);
      products = await productDBService.fetchProducts(branchId);
      invoices = await invoiceDBService.fetchUnpaidInvoicesForApp(branchId);
    } catch (err) {
      console.error("❌ Error fetching customers or products:", err);
    }

    // Fetch VAT settings
    let vatSettings = {};
    try {
      const vatSQL = `
        SELECT vat_enabled, vat_percentage, Explicit_Stock_Check
        FROM rules
        WHERE Branch_idBranch = ?
        LIMIT 1
      `;
      const vatRows = await query(db, vatSQL, [branchId]);
      if (vatRows && vatRows.length > 0) {
        vatSettings = {
          vat_enabled: vatRows[0].vat_enabled,
          vat_percentage: vatRows[0].vat_percentage,
          Explicit_Stock_Check: vatRows[0].Explicit_Stock_Check,
        };
      }
    } catch (vatErr) {
      console.error("❌ Error fetching VAT settings:", vatErr);
    }

    // Fetch Company details from invoice_header_settings
    let companyDetails = {};
    try {
      const companySQL = `
        SELECT business_name, phone, email, address, company_reg, website
        FROM invoice_header_settings
        WHERE Branch_idBranch = ?
        LIMIT 1
      `;
      const companyRows = await query(db, companySQL, [branchId]);
      if (companyRows && companyRows.length > 0) {
        companyDetails = {
          business_name: companyRows[0].business_name || selectedCompany.companyName || "AsipBook Partner",
          phone: companyRows[0].phone || "",
          email: companyRows[0].email || "",
          address: companyRows[0].address || "",
          company_reg: companyRows[0].company_reg || "",
          website: companyRows[0].website || "",
        };
      } else {
        companyDetails = {
          business_name: selectedCompany.companyName || "AsipBook Partner",
          phone: "",
          email: "",
          address: "",
          company_reg: "",
          website: "",
        };
      }
    } catch (companyErr) {
      console.error("❌ Error fetching company details:", companyErr);
    }

    if (!companyDetails.business_name) {
      companyDetails.business_name = selectedCompany.companyName || "AsipBook Partner";
    }

    // Create app JWT (7-day expiry for mobile usage)
    const finalToken = jwt.sign(
      { userId: user.idAsipiya_User },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      token: finalToken,
      user: {
        userId: user.idAsipiya_User,
        email: user.Email,
        firstName: user.First_Name,
        lastName: user.Last_Name,
        contact: user.Contact_No_01,
        companyid: selectedCompany.companyId,
        companyName: selectedCompany.companyName,
        company: companyDetails,
        branch: branchId,
        branchId,
        picture: picture,
        ...subscriptionDates,
        ...(user_privileges[0] || {}),
        ...vatSettings,
        Email_Verficiation_Status: user.Email_Verfication_Status,
      },
      customers,
      products,
      invoices,
      company: companyDetails,
    });
  } catch (error) {
    console.error("App Google login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appFacebookLogin = async (req, res) => {
  try {
    const { token, companyId } = req.body; // token is the Facebook accessToken

    // Helper to promisify DB queries
    const query = (conn, sql, params) => {
      return new Promise((resolve, reject) => {
        conn.query(sql, params, (err, results) => {
          if (err) return reject(err);
          resolve(results);
        });
      });
    };

    // Verify Facebook Token directly
    const axios = require("axios");
    const fbRes = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${token}`,
      { timeout: 10000 },
    );
    const { email, name, picture: picObj } = fbRes.data;
    const picture = picObj?.data?.url;

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

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const logoMap = {};
        for (const lr of logoRows) {
          logoMap[lr.companyId] = lr.logo
            ? `${baseUrl}/uploads/${lr.logo}`
            : null;
        }

        companyRows = companyRows.map((r) => ({
          ...r,
          logoUrl: logoMap[r.companyId] || null,
        }));
      }
    } catch (logoErr) {
      console.warn("Failed to augment companies with logos:", logoErr);
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

    // Fetch privileges
    let user_privileges = [];
    try {
      user_privileges = await branchDBService.getUsersPrivilages(
        user.idAsipiya_User,
      );
    } catch (privErr) {
      console.warn("⚠️ Privilege fetching failed or empty:", privErr);
    }

    // Fetch subscription dates
    let subscriptionDates = {};
    const subscriptionSQL = `
      SELECT Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On
      FROM companyhassoftware
      WHERE company_id = ? AND software_id = 1
      LIMIT 1
    `;
    try {
      const subRows = await query(db2, subscriptionSQL, [
        selectedCompany.companyId,
      ]);
      if (subRows && subRows.length > 0) {
        subscriptionDates = {
          Trial_Expire_On: subRows[0].Trial_Expire_On,
          Pro_Expire_On: subRows[0].Pro_Expire_On,
          Grace_Period_Expire_On: subRows[0].Grace_Period_Expire_On,
        };
      }
    } catch (subErr) {
      console.error("❌ Error fetching subscription dates:", subErr);
    }

    // Fetch customers & products for the branch
    let customers = [];
    let products = [];
    let invoices = [];
    try {
      customers = await customerDBService.fetchActiveCustomer(branchId);
      products = await productDBService.fetchProducts(branchId);
      invoices = await invoiceDBService.fetchUnpaidInvoicesForApp(branchId);
    } catch (err) {
      console.error("❌ Error fetching customers or products:", err);
    }

    // Fetch VAT settings
    let vatSettings = {};
    try {
      const vatSQL = `
        SELECT vat_enabled, vat_percentage, Explicit_Stock_Check
        FROM rules
        WHERE Branch_idBranch = ?
        LIMIT 1
      `;
      const vatRows = await query(db, vatSQL, [branchId]);
      if (vatRows && vatRows.length > 0) {
        vatSettings = {
          vat_enabled: vatRows[0].vat_enabled,
          vat_percentage: vatRows[0].vat_percentage,
          Explicit_Stock_Check: vatRows[0].Explicit_Stock_Check,
        };
      }
    } catch (vatErr) {
      console.error("❌ Error fetching VAT settings:", vatErr);
    }

    // Fetch Company details from invoice_header_settings
    let companyDetails = {};
    try {
      const companySQL = `
        SELECT business_name, phone, email, address, company_reg, website
        FROM invoice_header_settings
        WHERE Branch_idBranch = ?
        LIMIT 1
      `;
      const companyRows = await query(db, companySQL, [branchId]);
      if (companyRows && companyRows.length > 0) {
        companyDetails = {
          business_name: companyRows[0].business_name || selectedCompany.companyName || "AsipBook Partner",
          phone: companyRows[0].phone || "",
          email: companyRows[0].email || "",
          address: companyRows[0].address || "",
          company_reg: companyRows[0].company_reg || "",
          website: companyRows[0].website || "",
        };
      } else {
        companyDetails = {
          business_name: selectedCompany.companyName || "AsipBook Partner",
          phone: "",
          email: "",
          address: "",
          company_reg: "",
          website: "",
        };
      }
    } catch (companyErr) {
      console.error("❌ Error fetching company details:", companyErr);
    }

    if (!companyDetails.business_name) {
      companyDetails.business_name = selectedCompany.companyName || "AsipBook Partner";
    }

    // Create app JWT (7-day expiry for mobile usage)
    const finalToken = jwt.sign(
      { userId: user.idAsipiya_User },
      process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
      { expiresIn: "7d" },
    );

    return res.status(200).json({
      token: finalToken,
      user: {
        userId: user.idAsipiya_User,
        email: user.Email,
        firstName: user.First_Name,
        lastName: user.Last_Name,
        contact: user.Contact_No_01,
        companyid: selectedCompany.companyId,
        companyName: selectedCompany.companyName,
        company: companyDetails,
        branch: branchId,
        branchId,
        picture: picture,
        ...subscriptionDates,
        ...(user_privileges[0] || {}),
        ...vatSettings,
        Email_Verficiation_Status: user.Email_Verfication_Status,
      },
      customers,
      products,
      invoices,
      company: companyDetails,
    });
  } catch (error) {
    console.error("App Facebook login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


const appSync = async (req, res) => {
  const { invoices = [], customers = [], payments = [], branchId } = req.body;
  const userId = req.userId;

  if (
    (!invoices || invoices.length === 0) &&
    (!customers || customers.length === 0) &&
    (!payments || payments.length === 0)
  ) {
    return res.status(400).json({ message: "No data provided for sync" });
  }

  const customerUuidMap = {};
  const customerResults = [];
  const customerErrors = [];

  // 1. Process Customers First
  for (const custData of customers) {
    try {
      await new Promise((resolve, reject) => {
        db.getConnection((connErr, connection) => {
          if (connErr) return reject(connErr);

          connection.beginTransaction((beginErr) => {
            if (beginErr) {
              connection.release();
              return reject(beginErr);
            }

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

            const values = [
              custData.title || 'Mr.',
              custData.firstName,
              custData.middleName || '',
              custData.lastName || '',
              custData.displayName || `${custData.firstName} ${custData.lastName || ''}`.trim(),
              branchId,
              custData.companyName || '',
              custData.companyEmail || '',
              custData.phoneNumber || '',
              custData.mobileNumber || '',
              custData.fax || '',
              custData.other || '',
              custData.website || '',
              custData.gstNo || '',
              custData.vatNo || '',
              custData.billingAddress1 || '',
              custData.billingAddress2 || '',
              custData.billingAddress3 || '',
              custData.billingCity || '',
              custData.billingProvince || '',
              custData.billingCountry || 'Sri Lanka',
              custData.shippingAddress1 || '',
              custData.shippingAddress2 || '',
              custData.shippingAddress3 || '',
              custData.shippingCity || '',
              custData.shippingProvince || '',
              custData.shippingPostalCode || '',
              custData.shippingCountry || 'Sri Lanka',
              null,
              custData.officialEmail || null,
              custData.officialPhone || null,
              null,
              custData.credit_limit || 0,
              custData.credit_period || null
            ];

            connection.query(customerSql, values, (err, result) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  reject(err);
                });
              }

              const newCustomerId = result.insertId;
              connection.commit((commitErr) => {
                if (commitErr) {
                  return connection.rollback(() => {
                    connection.release();
                    reject(commitErr);
                  });
                }
                connection.release();
                customerUuidMap[custData.uuid] = newCustomerId;
                customerResults.push({
                  uuid: custData.uuid,
                  idCustomer: newCustomerId,
                  status: "synced"
                });
                resolve();
              });
            });
          });
        });
      });
    } catch (err) {
      customerErrors.push({
        uuid: custData.uuid,
        error: err.message
      });
    }
  }

  const invoiceUuidMap = {};
  const results = [];
  const errors = [];

  for (const invData of invoices) {
    try {
      await new Promise((resolve, reject) => {
        db.getConnection(async (connErr, connection) => {
          if (connErr) return reject(connErr);

          connection.beginTransaction(async (beginErr) => {
            if (beginErr) {
              connection.release();
              return reject(beginErr);
            }

            try {
              // Mapping mobile JSON to backend fields
              const Quotation_idQuotation = 0; // Offline invoices aren't from quotes usually
              const Invoice_Date = invData.created_at
                ? new Date(invData.created_at).toISOString().split("T")[0]
                : currentDate();
              
              let Customer_idCustomer = invData.customer_id;
              if (customerUuidMap[Customer_idCustomer]) {
                Customer_idCustomer = customerUuidMap[Customer_idCustomer];
              }
              const customerResult =
                await customerDBService.fetchCustomerById(Customer_idCustomer);
              let Address = "";
              if (customerResult && customerResult.length > 0) {
                const c = customerResult[0];
                Address = [
                  c.billingAddress1,
                  c.billingAddress2,
                  c.billingAddress3,
                  c.billingCity,
                ]
                  .filter((val) => val && val.trim() !== "" && val !== "null")
                  .join(", ");
              }
              const Employee_idEmployee = userId;
              const Total = invData.subtotal || 0;
              const Discount_Type = invData.discount_type || "amount";
              const Discount_Presentage = invData.discount_percentage || 0;
              const Discount_Amount = invData.discount_value || 0;
              const Net_Amount = invData.net_amount || 0;
              const Note = "Offline Sync " + invData.uuid;
              const Payment_Type = invData.payment_strategy || 1;
              const Interest_Amount = invData.interest_value || 0;
              const Interest_Presentage = invData.interest_percentage || 0;
              const Interest_Type = invData.interest_type || "percentage";
              const Paid_Amount =
                invData.payment_strategy === 1
                  ? invData.paid_amount || 0
                  : invData.down_payment || 0;
              const Balance_Amount = invData.balance_to_pay || 0;
              const lastCustomerLog =
                await customerLogDbService.fetchLastLog(Customer_idCustomer);
              const currentCustomerCreditBalance =
                lastCustomerLog?.length === 0
                  ? 0
                  : parseFloat(lastCustomerLog[0].Total_Credit_Balance);
              const Credit_Balance =
                currentCustomerCreditBalance + (invData.balance_to_pay || 0);
              const Vat_Amount = invData.vat_amount || 0;
              const Extra_Charge_Label =
                invData.extra_charge_note || "Extra Charge";
              const Extra_Charge = invData.extra_charge_amount || 0;
              const Branch_idBranch = branchId;
              const User_idUser = userId;
              const items = invData.items || [];
              const Installment_Count = invData.installment_count || 1;

              // Infer Payment Method
              let Payment_Method = "cash";
              if (invData.card_number) Payment_Method = "card";
              else if (invData.cheque_number) Payment_Method = "cheque";
              else if (invData.transaction_id) Payment_Method = "online";

              const Card_Type = invData.card_type;
              const Card_Number = invData.card_number;
              const Transaction_Id = invData.transaction_id;
              const Receipt = invData["Reciept Ref no"];
              const Cheque_No = invData.cheque_number;
              const Cheque_Date = invData.cheque_expire_date;

              const savedReceipt = saveBase64Receipt(Receipt);

              // 1. Generate Invoice Number
              const rules =
                await rulesDbService.getInvoiceNumberDetails(Branch_idBranch);
              const base_letter_part = rules[0].Invoice_No_Start_With;
              const starting_number = rules[0].Invoice_No_Strat_From;
              const salesman_enabled =
                parseInt(rules[0].salesman_enabled) === 1;

              let letter_part = base_letter_part;
              if (salesman_enabled && Employee_idEmployee) {
                const employee =
                  await employeeDbService.fetchEmployeeById(
                    Employee_idEmployee,
                  );
                if (employee && employee.length > 0) {
                  const salesmanPrefix = employee[0].Employee_Name.replace(
                    /\s+/g,
                    "",
                  )
                    .substring(0, 3)
                    .toUpperCase();
                  letter_part = `${salesmanPrefix}${base_letter_part}`;
                }
              }

              let next_invoice_number = `${letter_part}${starting_number}`;
              // Always search for last invoice matching the current prefix to avoid duplicates
              // when toggling salesman prefix on/off
              const last_invoice =
                await invoiceDBService.getLastInvoiceBySalesmanPrefix(
                  Branch_idBranch,
                  letter_part,
                );

              if (last_invoice?.length !== 0) {
                const last_invoice_number = last_invoice[0].Invoice_Number;
                const match = last_invoice_number.match(/\d/);
                if (match) {
                  const digitPosition = match.index;
                  const numericPart = parseInt(
                    last_invoice_number.slice(digitPosition),
                  );
                  next_invoice_number = `${letter_part}${numericPart + 1}`;
                }
              }
              const Invoice_Number = next_invoice_number;

              // 2. Customer Log & Credit Balance
              const Total_Credit_Balance = Credit_Balance;

              const Created_Date = currentDate();
              const created_at_db = currentDateTime();
              const safeChequeDate =
                !Cheque_Date || Cheque_Date.trim() === "" ? null : Cheque_Date;

              // 3. Insert Invoice
              const invoice = await invoiceDBService.insertInvoice(
                Invoice_Number,
                Quotation_idQuotation,
                Invoice_Date,
                Customer_idCustomer,
                Address,
                Employee_idEmployee,
                Total,
                Discount_Type,
                Discount_Presentage,
                Discount_Amount,
                null, // Discount2_Type
                0, // Discount2_Presentage
                0, // Discount2_Amount
                Net_Amount,
                items.length,
                Note,
                Payment_Type,
                Interest_Amount,
                Interest_Presentage,
                Interest_Type,
                Paid_Amount,
                Balance_Amount,
                Credit_Balance,
                Total_Credit_Balance,
                Created_Date,
                created_at_db,
                Branch_idBranch,
                Payment_Method,
                sanitizeValue(Card_Type),
                sanitizeValue(Card_Number),
                sanitizeValue(Transaction_Id),
                savedReceipt,
                null, // Cheque Type
                sanitizeValue(Cheque_No),
                safeChequeDate,
                null, // Cheque Name
                null, // Bank Account ID
                Vat_Amount,
                Extra_Charge_Label,
                Extra_Charge,
                userId,
                null, // place_of_supply
                null, // custom_fields_data
                connection,
              );

              const Invoice_idInvoice = invoice.insertId;

              // 4. Handle Installments
              if (Payment_Type === 2) {
                let installment_amount = parseFloat(Credit_Balance);
                let single_installment_amount =
                  Math.round((installment_amount / Installment_Count) * 100) /
                  100;
                let total_of_regular_installments =
                  single_installment_amount * (Installment_Count - 1);
                let last_installment_amount =
                  Math.round(
                    (installment_amount - total_of_regular_installments) * 100,
                  ) / 100;

                for (let i = 1; i <= Installment_Count; i++) {
                  const [year, month, day] =
                    Invoice_Date.split("-").map(Number);
                  const date = new Date(year, month - 1 + i, day);
                  const add_date = `${date.getFullYear()}-${(
                    date.getMonth() + 1
                  )
                    .toString()
                    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

                  const current_amount =
                    i === Installment_Count
                      ? last_installment_amount
                      : single_installment_amount;

                  await installmentLogDbService.insertInstallment(
                    Invoice_idInvoice,
                    Customer_idCustomer,
                    add_date,
                    i,
                    current_amount,
                    0,
                    current_amount,
                    0,
                    current_amount,
                    0,
                    Branch_idBranch,
                    connection,
                  );
                }
              }

              // 5. Customer Credit Log
              if (Credit_Balance !== 0) {
                await customerLogDbService.insertCustomerCreditLog(
                  Customer_idCustomer,
                  "INVOICE",
                  Invoice_idInvoice,
                  Credit_Balance,
                  0,
                  Total_Credit_Balance,
                  Payment_Type,
                  Payment_Method,
                  null, // Cheque Type
                  sanitizeValue(Cheque_No),
                  safeChequeDate,
                  null, // Cheque Name
                  0,
                  Branch_idBranch,
                  sanitizeValue(Card_Type),
                  sanitizeValue(Card_Number),
                  sanitizeValue(Transaction_Id),
                  savedReceipt,
                  null,
                  null,
                  null, // Note
                  null, // receipt_number
                  connection,
                );
              }

              // 6. Process Items
              for (const invItem of items) {
                let currentItem_id = invItem.item_id;
                let currentVariation_id = 0;
                let variationDescription = null;

                // 🔍 Handle Variations: Use 'isVariation' flag from mobile to safely identify variations
                if (
                  invItem.isVariation === true ||
                  invItem.isVariation === 1 ||
                  invItem.isVariation === "1"
                ) {
                  const variationCheck =
                    await productDBService.fetchVariation(currentItem_id);
                  if (variationCheck && variationCheck.length > 0) {
                    currentVariation_id = currentItem_id;
                    currentItem_id = variationCheck[0].item_id;
                    variationDescription = variationCheck[0].description;
                    console.log(
                      `[SYNC] Item ${invItem.item_id} identified as Variation ${currentVariation_id} of Product ${currentItem_id}`,
                    );
                  }
                }

                const item = await productDBService.fetchItem(currentItem_id);
                if (!item || item.length === 0) {
                  throw new Error(`Item ${currentItem_id} not found`);
                }

                const itemDescription =
                  invItem.long_description ||
                  item[0].Long_Description ||
                  item[0].Description;

                await invoiceDBService.insertInvoiceItem(
                  Invoice_idInvoice,
                  currentItem_id,
                  0, // Serial No (Default 0 for sync)
                  0, // Serial No ID
                  variationDescription || item[0].Description,
                  itemDescription,
                  item[0].Qty_Type,
                  invItem.quantity,
                  invItem.price,
                  invItem.line_total,
                  "amount", // Discount Type
                  0, // Discount
                  invItem.line_total,
                  Branch_idBranch,
                  currentVariation_id, // Pass Variation ID
                  invItem.remarks || "", // Remarks
                  connection,
                );

                // Inventory Update
                if (item[0].Type === "1") {
                  let in_qty = 0;
                  let out_qty = parseFloat(invItem.quantity);
                  let new_qty = 0;

                  // Case A: Variation Product
                  if (currentVariation_id && currentVariation_id > 0) {
                    console.log(
                      `[SYNC] Deducting variation stock: Var ID ${currentVariation_id}, Qty ${out_qty}`,
                    );
                    await productDBService.processInvoiceVariation(
                      currentVariation_id,
                      out_qty,
                      connection,
                    );
                    // For variations, we often keep main item qty tracking the total or just as a reference
                    // Here we follow the logic in createInvoice where main qty is logged as current but not necessarily adjusted in 'item' table directly if variation is used independently
                    new_qty = parseFloat(item[0].Qty);
                  }
                  // Case B: Standard Product
                  else {
                    new_qty = parseFloat(item[0].Qty) - out_qty;

                    await productDBService.itemProcess(
                      item[0].Cost,
                      item[0].Real_Cost,
                      new_qty,
                      currentItem_id,
                      connection,
                    );
                  }

                  await stockCardDbService.insertStockCard(
                    item[0].idItem,
                    item[0].Description,
                    "INVOICE",
                    Invoice_idInvoice,
                    item[0].Cost,
                    item[0].Real_Cost,
                    item[0].Rate,
                    in_qty,
                    out_qty,
                    new_qty,
                    Branch_idBranch,
                    connection,
                  );
                }
              }

              // 7. User Log
              await userLogDbService.insertLog(
                userId,
                currentDate(),
                "Invoice",
                Invoice_idInvoice,
                "create (sync)",
                Branch_idBranch,
                connection,
              );

              // Commit
              connection.commit((commitErr) => {
                if (commitErr) {
                  return connection.rollback(() => {
                    connection.release();
                    reject(commitErr);
                  });
                }
                connection.release();
                invoiceUuidMap[invData.uuid] = Invoice_idInvoice;
                results.push({
                  uuid: invData.uuid,
                  invoice_id: Invoice_idInvoice,
                  invoice_number: Invoice_Number,
                  status: "synced",
                });
                resolve();
              });
            } catch (err) {
              connection.rollback(() => {
                connection.release();
                errors.push({
                  uuid: invData.uuid,
                  error: err.message,
                });
                resolve(); // Still resolve to continue loop, but track error
              });
            }
          });
        });
      });
    } catch (loopErr) {
      errors.push({
        uuid: invData.uuid,
        error: loopErr.message,
      });
    }
  }

  // 3. Process Payments (Invoice-specific & Bulk FIFO allocations)
  const paymentResults = [];
  const paymentErrors = [];

  for (const p of payments) {
    try {
      let customerId = p.customer_id || p.Customer_idCustomer;
      if (customerUuidMap[customerId]) {
        customerId = customerUuidMap[customerId];
      }
      customerId = parseInt(customerId, 10);

      let invoiceId = p.invoice_id || p.Type_Id || 0;
      if (invoiceUuidMap[invoiceId]) {
        invoiceId = invoiceUuidMap[invoiceId];
      }
      invoiceId = parseInt(invoiceId, 10) || 0;

      const paidAmount = parseFloat(p.paid_amount || p.Paid_Amount || 0);
      if (paidAmount <= 0) {
        throw new Error("Invalid payment amount");
      }

      const paymentMethod = p.payment_method || p.Payment_Method || "cash";
      const paymentDate = p.date_time || p.Date_Time || new Date().toISOString().split("T")[0];
      const note = p.note || p.Note || (invoiceId > 0 ? `Payment for Invoice #${invoiceId}` : "Bulk payment via app sync");

      if (invoiceId > 0 && !p.is_bulk) {
        // Specific invoice payment
        const invRows = await new Promise((resolve, reject) => {
          db.query("SELECT * FROM invoice WHERE idInvoice = ?", [invoiceId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
          });
        });

        if (invRows.length === 0) {
          throw new Error(`Invoice #${invoiceId} not found`);
        }

        const inv = invRows[0];
        const invoiceTotal = Math.round(((parseFloat(inv.Net_Amount) || 0) + (parseFloat(inv.Interest_Amount) || 0)) * 100) / 100;
        const currentPaid = parseFloat(inv.Paid_Amount) || 0;
        const newPaid = Math.round(Math.min(invoiceTotal, currentPaid + paidAmount) * 100) / 100;
        const newBalance = Math.round(Math.max(0, invoiceTotal - newPaid) * 100) / 100;

        const lastLog = await customerLogDbService.fetchLastLog(customerId);
        const curCreditBalance = lastLog && lastLog.length > 0 ? parseFloat(lastLog[0].Total_Credit_Balance) || 0 : 0;
        const newCreditBalance = Math.max(0, curCreditBalance - paidAmount);

        await new Promise((resolve, reject) => {
          const insertSql = `
            INSERT INTO customer_credit_log (
              Customer_idCustomer, Type, Type_Id, Credit, Debit, Total_Credit_Balance,
              Payment_Type, Payment_Method, Cheque_Type, Cheque_No, Cheque_Date, Cheque_Name,
              Cheque_Status, Branch_idBranch, Note, receipt_number, Date_Time, Bank_Account_Id
            ) VALUES (?, 'PAYMENT', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
          `;
          db.query(
            insertSql,
            [
              customerId,
              invoiceId,
              paidAmount,
              newCreditBalance.toFixed(2),
              inv.Payment_Type || 3,
              paymentMethod,
              p.cheque_type || null,
              p.cheque_no || null,
              p.cheque_date || null,
              p.cheque_name || null,
              branchId,
              note,
              p.receipt_number || `PAY-${Date.now()}`,
              paymentDate,
              p.bank_account_id || null,
            ],
            (err, insRes) => {
              if (err) return reject(err);
              resolve(insRes);
            }
          );
        });

        await new Promise((resolve, reject) => {
          db.query(
            "UPDATE invoice SET Paid_Amount = ?, Balance_Amount = ?, Status = ? WHERE idInvoice = ?",
            [newPaid, newBalance, newBalance <= 0.01 ? 1 : 0, invoiceId],
            (err, uRes) => {
              if (err) return reject(err);
              resolve(uRes);
            }
          );
        });

        paymentResults.push({
          uuid: p.uuid,
          invoiceId,
          paidAmount,
          status: "synced",
        });
      } else {
        // Bulk customer payment FIFO across unpaid invoices
        const unpaidInvoices = await new Promise((resolve, reject) => {
          const uSql = `
            SELECT idInvoice, Net_Amount, Paid_Amount, Interest_Amount, Payment_Type, Date
            FROM invoice
            WHERE Customer_idCustomer = ?
              AND (CAST(Net_Amount AS DECIMAL(10,2)) + CAST(COALESCE(Interest_Amount, 0) AS DECIMAL(10,2)) - CAST(COALESCE(Paid_Amount, 0) AS DECIMAL(10,2))) > 0.01
            ORDER BY Date ASC, idInvoice ASC
          `;
          db.query(uSql, [customerId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
          });
        });

        let remainingToDistribute = paidAmount;
        let lastLog = await customerLogDbService.fetchLastLog(customerId);
        let curCreditBalance = lastLog && lastLog.length > 0 ? parseFloat(lastLog[0].Total_Credit_Balance) || 0 : 0;
        const sessionReceiptNumber = p.receipt_number || `PAY-${Date.now()}`;

        for (const unpaidInv of unpaidInvoices) {
          if (remainingToDistribute <= 0.005) break;

          const invTotal = Math.round(((parseFloat(unpaidInv.Net_Amount) || 0) + (parseFloat(unpaidInv.Interest_Amount) || 0)) * 100) / 100;
          const invPaid = parseFloat(unpaidInv.Paid_Amount) || 0;
          const invBalance = Math.round(Math.max(0, invTotal - invPaid) * 100) / 100;

          const allocate = Math.min(invBalance, remainingToDistribute);
          const newInvPaid = Math.round((invPaid + allocate) * 100) / 100;
          const newInvBalance = Math.round(Math.max(0, invTotal - newInvPaid) * 100) / 100;
          curCreditBalance = Math.max(0, curCreditBalance - allocate);

          await new Promise((resolve, reject) => {
            const insertSql = `
              INSERT INTO customer_credit_log (
                Customer_idCustomer, Type, Type_Id, Credit, Debit, Total_Credit_Balance,
                Payment_Type, Payment_Method, Cheque_Type, Cheque_No, Cheque_Date, Cheque_Name,
                Cheque_Status, Branch_idBranch, Note, receipt_number, Date_Time, Bank_Account_Id
              ) VALUES (?, 'PAYMENT', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            `;
            db.query(
              insertSql,
              [
                customerId,
                unpaidInv.idInvoice,
                allocate,
                curCreditBalance.toFixed(2),
                unpaidInv.Payment_Type || 0,
                paymentMethod,
                p.cheque_type || null,
                p.cheque_no || null,
                p.cheque_date || null,
                p.cheque_name || null,
                branchId,
                note,
                sessionReceiptNumber,
                paymentDate,
                p.bank_account_id || null,
              ],
              (err, insRes) => {
                if (err) return reject(err);
                resolve(insRes);
              }
            );
          });

          await new Promise((resolve, reject) => {
            db.query(
              "UPDATE invoice SET Paid_Amount = ?, Balance_Amount = ?, Status = ? WHERE idInvoice = ?",
              [newInvPaid, newInvBalance, newInvBalance <= 0.01 ? 1 : 0, unpaidInv.idInvoice],
              (err, uRes) => {
                if (err) return reject(err);
                resolve(uRes);
              }
            );
          });

          remainingToDistribute -= allocate;
        }

        if (remainingToDistribute > 0.005) {
          curCreditBalance = Math.max(0, curCreditBalance - remainingToDistribute);
          await new Promise((resolve, reject) => {
            const insertSql = `
              INSERT INTO customer_credit_log (
                Customer_idCustomer, Type, Type_Id, Credit, Debit, Total_Credit_Balance,
                Payment_Type, Payment_Method, Cheque_Type, Cheque_No, Cheque_Date, Cheque_Name,
                Cheque_Status, Branch_idBranch, Note, receipt_number, Date_Time, Bank_Account_Id
              ) VALUES (?, 'PAYMENT', 0, 0, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            `;
            db.query(
              insertSql,
              [
                customerId,
                remainingToDistribute,
                curCreditBalance.toFixed(2),
                paymentMethod,
                p.cheque_type || null,
                p.cheque_no || null,
                p.cheque_date || null,
                p.cheque_name || null,
                branchId,
                note,
                sessionReceiptNumber,
                paymentDate,
                p.bank_account_id || null,
              ],
              (err, insRes) => {
                if (err) return reject(err);
                resolve(insRes);
              }
            );
          });
        }

        paymentResults.push({
          uuid: p.uuid,
          customerId,
          paidAmount,
          status: "synced",
        });
      }
    } catch (pErr) {
      paymentErrors.push({
        uuid: p.uuid,
        error: pErr.message,
      });
    }
  }

  return res.status(200).json({
    message: "Sync complete",
    syncedInvoices: results,
    failedInvoices: errors,
    syncedCustomers: customerResults,
    failedCustomers: customerErrors,
    syncedPayments: paymentResults,
    failedPayments: paymentErrors,
  });
};

const appCheckEmail = async (req, res) => {
  try {
    const { email } = req.query;
    const response = await axiosClient.get("/company/auth/check-email", {
      params: { email },
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("App check-email error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appGetCompanyCategories = async (req, res) => {
  try {
    const response = await axiosClient.get("/company-categories");
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("App company-categories error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appRegisterCompany = async (req, res) => {
  try {
    const response = await axiosClient.post("/company/store", req.body);
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("App register error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appCreateOrder = async (req, res) => {
  try {
    const response = await axiosClient.post("/company-software/create-order", req.body);
    return res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error("App create-order error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appGetLoyalty = async (req, res) => {
  try {
    const loyaltyService = require("../services/loyaltyService");
    const userId = req.userId;
    const { planName } = req.query;
    console.log(`[AppLoyalty GET] Querying status for user ID: ${userId}, planName: ${planName}`);
    const status = await loyaltyService.getUserLoyaltyStatus(userId, planName);
    return res.status(200).json({ success: true, loyalty: status });
  } catch (error) {
    console.error("App get-loyalty error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const appGetWorkspaceData = async (req, res) => {
  try {
    const branchId = req.query.branchId;
    if (!branchId) {
      return res.status(400).json({ message: "branchId is required" });
    }

    const customerDBService = require("../services/customerDBService");
    const productDBService = require("../services/productDBService");
    const invoiceDBService = require("../services/invoiceDBService");

    const customers = await customerDBService.fetchActiveCustomer(branchId);
    const products = await productDBService.fetchProducts(branchId);
    const invoices = await invoiceDBService.fetchUnpaidInvoicesForApp(branchId);

    // Fetch VAT settings
    let vatSettings = {};
    try {
      const vatSQL = `
        SELECT vat_enabled, vat_percentage, Explicit_Stock_Check
        FROM rules
        WHERE Branch_idBranch = ?
        LIMIT 1
      `;
      const vatRows = await new Promise((resolve, reject) => {
        db.query(vatSQL, [branchId], (err, results) => {
          if (err) return reject(err);
          resolve(results || []);
        });
      });
      if (vatRows && vatRows.length > 0) {
        vatSettings = {
          vat_enabled: vatRows[0].vat_enabled,
          vat_percentage: vatRows[0].vat_percentage,
          Explicit_Stock_Check: vatRows[0].Explicit_Stock_Check,
        };
      }
    } catch (vatErr) {
      console.error("❌ Error fetching VAT settings:", vatErr);
    }

    // Fetch Company details
    let companyDetails = {};
    try {
      const companySQL = `
        SELECT business_name, phone, email, address, company_reg, website
        FROM invoice_header_settings
        WHERE Branch_idBranch = ?
        LIMIT 1
      `;
      const companyRows = await new Promise((resolve, reject) => {
        db.query(companySQL, [branchId], (err, results) => {
          if (err) return reject(err);
          resolve(results || []);
        });
      });
      if (companyRows && companyRows.length > 0) {
        companyDetails = {
          business_name: companyRows[0].business_name || "AsipBook Partner",
          phone: companyRows[0].phone || "",
          email: companyRows[0].email || "",
          address: companyRows[0].address || "",
          company_reg: companyRows[0].company_reg || "",
          website: companyRows[0].website || "",
        };
      } else {
        companyDetails = {
          business_name: "AsipBook Partner",
          phone: "",
          email: "",
          address: "",
          company_reg: "",
          website: "",
        };
      }
    } catch (companyErr) {
      console.error("❌ Error fetching company details:", companyErr);
    }

    if (!companyDetails.business_name) {
      companyDetails.business_name = "AsipBook Partner";
    }

    return res.status(200).json({
      customers,
      products,
      invoices,
      company: companyDetails,
      vatSettings
    });
  } catch (error) {
    console.error("Error fetching workspace data:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  appLoginUser,
  appGoogleLogin,
  appFacebookLogin,
  appSync,
  appCheckEmail,
  appGetCompanyCategories,
  appRegisterCompany,
  appCreateOrder,
  appGetLoyalty,
  appGetWorkspaceData,
};

