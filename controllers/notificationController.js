const db2 = require("../db/db2");

/** ----------------- HELPERS (dates) ----------------- **/
const toDate = (val) => {
  if (!val) return null;
  const s = String(val).trim().replace(/\//g, "-");
  // dd-mm-yyyy -> yyyy-mm-dd
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
  if (ddmmyyyy.test(s)) {
    const [, dd, mm, yyyy] = s.match(ddmmyyyy);
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const subCache = new Map();
const SUB_CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Fetch subscription notifications for a given company ID.
 * Returns an array of message strings.
 */
const getSubscriptionNotifications = async (companyId) => {
  if (!companyId) return [];

  const nowMs = Date.now();
  const cached = subCache.get(companyId);
  if (cached && (nowMs - cached.timestamp < SUB_CACHE_TTL)) {
    return cached.data;
  }

  // Use db2 which connects to asipbook_account_center
  const sql = `
      SELECT plan_name, Payment_Status, Trial_Expire_On, Pro_Expire_On, Grace_Period_Expire_On
      FROM companyhassoftware
      WHERE company_id = ?
    `;

  try {
    const [rows] = await db2.promise().query(sql, [companyId]);
    const messages = [];
    const msPerDay = 24 * 60 * 60 * 1000;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    rows.forEach((r) => {
      const status = (r.Payment_Status || "").toLowerCase();
      let expiry = null;

      if (status === "demo" || status === "trial")
        expiry = toDate(r.Trial_Expire_On);
      else if (status === "normal") expiry = toDate(r.Pro_Expire_On);
      else if (status === "grace period")
        expiry = toDate(r.Grace_Period_Expire_On);
      else if (status === "expired") {
        const ex =
          toDate(r.Pro_Expire_On) ||
          toDate(r.Grace_Period_Expire_On) ||
          toDate(r.Trial_Expire_On);
        if (ex && ex < today) {
          messages.push(
            `${r.plan_name || "Your plan"} expired on ${fmt(
              ex,
            )}. Please renew to continue using the software.`,
          );
        }
        return;
      }

      if (!expiry || isNaN(expiry.getTime())) return;

      const expiryDay = new Date(
        expiry.getFullYear(),
        expiry.getMonth(),
        expiry.getDate(),
      );
      const diffDays = Math.ceil((expiryDay - today) / msPerDay);

      if (diffDays >= 0 && diffDays <= 3) {
        if (diffDays === 0) {
          messages.push(
            `Your current plan is "${r.plan_name || "your plan"}"${
              r.Payment_Status ? ` (status: ${r.Payment_Status})` : ""
            }. It expires today (${fmt(
              expiry,
            )}). Please renew to avoid interruption.`,
          );
        } else if (diffDays === 1) {
          messages.push(
            `Your current plan is "${r.plan_name || "your plan"}"${
              r.Payment_Status ? ` (status: ${r.Payment_Status})` : ""
            }. It expires tomorrow (${fmt(expiry)}). Please renew promptly.`,
          );
        } else {
          messages.push(
            `Your current plan is "${r.plan_name || "your plan"}"${
              r.Payment_Status ? ` (status: ${r.Payment_Status})` : ""
            }. It will expire in ${diffDays} days on ${fmt(
              expiry,
            )}. Please renew to continue using the software.`,
          );
        }
      }
    });

    subCache.set(companyId, { timestamp: nowMs, data: messages });
    return messages;
  } catch (error) {
    console.error("Error fetching subscription notifications:", error);
    return [];
  }
};

module.exports = { getSubscriptionNotifications };
