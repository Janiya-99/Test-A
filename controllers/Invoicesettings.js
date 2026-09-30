const db = require("../db/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads");
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// ─── THERMAL CONTENT SETTINGS WHITELISTS ─────────────────────────────────────
const ALLOWED_THERMAL_FONT_SIZES = ["small", "medium", "large", "xl", "xxl"];
const ALLOWED_THERMAL_FONT_FAMILIES = ["Arial", "Calibri", "Trebuchet MS", "Times New Roman", "Georgia", "Palatino Linotype", "Courier New", "Consolas"];
const ALLOWED_THERMAL_PAPER_WIDTHS = ["58mm", "80mm"];

// ─── DEFAULT CUSTOM FIELD CATALOG ────────────────────────────────────────────
const DEFAULT_CUSTOM_FIELDS = [
  // Vehicle / Transport
  { key: "vehicle_brand", label: "Brand / Make", type: "text", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "vehicle_model", label: "Model", type: "text", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "vehicle_year", label: "Year", type: "number", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "vehicle_color", label: "Color", type: "text", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "vehicle_number", label: "Vehicle / Plate No.", type: "text", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "chassis_number", label: "Chassis Number", type: "text", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "engine_number", label: "Engine Number", type: "text", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "mileage", label: "Mileage (km)", type: "number", group: "Vehicle Info", enabled: false, custom_label: "" },
  { key: "fuel_type", label: "Fuel Type", type: "select", group: "Vehicle Info", enabled: false, custom_label: "", options: ["Petrol", "Diesel", "Electric", "Hybrid", "CNG"] },
  { key: "transmission", label: "Transmission", type: "select", group: "Vehicle Info", enabled: false, custom_label: "", options: ["Manual", "Automatic", "CVT", "Semi-Automatic"] },
  // Device / Electronics
  { key: "serial_number", label: "Serial Number", type: "text", group: "Device / Product", enabled: false, custom_label: "" },
  { key: "imei_number", label: "IMEI Number", type: "text", group: "Device / Product", enabled: false, custom_label: "" },
  { key: "device_type", label: "Device Type", type: "text", group: "Device / Product", enabled: false, custom_label: "" },
  { key: "warranty_number", label: "Warranty Number", type: "text", group: "Device / Product", enabled: false, custom_label: "" },
  { key: "purchase_date", label: "Purchase Date", type: "date", group: "Device / Product", enabled: false, custom_label: "" },
  // Order / Admin
  { key: "po_number", label: "PO Number", type: "text", group: "Order Details", enabled: false, custom_label: "" },
  // Insurance / Claims
  { key: "claim_number", label: "Claim Number", type: "text", group: "Insurance / Claim", enabled: false, custom_label: "" },
  { key: "policy_number", label: "Policy Number", type: "text", group: "Insurance / Claim", enabled: false, custom_label: "" },
  { key: "incident_date", label: "Incident Date", type: "date", group: "Insurance / Claim", enabled: false, custom_label: "" },
  // Customer / Admin
  { key: "customer_nic", label: "Customer NIC / ID No", type: "text", group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "technician_name", label: "Technician Assigned", type: "text", group: "Customer / Admin", enabled: false, custom_label: "" },
];

// Get header data for a specific branch
exports.getHeader = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;
  const isTax = req.query.is_tax === "true" || req.query.is_tax === "1" || req.query.is_tax === 1 ? 1 : 0;

  // 🔍 DEBUG
  console.log(`[GET-HEADER] Request received. Query:`, req.query);

  if (!branchId) {
    console.error(`[GET-HEADER] ❌ Error: Branch ID is missing.`);
    return res.status(400).json({ error: "Branch ID is required" });
  }

  const query =
    "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ? AND is_tax = ? LIMIT 1";

  db.query(query, [branchId, isTax], (err, results) => {
    if (err) {
      console.error(
        `[GET-HEADER] ❌ Database error for Branch ID ${branchId}:`,
        err
      );
      return res.status(500).json({ error: err.message });
    }

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

    const defaultData = {
      header_type: "text",
      business_name: "Your Business Name",
      address: "123 Main Street, City, Country",
      website: "www.yourbusiness.com",
      email: "info@yourbusiness.com",
      phone: "+123 456 7890",
      bill_to: "Customer Name or Company",
      ship_to: "Shipping Address",
      date: "2025-01-01",
      invoice_number: "INV-0001",
      additional_note: "Thank you for your business!",
      thermal_footer_message: "හොදම දේ අඩුම මිලට",
      visibility: JSON.stringify(defaultShowFields),
      fontSizes: JSON.stringify(defaultFontSizes),
      custom_fields_config: JSON.stringify(DEFAULT_CUSTOM_FIELDS),
    };

    let data = results[0];

    if (!data) {
      console.log(
        `[GET-HEADER] ℹ️ No header settings found for Branch ID ${branchId}. Returning defaults.`
      );
      data = { ...defaultData };
    }

    // Merge saved custom fields config with default catalog
    let savedFields = [];
    try {
      savedFields = JSON.parse(data.custom_fields_config || '[]');
    } catch (_) {
      savedFields = [];
    }

    const mergedFields = DEFAULT_CUSTOM_FIELDS.map(def => {
      const saved = savedFields.find(f => f.key === def.key);
      return saved ? { ...def, ...saved } : def;
    });

    // Append any saved fields that aren't in the default catalog
    savedFields.forEach(sf => {
      if (!mergedFields.find(f => f.key === sf.key)) {
        mergedFields.push(sf);
      }
    });

    data.custom_fields_config = JSON.stringify(mergedFields);

    try {
      const parsedVisibility = data.visibility
        ? JSON.parse(data.visibility)
        : {};
      data.showFields = {
        ...defaultShowFields,
        ...parsedVisibility,
      };
    } catch (e) {
      console.error(`[GET-HEADER] ⚠️ Error parsing visibility:`, e);
      data.showFields = defaultShowFields;
    }

    try {
      const parsedFontSizes = data.fontSizes ? JSON.parse(data.fontSizes) : {};
      data.fontSizes = {
        ...defaultFontSizes,
        ...parsedFontSizes,
      };
    } catch (e) {
      data.fontSizes = defaultFontSizes;
    }

    console.log(
      `[GET-HEADER] ✅ Successfully retrieved header settings for Branch ID ${branchId}`
    );
    res.json(data);
  });
};

// Save or update header
exports.saveHeader = (req, res) => {
  const { showFields, header_type, branch_id, fontSizes, datee, custom_fields_config, is_tax, ...restData } =
    req.body;

  let formattedDate = null;
  if (datee) {
    try {
      const d = new Date(datee);
      formattedDate = d.toISOString().slice(0, 19).replace("T", " "); // to get date like '2025-10-15 18:30:00'
    } catch (err) {
      console.error("Invalid date format:", datee);
    }
  }

  const isTaxVal = is_tax === "true" || is_tax === "1" || is_tax === 1 ? 1 : 0;
  const data = {
    ...restData,
    Branch_idBranch: branch_id, // Use the correct column name
    is_tax: isTaxVal,
    header_type: header_type,
    visibility: JSON.stringify(showFields || {}),
    fontSizes: JSON.stringify(fontSizes || {}),
    datee: formattedDate || null,
  };

  if (custom_fields_config !== undefined) {
    data.custom_fields_config = typeof custom_fields_config === 'string' ? custom_fields_config : JSON.stringify(custom_fields_config);
  }

  // First, try to update by Branch_idBranch and is_tax
  db.query(
    "UPDATE invoice_header_settings SET ? WHERE Branch_idBranch = ? AND is_tax = ?",
    [data, branch_id, isTaxVal],
    (err, result) => {
      if (err) {
        console.error("Update error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (result.affectedRows === 0) {
        // No existing entry, insert new
        db.query("INSERT INTO invoice_header_settings SET ?", data, (err) => {
          if (err) {
            console.error("Insert error:", err);
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, message: "Header created" });
        });
      } else {
        res.json({ success: true, message: "Header updated" });
      }
    }
  );
};

exports.getFooter = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;
  const isTax = req.query.is_tax === "true" || req.query.is_tax === "1" || req.query.is_tax === 1 ? 1 : 0;

  // 🔍 DEBUG
  console.log(`[GET-FOOTER] Request received. Query:`, req.query);

  if (!branchId) {
    console.error(`[GET-FOOTER] ❌ Error: Missing branch_id in query`);
    return res.status(400).json({ error: "Missing branch_id in query" });
  }

  db.query(
    "SELECT * FROM invoice_footer_settings WHERE Branch_idBranch = ? AND is_tax = ? LIMIT 1",
    [branchId, isTax],
    (err, results) => {
      if (err) {
        console.error(
          `[GET-FOOTER] ❌ Database error for Branch ID ${branchId}:`,
          err
        );
        return res.status(500).json({ error: err.message });
      }

      const defaultData = {
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
          vat: true,
          extraCharge: true,
          installments: true,
          signatures: true,
        }),
      };

      if (results.length === 0) {
        console.log(
          `[GET-FOOTER] ℹ️ No footer settings found for Branch ID ${branchId}. Returning defaults.`
        );
        return res.json({
          footerType: defaultData.footer_type,
          footerImage: defaultData.footer_image,
          notes: defaultData.notes,
          paymentDetails: defaultData.payment_details,
          footerText: defaultData.footer_text,
          showFields: JSON.parse(defaultData.visibility),
        });
      }

      const data = results[0];

      try {
        data.visibility = data.visibility
          ? JSON.parse(data.visibility)
          : JSON.parse(defaultData.visibility);

        // Merge newly added toggles to default to true for existing database records
        data.visibility = {
          discounts: true,
          deposit: true,
          estimateSummary: true,
          tax: true,
          vat: true,
          extraCharge: true,
          installments: true,
          signatures: true,
          signatureFormat: "format1",
          ...data.visibility,
        };
      } catch (e) {
        console.error(`[GET-FOOTER] ⚠️ Error parsing visibility:`, e);
        data.visibility = JSON.parse(defaultData.visibility);
      }

      const responseData = {
        footerType: data.footer_type || defaultData.footer_type,
        footerImage: data.footer_image || defaultData.footer_image,
        notes: data.notes || defaultData.notes,
        paymentDetails: data.payment_details || defaultData.payment_details,
        footerText: data.footer_text || defaultData.footer_text,
        showFields: data.visibility,
      };

      console.log(
        `[GET-FOOTER] ✅ Successfully retrieved footer settings for Branch ID ${branchId}`
      );
      res.json(responseData);
    }
  );
};

// Save or update footer
exports.saveFooter = (req, res) => {
  const {
    footerType,
    footerImage,
    notes,
    paymentDetails,
    footerText,
    showFields,
    branch_id,
    is_tax,
  } = req.body;

  // Validate branch_id exists
  if (!branch_id) {
    return res.status(400).json({ error: "branch_id is required" });
  }

  // Prepare visibility object
  const visibility = {
    discounts: !!showFields?.discounts,
    deposit: !!showFields?.deposit,
    estimateSummary: !!showFields?.estimateSummary,
    tax: !!showFields?.tax,
    vat: showFields?.vat !== undefined ? !!showFields?.vat : true,
    extraCharge: showFields?.extraCharge !== undefined ? !!showFields?.extraCharge : true,
    installments: showFields?.installments !== undefined ? !!showFields?.installments : true,
    signatures: showFields?.signatures !== undefined ? !!showFields?.signatures : true,
    signatureFormat: showFields?.signatureFormat || "format1",
  };

  const isTaxVal = is_tax === "true" || is_tax === "1" || is_tax === 1 ? 1 : 0;
  const data = {
    footer_type: footerType || "text",
    footer_image: footerImage || null,
    notes: notes || "",
    payment_details: paymentDetails || "",
    footer_text: footerText || "",
    visibility: JSON.stringify(visibility),
    is_tax: isTaxVal,
  };

  // First check if record exists for this branch and is_tax
  db.query(
    "SELECT id FROM invoice_footer_settings WHERE Branch_idBranch = ? AND is_tax = ?",
    [branch_id, isTaxVal],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (results.length > 0) {
        // Update existing record
        db.query(
          "UPDATE invoice_footer_settings SET ? WHERE Branch_idBranch = ? AND is_tax = ?",
          [data, branch_id, isTaxVal],
          (err, result) => {
            if (err) {
              console.error("Update error:", err);
              return res.status(500).json({ error: err.message });
            }
            console.log(
              `Updated footer settings for branch ${branch_id} and is_tax ${isTaxVal}. Affected rows: ${result.affectedRows}`
            );
            res.json({ success: true, message: "Footer settings updated" });
          }
        );
      } else {
        // Insert new record with branch_id
        db.query(
          "INSERT INTO invoice_footer_settings SET ?",
          { ...data, Branch_idBranch: branch_id },
          (err, result) => {
            if (err) {
              console.error("Insert error:", err);
              return res.status(500).json({ error: err.message });
            }
            console.log(
              `Created new footer settings for branch ${branch_id} and is_tax ${isTaxVal}. Insert ID: ${result.insertId}`
            );
            res.json({ success: true, message: "Footer settings created" });
          }
        );
      }
    }
  );
};

// Get table settings by branch_id
exports.getTableSettings = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;

  if (!branchId) {
    return res.status(400).json({ error: "Missing branch_id parameter" });
  }

  db.query(
    "SELECT * FROM invoice_table_settings WHERE Branch_idBranch = ? LIMIT 1",
    [branchId],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (results.length === 0) {
        // Return default if not found
        return res.json({
          showInvoice: true,
          showRemarks: true,
          selectedColumns: [],
        });
      }

      const data = results[0];
      try {
        data.selectedColumns = JSON.parse(data.selected_columns || "[]");
      } catch (e) {
        console.error("Error parsing selected_columns:", e);
        data.selectedColumns = [];
      }

      res.json({
        showInvoice: data.show_invoice,
        showRemarks: data.show_remarks === null ? true : (Number(data.show_remarks) === 1),
        selectedColumns: data.selectedColumns,
      });
    }
  );
};

// Save or update table settings
exports.saveTableSettings = (req, res) => {
  const { showInvoice, showRemarks, selectedColumns, branch_id } = req.body;

  if (!branch_id) {
    return res.status(400).json({ error: "branch_id is required" });
  }

  // Explicitly convert to 1 or 0
  const show_invoice = showInvoice ? 1 : 0;
  const show_remarks = showRemarks !== false ? 1 : 0;

  const data = {
    user_id: 0,
    show_invoice, // Now definitely 1 or 0
    show_remarks,
    selected_columns: JSON.stringify(selectedColumns || []),
    Branch_idBranch: branch_id,
  };

  // First check if record exists for this branch
  db.query(
    "SELECT id FROM invoice_table_settings WHERE Branch_idBranch = ?",
    [branch_id],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: err.message });
      }

      if (results.length > 0) {
        // Update existing record
        db.query(
          "UPDATE invoice_table_settings SET ? WHERE Branch_idBranch = ?",
          [data, branch_id],
          (err, result) => {
            if (err) {
              console.error("Update error:", err);
              return res.status(500).json({ error: err.message });
            }
            console.log(
              `Updated table settings for branch ${branch_id}. Affected rows: ${result.affectedRows}`
            );
            res.json({ success: true, message: "Table settings updated" });
          }
        );
      } else {
        // Insert new record with branch_id
        db.query(
          "INSERT INTO invoice_table_settings SET ?",
          data,
          (err, result) => {
            if (err) {
              console.error("Insert error:", err);
              return res.status(500).json({ error: err.message });
            }
            console.log(
              `Created new table settings for branch ${branch_id}. Insert ID: ${result.insertId}`
            );
            res.json({ success: true, message: "Table settings created" });
          }
        );
      }
    }
  );
};

// Get main settings for a specific branch
exports.getMainSettings = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;

  // 🔍 DEBUG: Log entry to getMainSettings
  console.log(`[GET-MAIN-SETTINGS] Request received. Query:`, req.query);

  if (!branchId) {
    console.error(
      `[GET-MAIN-SETTINGS] ❌ Error: Branch ID is missing in request.`
    );
    return res.status(400).json({ error: "Branch ID is required" });
  }

  const query = "SELECT * FROM invoice_main_settings WHERE Branch_idBranch = ?";
  db.query(query, [branchId], (err, results) => {
    if (err) {
      console.error(
        `[GET-MAIN-SETTINGS] ❌ Database error for Branch ID ${branchId}:`,
        err
      );
      return res.status(500).json({ error: err.message });
    }

    const defaultData = {
      template: "Classic",
      logo_url: null,
      theme_color: "#A7C7E7",
      text_color: "#000000",
      print_margins: { top: 10, bottom: 10, left: 10, right: 10 },
      paper_size: null,
      tax_template: "Classic",
      signature_url: null,
      signature_base64: null,
      thermal_font_size: "medium",
      thermal_font_family: null,
      thermal_paper_width: "80mm",
    };

    if (results.length === 0) {
      console.log(
        `[GET-MAIN-SETTINGS] ℹ️ No settings found for Branch ID ${branchId}. Returning defaults.`
      );
      return res.json(defaultData);
    }

    const data = results[0];

    // Parse print_margins safely
    try {
      data.print_margins = data.print_margins
        ? JSON.parse(data.print_margins)
        : defaultData.print_margins;
    } catch (e) {
      console.error(
        `[GET-MAIN-SETTINGS] ⚠️ Error parsing print_margins for Branch ID ${branchId}:`,
        e
      );
      data.print_margins = defaultData.print_margins;
    }

    // Parse paper_size safely
    try {
      data.paper_size = data.paper_size ? JSON.parse(data.paper_size) : null;
    } catch (e) {
      console.error(
        `[GET-MAIN-SETTINGS] ⚠️ Error parsing paper_size for Branch ID ${branchId}:`,
        e
      );
      data.paper_size = null;
    }

    // Parse email_settings safely
    try {
      data.email_settings = data.email_settings ? JSON.parse(data.email_settings) : null;
    } catch (e) {
      console.error(
        `[GET-MAIN-SETTINGS] ⚠️ Error parsing email_settings for Branch ID ${branchId}:`,
        e
      );
      data.email_settings = null;
    }

    // Resolve thermal content font/paper settings with safe whitelist fallback
    data.thermal_font_size = ALLOWED_THERMAL_FONT_SIZES.includes(data.thermal_font_size)
      ? data.thermal_font_size
      : "medium";
    data.thermal_font_family = ALLOWED_THERMAL_FONT_FAMILIES.includes(data.thermal_font_family)
      ? data.thermal_font_family
      : null;
    data.thermal_paper_width = ALLOWED_THERMAL_PAPER_WIDTHS.includes(data.thermal_paper_width)
      ? data.thermal_paper_width
      : "80mm";

    // Generate full logo URL if logo_url exists
    if (data.logo_url) {
      if (data.logo_url.startsWith("data:")) {
        data.logo_base64 = data.logo_url;
      } else {
        let filename = data.logo_url;
        let isFullUrl = false;
        if (data.logo_url.startsWith("http://") || data.logo_url.startsWith("https://")) {
          filename = path.basename(data.logo_url);
          isFullUrl = true;
        }

        const logoPath = path.join(__dirname, "../uploads", filename);
        try {
          if (fs.existsSync(logoPath)) {
            const fileBuffer = fs.readFileSync(logoPath);
            const ext = path.extname(filename).toLowerCase().substring(1);
            const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
            data.logo_base64 = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
          }
        } catch (err) {
          console.error("Error reading logo file as base64 in getMainSettings:", err);
        }

        if (!isFullUrl) {
          const baseUrl = `${req.protocol}://${req.get("host")}`;
          data.logo_url = `${baseUrl}/uploads/${data.logo_url}`;
        }
      }
    } else {
      data.logo_url = null;
      data.logo_base64 = null;
    }

    // Generate full signature URL if signature_url exists
    if (data.signature_url) {
      if (data.signature_url.startsWith("data:")) {
        data.signature_base64 = data.signature_url;
      } else {
        let filename = data.signature_url;
        let isFullUrl = false;
        if (data.signature_url.startsWith("http://") || data.signature_url.startsWith("https://")) {
          filename = path.basename(data.signature_url);
          isFullUrl = true;
        }

        const signaturePath = path.join(__dirname, "../uploads", filename);
        try {
          if (fs.existsSync(signaturePath)) {
            const fileBuffer = fs.readFileSync(signaturePath);
            const ext = path.extname(filename).toLowerCase().substring(1);
            const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
            data.signature_base64 = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
          }
        } catch (err) {
          console.error("Error reading signature file as base64 in getMainSettings:", err);
        }

        if (!isFullUrl) {
          const baseUrl = `${req.protocol}://${req.get("host")}`;
          data.signature_url = `${baseUrl}/uploads/${data.signature_url}`;
        }
      }
    } else {
      data.signature_url = null;
      data.signature_base64 = null;
    }

    console.log(
      `[GET-MAIN-SETTINGS] ✅ Successfully retrieved settings for Branch ID ${branchId}`
    );
    res.json(data);
  });
};

// Save or update main settings
exports.saveMainSettings = [
  upload.fields([{ name: "logo", maxCount: 1 }, { name: "signature", maxCount: 1 }]), // Handle logo and signature file upload
  async (req, res) => {
    const {
      template = "Classic",
      termalprinttemplate = "Classic", // Add termalprinttemplate with default value
      tax_template = "Classic",
      theme_color = "#000000",
      text_color = "#A7C7E7",
      print_margins = JSON.stringify({
        top: 10,
        bottom: 10,
        left: 10,
        right: 10,
      }),
      paper_size,
      branch_id,
      email_settings,
      thermal_font_size,
      thermal_font_family,
      thermal_paper_width,
    } = req.body;

    if (!branch_id) {
      return res.status(400).json({ error: "branch_id is required" });
    }

    // Validate paper_size if provided
    if (paper_size !== undefined && paper_size !== null) {
      try {
        const paperSizeObj =
          typeof paper_size === "string" ? JSON.parse(paper_size) : paper_size;

        // Validate required fields
        if (!paperSizeObj.type || typeof paperSizeObj.type !== "string") {
          return res
            .status(400)
            .json({ error: "paper_size must include a valid 'type' field" });
        }

        // Validate width and height are positive numbers
        if (typeof paperSizeObj.width !== "number" || paperSizeObj.width <= 0) {
          return res
            .status(400)
            .json({ error: "paper_size 'width' must be a positive number" });
        }

        if (
          typeof paperSizeObj.height !== "number" ||
          paperSizeObj.height <= 0
        ) {
          return res
            .status(400)
            .json({ error: "paper_size 'height' must be a positive number" });
        }
      } catch (e) {
        return res.status(400).json({
          error:
            "paper_size must be valid JSON with structure: {type, width, height}",
        });
      }
    }

    try {
      // Prepare data for database
      const data = {
        template,
        termalprinttemplate,
        tax_template,
        theme_color,
        text_color,
        print_margins,
        Branch_idBranch: branch_id,
        // Do not trust frontend validation alone — re-validate against the whitelist here.
        thermal_font_size: ALLOWED_THERMAL_FONT_SIZES.includes(thermal_font_size)
          ? thermal_font_size
          : "medium",
        thermal_font_family:
          thermal_font_family != null && ALLOWED_THERMAL_FONT_FAMILIES.includes(thermal_font_family)
            ? thermal_font_family
            : null,
        thermal_paper_width: ALLOWED_THERMAL_PAPER_WIDTHS.includes(thermal_paper_width)
          ? thermal_paper_width
          : "80mm",
      };

      // Add email_settings to data if provided
      if (email_settings !== undefined && email_settings !== null) {
        data.email_settings =
          typeof email_settings === "string"
            ? email_settings
            : JSON.stringify(email_settings);
      }

      // Add paper_size to data if provided
      if (paper_size !== undefined && paper_size !== null) {
        data.paper_size =
          typeof paper_size === "string"
            ? paper_size
            : JSON.stringify(paper_size);
      }

      // If file was uploaded, store the path
      if (req.files && req.files.logo && req.files.logo[0]) {
        data.logo_url = req.files.logo[0].filename; // Store just the filename
      } else if (req.body.remove_logo === "true") {
        data.logo_url = null;
      }

      // Handle signature upload
      if (req.files && req.files.signature && req.files.signature[0]) {
        data.signature_url = req.files.signature[0].filename;
      } else if (req.body.remove_signature === "true") {
        data.signature_url = null;
      }

      // Check if a record exists for this branch
      db.query(
        "SELECT id FROM invoice_main_settings WHERE Branch_idBranch = ?",
        [branch_id],
        (err, results) => {
          if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: err.message });
          }

          if (results.length > 0) {
            // Update existing record
            // Remove Branch_idBranch from data to avoid updating it or causing issues
            const { Branch_idBranch, ...updateData } = data;

            const query =
              "UPDATE invoice_main_settings SET ? WHERE Branch_idBranch = ?";
            db.query(query, [updateData, branch_id], (err, result) => {
              if (err) {
                console.error("Database error:", err);
                console.error("Query:", query);
                console.error("Data:", updateData);
                return res.status(500).json({ error: err.message });
              }
              console.log(
                `Updated main settings for branch ${branch_id}. Affected rows: ${result.affectedRows}`
              );
              res.json({ success: true, message: "Main settings saved" });
            });
          } else {
            // Insert new record
            const query = "INSERT INTO invoice_main_settings SET ?";
            db.query(query, data, (err, result) => {
              if (err) {
                console.error("Database error:", err);
                return res.status(500).json({ error: err.message });
              }
              console.log(
                `Created new main settings for branch ${branch_id}. Insert ID: ${result.insertId}`
              );
              res.json({ success: true, message: "Main settings saved" });
            });
          }
        }
      );
    } catch (err) {
      console.error("Error:", err);
      res.status(500).json({ error: err.message });
    }
  },
];

// Get invoice data for preview (Simulated/Sample data)
exports.getInvoiceData = (req, res) => {
  const branchId = req.params.branchId;

  // You can fetch real data here if needed, or return a structure
  // that matches what the frontend expects for the preview.
  // For now, returning sample data to fix the 404 and allow usage.

  const sampleData = {
    businessName: "Your Business",
    items: [
      {
        Description: "Sample Item 1",
        Qty: 1,
        Rate: 100,
        Amount: 100,
        Discount: 0,
        Discount_Type: "amount",
      },
      {
        Description: "Sample Item 2",
        Qty: 2,
        Rate: 50,
        Amount: 100,
        Discount: 0,
        Discount_Type: "amount",
      },
    ],
    terms: "Payment due within 30 days.",
    notes: "Thanks for your business!",
    paymentDetails: "Bank: Example Bank, Acc: 123456789",
    footerText: "Computer generated invoice.",
    showFields: {
      discounts: true,
      deposit: false,
      estimateSummary: false,
      tax: true,
    },
    totalAmount: 200,
  };

  res.json(sampleData);
};
