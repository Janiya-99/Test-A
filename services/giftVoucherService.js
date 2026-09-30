const db = require("../db/db");

/**
 * Gift Voucher Service for AsipBook SaaS ERP / POS
 * Manages voucher issuance, scannable barcode generation,
 * single-use full redemption, real-time POS verification, and audit logs.
 */

const DEFAULT_SETTINGS = {
  voucher_prefix: "GV-",
  code_length: 8,
  default_expiry_days: 180,
  allow_with_promotions: 1,
  min_spend_amount: 0.0,
  terms_and_conditions:
    "This gift voucher is valid for a single transaction. It is non-refundable, non-exchangeable for cash, and must be fully spent upon redemption. Unused balance will not be retained.",
};

// Helper: Resolve company ID and Name for branch
const getCompanyDetails = (branchId) => {
  return new Promise((resolve) => {
    const query = `
      SELECT b.Company_idCompany AS companyId, c.Name AS companyName
      FROM branch b
      LEFT JOIN company c ON c.idCompany = b.Company_idCompany
      WHERE b.idBranch = ?
    `;
    db.query(query, [branchId], (err, rows) => {
      if (!err && rows && rows.length > 0) {
        resolve({
          companyId: rows[0].companyId,
          companyName: rows[0].companyName || "",
        });
      } else {
        resolve({ companyId: null, companyName: "" });
      }
    });
  });
};

// Helper: Resolve company ID for branch
const getCompanyId = async (branchId) => {
  const details = await getCompanyDetails(branchId);
  return details.companyId;
};

/**
 * Get Gift Voucher settings for a branch
 */
const getGiftVoucherSettings = async (branchId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM gift_voucher_settings WHERE branch_id = ?";
    db.query(query, [branchId], async (err, rows) => {
      if (err) return reject(err);
      if (rows && rows.length > 0) {
        return resolve(rows[0]);
      }
      const companyId = await getCompanyId(branchId);
      resolve({
        ...DEFAULT_SETTINGS,
        branch_id: branchId,
        company_id: companyId,
      });
    });
  });
};

/**
 * Save / update Gift Voucher settings for a branch
 */
const saveGiftVoucherSettings = async (branchId, settingsData) => {
  const companyId = await getCompanyId(branchId);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...settingsData,
    branch_id: branchId,
    company_id: companyId,
  };

  const sql = `
    INSERT INTO gift_voucher_settings (
      branch_id, company_id, voucher_prefix, code_length,
      default_expiry_days, allow_with_promotions, min_spend_amount,
      terms_and_conditions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      company_id = VALUES(company_id),
      voucher_prefix = VALUES(voucher_prefix),
      code_length = VALUES(code_length),
      default_expiry_days = VALUES(default_expiry_days),
      allow_with_promotions = VALUES(allow_with_promotions),
      min_spend_amount = VALUES(min_spend_amount),
      terms_and_conditions = VALUES(terms_and_conditions)
  `;

  const values = [
    settings.branch_id,
    settings.company_id,
    settings.voucher_prefix || "GV-",
    parseInt(settings.code_length, 10) || 8,
    parseInt(settings.default_expiry_days, 10) || 180,
    settings.allow_with_promotions ? 1 : 0,
    parseFloat(settings.min_spend_amount) || 0.0,
    settings.terms_and_conditions || DEFAULT_SETTINGS.terms_and_conditions,
  ];

  return new Promise((resolve, reject) => {
    db.query(sql, values, (err) => {
      if (err) return reject(err);
      resolve({ success: true, settings });
    });
  });
};

/**
 * Generate a unique alphanumeric voucher code
 */
const generateUniqueVoucherCode = async (prefix = "GV-", length = 8) => {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude easily confused chars (0, O, 1, I)
  let isUnique = false;
  let code = "";
  let attempts = 0;

  while (!isUnique && attempts < 20) {
    attempts++;
    let randomPart = "";
    for (let i = 0; i < length; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code = `${prefix}${randomPart}`;

    const existing = await new Promise((res, rej) => {
      db.query("SELECT id FROM gift_vouchers WHERE voucher_code = ?", [code], (err, rows) => {
        if (err) return rej(err);
        res(rows);
      });
    });

    if (!existing || existing.length === 0) {
      isUnique = true;
    }
  }

  if (!isUnique) {
    code = `${prefix}${Date.now().toString(36).toUpperCase()}`;
  }

  return code;
};

/**
 * Issue a single Gift Voucher
 */
const issueGiftVoucher = async ({
  branchId,
  amount,
  customerId = null,
  recipientName = null,
  recipientPhone = null,
  recipientEmail = null,
  expiryDays = null,
  notes = null,
  userId = null,
  issueType = "DIRECT_ISSUED",
  invoiceId = null,
  customCode = null,
}) => {
  const voucherAmount = parseFloat(amount);
  if (!voucherAmount || voucherAmount <= 0) {
    throw new Error("Voucher amount must be greater than 0");
  }

  const settings = await getGiftVoucherSettings(branchId);
  const companyDetails = await getCompanyDetails(branchId);
  const companyId = companyDetails.companyId;

  // Determine code
  let voucherCode = (customCode || "").trim().toUpperCase();
  if (!voucherCode) {
    voucherCode = await generateUniqueVoucherCode(
      settings.voucher_prefix || "GV-",
      settings.code_length || 8
    );
  } else {
    // Check custom code uniqueness
    const exists = await new Promise((res, rej) => {
      db.query("SELECT id FROM gift_vouchers WHERE voucher_code = ?", [voucherCode], (err, rows) => {
        if (err) return rej(err);
        res(rows);
      });
    });
    if (exists && exists.length > 0) {
      throw new Error(`Voucher code "${voucherCode}" already exists`);
    }
  }

  // Calculate expiry date
  const effectiveExpiryDays =
    expiryDays !== null && expiryDays !== undefined
      ? parseInt(expiryDays, 10)
      : parseInt(settings.default_expiry_days, 10);

  let expiryDate = null;
  if (effectiveExpiryDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() + effectiveExpiryDays);
    expiryDate = d.toISOString().split("T")[0];
  }

  const barcode = voucherCode;

  const insertSql = `
    INSERT INTO gift_vouchers (
      voucher_code, barcode, amount, customer_id, recipient_name,
      recipient_phone, recipient_email, branch_id, company_id,
      expiry_date, status, issue_type, created_invoice_id, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
  `;

  return new Promise((resolve, reject) => {
    db.query(
      insertSql,
      [
        voucherCode,
        barcode,
        voucherAmount,
        customerId || null,
        recipientName || null,
        recipientPhone || null,
        recipientEmail || null,
        branchId,
        companyId,
        expiryDate,
        issueType,
        invoiceId || null,
        notes || null,
        userId || null,
      ],
      (err, result) => {
        if (err) return reject(err);
        const voucherId = result.insertId;

        // Insert log
        const logSql = `
          INSERT INTO gift_voucher_logs (
            voucher_id, branch_id, company_id, action, amount,
            invoice_id, customer_id, reference_note, created_by
          ) VALUES (?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?)
        `;

        db.query(
          logSql,
          [
            voucherId,
            branchId,
            companyId,
            voucherAmount,
            invoiceId || null,
            customerId || null,
            notes || `Issued Gift Voucher (${issueType})`,
            userId,
          ],
          (logErr) => {
            if (logErr) console.error("[GiftVoucher] Log insertion error:", logErr);

            resolve({
              success: true,
              voucher: {
                id: voucherId,
                voucher_code: voucherCode,
                barcode,
                amount: voucherAmount,
                expiry_date: expiryDate,
                status: "ACTIVE",
                recipient_name: recipientName,
                recipient_phone: recipientPhone,
                recipient_email: recipientEmail,
                customer_id: customerId,
                company_id: companyId,
                companyName: companyDetails.companyName,
              },
            });
          }
        );
      }
    );
  });
};

/**
 * Batch generate vouchers for campaigns or promotions
 */
const batchGenerateVouchers = async ({
  branchId,
  count,
  amount,
  expiryDays = null,
  notes = null,
  userId = null,
}) => {
  const numCount = Math.min(100, Math.max(1, parseInt(count, 10) || 1));
  const voucherAmount = parseFloat(amount);
  if (!voucherAmount || voucherAmount <= 0) {
    throw new Error("Voucher amount must be greater than 0");
  }

  const generated = [];
  for (let i = 0; i < numCount; i++) {
    const res = await issueGiftVoucher({
      branchId,
      amount: voucherAmount,
      expiryDays,
      notes: notes || `Batch generated voucher #${i + 1}`,
      userId,
      issueType: "BATCH",
    });
    generated.push(res.voucher);
  }

  return {
    success: true,
    count: generated.length,
    vouchers: generated,
  };
};

/**
 * Real-time verification of a voucher for POS & Invoice checkout
 * Scanned from barcode or typed code
 */
const verifyVoucherForRedemption = async ({ code, branchId, billAmount = 0 }) => {
  const rawCode = (code || "").trim();
  if (!rawCode) {
    return { valid: false, message: "Please enter or scan a voucher code" };
  }

  // 1. Check if Gift Voucher is enabled in branch rules
  const rules = await new Promise((res, rej) => {
    db.query("SELECT enable_gift_voucher FROM rules WHERE Branch_idBranch = ?", [branchId], (err, rows) => {
      if (err) return rej(err);
      res(rows);
    });
  });

  if (!rules || rules.length === 0 || Number(rules[0].enable_gift_voucher) !== 1) {
    return { valid: false, message: "Gift Voucher option is currently disabled in System Settings" };
  }

  // 2. Fetch voucher record
  const sql = `
    SELECT gv.*, c.displayName AS customerName, c.mobileNumber AS customerPhone,
           COALESCE(comp.Name, '') AS companyName
    FROM gift_vouchers gv
    LEFT JOIN customer c ON c.idCustomer = gv.customer_id
    LEFT JOIN company comp ON comp.idCompany = gv.company_id
    WHERE gv.voucher_code = ? OR gv.barcode = ?
    LIMIT 1
  `;

  const rows = await new Promise((res, rej) => {
    db.query(sql, [rawCode, rawCode], (err, result) => {
      if (err) return rej(err);
      res(result);
    });
  });

  if (!rows || rows.length === 0) {
    return { valid: false, message: `Voucher "${rawCode}" not found` };
  }

  const voucher = rows[0];

  // 3. Status checks
  if (voucher.status === "REDEEMED") {
    return {
      valid: false,
      message: `Voucher "${voucher.voucher_code}" has already been redeemed on ${
        voucher.redeemed_at ? new Date(voucher.redeemed_at).toLocaleDateString() : "a previous sale"
      }`,
    };
  }

  if (voucher.status === "VOIDED") {
    return { valid: false, message: `Voucher "${voucher.voucher_code}" has been voided / cancelled` };
  }

  // 4. Expiry check
  if (voucher.expiry_date) {
    const today = new Date().toISOString().split("T")[0];
    const exp = new Date(voucher.expiry_date).toISOString().split("T")[0];
    if (today > exp) {
      // Auto-update to EXPIRED
      db.query("UPDATE gift_vouchers SET status = 'EXPIRED' WHERE id = ?", [voucher.id]);
      return {
        valid: false,
        message: `Voucher "${voucher.voucher_code}" expired on ${new Date(voucher.expiry_date).toLocaleDateString()}`,
      };
    }
  }

  // 5. Minimum spend check
  const settings = await getGiftVoucherSettings(branchId);
  const minSpend = parseFloat(settings.min_spend_amount) || 0;
  const currentBill = parseFloat(billAmount) || 0;

  if (minSpend > 0 && currentBill > 0 && currentBill < minSpend) {
    return {
      valid: false,
      message: `Minimum bill amount of LKR ${minSpend.toLocaleString()} is required to redeem this voucher`,
    };
  }

  const voucherValue = parseFloat(voucher.amount) || 0;

  return {
    valid: true,
    voucher: {
      id: voucher.id,
      voucher_code: voucher.voucher_code,
      barcode: voucher.barcode,
      amount: voucherValue,
      status: voucher.status,
      expiry_date: voucher.expiry_date,
      recipient_name: voucher.recipient_name || voucher.customerName || "Bearer",
      recipient_phone: voucher.recipient_phone || voucher.customerPhone || "-",
      customer_id: voucher.customer_id,
      company_id: voucher.company_id,
      companyName: voucher.companyName || "",
      terms: settings.terms_and_conditions,
    },
  };
};

/**
 * Atomically claim/redeem a voucher during Invoice or POS checkout
 * Strictly enforces single-use full redemption
 */
const claimVoucherForInvoice = async ({
  voucherCode,
  invoiceId,
  invoiceNumber = "",
  customerId = null,
  branchId,
  userId = null,
  connection = null,
}) => {
  const code = (voucherCode || "").trim();
  if (!code) return null;

  const executeClaim = async (conn) => {
    // 1. Lock voucher row
    const lockSql = `
      SELECT * FROM gift_vouchers
      WHERE (voucher_code = ? OR barcode = ?)
      FOR UPDATE
    `;

    const rows = await new Promise((res, rej) => {
      conn.query(lockSql, [code, code], (err, r) => (err ? rej(err) : res(r)));
    });

    if (!rows || rows.length === 0) {
      throw new Error(`Voucher "${code}" not found`);
    }

    const voucher = rows[0];

    if (voucher.status !== "ACTIVE") {
      throw new Error(`Voucher "${voucher.voucher_code}" cannot be redeemed. Current status: ${voucher.status}`);
    }

    // 2. Mark as REDEEMED
    const updateSql = `
      UPDATE gift_vouchers
      SET status = 'REDEEMED',
          redeemed_invoice_id = ?,
          redeemed_at = NOW()
      WHERE id = ?
    `;

    await new Promise((res, rej) => {
      conn.query(updateSql, [invoiceId, voucher.id], (err) => (err ? rej(err) : res()));
    });

    // 3. Insert transaction log
    const logSql = `
      INSERT INTO gift_voucher_logs (
        voucher_id, branch_id, company_id, action, amount,
        invoice_id, customer_id, reference_note, created_by
      ) VALUES (?, ?, ?, 'REDEEMED', ?, ?, ?, ?, ?)
    `;

    const note = `Redeemed on Invoice #${invoiceNumber || invoiceId}`;

    await new Promise((res, rej) => {
      conn.query(
        logSql,
        [voucher.id, branchId, voucher.company_id, voucher.amount, invoiceId, customerId || voucher.customer_id, note, userId],
        (err) => (err ? rej(err) : res())
      );
    });

    console.log(`[GiftVoucher] ✅ Redeemed voucher #${voucher.voucher_code} (LKR ${voucher.amount}) on invoice #${invoiceNumber || invoiceId}`);

    return {
      success: true,
      voucherId: voucher.id,
      voucherCode: voucher.voucher_code,
      amount: parseFloat(voucher.amount),
    };
  };

  if (connection) {
    return executeClaim(connection);
  } else {
    return new Promise((resolve, reject) => {
      db.getConnection((connErr, conn) => {
        if (connErr) return reject(connErr);
        conn.beginTransaction(async (txErr) => {
          if (txErr) {
            conn.release();
            return reject(txErr);
          }
          try {
            const result = await executeClaim(conn);
            conn.commit((commitErr) => {
              if (commitErr) {
                return conn.rollback(() => {
                  conn.release();
                  reject(commitErr);
                });
              }
              conn.release();
              resolve(result);
            });
          } catch (e) {
            conn.rollback(() => {
              conn.release();
              reject(e);
            });
          }
        });
      });
    });
  }
};

/**
 * Revert voucher redemption if an invoice is cancelled or deleted
 */
const revertVoucherRedemption = async (invoiceId, connection = null) => {
  if (!invoiceId) return;

  const executeRevert = async (conn) => {
    const logsSql = `
      SELECT * FROM gift_voucher_logs
      WHERE invoice_id = ? AND action = 'REDEEMED'
    `;

    const logs = await new Promise((res, rej) => {
      conn.query(logsSql, [invoiceId], (err, rows) => (err ? rej(err) : res(rows)));
    });

    if (!logs || logs.length === 0) return;

    for (const log of logs) {
      // Revert voucher status back to ACTIVE
      const revertSql = `
        UPDATE gift_vouchers
        SET status = 'ACTIVE',
            redeemed_invoice_id = NULL,
            redeemed_at = NULL
        WHERE id = ?
      `;

      await new Promise((res, rej) => {
        conn.query(revertSql, [log.voucher_id], (err) => (err ? rej(err) : res()));
      });

      // Insert log
      const logSql = `
        INSERT INTO gift_voucher_logs (
          voucher_id, branch_id, company_id, action, amount,
          invoice_id, customer_id, reference_note, created_by
        ) VALUES (?, ?, ?, 'REFUNDED', ?, ?, ?, ?, NULL)
      `;

      await new Promise((res, rej) => {
        conn.query(
          logSql,
          [log.voucher_id, log.branch_id, log.company_id, log.amount, invoiceId, log.customer_id, `Restored voucher from deleted Invoice #${invoiceId}`],
          (err) => (err ? rej(err) : res())
        );
      });

      console.log(`[GiftVoucher] 🔄 Reverted redemption for voucher ID #${log.voucher_id} from invoice #${invoiceId}`);
    }
  };

  if (connection) {
    return executeRevert(connection);
  } else {
    return new Promise((resolve) => {
      db.getConnection(async (err, conn) => {
        if (err) return resolve();
        try {
          await executeRevert(conn);
        } catch (e) {
          console.error("[GiftVoucher] Error reverting voucher:", e);
        } finally {
          conn.release();
          resolve();
        }
      });
    });
  }
};

/**
 * Void / Cancel a gift voucher
 */
const voidVoucher = async (voucherId, reason = "", userId = null) => {
  return new Promise((resolve, reject) => {
    db.query("SELECT * FROM gift_vouchers WHERE id = ?", [voucherId], (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) return reject(new Error("Voucher not found"));

      const voucher = rows[0];
      if (voucher.status === "REDEEMED") {
        return reject(new Error("Cannot void a voucher that has already been redeemed"));
      }

      db.query("UPDATE gift_vouchers SET status = 'VOIDED' WHERE id = ?", [voucherId], (err2) => {
        if (err2) return reject(err2);

        const logSql = `
          INSERT INTO gift_voucher_logs (
            voucher_id, branch_id, company_id, action, amount,
            reference_note, created_by
          ) VALUES (?, ?, ?, 'VOIDED', ?, ?, ?)
        `;

        db.query(
          logSql,
          [voucherId, voucher.branch_id, voucher.company_id, voucher.amount, reason || "Voided by administrator", userId],
          (logErr) => {
            if (logErr) console.error("[GiftVoucher] Void log error:", logErr);
            resolve({ success: true, message: `Voucher #${voucher.voucher_code} voided successfully` });
          }
        );
      });
    });
  });
};

/**
 * Paginated list of Gift Vouchers with search and filters
 */
const getGiftVoucherList = async (branchId, queryParams = {}) => {
  const {
    page = 1,
    limit = 20,
    search = "",
    status = "ALL",
    startDate = "",
    endDate = "",
  } = queryParams;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const conditions = ["(gv.branch_id = ? OR gv.company_id = ?)"];
  const companyId = await getCompanyId(branchId);
  const params = [branchId, companyId];

  if (status && status !== "ALL") {
    conditions.push("gv.status = ?");
    params.push(status);
  }

  if (search && search.trim() !== "") {
    const s = `%${search.trim()}%`;
    conditions.push("(gv.voucher_code LIKE ? OR gv.barcode LIKE ? OR gv.recipient_name LIKE ? OR c.displayName LIKE ?)");
    params.push(s, s, s, s);
  }

  if (startDate) {
    conditions.push("DATE(gv.created_at) >= ?");
    params.push(startDate);
  }

  if (endDate) {
    conditions.push("DATE(gv.created_at) <= ?");
    params.push(endDate);
  }

  const whereSql = conditions.join(" AND ");

  return new Promise((resolve, reject) => {
    // Count query
    const countSql = `
      SELECT COUNT(gv.id) AS total
      FROM gift_vouchers gv
      LEFT JOIN customer c ON c.idCustomer = gv.customer_id
      WHERE ${whereSql}
    `;

    db.query(countSql, params, (err, countRows) => {
      if (err) return reject(err);

      const totalRecords = countRows[0]?.total || 0;
      const totalPages = Math.ceil(totalRecords / parseInt(limit, 10)) || 1;

      // Data query
      const dataSql = `
        SELECT gv.*, c.displayName AS customerName, c.mobileNumber AS customerPhone,
               inv.Invoice_Number AS redeemedInvoiceNumber,
               COALESCE(comp.Name, '') AS companyName
        FROM gift_vouchers gv
        LEFT JOIN customer c ON c.idCustomer = gv.customer_id
        LEFT JOIN invoice inv ON inv.idInvoice = gv.redeemed_invoice_id
        LEFT JOIN company comp ON comp.idCompany = gv.company_id
        WHERE ${whereSql}
        ORDER BY gv.id DESC
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, parseInt(limit, 10), parseInt(offset, 10)];

      db.query(dataSql, dataParams, (err2, rows) => {
        if (err2) return reject(err2);

        resolve({
          data: rows || [],
          pagination: {
            currentPage: parseInt(page, 10),
            totalPages,
            totalRecords,
            limit: parseInt(limit, 10),
          },
        });
      });
    });
  });
};

/**
 * Gift Voucher Dashboard KPI Aggregates
 */
const getGiftVoucherDashboard = async (branchId) => {
  const companyId = await getCompanyId(branchId);

  const statsSql = `
    SELECT
      COUNT(id) AS total_vouchers,
      COALESCE(SUM(amount), 0) AS total_value_issued,
      COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_count,
      COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN amount ELSE 0 END), 0) AS active_liability_value,
      COALESCE(SUM(CASE WHEN status = 'REDEEMED' THEN 1 ELSE 0 END), 0) AS redeemed_count,
      COALESCE(SUM(CASE WHEN status = 'REDEEMED' THEN amount ELSE 0 END), 0) AS redeemed_value,
      COALESCE(SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired_count,
      COALESCE(SUM(CASE WHEN status = 'VOIDED' THEN 1 ELSE 0 END), 0) AS voided_count
    FROM gift_vouchers
    WHERE (branch_id = ? OR company_id = ?)
  `;

  const recentSql = `
    SELECT l.*, gv.voucher_code, gv.barcode, c.displayName AS customerName,
           inv.Invoice_Number AS invoiceNumber
    FROM gift_voucher_logs l
    JOIN gift_vouchers gv ON gv.id = l.voucher_id
    LEFT JOIN customer c ON c.idCustomer = l.customer_id
    LEFT JOIN invoice inv ON inv.idInvoice = l.invoice_id
    WHERE (l.branch_id = ? OR l.company_id = ?)
    ORDER BY l.id DESC
    LIMIT 15
  `;

  return new Promise((resolve, reject) => {
    db.query(statsSql, [branchId, companyId], (err, statRows) => {
      if (err) return reject(err);
      const s = statRows[0] || {};

      db.query(recentSql, [branchId, companyId], (err2, recentRows) => {
        if (err2) return reject(err2);

        resolve({
          stats: {
            totalVouchers: parseInt(s.total_vouchers, 10) || 0,
            totalValueIssued: parseFloat(s.total_value_issued) || 0,
            activeCount: parseInt(s.active_count, 10) || 0,
            activeLiabilityValue: parseFloat(s.active_liability_value) || 0,
            redeemedCount: parseInt(s.redeemed_count, 10) || 0,
            redeemedValue: parseFloat(s.redeemed_value) || 0,
            expiredCount: parseInt(s.expired_count, 10) || 0,
            voidedCount: parseInt(s.voided_count, 10) || 0,
          },
          recentActivity: recentRows || [],
        });
      });
    });
  });
};

/**
 * View detailed voucher with logs
 */
const getGiftVoucherById = async (voucherId) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT gv.*, c.displayName AS customerName, c.mobileNumber AS customerPhone,
             c.companyEmail AS customerEmail,
             inv.Invoice_Number AS redeemedInvoiceNumber
      FROM gift_vouchers gv
      LEFT JOIN customer c ON c.idCustomer = gv.customer_id
      LEFT JOIN invoice inv ON inv.idInvoice = gv.redeemed_invoice_id
      WHERE gv.id = ?
    `;

    db.query(sql, [voucherId], (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) return reject(new Error("Voucher not found"));

      const voucher = rows[0];

      const logsSql = `
        SELECT l.*, inv.Invoice_Number AS invoiceNumber
        FROM gift_voucher_logs l
        LEFT JOIN invoice inv ON inv.idInvoice = l.invoice_id
        WHERE l.voucher_id = ?
        ORDER BY l.id DESC
      `;

      db.query(logsSql, [voucherId], (err2, logRows) => {
        if (err2) return reject(err2);
        resolve({
          voucher,
          logs: logRows || [],
        });
      });
    });
  });
};

/**
 * Get unlinked (DIRECT_ISSUED / PROMOTIONAL) ACTIVE vouchers for the quick modal
 */
const getUnlinkedVouchers = async (branchId, search = "") => {
  return new Promise((resolve, reject) => {
    const q = search.trim()
      ? `SELECT gv.*, c.displayName AS customerName FROM gift_vouchers gv
         LEFT JOIN customer c ON c.idCustomer = gv.customer_id
         WHERE gv.branch_id = ? AND gv.status = 'ACTIVE'
           AND (gv.voucher_code LIKE ? OR gv.recipient_name LIKE ? OR c.displayName LIKE ?)
         ORDER BY gv.created_at DESC LIMIT 50`
      : `SELECT gv.*, c.displayName AS customerName FROM gift_vouchers gv
         LEFT JOIN customer c ON c.idCustomer = gv.customer_id
         WHERE gv.branch_id = ? AND gv.status = 'ACTIVE'
         ORDER BY gv.created_at DESC LIMIT 50`;

    const params = search.trim()
      ? [branchId, `%${search}%`, `%${search}%`, `%${search}%`]
      : [branchId];

    db.query(q, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
};

/**
 * Invoice gift vouchers so customers who purchased them are formally billed.
 * Creates a real invoice, records accounting double-entries, and marks vouchers as INVOICED.
 *
 * Accounting (Customer Purchases Voucher):
 *   DR  Cash in Hand / Bank Account   [totalAmount]   Asset increases
 *   CR  Gift Voucher Liability         [totalAmount]   Liability created (customer holds voucher)
 *
 * @param {Object} params
 */
const invoiceGiftVouchers = async ({
  voucherIds,
  branchId,
  companyId,
  customerId,
  paymentMethod = "cash",
  bankAccountId = null,
  userId,
  dateTime,
  notes = "",
}) => {
  // Lazy-load to avoid circular deps
  const { findAccountByNameAndGroup, ensureAccountExists, creditDebitLogHelper } = require("../controllers/accountingController");
  const invoiceDBService = require("./invoiceDBService");

  if (!voucherIds || voucherIds.length === 0) throw new Error("No vouchers selected");

  return new Promise((resolve, reject) => {
    db.getConnection(async (connErr, connection) => {
      if (connErr) return reject(connErr);

      connection.beginTransaction(async (txErr) => {
        if (txErr) { connection.release(); return reject(txErr); }

        try {
          // 1. Fetch the selected vouchers
          const [vouchers] = await new Promise((res, rej) => {
            connection.query(
              `SELECT * FROM gift_vouchers WHERE id IN (?) AND branch_id = ? AND status = 'ACTIVE'`,
              [voucherIds, branchId],
              (err, rows) => err ? rej(err) : res([rows])
            );
          });

          if (vouchers.length === 0) throw new Error("No valid ACTIVE vouchers found");

          const totalAmount = vouchers.reduce((sum, v) => sum + parseFloat(v.amount), 0);

          // 2. Generate Invoice Number — fetch last invoice for the branch
          const [lastInvoiceRows] = await new Promise((res, rej) => {
            connection.query(
              `SELECT Invoice_Number FROM invoice WHERE Branch_idBranch = ? ORDER BY idInvoice DESC LIMIT 1`,
              [branchId],
              (err, rows) => err ? rej(err) : res([rows])
            );
          });

          let invoiceNumber = `GV-${Date.now()}`;
          if (lastInvoiceRows && lastInvoiceRows.length > 0) {
            const last = lastInvoiceRows[0].Invoice_Number;
            const match = last.match(/^(.*?)(\d+)$/);
            if (match) {
              const next = String(parseInt(match[2], 10) + 1).padStart(match[2].length, "0");
              invoiceNumber = `${match[1]}${next}`;
            }
          }

          const now = dateTime || new Date().toISOString().slice(0, 19).replace("T", " ");
          const todayDate = now.slice(0, 10);

          // 3. Insert Invoice
          const invoiceResult = await invoiceDBService.insertInvoice(
            invoiceNumber,           // Invoice_Number
            null,                    // Quotation_idQuotation
            todayDate,               // Date
            customerId || null,      // Customer_idCustomer
            null,                    // Address
            userId,                  // Employee_idEmployee
            totalAmount,             // Total
            null, 0, 0,              // Discount_Type, Discount_Presentage, Discount_Amount
            null, 0, 0,              // Discount2_Type, Discount2_Presentage, Discount2_Amount
            totalAmount,             // Net_Amount
            vouchers.length,         // Item_Count
            notes || `Gift Voucher Sale — ${vouchers.map(v => v.voucher_code).join(", ")}`, // Note
            1,                       // Payment_Type (1 = Full Payment)
            0, 0, null,              // Interest_Amount, Interest_Presentage, Interest_Type
            totalAmount,             // Paid_Amount
            0,                       // Balance_Amount
            0,                       // Credit_Balance
            0,                       // Total_Credit_Balance
            todayDate,               // Created_Date
            now,                     // created_at
            branchId,                // Branch_idBranch
            paymentMethod,           // Payment_Method
            null, null, null, null,  // Card fields
            null, null, null, null,  // Cheque fields
            bankAccountId || null,   // Bank_Account_Id
            0, null,                 // Vat_Amount, Vat_Type
            null, 0,                 // Extra_Charge_Label, Extra_Charge
            userId,                  // user
            null,                    // place_of_supply
            null,                    // custom_fields_data
            connection
          );

          const newInvoiceId = invoiceResult.insertId || invoiceResult[0]?.insertId;
          if (!newInvoiceId) throw new Error("Failed to create invoice");

          // 4. Insert one Invoice_Has_Item row per voucher
          for (const v of vouchers) {
            await invoiceDBService.insertInvoiceItem(
              newInvoiceId,               // Invoice_idInvoice
              0,                          // Item_idItem (0 = manual/service item)
              0,                          // Item_Has_Serial
              null,                       // Serial_No_Id
              `Gift Voucher - ${v.voucher_code}`, // Description
              null,                       // Long_Description
              "pcs",                      // Qty_Type
              1,                          // Qty
              parseFloat(v.amount),       // Rate
              parseFloat(v.amount),       // Amount
              null, 0,                    // Discount_Type, Discount
              parseFloat(v.amount),       // Total_Amount
              branchId,                   // Branch_idBranch
              null,                       // Variation_Id
              v.recipient_name || null,   // Remarks
              connection,                 // connection (arg17)
              0,                          // is_bonus_line (arg18)
              null                        // promo_rule_id (arg19)
            );
          }

          // 5. Update gift_vouchers — mark as INVOICED
          await new Promise((res, rej) => {
            connection.query(
              `UPDATE gift_vouchers SET issue_type = 'INVOICED', created_invoice_id = ? WHERE id IN (?)`,
              [newInvoiceId, voucherIds],
              (err) => err ? rej(err) : res()
            );
          });

          // 6. Accounting double-entries (Professional plan only, best-effort)
          try {
            const pMethodLower = (paymentMethod || "").toLowerCase();
            const isBank = pMethodLower === "card" || pMethodLower.includes("bank") || pMethodLower.includes("online");
            const paymentAccountName = isBank ? "Bank Account" : "Cash in Hand";

            const Payment_AccountId = await findAccountByNameAndGroup(
              paymentAccountName, "Assets", companyId, branchId, connection
            ) || await findAccountByNameAndGroup(
              "Cash in Hand", "Assets", companyId, branchId, connection
            );

            const Voucher_AccountId = await ensureAccountExists(
              "Gift Voucher Liability", "Liabilities", "Liabilities", "2000-004",
              "Gift Voucher Liability account",
              companyId, branchId, userId || 1, connection
            );

            if (Payment_AccountId && Voucher_AccountId) {
              // DR Cash / Bank (asset increases)
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: totalAmount,
                description: `Gift Voucher Sale — Invoice ${invoiceNumber}`,
                type: "Gift Voucher Sale",
                accountId: Payment_AccountId,
                branchId,
                userId,
                companyId,
                transactionType: "debit",
                connection,
              });

              // CR Gift Voucher Liability (liability created)
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Liabilities",
                amount: totalAmount,
                description: `Gift Voucher Liability — Invoice ${invoiceNumber}`,
                type: "Gift Voucher Sale",
                accountId: Voucher_AccountId,
                branchId,
                userId,
                companyId,
                transactionType: "credit",
                connection,
              });
            }
          } catch (accErr) {
            console.error("[GiftVoucher] Accounting entry error (non-fatal):", accErr);
          }

          // 7. Commit
          await new Promise((res, rej) => connection.commit((err) => err ? rej(err) : res()));
          connection.release();

          resolve({
            success: true,
            invoiceId: newInvoiceId,
            invoiceNumber,
            totalAmount,
            vouchersInvoiced: vouchers.length,
          });

        } catch (err) {
          await new Promise((res) => connection.rollback(() => res()));
          connection.release();
          reject(err);
        }
      });
    });
  });
};

/**
 * Record promotional voucher accounting.
 * When a voucher is issued as PROMOTIONAL, record:
 *   DR  Promotion Expense    [amount]
 *   CR  Gift Voucher Liability [amount]
 */
const recordPromotionalVoucherAccounting = async ({
  voucherId,
  amount,
  branchId,
  companyId,
  userId,
  voucherCode,
}) => {
  const { findAccountByNameAndGroup, ensureAccountExists, creditDebitLogHelper } = require("../controllers/accountingController");
  try {
    const Expense_AccountId = await ensureAccountExists(
      "Promotion Expense", "Expenses", "Expenses", "4000-004",
      "Promotion Expense account",
      companyId, branchId, userId || 1
    );

    const Voucher_AccountId = await ensureAccountExists(
      "Gift Voucher Liability", "Liabilities", "Liabilities", "2000-004",
      "Gift Voucher Liability account",
      companyId, branchId, userId || 1
    );

    if (Expense_AccountId) {
      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Expenses",
        amount: parseFloat(amount),
        description: `Promotional Gift Voucher issued: ${voucherCode}`,
        type: "Gift Voucher Promotion",
        accountId: Expense_AccountId,
        branchId,
        userId,
        companyId,
        transactionType: "debit",
      });
    }

    if (Voucher_AccountId) {
      await creditDebitLogHelper({
        accountType: "Chartered Account",
        group: "Liabilities",
        amount: parseFloat(amount),
        description: `Gift Voucher Liability — Promo: ${voucherCode}`,
        type: "Gift Voucher Promotion",
        accountId: Voucher_AccountId,
        branchId,
        userId,
        companyId,
        transactionType: "credit",
      });
    }

    return true;
  } catch (err) {
    console.error("[GiftVoucher] Promotional accounting error:", err);
    return false;
  }
};

module.exports = {
  getGiftVoucherSettings,
  saveGiftVoucherSettings,
  generateUniqueVoucherCode,
  issueGiftVoucher,
  batchGenerateVouchers,
  verifyVoucherForRedemption,
  claimVoucherForInvoice,
  revertVoucherRedemption,
  voidVoucher,
  getGiftVoucherList,
  getGiftVoucherDashboard,
  getGiftVoucherById,
  getUnlinkedVouchers,
  invoiceGiftVouchers,
  recordPromotionalVoucherAccounting,
};

