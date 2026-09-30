const db = require("../db/db");
const db2 = require("../db/db2"); // Account center database where companyhassoftware is located
const invoiceDBService = require("../services/invoiceDBService");
const quotationDBService = require("../services/quotaionDBService");
const posDBService = require("../services/posDBService");
const branchDBService = require("../services/branchDBService");

/**
 * Calculate which month the company is in since purchase date
 * @param {string} purchasedDate - Date in format 'YYYY-MM-DD' or other parseable format
 * @returns {number} Month number (1, 2, 3, 4, 5, etc.)
 */
const getMonthFromPurchaseDate = (purchasedDate) => {
  if (!purchasedDate || purchasedDate === "-" || purchasedDate === "NULL") {
    return 1; // Default to month 1 if no purchase date
  }

  const purchaseDate = new Date(purchasedDate);
  const currentDate = new Date();

  // Calculate the difference in months
  let yearDiff = currentDate.getFullYear() - purchaseDate.getFullYear();
  let monthDiff = currentDate.getMonth() - purchaseDate.getMonth();
  let totalMonthsDiff = yearDiff * 12 + monthDiff;

  // If today's day is less than purchase day, the current billing month hasn't completed
  // Example: Purchased Dec 3, today is Jan 2. totalMonthsDiff is 1, but it's still Month 1.
  if (currentDate.getDate() < purchaseDate.getDate()) {
    totalMonthsDiff--;
  }

  // Month 1: 0 months difference
  // Month 2: 1 month difference
  // etc.
  return totalMonthsDiff + 1;
};

/**
 * Get the date range for the current month from purchase date
 * @param {string} purchasedDate - Purchase date
 * @returns {object} { startDate, endDate }
 */
const getCurrentMonthRange = (purchasedDate) => {
  if (!purchasedDate || purchasedDate === "-" || purchasedDate === "NULL") {
    // If no purchase date, use current calendar month
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
  }

  const purchaseDate = new Date(purchasedDate);
  const currentDate = new Date();

  // Calculate which month we're in
  const monthNumber = getMonthFromPurchaseDate(purchasedDate);

  // Calculate start date (purchase date + (monthNumber - 1) months)
  const startDate = new Date(purchaseDate);
  startDate.setMonth(startDate.getMonth() + (monthNumber - 1));

  // Calculate end date (start date + 1 month - 1 day)
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);
  endDate.setDate(endDate.getDate() - 1);

  // If endDate is in the future, use current date
  if (endDate > currentDate) {
    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: currentDate.toISOString().split("T")[0],
    };
  }

  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
};

/**
 * Get the limit for a given month and type
 * @param {number} monthNumber - Month number (1, 2, 3, 4, 5, etc.)
 * @param {string} type - Type: 'invoice', 'quotation', or 'pos'
 * @returns {number} The limit for that month
 */
const getLimitForMonth = (monthNumber, type) => {
  // Only apply tiers for months 1-3, then stay at month 4 limit (15)
  const cappedMonth = monthNumber > 4 ? 4 : monthNumber;

  const limits = {
    1: 500,
    2: 300,
    3: 100,
    4: 10,
  };

  return limits[cappedMonth] || 10; // Default to month 4 limit
};

/**
 * Check if a company has exceeded their plan limit
 * @param {number} companyId - Company ID
 * @param {string} type - Type: 'invoice', 'quotation', or 'pos'
 * @param {number} branchId - Branch ID
 * @returns {Promise<object>} { allowed: boolean, limit: number, current: number, remaining: number, plan: string, month: number }
 */
const checkPlanLimit = async (companyId, type, branchId) => {
  try {
    console.log(
      `[PLAN LIMIT CHECK] Starting check for company ${companyId}, type: ${type}, branch: ${branchId}`,
    );

    // Get plan details from companyhassoftware
    const query = `
      SELECT plan_name, Purchased_Date 
      FROM companyhassoftware 
      WHERE company_id = ? 
      ORDER BY id DESC 
      LIMIT 1
    `;

    const planDetails = await new Promise((resolve, reject) => {
      db2.query(query, [companyId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    console.log(`[PLAN LIMIT CHECK] Plan details fetched:`, planDetails);

    // If no plan details found or not a Free plan, allow unlimited
    if (!planDetails || planDetails.length === 0) {
      console.log(
        `[PLAN LIMIT CHECK] No plan details found for company ${companyId}, allowing unlimited`,
      );
      return {
        allowed: true,
        limit: -1,
        current: 0,
        remaining: -1,
        plan: "unknown",
        month: 0,
      };
    }

    const { plan_name, Purchased_Date } = planDetails[0];
    console.log(
      `[PLAN LIMIT CHECK] Plan: ${plan_name}, Purchase Date: ${Purchased_Date}`,
    );

    // Only apply limits to Free plans (e.g., "Free - Monthly", "Free - Yearly")
    if (!plan_name.startsWith("Free")) {
      console.log(
        `[PLAN LIMIT CHECK] Plan is not Free (${plan_name}), allowing unlimited`,
      );
      return {
        allowed: true,
        limit: -1,
        current: 0,
        remaining: -1,
        plan: plan_name,
        month: 0,
      };
    }

    // Calculate current month from purchase date
    const monthNumber = getMonthFromPurchaseDate(Purchased_Date);
    const limit = getLimitForMonth(monthNumber, type);
    console.log(
      `[PLAN LIMIT CHECK] Actual Month ${monthNumber}, Applied Limit: ${limit}`,
    );

    // Get date range for current month
    const { startDate, endDate } = getCurrentMonthRange(Purchased_Date);
    console.log(`[PLAN LIMIT CHECK] Date range: ${startDate} to ${endDate}`);

    // Get current usage count based on type
    let currentCount = 0;

    switch (type) {
      case "invoice":
        currentCount = await invoiceDBService.getInvoiceCountForMonth(
          companyId,
          startDate,
          endDate,
        );
        break;
      case "quotation":
        currentCount = await quotationDBService.getQuotationCountForMonth(
          companyId,
          startDate,
          endDate,
        );
        break;
      case "pos":
        currentCount = await posDBService.getPosCountForMonth(
          companyId,
          startDate,
          endDate,
        );
        break;
      default:
        throw new Error(`Invalid type: ${type}`);
    }

    console.log(
      `[PLAN LIMIT CHECK] Current count: ${currentCount}, Limit: ${limit}`,
    );

    const remaining = Math.max(0, limit - currentCount);
    const allowed = currentCount < limit;

    console.log(
      `[PLAN LIMIT CHECK] DECISION: ${allowed ? "ALLOWED" : "BLOCKED"} - Current: ${currentCount}, Limit: ${limit}, Remaining: ${remaining}`,
    );

    return {
      allowed,
      limit,
      current: currentCount,
      remaining,
      plan: plan_name,
      month: monthNumber,
    };
  } catch (error) {
    console.error("Error checking plan limit:", error);
    // In case of error, allow the operation to proceed
    return {
      allowed: true,
      limit: -1,
      current: 0,
      remaining: -1,
      plan: "error",
      month: 0,
      error: error.message,
    };
  }
};

module.exports = {
  getMonthFromPurchaseDate,
  getLimitForMonth,
  checkPlanLimit,
  getCurrentMonthRange,
};
