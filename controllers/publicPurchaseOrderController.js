const db = require("../db/db");
const db2 = require("../db/db2");

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
    if (parts[0] === "po" && parts[1]) {
      return parseInt(parts[1], 10);
    }
    return null;
  } catch (e) {
    return null;
  }
};

const getPublicPurchaseOrderDetails = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }

    const idPurchaseOrder = decodeToken(token);
    if (!idPurchaseOrder) {
      return res.status(400).json({ success: false, message: "Invalid purchase order share link" });
    }

    // 1. Fetch Purchase Order + Supplier Details
    const poQuery = `
      SELECT 
        po.*,
        s.Company_Name,
        s.Contact_No,
        s.Contact_No2,
        s.Address1,
        s.Address2,
        s.Address3
      FROM purchase_orders po
      INNER JOIN supplier s ON po.Supplier_idSupplier = s.idSupplier
      WHERE po.idPurchase_Order = ?`;

    const poResult = await queryDb(db, poQuery, [idPurchaseOrder]);
    if (poResult.length === 0) {
      return res.status(404).json({ success: false, message: "Purchase Order not found" });
    }

    const po = poResult[0];
    po.Address = [po.Address1, po.Address2, po.Address3].filter(Boolean).join(", ");
    const branchId = po.Branch_idBranch;

    // 2. Fetch Purchase Order Items
    const itemsQuery = `
      SELECT 
        poi.*, 
        i.Item_Code,
        i.Description AS Item_Name,
        qt.Description AS Unit_Name,
        qt.Description AS Unit
      FROM purchase_order_items poi
      INNER JOIN item i ON poi.Item_idItem = i.idItem 
      LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(poi.Qty_Type, i.Qty_Type)
      WHERE Purchase_Order_idPurchase_Order = ?`;

    const items = await queryDb(db, itemsQuery, [idPurchaseOrder]);

    // 3. Fetch Branch & Company account details (from db2)
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

    // 4. Fetch PO / Invoice Header Settings and Main Settings (Design) from db
    const headerQuery = "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ? LIMIT 1";
    const mainQuery = "SELECT * FROM invoice_main_settings WHERE Branch_idBranch = ? LIMIT 1";

    const [headerResult, mainResult] = await Promise.all([
      queryDb(db, headerQuery, [branchId]),
      queryDb(db, mainQuery, [branchId]),
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
        mainData.logo_url = `${req.protocol}://${req.get("host")}/uploads/${mainData.logo_url}`;
      }
    }

    // 5. Fetch PO Settings (customization)
    let poSettings = {
      header_color: "#1e293b",
      accent_color: "#6366f1",
      terms_and_conditions: "",
      footer_note: "This is a computer-generated document. No signature required.",
      show_logo: 1,
      show_terms: 1,
      show_footer_note: 1,
      show_vendor_address: 1,
      show_expected_date: 1,
      show_deadline_date: 1,
      show_item_code: 1,
      show_item_note: 1,
      show_subtotal: 1,
      show_discount: 1,
      show_email: 1,
      show_phone: 1,
      show_website: 1,
      show_address: 1,
    };
    try {
      const poSettingsResult = await queryDb(db, "SELECT * FROM po_settings WHERE Branch_idBranch = ? LIMIT 1", [branchId]);
      if (poSettingsResult.length > 0) {
        poSettings = { ...poSettings, ...poSettingsResult[0] };
      }
    } catch (err) {
      console.error("Error fetching po_settings:", err);
    }

    // 6. Return single unified response payload!
    return res.json({
      success: true,
      data: {
        po,
        items,
        address: branchDetails,
        headerData,
        settingsData: mainData,
        poSettings,
      },
    });
  } catch (err) {
    console.error("Error in getPublicPurchaseOrderDetails:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error fetching purchase order details",
      error: err.message,
    });
  }
};

module.exports = { getPublicPurchaseOrderDetails };
