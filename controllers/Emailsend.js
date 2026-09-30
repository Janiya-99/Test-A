const express = require("express");
const router = express.Router();
const transporter = require("../utils/emailTransporter");
const db = require("../db/db");
const path = require("path");
const fs = require("fs");

// Send quotation email
router.post("/send-quotation-email", async (req, res) => {
  const {
    quotationId,
    customerEmail,
    customerName,
    quotationDate,
    expiryDate,
    items,
    subtotal,
    discount,
    discountType,
    total,
    note,
    address,
  } = req.body;

  if (!quotationId || !customerEmail) {
    return res.status(400).json({ message: "Missing data" });
  }

  // Format currency with space separator
  const formatCurrency = (amount) => {
    return parseFloat(amount)
      .toFixed(2)
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };

  try {
    // 1. Fetch Branch ID using Quotation ID
    const [quotationRows] = await db
      .promise()
      .query(
        "SELECT Branch_idBranch FROM quotation WHERE Quotation_Number = ? OR idQuotation = ?",
        [quotationId, quotationId],
      );

    // Fallback if not found (though it should be)
    const branchId =
      quotationRows.length > 0 ? quotationRows[0].Branch_idBranch : null;

    let businessDetails = {
      name: "Asipbook",
      address: "",
      phone: "",
      email: "",
      website: "",
      logoUrl: "",
    };

    let emailSettings = {
      emailSubject: `Quotation #[Quotation No.]`,
      message: "Please find your quotation details here. Feel free to contact us if you have any questions.",
      useGreeting: false,
      greetingType: "Hello",
      customerName: "[FULL NAME]",
      showFullDetails: true,
      showSummary: false,
      showPdf: false,
    };

    if (branchId) {
      // 2. Fetch Header Settings
      const [headerRows] = await db
        .promise()
        .query(
          "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      // 3. Fetch Main Settings (for logo filename)
      const [mainRows] = await db
        .promise()
        .query(
          "SELECT logo_url FROM invoice_main_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      // Fetch Quotation Email settings
      const [quotMainRows] = await db
        .promise()
        .query(
          "SELECT email_settings FROM quotation_main_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      if (headerRows.length > 0) {
        const header = headerRows[0];
        businessDetails = {
          name: header.business_name || "Asipbook",
          address: header.address || "",
          phone: header.phone || "",
          email: header.email || "",
          website: header.website || "",
          logoUrl:
            mainRows.length > 0 && mainRows[0].logo_url
              ? mainRows[0].logo_url
              : "",
        };
      }

      if (quotMainRows.length > 0 && quotMainRows[0].email_settings) {
        try {
          const parsed = typeof quotMainRows[0].email_settings === "string"
            ? JSON.parse(quotMainRows[0].email_settings)
            : quotMainRows[0].email_settings;
          if (parsed) {
            emailSettings = { ...emailSettings, ...parsed };
          }
        } catch (e) {
          console.error("Error parsing quotation email_settings:", e);
        }
      }
    }

    // Fetch Customer details to get First/Last names for tags if needed
    let firstName = "";
    let lastName = "";
    let fullName = customerName || "Valued Customer";
    const [qDetails] = await db
      .promise()
      .query(
        "SELECT c.First_Name, c.lastName, c.displayName FROM quotation q JOIN customer c ON q.Customer_idCustomer = c.idCustomer WHERE q.Quotation_Number = ? OR q.idQuotation = ?",
        [quotationId, quotationId]
      );
    if (qDetails.length > 0) {
      firstName = qDetails[0].First_Name || "";
      lastName = qDetails[0].lastName || "";
      fullName = qDetails[0].displayName || (firstName + " " + lastName).trim() || fullName;
    }

    // Perform Tag replacements
    const vars = {
      "Quotation No.": quotationId,
      "Quotation Number": quotationId,
      "FULL NAME": fullName,
      "FIRST NAME": firstName || fullName,
      "LAST NAME": lastName || "",
      "Company Name": businessDetails.name,
    };

    const replaceTags = (str) => {
      if (!str) return "";
      let resStr = str;
      for (const [k, v] of Object.entries(vars)) {
        resStr = resStr.split(`[${k}]`).join(v);
      }
      return resStr;
    };

    const finalSubject = replaceTags(emailSettings.emailSubject);
    let finalGreeting = "";
    if (emailSettings.useGreeting) {
      const namePlaceholder = emailSettings.customerName || "[FULL NAME]";
      let nameVal = fullName;
      if (namePlaceholder === "[FIRST NAME]") nameVal = firstName || fullName;
      if (namePlaceholder === "[LAST NAME]") nameVal = lastName || fullName;
      finalGreeting = `${emailSettings.greetingType || "Hello"} ${nameVal},`;
    } else {
      finalGreeting = `Dear ${fullName},`;
    }

    const finalMessageBody = replaceTags(emailSettings.message);

    // Handle Logo Attachment
    let attachments = [];
    let logoSrc = "";

    if (businessDetails.logoUrl) {
      const logoPath = path.join(
        __dirname,
        "../uploads",
        businessDetails.logoUrl,
      );
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: businessDetails.logoUrl,
          path: logoPath,
          cid: "companyLogo", // same cid value as in the html img src
        });
        logoSrc = "cid:companyLogo";
      }
    }

    // Format items for HTML table
    let mainContentHtml = "";
    if (req.body.isMultiOption === 1 && req.body.options && Array.isArray(req.body.options)) {
      mainContentHtml = req.body.options
        .map((opt, optIndex) => {
          const optionItems = (opt.items || []).filter(
            (item) => item.Item_idItem || (item.is_manual_item && item.Item_Name)
          );
          const optionItemsRows = optionItems
            .map(
              (item) => `
            <tr class="table-row">
              <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef;">${item.Item_Name || "N/A"}</td>
              <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Rate)}</td>
              <td style="text-align: center; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Qty}</td>
              <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Discount} ${item.Discount_Type === "percentage" ? "%" : ""}</td>
              <td style="text-align: right; border-right: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Total_Amount)}</td>
            </tr>
          `
            )
            .join("");

          const optSubtotal = parseFloat(opt.SubTotal) || 0;
          const optDiscount = parseFloat(opt.Discount) || 0;
          const optTotal = parseFloat(opt.Total) || 0;

          return `
            <div style="margin-top: 30px; margin-bottom: 40px; border: 1px solid #e9ecef; border-radius: 6px; overflow: hidden; background-color: #ffffff;">
              <div style="background-color: #1a73e8; color: #ffffff; padding: 12px 15px; font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
                ${opt.label || `Option ${optIndex + 1}`}
              </div>
              <table class="table-container" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 0;">
                <tr class="table-header" style="background-color: #f8f9fa;">
                  <th width="40%" style="color: #32325d; background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">Item Description</th>
                  <th width="15%" style="text-align: right; color: #32325d; background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">Rate</th>
                  <th width="10%" style="text-align: center; color: #32325d; background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">Qty</th>
                  <th width="15%" style="text-align: right; color: #32325d; background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">Discount</th>
                  <th width="20%" style="text-align: right; color: #32325d; background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; border-right: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">Amount</th>
                </tr>
                ${optionItemsRows}
              </table>
              <div style="padding: 15px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size: 13px; color: #8898aa; text-align: right; padding: 4px 10px;">Subtotal:</td>
                    <td style="font-size: 13px; color: #32325d; font-weight: bold; text-align: right; width: 120px; padding: 4px 10px;">LKR ${formatCurrency(optSubtotal)}</td>
                  </tr>
                  ${optDiscount > 0 ? `
                  <tr>
                    <td style="font-size: 13px; color: #8898aa; text-align: right; padding: 4px 10px;">Discount:</td>
                    <td style="font-size: 13px; color: #d9534f; font-weight: bold; text-align: right; width: 120px; padding: 4px 10px;">LKR ${formatCurrency(optDiscount)}</td>
                  </tr>` : ""}
                  <tr>
                    <td style="font-size: 15px; color: #1a73e8; font-weight: bold; text-align: right; padding: 8px 10px; border-top: 1px solid #e9ecef;">Option Total:</td>
                    <td style="font-size: 15px; color: #1a73e8; font-weight: bold; text-align: right; width: 120px; padding: 8px 10px; border-top: 1px solid #e9ecef;">LKR ${formatCurrency(optTotal)}</td>
                  </tr>
                </table>
              </div>
            </div>
          `;
        })
        .join("");
    } else {
      const itemsHtml = items
        .filter((item) => item.Item_idItem) // Filter out empty items
        .map(
          (item) => `
            <tr class="table-row">
              <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef;">${item.Item_Name || "N/A"}</td>
              <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Rate)}</td>
              <td style="text-align: center; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Qty}</td>
              <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Discount} ${item.Discount_Type === "percentage" ? "%" : ""}</td>
              <td style="text-align: right; border-right: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Total_Amount)}</td>
            </tr>
          `
        )
        .join("");

      mainContentHtml = `
        <table class="table-container" width="100%" cellpadding="0" cellspacing="0">
          <tr class="table-header">
            <th width="40%">Item Description</th>
            <th width="15%" style="text-align: right;">Rate</th>
            <th width="10%" style="text-align: center;">Qty</th>
            <th width="15%" style="text-align: right;">Discount</th>
            <th width="20%">Amount</th>
          </tr>
          ${itemsHtml}
        </table>

        <table class="totals-table" align="right">
          <tr>
            <td class="total-label">Subtotal</td>
            <td class="total-value">LKR ${formatCurrency(subtotal)}</td>
          </tr>
          <tr>
            <td class="total-label">Discount</td>
            <td class="total-value" style="color: #2dce89;">
              ${discount} ${discountType === "percentage" ? "%" : "LKR"}
            </td>
          </tr>
          <tr class="final-row">
            <td class="total-label">Total</td>
            <td class="total-value">LKR ${formatCurrency(total)}</td>
          </tr>
        </table>
        <div style="clear: both;"></div>
      `;
    }

    const mailOptions = {
      from: `<${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: finalSubject,
      attachments: attachments,
      html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${finalSubject}</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f6f9fc; color: #333333; }
              .container { max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-top: 40px; margin-bottom: 40px; }
              
              .header-section { padding: 40px; background-color: #ffffff; border-bottom: 1px solid #e9ecef; }
              .company-name { font-size: 24px; font-weight: bold; color: #32325d; margin-bottom: 5px; }
              .company-details { font-size: 14px; color: #525f7f; line-height: 1.5; }
              .quotation-title { color: #1a73e8; margin: 0; font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
              .quotation-number { font-size: 16px; color: #525f7f; margin-top: 5px; font-weight: 500; }

              .content { padding: 40px; }
              
              .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; background-color: #f8f9fa; border-radius: 6px; }
              .meta-table td { vertical-align: top; padding: 20px; text-align: center; border-right: 1px solid #e9ecef; }
              .meta-table td:last-child { border-right: none; }
              .meta-label { font-size: 11px; text-transform: uppercase; color: #8898aa; letter-spacing: 1.5px; margin-bottom: 8px; font-weight: 700; display: block; }
              .meta-value { font-size: 16px; font-weight: 600; color: #32325d; display: block; }
              
              .table-container { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; }
              .table-header th { background-color: #1a73e8; color: #ffffff; font-weight: 600; text-align: left; padding: 12px 15px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
              .table-header th:first-child { border-top-left-radius: 4px; }
              .table-header th:last-child { border-top-right-radius: 4px; text-align: right; }
              
              .table-row td { padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-size: 14px; color: #525f7f; border-left: 1px solid #e9ecef; vertical-align: middle; }
              .table-row td:last-child { border-right: 1px solid #e9ecef; text-align: right; font-weight: 600; color: #32325d; }
              
              .totals-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              .totals-table td { padding: 8px 0; text-align: right; font-size: 14px; color: #525f7f; }
              .totals-table .total-label { padding-right: 20px; font-weight: 500; }
              .totals-table .total-value { font-weight: 600; color: #32325d; width: 150px; }
              .totals-table .final-row td { padding-top: 15px; padding-bottom: 15px; border-top: 2px solid #e9ecef; font-size: 18px; color: #1a73e8; font-weight: 700; }
              
              .note { background-color: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; font-size: 14px; color: #525f7f; margin-top: 30px; line-height: 1.5; }
              .footer { background-color: #f6f9fc; padding: 20px; text-align: center; color: #8898aa; font-size: 12px; border-top: 1px solid #e9ecef; line-height: 1.5; }
              .btn { display: inline-block; background-color: #1a73e8; color: #ffffff; padding: 12px 25px; border-radius: 4px; text-decoration: none; font-weight: 600; margin-top: 20px; font-size: 14px; box-shadow: 0 4px 6px rgba(50, 50, 93, 0.11), 0 1px 3px rgba(0, 0, 0, 0.08); transition: all 0.15s ease; }
              
              @media only screen and (max-width: 600px) {
                .container { width: 100%; margin: 0; border-radius: 0; }
                .content, .header-section { padding: 20px; }
                .meta-table td { display: block; width: 100%; text-align: left !important; padding: 15px; border-right: none; border-bottom: 1px solid #e9ecef; }
                .meta-table td:last-child { border-bottom: none; }
                .table-container th:nth-child(2), .table-container td:nth-child(2),
                .table-container th:nth-child(3), .table-container td:nth-child(3) { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header-section">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="top">
                       ${logoSrc ? `<img src="${logoSrc}" style="max-height: 70px; margin-bottom: 15px;" alt="Logo"/>` : ""}
                       <div class="company-name">${businessDetails.name}</div>
                       <div class="company-details">
                          ${businessDetails.address}<br>
                          ${businessDetails.phone ? `Tel: ${businessDetails.phone}<br>` : ""}
                          ${businessDetails.email ? `Email: ${businessDetails.email}<br>` : ""}
                          ${businessDetails.website ? `Web: ${businessDetails.website}` : ""}
                       </div>
                    </td>
                    <td valign="top" style="text-align: right;">
                       <h1 class="quotation-title">QUOTATION</h1>
                       <div class="quotation-number">#${quotationId}</div>
                    </td>
                  </tr>
                </table>
              </div>
              
              <div class="content">
                ${finalGreeting ? `<p style="font-size: 16px; margin-bottom: 10px; color: #32325d;">${finalGreeting}</p>` : ""}
                <p style="font-size: 14px; color: #525f7f; line-height: 1.5; margin-bottom: 30px; white-space: pre-wrap;">${finalMessageBody}</p>
                
                <table class="meta-table">
                  <tr>
                    <td>
                      <span class="meta-label">Date</span>
                      <span class="meta-value">${new Date(quotationDate).toLocaleDateString()}</span>
                    </td>
                    <td>
                       <span class="meta-label">Amount</span>
                       <span class="meta-value">LKR ${formatCurrency(total)}</span>
                    </td>
                    <td>
                      <span class="meta-label">Expires</span>
                      <span class="meta-value" style="color: ${new Date(expiryDate) < new Date() ? "#e53e3e" : "#32325d"};">
                        ${expiryDate ? new Date(expiryDate).toLocaleDateString() : "N/A"}
                      </span>
                    </td>
                  </tr>
                </table>

                ${
                  address
                    ? `
                <div style="margin-bottom: 30px; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
                    <span class="meta-label" style="display:block; margin-bottom: 5px;">Delivery Address</span>
                    <p style="margin: 0; font-size: 14px; color: #525f7f;">${address}</p>
                </div>`
                    : ""
                }

                ${mainContentHtml}

                ${note ? `<div class="note"><strong>Note:</strong><br>${note}</div>` : ""}

                <div style="text-align: center; margin-top: 30px;">
                 <a href="#" class="btn" style="color: #ffffff;">View Quotation Online</a>
                </div>
              </div>

              <div class="footer">
                <p>Thank you for choosing ${businessDetails.name}!</p>
                <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} ${businessDetails.name}. All rights reserved.</p>
                <p>If you have any questions, please contact us at <a href="mailto:security@asipbook.com" style="color: #1a73e8; text-decoration: none;">security@asipbook.com</a></p>
              </div>
            </div>
          </body>
          </html>
        `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Email sent successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send email" });
  }
});

// Send Purchase Order email
router.post("/send-purchase-order-email", async (req, res) => {
  const {
    poId,
    supplierEmail,
    supplierName,
    poDate,
    items,
    subtotal,
    discount,
    netTotal,
    branchId,
    address,
  } = req.body;

  if (!poId || !supplierEmail) {
    return res.status(400).json({ message: "Missing data" });
  }

  // Format currency with space separator
  const formatCurrency = (amount) => {
    return parseFloat(amount || 0)
      .toFixed(2)
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };

  try {
    let businessDetails = {
      name: "Asipbook",
      address: "",
      phone: "",
      email: "",
      website: "",
      logoUrl: "",
    };

    if (branchId) {
      // 1. Fetch Header Settings
      const [headerRows] = await db
        .promise()
        .query(
          "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      // 2. Fetch Main Settings (for logo filename)
      const [mainRows] = await db
        .promise()
        .query(
          "SELECT logo_url FROM invoice_main_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      if (headerRows.length > 0) {
        const header = headerRows[0];
        businessDetails = {
          name: header.business_name || "Asipbook",
          address: header.address || "",
          phone: header.phone || "",
          email: header.email || "",
          website: header.website || "",
          logoUrl:
            mainRows.length > 0 && mainRows[0].logo_url
              ? mainRows[0].logo_url
              : "",
        };
      }
    }

    // Handle Logo Attachment
    let attachments = [];
    let logoSrc = "";

    if (businessDetails.logoUrl) {
      const logoPath = path.join(
        __dirname,
        "../uploads",
        businessDetails.logoUrl,
      );
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: businessDetails.logoUrl,
          path: logoPath,
          cid: "companyLogo",
        });
        logoSrc = "cid:companyLogo";
      }
    }

    // Uses shared transporter from utils/emailTransporter.js


    // Format items for HTML table
    const itemsHtml = items
      .map(
        (item, idx) => `
          <tr class="table-row">
            <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef;">${idx + 1}</td>
            <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef;">
              <strong>${item.Item_Name || item.Item_Description || "N/A"}</strong><br>
              <small style="color: #8898aa;">${item.Item_Code || ""}</small>
            </td>
            <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Qty}</td>
            <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Cost)}</td>
            <td style="text-align: right; border-right: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Total || item.Sub_Total)}</td>
          </tr>
        `,
      )
      .join("");

    const mailOptions = {
      from: `<${process.env.EMAIL_USER}>`,
      to: supplierEmail,
      subject: `Purchase Order #${poId}`,
      attachments: attachments,
      html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Purchase Order #${poId}</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f6f9fc; color: #333333; }
              .container { max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-top: 40px; margin-bottom: 40px; }
              
              .header-section { padding: 40px; background-color: #ffffff; border-bottom: 1px solid #e9ecef; }
              .company-name { font-size: 24px; font-weight: bold; color: #32325d; margin-bottom: 5px; }
              .company-details { font-size: 14px; color: #525f7f; line-height: 1.5; }
              .quotation-title { color: #5e72e4; margin: 0; font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
              .quotation-number { font-size: 16px; color: #525f7f; margin-top: 5px; font-weight: 500; }

              .content { padding: 40px; }
              
              .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; background-color: #f8f9fa; border-radius: 6px; }
              .meta-table td { vertical-align: top; padding: 20px; text-align: center; border-right: 1px solid #e9ecef; }
              .meta-table td:last-child { border-right: none; }
              .meta-label { font-size: 11px; text-transform: uppercase; color: #8898aa; letter-spacing: 1.5px; margin-bottom: 8px; font-weight: 700; display: block; }
              .meta-value { font-size: 16px; font-weight: 600; color: #32325d; display: block; }
              
              .table-container { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; }
              .table-header th { background-color: #5e72e4; color: #ffffff; font-weight: 600; text-align: left; padding: 12px 15px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
              .table-header th:first-child { border-top-left-radius: 4px; }
              .table-header th:last-child { border-top-right-radius: 4px; text-align: right; }
              
              .table-row td { padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-size: 14px; color: #525f7f; border-left: 1px solid #e9ecef; vertical-align: middle; }
              .table-row td:last-child { border-right: 1px solid #e9ecef; text-align: right; font-weight: 600; color: #32325d; }
              
              .totals-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              .totals-table td { padding: 8px 0; text-align: right; font-size: 14px; color: #525f7f; }
              .totals-table .total-label { padding-right: 20px; font-weight: 500; }
              .totals-table .total-value { font-weight: 600; color: #32325d; width: 150px; }
              .totals-table .final-row td { padding-top: 15px; padding-bottom: 15px; border-top: 2px solid #e9ecef; font-size: 18px; color: #5e72e4; font-weight: 700; }
              
              .footer { background-color: #f6f9fc; padding: 20px; text-align: center; color: #8898aa; font-size: 12px; border-top: 1px solid #e9ecef; line-height: 1.5; }
              
              @media only screen and (max-width: 600px) {
                .container { width: 100%; margin: 0; border-radius: 0; }
                .content, .header-section { padding: 20px; }
                .meta-table td { display: block; width: 100%; text-align: left !important; padding: 15px; border-right: none; border-bottom: 1px solid #e9ecef; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header-section">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="top">
                       ${logoSrc ? `<img src="${logoSrc}" style="max-height: 70px; margin-bottom: 15px;" alt="Logo"/>` : ""}
                       <div class="company-name">${businessDetails.name}</div>
                       <div class="company-details">
                          ${businessDetails.address}<br>
                          ${businessDetails.phone ? `Tel: ${businessDetails.phone}<br>` : ""}
                          ${businessDetails.email ? `Email: ${businessDetails.email}<br>` : ""}
                          ${businessDetails.website ? `Web: ${businessDetails.website}` : ""}
                       </div>
                    </td>
                    <td valign="top" style="text-align: right;">
                       <h1 class="quotation-title">PURCHASE ORDER</h1>
                       <div class="quotation-number">#${poId}</div>
                    </td>
                  </tr>
                </table>
              </div>
              
              <div class="content">
                <p style="font-size: 16px; margin-bottom: 30px; color: #32325d;">Dear <strong>${supplierName}</strong>,</p>
                
                <table class="meta-table">
                  <tr>
                    <td>
                      <span class="meta-label">Date</span>
                      <span class="meta-value">${new Date(poDate).toLocaleDateString()}</span>
                    </td>
                    <td>
                       <span class="meta-label">Amount</span>
                       <span class="meta-value">LKR ${formatCurrency(netTotal)}</span>
                    </td>
                    <td>
                      <span class="meta-label">PO Number</span>
                      <span class="meta-value">#${poId}</span>
                    </td>
                  </tr>
                </table>

                ${
                  address
                    ? `
                <div style="margin-bottom: 30px; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
                    <span class="meta-label" style="display:block; margin-bottom: 5px;">Supplier Address</span>
                    <p style="margin: 0; font-size: 14px; color: #525f7f;">${address}</p>
                </div>`
                    : ""
                }

                <table class="table-container" width="100%" cellpadding="0" cellspacing="0">
                  <tr class="table-header">
                    <th width="5%">#</th>
                    <th width="50%">Item Description</th>
                    <th width="10%" style="text-align: right;">Qty</th>
                    <th width="15%" style="text-align: right;">Cost</th>
                    <th width="20%">Amount</th>
                  </tr>
                  ${itemsHtml}
                </table>

                <table class="totals-table" align="right">
                  <tr>
                    <td class="total-label">Subtotal</td>
                    <td class="total-value">LKR ${formatCurrency(subtotal)}</td>
                  </tr>
                  <tr>
                    <td class="total-label">Discount</td>
                    <td class="total-value" style="color: #f5365c;">
                      - LKR ${formatCurrency(discount)}
                    </td>
                  </tr>
                  <tr class="final-row">
                    <td class="total-label">Net Total</td>
                    <td class="total-value">LKR ${formatCurrency(netTotal)}</td>
                  </tr>
                </table>

                <div style="clear: both;"></div>

                <div style="margin-top: 50px; padding: 20px; border-top: 1px dashed #e9ecef; text-align: center;">
                  <p style="font-size: 14px; color: #8898aa;">Please find the attached details of our Purchase Order. We look forward to receiving the items soon.</p>
                </div>
              </div>

              <div class="footer">
                <p>Thank you for your business!</p>
                <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} ${businessDetails.name}. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Email sent successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to send email" });
  }
});

// Send low stock items email to supplier
router.post("/send-low-stock-email", async (req, res) => {
  const {
    supplierEmail,
    supplierName,
    items,
    branchId,
  } = req.body;

  if (!supplierEmail || !items || !Array.isArray(items)) {
    return res.status(400).json({ message: "Missing required data: supplierEmail and items are required" });
  }

  let businessDetails = {
    business_name: "Our Business",
    address: "",
    phone: "",
    email: "",
    website: "",
  };

  try {
    if (branchId) {
      const [headerRows] = await db
        .promise()
        .query(
          "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ?",
          [branchId],
        );
      if (headerRows.length > 0) {
        const header = headerRows[0];
        businessDetails = {
          business_name: header.business_name || "Our Business",
          address: header.address || "",
          phone: header.phone || "",
          email: header.email || "",
          website: header.website || "",
        };
      }
    }
  } catch (dbErr) {
    console.error("Error fetching branch details for email:", dbErr);
  }

  const busName = businessDetails.business_name;
  const busAddress = businessDetails.address;
  const busPhone = businessDetails.phone;
  const busEmail = businessDetails.email;
  const busWebsite = businessDetails.website;

  try {
    // Format items for HTML table
    const itemsHtml = items
      .map(
        (item) => `
          <tr class="table-row">
            <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; padding: 12px 15px;">${item.Item_Code || "N/A"}</td>
            <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; padding: 12px 15px;">${item.Description || "N/A"}</td>
            <td style="text-align: center; border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; padding: 12px 15px;">${item.Qty}</td>
            <td style="text-align: center; border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; padding: 12px 15px;">${item.low_stock_level}</td>
            <td style="text-align: right; border-left: 1px solid #e9ecef; border-right: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; padding: 12px 15px;">LKR ${parseFloat(item.Cost || 0).toFixed(2)}</td>
          </tr>
        `
      )
      .join("");

    const mailOptions = {
      from: `<${process.env.EMAIL_USER}>`,
      to: supplierEmail,
      subject: `Restocking Request - Low Stock Alert from ${busName}`,
      html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Low Stock Alert</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f6f9fc; color: #333333; }
              .container { max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-top: 40px; margin-bottom: 40px; }
              .header-section { padding: 40px; background-color: #ffffff; border-bottom: 1px solid #e9ecef; }
              .company-name { font-size: 24px; font-weight: bold; color: #32325d; margin-bottom: 5px; }
              .company-details { font-size: 14px; color: #525f7f; line-height: 1.5; }
              .alert-title { color: #e53e3e; margin: 0; font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
              .content { padding: 40px; }
              .table-container { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; }
              .table-header th { background-color: #e53e3e; color: #ffffff; font-weight: 600; text-align: left; padding: 12px 15px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
              .table-header th:first-child { border-top-left-radius: 4px; }
              .table-header th:last-child { border-top-right-radius: 4px; text-align: right; }
              .table-row td { padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-size: 14px; color: #525f7f; border-left: 1px solid #e9ecef; vertical-align: middle; }
              .table-row td:last-child { border-right: 1px solid #e9ecef; text-align: right; }
              .footer { background-color: #f6f9fc; padding: 20px; text-align: center; color: #8898aa; font-size: 12px; border-top: 1px solid #e9ecef; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header-section">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="top">
                       <div class="company-name">${busName}</div>
                       <div class="company-details">
                          ${busAddress ? `${busAddress}<br>` : ""}
                          ${busPhone ? `Tel: ${busPhone}<br>` : ""}
                          ${busEmail ? `Email: ${busEmail}<br>` : ""}
                          ${busWebsite ? `Web: ${busWebsite}` : ""}
                       </div>
                    </td>
                    <td valign="top" style="text-align: right;">
                       <h1 class="alert-title">RESTOCK REQUEST</h1>
                    </td>
                  </tr>
                </table>
              </div>
              
              <div class="content">
                <p style="font-size: 16px; margin-bottom: 20px; color: #32325d;">Hello ${supplierName || "Supplier"},</p>
                <p style="font-size: 14px; color: #525f7f; line-height: 1.5; margin-bottom: 30px;">
                  We would like to request restocking for the following items which have reached their low stock level threshold at <strong>${busName}</strong>. Please find the details below:
                </p>
                
                <table class="table-container" width="100%" cellpadding="0" cellspacing="0">
                  <tr class="table-header">
                    <th width="20%">Item Code</th>
                    <th width="35%">Description</th>
                    <th width="15%" style="text-align: center;">Current Qty</th>
                    <th width="15%" style="text-align: center;">Alert Qty</th>
                    <th width="15%" style="text-align: right;">Cost</th>
                  </tr>
                  ${itemsHtml}
                </table>
              </div>

              <div class="footer">
                <p>Please send us quotation/delivery options for restocking the items listed above. Thank you!</p>
                <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} ${busName}. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Low stock notification email sent successfully" });
  } catch (error) {
    console.error("Error sending low stock notification email:", error);
    res.status(500).json({ message: "Failed to send email", error: error.message });
  }
});

router.post("/send-invoice-email", async (req, res) => {
  const {
    invoiceId,
    idInvoice,
    customerEmail,
    customerName,
    invoiceDate,
    dueDate,
    items,
    subtotal,
    discount,
    discountType,
    discount2,
    discount2Type,
    interestAmount,
    netAmount,
    paidAmount,
    balanceAmount,
    vatAmount,
    extraCharge,
    extraChargeLabel,
    note,
    address: shippingAddress,
    branchId,
  } = req.body;

  if (!invoiceId || !customerEmail) {
    return res.status(400).json({ message: "Missing data" });
  }

  // Format currency with space separator
  const formatCurrency = (amount) => {
    return parseFloat(amount || 0)
      .toFixed(2)
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString();
  };

  try {
    // 1. Fetch branch settings
    let businessDetails = {
      name: "Asipbook",
      address: "",
      phone: "",
      email: "",
      website: "",
      logoUrl: "",
    };

    let emailSettings = {
      emailSubject: `Invoice #[Invoice No.]`,
      message: "We appreciate your business. Please find your invoice details here. Feel free to contact us if you have any questions.",
      useGreeting: false,
      greetingType: "Hello",
      customerName: "[FULL NAME]",
      showFullDetails: true,
      showSummary: false,
      showPdf: false,
    };

    if (branchId) {
      // Fetch Header Settings
      const [headerRows] = await db
        .promise()
        .query(
          "SELECT * FROM invoice_header_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      // Fetch Main Settings (for logo filename and email template)
      const [mainRows] = await db
        .promise()
        .query(
          "SELECT logo_url, email_settings FROM invoice_main_settings WHERE Branch_idBranch = ?",
          [branchId],
        );

      if (headerRows.length > 0) {
        const header = headerRows[0];
        businessDetails = {
          name: header.business_name || "Asipbook",
          address: header.address || "",
          phone: header.phone || "",
          email: header.email || "",
          website: header.website || "",
          logoUrl:
            mainRows.length > 0 && mainRows[0].logo_url
              ? mainRows[0].logo_url
              : "",
        };
      }

      if (mainRows.length > 0 && mainRows[0].email_settings) {
        try {
          const parsed = typeof mainRows[0].email_settings === "string"
            ? JSON.parse(mainRows[0].email_settings)
            : mainRows[0].email_settings;
          if (parsed) {
            emailSettings = { ...emailSettings, ...parsed };
          }
        } catch (e) {
          console.error("Error parsing email_settings:", e);
        }
      }
    }

    // 2. Fetch Customer details to get First/Last names for tags if needed
    let firstName = "";
    let lastName = "";
    let fullName = customerName || "Valued Customer";
    if (idInvoice) {
      const [invRows] = await db
        .promise()
        .query(
          "SELECT c.First_Name, c.lastName, c.displayName FROM invoice i JOIN customer c ON i.Customer_idCustomer = c.idCustomer WHERE i.idInvoice = ?",
          [idInvoice]
        );
      if (invRows.length > 0) {
        firstName = invRows[0].First_Name || "";
        lastName = invRows[0].lastName || "";
        fullName = invRows[0].displayName || (firstName + " " + lastName).trim() || fullName;
      }
    }

    // 3. Perform Tag replacements
    const vars = {
      "Invoice No.": invoiceId,
      "Invoice Number": invoiceId,
      "FULL NAME": fullName,
      "FIRST NAME": firstName || fullName,
      "LAST NAME": lastName || "",
      "Company Name": businessDetails.name,
    };

    const replaceTags = (str) => {
      if (!str) return "";
      let resStr = str;
      for (const [k, v] of Object.entries(vars)) {
        resStr = resStr.split(`[${k}]`).join(v);
      }
      return resStr;
    };

    const finalSubject = replaceTags(emailSettings.emailSubject);
    let finalGreeting = "";
    if (emailSettings.useGreeting) {
      const namePlaceholder = emailSettings.customerName || "[FULL NAME]";
      let nameVal = fullName;
      if (namePlaceholder === "[FIRST NAME]") nameVal = firstName || fullName;
      if (namePlaceholder === "[LAST NAME]") nameVal = lastName || fullName;
      finalGreeting = `${emailSettings.greetingType || "Hello"} ${nameVal},`;
    }

    const finalMessageBody = replaceTags(emailSettings.message);

    // 4. Handle Logo Attachment
    let attachments = [];
    let logoSrc = "";

    if (businessDetails.logoUrl) {
      const logoPath = path.join(
        __dirname,
        "../uploads",
        businessDetails.logoUrl,
      );
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: businessDetails.logoUrl,
          path: logoPath,
          cid: "companyLogo",
        });
        logoSrc = "cid:companyLogo";
      }
    }

    // 5. Format items for HTML table (if showFullDetails is enabled)
    let mainContentHtml = "";
    if (emailSettings.showFullDetails) {
      const itemsHtml = (items || [])
        .map(
          (item) => `
            <tr class="table-row">
              <td style="border-left: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef;">${item.Item_Name || item.Description || "N/A"}</td>
              <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Rate || item.unit_price)}</td>
              <td style="text-align: center; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Qty || item.qty || 1}</td>
              <td style="text-align: right; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${item.Discount || 0} ${item.Discount_Type === "percentage" ? "%" : ""}</td>
              <td style="text-align: right; border-right: 1px solid #e9ecef; border-bottom: 1px solid #e9ecef; border-left: 1px solid #e9ecef;">${formatCurrency(item.Total_Amount || item.total_amount)}</td>
            </tr>
          `
        )
        .join("");

      mainContentHtml = `
        <table class="table-container" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;">
          <tr class="table-header" style="background-color: #5e72e4;">
            <th width="40%" style="color: #ffffff; padding: 12px 15px;">Item Description</th>
            <th width="15%" style="text-align: right; color: #ffffff; padding: 12px 15px;">Rate</th>
            <th width="10%" style="text-align: center; color: #ffffff; padding: 12px 15px;">Qty</th>
            <th width="15%" style="text-align: right; color: #ffffff; padding: 12px 15px;">Discount</th>
            <th width="20%" style="text-align: right; color: #ffffff; padding: 12px 15px;">Amount</th>
          </tr>
          ${itemsHtml}
        </table>

        <table class="totals-table" align="right" style="margin-top: 20px; width: 300px;">
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">Subtotal</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; font-weight: 600;">LKR ${formatCurrency(subtotal)}</td>
          </tr>
          ${parseFloat(discount) > 0 ? `
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">Discount 1</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; color: #2dce89; font-weight: 600;">
              ${discountType === "percentage" ? `${discount}%` : `LKR ${formatCurrency(discount)}`}
            </td>
          </tr>` : ""}
          ${parseFloat(discount2) > 0 ? `
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">Discount 2</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; color: #2dce89; font-weight: 600;">
              ${discount2Type === "percentage" ? `${discount2}%` : `LKR ${formatCurrency(discount2)}`}
            </td>
          </tr>` : ""}
          ${parseFloat(vatAmount) > 0 ? `
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">VAT</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; font-weight: 600;">LKR ${formatCurrency(vatAmount)}</td>
          </tr>` : ""}
          ${parseFloat(extraCharge) > 0 ? `
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">${extraChargeLabel || "Extra Charge"}</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; font-weight: 600;">LKR ${formatCurrency(extraCharge)}</td>
          </tr>` : ""}
          ${parseFloat(interestAmount) > 0 ? `
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">Interest/Charges</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; font-weight: 600;">LKR ${formatCurrency(interestAmount)}</td>
          </tr>` : ""}
          <tr class="final-row">
            <td class="total-label" style="padding: 12px; text-align: right; border-top: 2px solid #e9ecef; font-size: 16px; font-weight: bold; color: #5e72e4;">Total</td>
            <td class="total-value" style="padding: 12px; text-align: right; border-top: 2px solid #e9ecef; font-size: 16px; font-weight: bold; color: #5e72e4;">LKR ${formatCurrency(netAmount)}</td>
          </tr>
          <tr>
            <td class="total-label" style="padding: 6px 12px; text-align: right;">Paid Amount</td>
            <td class="total-value" style="padding: 6px 12px; text-align: right; font-weight: 600; color: #2dce89;">LKR ${formatCurrency(paidAmount)}</td>
          </tr>
          <tr style="font-weight: bold;">
            <td class="total-label" style="padding: 8px 12px; text-align: right; border-top: 1px solid #e9ecef; color: #e53e3e;">Balance Due</td>
            <td class="total-value" style="padding: 8px 12px; text-align: right; border-top: 1px solid #e9ecef; color: #e53e3e;">LKR ${formatCurrency(balanceAmount)}</td>
          </tr>
        </table>
        <div style="clear: both;"></div>
      `;
    } else if (emailSettings.showSummary) {
      mainContentHtml = `
        <div style="margin-bottom: 30px; padding: 20px; background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid #5e72e4;">
          <h4 style="margin: 0 0 10px 0; color: #32325d; font-size: 16px;">Invoice Summary</h4>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; color: #525f7f;">
            <tr>
              <td style="padding: 6px 0;">Subtotal:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #32325d;">LKR ${formatCurrency(subtotal)}</td>
            </tr>
            ${parseFloat(discount) > 0 ? `
            <tr>
              <td style="padding: 6px 0;">Discount 1:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #2DCE89;">
                ${discountType === "percentage" ? `${discount}%` : `LKR ${formatCurrency(discount)}`}
              </td>
            </tr>` : ""}
            ${parseFloat(discount2) > 0 ? `
            <tr>
              <td style="padding: 6px 0;">Discount 2:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #2DCE89;">
                ${discount2Type === "percentage" ? `${discount2}%` : `LKR ${formatCurrency(discount2)}`}
              </td>
            </tr>` : ""}
            ${parseFloat(vatAmount) > 0 ? `
            <tr>
              <td style="padding: 6px 0;">VAT:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #32325d;">LKR ${formatCurrency(vatAmount)}</td>
            </tr>` : ""}
            ${parseFloat(extraCharge) > 0 ? `
            <tr>
              <td style="padding: 6px 0;">${extraChargeLabel || "Extra Charge"}:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #32325d;">LKR ${formatCurrency(extraCharge)}</td>
            </tr>` : ""}
            <tr>
              <td style="padding: 6px 0;">Total Amount:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #32325d;">LKR ${formatCurrency(netAmount)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0;">Paid to Date:</td>
              <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #2DCE89;">LKR ${formatCurrency(paidAmount)}</td>
            </tr>
            <tr style="font-size: 16px; font-weight: bold; border-top: 1px solid #e9ecef;">
              <td style="padding: 10px 0 0 0; color: #e53e3e;">Balance Due:</td>
              <td style="padding: 10px 0 0 0; text-align: right; color: #e53e3e;">LKR ${formatCurrency(balanceAmount)}</td>
            </tr>
          </table>
        </div>
      `;
    }

    // 6. Generate share link token
    const salt = Math.random().toString(36).substring(2, 8);
    const rawToken = `inv_${idInvoice}_${salt}`;
    const token = btoa(rawToken).replace(/=+$/, "");
    const host = req.get("origin") || req.get("host") || "http://localhost:3000";
    // Avoid double /api in url if origin includes it
    const domain = host.replace(/\/api\/?$/, "");
    const shareLink = `${domain.includes("localhost") ? "http://localhost:5173" : domain}/public/invoice/${token}`;

    const mailOptions = {
      from: `<${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: finalSubject,
      attachments: attachments,
      html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${finalSubject}</title>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f6f9fc; color: #333333; }
              .container { max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-top: 40px; margin-bottom: 40px; }
              
              .header-section { padding: 40px; background-color: #ffffff; border-bottom: 1px solid #e9ecef; }
              .company-name { font-size: 24px; font-weight: bold; color: #32325d; margin-bottom: 5px; }
              .company-details { font-size: 14px; color: #525f7f; line-height: 1.5; }
              .quotation-title { color: #5e72e4; margin: 0; font-size: 28px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
              .quotation-number { font-size: 16px; color: #525f7f; margin-top: 5px; font-weight: 500; }
 
              .content { padding: 40px; }
              
              .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 40px; background-color: #f8f9fa; border-radius: 6px; }
              .meta-table td { vertical-align: top; padding: 20px; text-align: center; border-right: 1px solid #e9ecef; }
              .meta-table td:last-child { border-right: none; }
              .meta-label { font-size: 11px; text-transform: uppercase; color: #8898aa; letter-spacing: 1.5px; margin-bottom: 8px; font-weight: 700; display: block; }
              .meta-value { font-size: 16px; font-weight: 600; color: #32325d; display: block; }
              
              .table-container { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; }
              .table-header th { background-color: #5e72e4; color: #ffffff; font-weight: 600; text-align: left; padding: 12px 15px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
              .table-header th:first-child { border-top-left-radius: 4px; }
              .table-header th:last-child { border-top-right-radius: 4px; text-align: right; }
              
              .table-row td { padding: 12px 15px; border-bottom: 1px solid #e9ecef; font-size: 14px; color: #525f7f; border-left: 1px solid #e9ecef; vertical-align: middle; }
              .table-row td:last-child { border-right: 1px solid #e9ecef; text-align: right; font-weight: 600; color: #32325d; }
              
              .totals-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              .totals-table td { padding: 8px 0; text-align: right; font-size: 14px; color: #525f7f; }
              .totals-table .total-label { padding-right: 20px; font-weight: 500; }
              .totals-table .total-value { font-weight: 600; color: #32325d; width: 150px; }
              .totals-table .final-row td { padding-top: 15px; padding-bottom: 15px; border-top: 2px solid #e9ecef; font-size: 18px; color: #5e72e4; font-weight: 700; }
              
              .note { background-color: #fff8e1; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; font-size: 14px; color: #525f7f; margin-top: 30px; line-height: 1.5; }
              .footer { background-color: #f6f9fc; padding: 20px; text-align: center; color: #8898aa; font-size: 12px; border-top: 1px solid #e9ecef; line-height: 1.5; }
              .btn { display: inline-block; background-color: #5e72e4; color: #ffffff; padding: 12px 25px; border-radius: 4px; text-decoration: none; font-weight: 600; margin-top: 20px; font-size: 14px; box-shadow: 0 4px 6px rgba(50, 50, 93, 0.11), 0 1px 3px rgba(0, 0, 0, 0.08); transition: all 0.15s ease; }
              
              @media only screen and (max-width: 600px) {
                .container { width: 100%; margin: 0; border-radius: 0; }
                .content, .header-section { padding: 20px; }
                .meta-table td { display: block; width: 100%; text-align: left !important; padding: 15px; border-right: none; border-bottom: 1px solid #e9ecef; }
                .meta-table td:last-child { border-bottom: none; }
                .table-container th:nth-child(2), .table-container td:nth-child(2),
                .table-container th:nth-child(3), .table-container td:nth-child(3) { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header-section">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="top">
                       ${logoSrc ? `<img src="${logoSrc}" style="max-height: 70px; margin-bottom: 15px;" alt="Logo"/>` : ""}
                       <div class="company-name">${businessDetails.name}</div>
                       <div class="company-details">
                          ${businessDetails.address}<br>
                          ${businessDetails.phone ? `Tel: ${businessDetails.phone}<br>` : ""}
                          ${businessDetails.email ? `Email: ${businessDetails.email}<br>` : ""}
                          ${businessDetails.website ? `Web: ${businessDetails.website}` : ""}
                       </div>
                    </td>
                    <td valign="top" style="text-align: right;">
                       <h1 class="quotation-title" style="color: #5e72e4;">INVOICE</h1>
                       <div class="quotation-number">#${invoiceId}</div>
                    </td>
                  </tr>
                </table>
              </div>
              
              <div class="content">
                ${finalGreeting ? `<p style="font-size: 16px; margin-bottom: 10px; color: #32325d;">${finalGreeting}</p>` : ""}
                
                <p style="font-size: 14px; color: #525f7f; line-height: 1.5; margin-bottom: 30px; white-space: pre-wrap;">${finalMessageBody}</p>
                
                <table class="meta-table">
                  <tr>
                    <td>
                      <span class="meta-label">Invoice Date</span>
                      <span class="meta-value">${formatDate(invoiceDate)}</span>
                    </td>
                    <td>
                       <span class="meta-label">Total Amount</span>
                       <span class="meta-value">LKR ${formatCurrency(netAmount)}</span>
                    </td>
                    <td>
                      <span class="meta-label">Due Date</span>
                      <span class="meta-value" style="color: ${dueDate && !isNaN(new Date(dueDate).getTime()) && new Date(dueDate) < new Date() ? "#e53e3e" : "#32325d"};">
                        ${formatDate(dueDate)}
                      </span>
                    </td>
                  </tr>
                </table>
 
                ${
                  shippingAddress
                    ? `
                <div style="margin-bottom: 30px; padding: 15px; background-color: #f8f9fa; border-radius: 6px;">
                    <span class="meta-label" style="display:block; margin-bottom: 5px;">Billing/Shipping Address</span>
                    <p style="margin: 0; font-size: 14px; color: #525f7f;">${shippingAddress}</p>
                </div>`
                    : ""
                }
 
                ${mainContentHtml}
 
                ${note ? `<div class="note"><strong>Note:</strong><br>${note}</div>` : ""}
 
                <div style="text-align: center; margin-top: 30px;">
                 <a href="${shareLink}" class="btn" style="color: #ffffff; background-color: #5e72e4;">View Invoice Online</a>
                </div>
              </div>
 
              <div class="footer">
                <p>Thank you for your business!</p>
                <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} ${businessDetails.name}. All rights reserved.</p>
                <p>If you have any questions, please contact us at <a href="mailto:${businessDetails.email || "security@asipbook.com"}" style="color: #5e72e4; text-decoration: none;">${businessDetails.email || "security@asipbook.com"}</a></p>
              </div>
            </div>
          </body>
          </html>
        `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Invoice email sent successfully" });
  } catch (error) {
    console.error("Error sending invoice email:", error);
    res.status(500).json({ message: "Failed to send email", error: error.message });
  }
});

module.exports = router;
