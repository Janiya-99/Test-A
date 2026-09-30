const db = require("../db/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const DEFAULT_CUSTOM_FIELDS = [
  // Vehicle / Transport
  { key: "vehicle_brand",    label: "Brand / Make",        type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_model",    label: "Model",               type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_year",     label: "Year",                type: "number", group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_color",    label: "Color",               type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "vehicle_number",   label: "Vehicle / Plate No.", type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "chassis_number",   label: "Chassis Number",      type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "engine_number",    label: "Engine Number",       type: "text",   group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "mileage",          label: "Mileage (km)",        type: "number", group: "Vehicle Info",      enabled: false, custom_label: "" },
  { key: "fuel_type",        label: "Fuel Type",           type: "select", group: "Vehicle Info",      enabled: false, custom_label: "", options: ["Petrol","Diesel","Electric","Hybrid","CNG"] },
  { key: "transmission",     label: "Transmission",        type: "select", group: "Vehicle Info",      enabled: false, custom_label: "", options: ["Manual","Automatic","CVT","Semi-Automatic"] },
  // Device / Electronics
  { key: "serial_number",    label: "Serial Number",       type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "imei_number",      label: "IMEI Number",         type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "device_type",      label: "Device Type",         type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "warranty_number",  label: "Warranty Number",     type: "text",   group: "Device / Product", enabled: false, custom_label: "" },
  { key: "purchase_date",    label: "Purchase Date",       type: "date",   group: "Device / Product", enabled: false, custom_label: "" },
  // Insurance / Claims
  { key: "claim_number",     label: "Claim Number",        type: "text",   group: "Insurance / Claim",enabled: false, custom_label: "" },
  { key: "policy_number",    label: "Policy Number",       type: "text",   group: "Insurance / Claim",enabled: false, custom_label: "" },
  { key: "incident_date",    label: "Incident Date",       type: "date",   group: "Insurance / Claim",enabled: false, custom_label: "" },
  // Customer / Admin
  { key: "customer_nic",     label: "Customer NIC / ID No",type: "text",   group: "Customer / Admin", enabled: false, custom_label: "" },
  { key: "technician_name",  label: "Technician Assigned", type: "text",   group: "Customer / Admin", enabled: false, custom_label: "" },
];

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "q-logo-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

exports.getHeader = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;
  if (!branchId) return res.status(400).json({ error: "Branch ID is required" });

  const query = "SELECT * FROM quotation_header_settings WHERE Branch_idBranch = ? LIMIT 1";
  db.query(query, [branchId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const defaultShowFields = {
      business_name: true,
      logo: true,
      address: true,
      website: true,
      email: true,
      phone: true,
      bill_to: true,
      ship_to: true,
      datee: true,
      invoice_number: true,
      additional_note: true,
      quotation_heading: true,
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
      invoice_headings: 16,
      quotation_heading: 16,
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
      datee: "2025-01-01",
      invoice_number: "Q-0001",
      additional_note: "Quotation - Valid for 30 days",
      quotation_heading: "QUOTATION",
      thermal_footer_message: "හොදම දේ අඩුම මිලට",
      visibility: JSON.stringify(defaultShowFields),
      fontSizes: JSON.stringify(defaultFontSizes),
    };

    const processAndSend = (data) => {
      data.invoice_id = data.invoice_number; // map for frontend compatibility

      try {
        const parsedVisibility = data.visibility ? JSON.parse(data.visibility) : {};
        data.showFields = { ...defaultShowFields, ...parsedVisibility };
      } catch (e) {
        data.showFields = defaultShowFields;
      }

      try {
        const parsedFontSizes = data.fontSizes ? JSON.parse(data.fontSizes) : {};
        data.fontSizes = { ...defaultFontSizes, ...parsedFontSizes };
      } catch (e) {
        data.fontSizes = defaultFontSizes;
      }

      res.json(data);
    };

    if (!results || results.length === 0) {
      const db2 = require("../db/db2");
      db2.query("SELECT * FROM branch WHERE idBranch = ? LIMIT 1", [branchId], (bErr, bRows) => {
        if (!bErr && bRows && bRows.length > 0) {
          const b = bRows[0];
          db2.query("SELECT * FROM company WHERE idCompany = ? LIMIT 1", [b.Company_idCompany], (cErr, cRows) => {
            const comp = (!cErr && cRows && cRows.length > 0) ? cRows[0] : {};
            const dynData = {
              ...defaultData,
              business_name: comp.Name || b.Name || "AsipBook",
              address: b.Address || comp.Address || "",
              email: b.email || comp.Company_Email || "",
              phone: b.Contact_no || "",
              website: comp.Company_Website || "",
            };
            return processAndSend(dynData);
          });
        } else {
          return processAndSend({ ...defaultData });
        }
      });
    } else {
      processAndSend({ ...results[0] });
    }
  });
};

exports.saveHeader = (req, res) => {
  const { showFields, header_type, branch_id, fontSizes, datee, date, invoice_id, ...restData } = req.body;
  let formattedDate = null;
  if (datee) {
    try {
      const d = new Date(datee);
      formattedDate = d.toISOString().slice(0, 19).replace("T", " ");
    } catch (err) {}
  }

  const data = {
    ...restData,
    Branch_idBranch: branch_id,
    header_type: header_type,
    visibility: JSON.stringify(showFields || {}),
    fontSizes: JSON.stringify(fontSizes || {}),
    datee: formattedDate || null,
  };

  if (invoice_id !== undefined) {
    data.invoice_number = invoice_id;
  }

  db.query("UPDATE quotation_header_settings SET ? WHERE Branch_idBranch = ?", [data, branch_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) {
      db.query("INSERT INTO quotation_header_settings SET ?", data, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Header created" });
      });
    } else {
      res.json({ success: true, message: "Header updated" });
    }
  });
};

exports.getFooter = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;
  if (!branchId) return res.status(400).json({ error: "Missing branch_id in query" });

  db.query("SELECT * FROM quotation_footer_settings WHERE Branch_idBranch = ? LIMIT 1", [branchId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

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
        signatures: true,
      }),
    };

    if (results.length === 0) {
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
      data.visibility = data.visibility ? JSON.parse(data.visibility) : JSON.parse(defaultData.visibility);
    } catch (e) {
      data.visibility = JSON.parse(defaultData.visibility);
    }

    res.json({
      footerType: data.footer_type || defaultData.footer_type,
      footerImage: data.footer_image || defaultData.footer_image,
      notes: data.notes || defaultData.notes,
      paymentDetails: data.payment_details || defaultData.payment_details,
      footerText: data.footer_text || defaultData.footer_text,
      showFields: data.visibility,
    });
  });
};

exports.saveFooter = (req, res) => {
  const { footerType, footerImage, notes, paymentDetails, footerText, showFields, branch_id } = req.body;
  if (!branch_id) return res.status(400).json({ error: "branch_id is required" });

  const visibility = {
    discounts: showFields?.discounts !== false,
    deposit: showFields?.deposit !== false,
    estimateSummary: showFields?.estimateSummary !== false,
    tax: showFields?.tax !== false,
    signatures: showFields?.signatures !== false,
  };

  const data = {
    footer_type: footerType || "text",
    footer_image: footerImage || null,
    notes: notes || "",
    payment_details: paymentDetails || "",
    footer_text: footerText || "",
    visibility: JSON.stringify(visibility),
  };

  db.query("SELECT id FROM quotation_footer_settings WHERE Branch_idBranch = ?", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) {
      db.query("UPDATE quotation_footer_settings SET ? WHERE Branch_idBranch = ?", [data, branch_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Footer settings updated" });
      });
    } else {
      db.query("INSERT INTO quotation_footer_settings SET ?", { ...data, Branch_idBranch: branch_id }, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Footer settings created" });
      });
    }
  });
};

exports.getTableSettings = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;
  if (!branchId) return res.status(400).json({ error: "Missing branch_id parameter" });

  db.query("SELECT * FROM quotation_table_settings WHERE Branch_idBranch = ? LIMIT 1", [branchId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.json({ showInvoice: true, selectedColumns: [] });

    const data = results[0];
    try {
      data.selectedColumns = JSON.parse(data.selected_columns || "[]");
    } catch (e) {
      data.selectedColumns = [];
    }
    res.json({ showInvoice: data.show_invoice, selectedColumns: data.selectedColumns });
  });
};

exports.saveTableSettings = (req, res) => {
  const { showInvoice, selectedColumns, branch_id } = req.body;
  if (!branch_id) return res.status(400).json({ error: "branch_id is required" });

  const data = {
    show_invoice: showInvoice ? 1 : 0,
    selected_columns: JSON.stringify(selectedColumns || []),
    Branch_idBranch: branch_id,
  };

  db.query("SELECT id FROM quotation_table_settings WHERE Branch_idBranch = ?", [branch_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) {
      db.query("UPDATE quotation_table_settings SET ? WHERE Branch_idBranch = ?", [data, branch_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Table settings updated" });
      });
    } else {
      db.query("INSERT INTO quotation_table_settings SET ?", data, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Table settings created" });
      });
    }
  });
};

exports.getMainSettings = (req, res) => {
  const branchId = req.query.branch_id || req.query.branchId;
  if (!branchId) return res.status(400).json({ error: "Branch ID is required" });

  db.query("SELECT * FROM quotation_main_settings WHERE Branch_idBranch = ?", [branchId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const defaultData = {
      template: "Classic",
      logo_url: null,
      theme_color: "#000000",
      text_color: "#A7C7E7",
      print_margins: { top: 10, bottom: 10, left: 10, right: 10 },
      paper_size: null,
      custom_fields_config: JSON.stringify(DEFAULT_CUSTOM_FIELDS),
      termalprinttemplate: "Classic",
    };

    if (results.length === 0) return res.json(defaultData);

    const data = results[0];
    try {
      data.print_margins = data.print_margins ? JSON.parse(data.print_margins) : defaultData.print_margins;
    } catch (e) {
      data.print_margins = defaultData.print_margins;
    }
    try {
      data.paper_size = data.paper_size ? JSON.parse(data.paper_size) : null;
    } catch (e) {
      data.paper_size = null;
    }
    try {
      data.email_settings = data.email_settings ? JSON.parse(data.email_settings) : null;
    } catch (e) {
      data.email_settings = null;
    }

    // Merge saved config with default catalog
    let savedFields = [];
    try { savedFields = JSON.parse(data.custom_fields_config || '[]'); } catch(_) {}
    const mergedFields = DEFAULT_CUSTOM_FIELDS.map(def => {
      const saved = savedFields.find(f => f.key === def.key);
      return saved ? { ...def, ...saved } : def;
    });
    savedFields.forEach(sf => {
      if (!mergedFields.find(f => f.key === sf.key)) mergedFields.push(sf);
    });
    data.custom_fields_config = JSON.stringify(mergedFields);

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

    res.json(data);
  });
};

exports.saveMainSettings = [
  upload.single("logo"),
  async (req, res) => {
    const { template = "Classic", termalprinttemplate = "Classic", theme_color = "#000000", text_color = "#A7C7E7", print_margins, paper_size, custom_fields_config, branch_id, email_settings } = req.body;
    if (!branch_id) return res.status(400).json({ error: "branch_id is required" });

    try {
      const cfJson = custom_fields_config
        ? (typeof custom_fields_config === 'string' ? custom_fields_config : JSON.stringify(custom_fields_config))
        : JSON.stringify(DEFAULT_CUSTOM_FIELDS);

      const data = { template, termalprinttemplate, theme_color, text_color, print_margins, custom_fields_config: cfJson, Branch_idBranch: branch_id };
      if (paper_size !== undefined && paper_size !== null) data.paper_size = typeof paper_size === "string" ? paper_size : JSON.stringify(paper_size);
      if (email_settings !== undefined && email_settings !== null) data.email_settings = typeof email_settings === "string" ? email_settings : JSON.stringify(email_settings);
      if (req.file) data.logo_url = req.file.filename;

      db.query("SELECT id FROM quotation_main_settings WHERE Branch_idBranch = ?", [branch_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
          const { Branch_idBranch, ...updateData } = data;
          db.query("UPDATE quotation_main_settings SET ? WHERE Branch_idBranch = ?", [updateData, branch_id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Main settings saved" });
          });
        } else {
          db.query("INSERT INTO quotation_main_settings SET ?", data, (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Main settings saved" });
          });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
];
