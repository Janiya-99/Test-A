const db = require("../db/db");
const db2 = require("../db/db2");
const path = require("path");
const fs = require("fs");

// Helper function to query MySQL using Promises
const queryDb = (conn, sql, params) => {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

// Decode base64 dynamic token with dynamic noise
const decodeToken = (token) => {
  try {
    let base64 = token;
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    const decoded = Buffer.from(base64, "base64").toString("ascii");
    const parts = decoded.split("_");
    if (parts[0] === "inv" && parts[1]) {
      return parseInt(parts[1], 10);
    }
    return null;
  } catch (e) {
    return null;
  }
};

const getPublicInvoiceDetails = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }

    const idInvoice = decodeToken(token);
    if (!idInvoice) {
      return res.status(400).json({ success: false, message: "Invalid invoice share link" });
    }

    // 1. Fetch Invoice + Customer Details
    const invoiceQuery = `
      SELECT 
        i.idInvoice,
        i.Invoice_Number,
        i.Quotation_idQuotation,
        i.Date AS Invoice_Date,
        i.Customer_idCustomer,
        i.Address,
        i.Employee_idEmployee,
        i.Total,
        i.Discount_Type,
        i.Discount_Presentage,
        i.Discount_Amount,
        i.Net_Amount,
        i.Item_Count,
        i.Note,
        i.Payment_Type,
        i.Interest_Amount,
        i.Interest_Presentage,
        i.Interest_Type,
        i.Paid_Amount,
        i.Balance_Amount,
        i.Credit_Balance,
        i.Total_Credit_Balance,
        i.Created_Date,
        i.created_at,
        i.Branch_idBranch,
        i.Payment_Method,
        i.Card_Type,
        i.Card_Number,
        i.Transaction_Id,
        i.Receipt,
        i.Cheque_Type,
        i.Cheque_No,
        i.Cheque_Date,
        i.Cheque_Name,
        i.Vat_Amount,
        i.Vat_Type,
        i.Extra_Charge_Label,
        i.Extra_Charge,
        i.custom_fields_data,
        c.Title,
        c.First_Name,
        c.displayName,
        c.companyName,
        c.phoneNumber,
        c.shippingAddress1,
        c.shippingAddress2,
        c.shippingAddress3,
        c.billingAddress1,
        c.billingAddress2,
        c.billingAddress3,
        c.mobileNumber,
        c.shippingCity,
        c.shippingProvince,
        c.shippingPostalCode,
        c.shippingCountry,
        c.vatNo,
        c.billingCity
      FROM invoice i
      LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
      WHERE i.idInvoice = ?`;

    const invoiceResult = await queryDb(db, invoiceQuery, [idInvoice]);
    if (invoiceResult.length === 0) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    const invoice = invoiceResult[0];
    try {
      invoice.custom_fields_data = invoice.custom_fields_data
        ? (typeof invoice.custom_fields_data === "string" ? JSON.parse(invoice.custom_fields_data) : invoice.custom_fields_data)
        : {};
    } catch (_) {
      invoice.custom_fields_data = {};
    }
    const branchId = invoice.Branch_idBranch;

    // Fetch Custom Fields for Public Invoice
    const customerId = invoice.Customer_idCustomer;
    let customFields = [];
    if (customerId) {
      customFields = await new Promise((resolve) => {
        const sql = `
          SELECT cfd.field_id, cfd.value, cf.field_name 
          FROM customer_field_data cfd 
          JOIN customer_fields cf ON cf.id = cfd.field_id 
          WHERE cfd.customer_id = ? AND cf.show_in_invoice = 1
        `;
        db.query(sql, [customerId], (err, results) => {
          if (err) {
            console.error("Error fetching custom fields for public invoice:", err);
            resolve([]);
          } else {
            resolve(results || []);
          }
        });
      });
    }
    invoice.custom_fields = customFields;

    // 2. Fetch Invoice Items & Service Dates
    const itemsQuery = `
      SELECT 
        ihi.*, 
        i.Type, 
        i.Cost, 
        i.Real_Cost, 
        i.Qty as Current_Stock, 
        COALESCE(i.Description, ihi.Description) as Item_Name, 
        COALESCE(i.Long_Description, ihi.Long_Description) as Item_Long_Description, 
        i.Item_Description as Item_Additional_Description, 
        ihi.Variation_Id, 
        si.ID as Serial_No_Id, 
        si.Serial_No as Serial_Number,
        qt.Description AS Unit_Name,
        qt.Description AS Unit
      FROM invoice_has_item ihi 
      LEFT JOIN item i ON ihi.Item_idItem = i.idItem 
      LEFT JOIN item_has_serial_no si ON ihi.Serial_No_Id = si.ID  
      LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(ihi.Qty_Type, i.Qty_Type)
      WHERE ihi.Invoice_idInvoice = ?`;

    let items = await queryDb(db, itemsQuery, [idInvoice]);

    // Fetch custom fields for items
    const itemIds = items.map((item) => item.Item_idItem).filter(Boolean);
    let customFieldsMap = {};
    if (itemIds.length > 0) {
      try {
        const fieldQuery = `
          SELECT 
            pfd.item_id,
            pfd.field_id,
            pfd.value,
            pf.field_name,
            pf.field_type
          FROM product_field_data pfd
          LEFT JOIN product_fields pf ON pfd.field_id = pf.id
          WHERE pfd.item_id IN (?)
        `;
        const fieldResults = await queryDb(db, fieldQuery, [itemIds]);
        for (const field of fieldResults) {
          if (!customFieldsMap[field.item_id]) {
            customFieldsMap[field.item_id] = [];
          }
          customFieldsMap[field.item_id].push({
            fieldId: field.field_id,
            fieldName: field.field_name,
            fieldType: field.field_type,
            value: field.value,
          });
        }
      } catch (cfErr) {
        console.error("Error fetching custom fields for items:", cfErr);
      }
    }

    // Populate service dates if needed & attach custom fields
    items = await Promise.all(
      items.map(async (item) => {
        item.customFields = customFieldsMap[item.Item_idItem] || [];
        if (item.Item_Service === 1) {
          const datesQuery = "SELECT Date FROM item_has_service_dates WHERE Invoice_idInvoice = ? AND Item_idItem = ?";
          const dates = await queryDb(db, datesQuery, [idInvoice, item.Item_idItem]);
          item.dates = dates;
        }
        return item;
      })
    );

    // 3. Fetch Installments if applicable
    let installments = [];
    if (invoice.Payment_Type === 2) {
      const installmentsQuery = "SELECT * FROM installment_payment WHERE Invoice_idInvoice = ? ORDER BY Term ASC";
      installments = await queryDb(db, installmentsQuery, [idInvoice]);
    }

    // 4. Fetch Branch & Company account details (from db2)
    let branchDetails = {};
    try {
      const branchQuery = "SELECT * FROM branch WHERE idBranch = ? LIMIT 1";
      const branchResult = await queryDb(db2, branchQuery, [branchId]);
      if (branchResult.length > 0) {
        const branch = branchResult[0];
        const companyQuery = "SELECT * FROM company WHERE idCompany = ? LIMIT 1";
        const companyResult = await queryDb(db2, companyQuery, [branch.Company_idCompany]);
        
        const companyName = companyResult.length > 0 ? companyResult[0].Name : "Your Business";
        const companyLogo = companyResult.length > 0 ? companyResult[0].Logo : null;
        const logoUrl = companyLogo ? `${req.protocol}://${req.get("host")}/uploads/${companyLogo}` : null;

        branchDetails = {
          Address1: branch.Address1,
          Address2: branch.Address2,
          Address3: branch.Address3,
          Contact_No: branch.Contact_No,
          Print_Size: branch.Print_Size,
          Company: companyName,
          Logo: logoUrl,
        };
      }
    } catch (err) {
      console.error("Error fetching branch details from db2:", err);
    }

    // 5. Fetch Invoice Header, Main (Design), Footer, Table settings, and rules (from db)
    const invoiceType = req.query.invoiceType || "";
    const isTax = invoiceType === "tax" ? 1 : 0;
    const headerQuery = "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ? AND is_tax = ? LIMIT 1";
    const mainQuery = "SELECT * FROM invoice_main_settings WHERE Branch_idBranch = ? LIMIT 1";
    const footerQuery = "SELECT * FROM invoice_footer_settings WHERE Branch_idBranch = ? AND is_tax = ? LIMIT 1";
    const tableQuery = "SELECT * FROM invoice_table_settings WHERE Branch_idBranch = ? LIMIT 1";
    const rulesQuery = "SELECT * FROM rules WHERE Branch_idBranch = ? LIMIT 1";

    const [headerResult, mainResult, footerResult, tableResult, rulesResult] = await Promise.all([
      queryDb(db, headerQuery, [branchId, isTax]),
      queryDb(db, mainQuery, [branchId]),
      queryDb(db, footerQuery, [branchId, isTax]),
      queryDb(db, tableQuery, [branchId]),
      queryDb(db, rulesQuery, [branchId]),
    ]);

    // Parse header visibility and sizes
    let headerData = headerResult[0] || {};
    const defaultShowFields = {
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
      vat_no: true,
      show_thermal_footer: true,
    };
    const defaultFontSizes = {
      business_name: 16,
      address: 16,
      website: 16,
      email: 16,
      phone: 16,
      bill_to: 16,
      ship_to: 16,
      datee: 16,
      invoice_number: 16,
      payment_method: 16,
      terms: 16,
      additional_note: 16,
      company_reg: 16,
      vat_no: 16,
      invoice_headings: 16,
    };

    if (headerResult.length > 0) {
      try {
        headerData.showFields = headerData.visibility ? { ...defaultShowFields, ...JSON.parse(headerData.visibility) } : defaultShowFields;
      } catch (e) {
        headerData.showFields = defaultShowFields;
      }
      try {
        headerData.fontSizes = headerData.fontSizes ? { ...defaultFontSizes, ...JSON.parse(headerData.fontSizes) } : defaultFontSizes;
      } catch (e) {
        headerData.fontSizes = defaultFontSizes;
      }
    } else {
      headerData = {
        header_type: "text",
        business_name: branchDetails.Company || "Your Business Name",
        address: [branchDetails.Address1, branchDetails.Address2, branchDetails.Address3].filter(Boolean).join(", ") || "123 Main Street, City, Country",
        website: "www.yourbusiness.com",
        email: "info@yourbusiness.com",
        phone: branchDetails.Contact_No || "+123 456 7890",
        showFields: defaultShowFields,
        fontSizes: defaultFontSizes,
      };
    }

    // Parse main (design) settings
    let mainData = mainResult[0] || {
      template: "Classic",
      logo_url: null,
      theme_color: "#A7C7E7",
      text_color: "#000000",
      print_margins: { top: 10, bottom: 10, left: 10, right: 10 },
      paper_size: null,
    };
    if (mainResult.length > 0) {
      try {
        mainData.print_margins = mainData.print_margins ? JSON.parse(mainData.print_margins) : { top: 10, bottom: 10, left: 10, right: 10 };
      } catch (e) {
        mainData.print_margins = { top: 10, bottom: 10, left: 10, right: 10 };
      }
      try {
        mainData.paper_size = mainData.paper_size ? JSON.parse(mainData.paper_size) : null;
      } catch (e) {
        mainData.paper_size = null;
      }
      if (mainData.logo_url) {
        const logoPath = path.join(__dirname, "../uploads", mainData.logo_url);
        try {
          if (fs.existsSync(logoPath)) {
            const fileBuffer = fs.readFileSync(logoPath);
            const ext = path.extname(mainData.logo_url).toLowerCase().substring(1);
            const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
            mainData.logo_base64 = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
          }
        } catch (err) {
          console.error("Error reading logo file as base64 in getPublicInvoiceDetails:", err);
        }
        mainData.logo_url = `${req.protocol}://${req.get("host")}/uploads/${mainData.logo_url}`;
      } else {
        mainData.logo_url = null;
        mainData.logo_base64 = null;
      }
    }

    // Parse footer settings
    let footerData = {};
    if (footerResult.length > 0) {
      const fd = footerResult[0];
      let vis = { discounts: true, deposit: true, estimateSummary: true, tax: true };
      try {
        vis = fd.visibility ? JSON.parse(fd.visibility) : vis;
      } catch (e) {}
      footerData = {
        footerType: fd.footer_type || "text",
        footerImage: fd.footer_image || null,
        notes: fd.notes || "",
        paymentDetails: fd.payment_details || "",
        footerText: fd.footer_text || "",
        showFields: vis,
      };
    } else {
      footerData = {
        footerType: "text",
        footerImage: null,
        notes: "",
        paymentDetails: "",
        footerText: "",
        showFields: { discounts: true, deposit: true, estimateSummary: true, tax: true },
      };
    }

    // Parse table settings
    let tableSettings = { showInvoice: true, selectedColumns: [] };
    if (tableResult.length > 0) {
      try {
        tableSettings = {
          showInvoice: tableResult[0].show_invoice === 1,
          selectedColumns: JSON.parse(tableResult[0].selected_columns || "[]"),
        };
      } catch (e) {}
    }

    // Parse rules details
    let ruleDetails = rulesResult[0] || {
      Invoice_No_Strat_From: 1,
      Invoice_No_Start_With: "INV",
    };
    if (rulesResult.length > 0) {
      const r = rulesResult[0];
      ruleDetails = {
        ...r,
        baseUrl: r.Invoice_Header ? `${req.protocol}://${req.get("host")}/uploads/${r.Invoice_Header}` : null,
        baseFooterUrl: r.Invoice_Footer ? `${req.protocol}://${req.get("host")}/uploads/${r.Invoice_Footer}` : null,
      };
    }

    // 6. Return single unified response payload!
    return res.json({
      success: true,
      data: {
        invoice,
        items,
        installments,
        address: branchDetails,
        headerData,
        footerData,
        tableSettings,
        settingsData: mainData,
        ruleDetails,
      },
    });
  } catch (err) {
    console.error("Error in getPublicInvoiceDetails:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error fetching invoice details",
      error: err.message,
    });
  }
};

module.exports = { getPublicInvoiceDetails };
