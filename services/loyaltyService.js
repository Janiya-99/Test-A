const db = require("../db/db");
const db2 = require("../db/db2");

// XP Thresholds
const XP_THRESHOLDS = {
  SILVER: 0,
  GOLD: 1000,
  PLATINUM: 5000,
  DIAMOND: 10000,
};

// XP Award Triggers
const XP_TRIGGERS = {
  DAILY_LOGIN: 50,
  INVOICE_CREATION: 100,
  GRN_CREATION: 150,
  APPOINTMENT_CREATION: 120,
};

/**
 * Calculates a user's loyalty tier based on current XP and subscription plan.
 * Handles auto-unlocks from plans and the gatekeeper locking mechanism.
 * 
 * @param {number|string} userId - ID of the user
 * @param {number} currentXp - Current accumulated XP of the user
 * @param {string} currentPlan - Current subscription plan ('Free Plan', 'Standard Plan', 'Professional Plan')
 * @returns {object} Calculated tier data, status, progress, locks, and CTAs
 */
const calculateUserTier = (userId, currentXp = 0, currentPlan = "Free Plan") => {
  const xp = Math.max(0, parseInt(currentXp) || 0);
  const plan = (currentPlan || "Free Plan").trim();

  // Normalize Plan names to detect Standard/Pro variants
  const isProPlan = /Professional|Pro/i.test(plan);
  const isStandardPlan = /Standard/i.test(plan) || isProPlan; // Pro also unlocks Standard benefits

  // Determine potential tier based solely on XP
  let potentialTier = "Silver";
  if (xp >= XP_THRESHOLDS.DIAMOND) {
    potentialTier = "Diamond";
  } else if (xp >= XP_THRESHOLDS.PLATINUM) {
    potentialTier = "Platinum";
  } else if (xp >= XP_THRESHOLDS.GOLD) {
    potentialTier = "Gold";
  }

  // Determine active tier based on XP, Plan auto-unlocks, and locks
  let activeTier = "Silver";
  let isLocked = false;
  let lockReason = null;

  if (isProPlan) {
    // Pro Plan: All tiers accessible. Active tier matches potential tier exactly based on XP.
    activeTier = potentialTier;
  } else if (isStandardPlan) {
    // Standard Plan: Capped at Platinum.
    if (potentialTier === "Diamond") {
      activeTier = "Platinum";
      isLocked = true;
      lockReason = "Upgrade to Professional Plan to unlock Diamond.";
    } else {
      activeTier = potentialTier;
    }
  } else {
    // Free Plan: Capped at Gold.
    if (potentialTier === "Diamond") {
      activeTier = "Gold";
      isLocked = true;
      lockReason = "Upgrade to Professional Plan to unlock Diamond.";
    } else if (potentialTier === "Platinum") {
      activeTier = "Gold";
      isLocked = true;
      lockReason = "Upgrade to Standard Plan to unlock Platinum.";
    } else {
      activeTier = potentialTier;
    }
  }

  // Next Tier Progression calculation
  let nextTierName = null;
  let xpRequired = 0;
  let xpNeeded = 0;
  let nextTierRequiredPlan = null;
  let isNextTierPlanLocked = false;

  if (activeTier === "Silver") {
    nextTierName = "Gold";
    xpRequired = XP_THRESHOLDS.GOLD;
    xpNeeded = Math.max(0, XP_THRESHOLDS.GOLD - xp);
  } else if (activeTier === "Gold") {
    nextTierName = "Platinum";
    xpRequired = XP_THRESHOLDS.PLATINUM;
    xpNeeded = Math.max(0, XP_THRESHOLDS.PLATINUM - xp);
    nextTierRequiredPlan = "Standard Plan";
    isNextTierPlanLocked = !isStandardPlan;
  } else if (activeTier === "Platinum") {
    nextTierName = "Diamond";
    xpRequired = XP_THRESHOLDS.DIAMOND;
    xpNeeded = Math.max(0, XP_THRESHOLDS.DIAMOND - xp);
    nextTierRequiredPlan = "Professional Plan";
    isNextTierPlanLocked = !isProPlan;
  }

  // Calculate percentage progress to next tier
  let progressPercentage = 100;
  if (activeTier !== "Diamond") {
    const currentTierFloor = XP_THRESHOLDS[activeTier.toUpperCase()] || 0;
    const nextTierCeil = XP_THRESHOLDS[nextTierName.toUpperCase()];
    const range = nextTierCeil - currentTierFloor;
    const progressInRange = xp - currentTierFloor;
    progressPercentage = Math.min(100, Math.max(0, Math.round((progressInRange / range) * 100)));
  }

  // Tiers layout structure with unlock state and plan details for UI mapping
  const tiersProgress = [
    {
      name: "Silver",
      xpRequired: XP_THRESHOLDS.SILVER,
      isUnlocked: true,
      isLockedByPlan: false,
      requiredPlan: null,
    },
    {
      name: "Gold",
      xpRequired: XP_THRESHOLDS.GOLD,
      isUnlocked: xp >= XP_THRESHOLDS.GOLD,
      isLockedByPlan: false,
      requiredPlan: null,
    },
    {
      name: "Platinum",
      xpRequired: XP_THRESHOLDS.PLATINUM,
      isUnlocked: isStandardPlan && xp >= XP_THRESHOLDS.PLATINUM,
      isLockedByPlan: !isStandardPlan,
      requiredPlan: "Standard Plan",
      lockMessage: "Upgrade to Standard Plan to unlock Platinum.",
    },
    {
      name: "Diamond",
      xpRequired: XP_THRESHOLDS.DIAMOND,
      isUnlocked: isProPlan && xp >= XP_THRESHOLDS.DIAMOND,
      isLockedByPlan: !isProPlan,
      requiredPlan: "Professional Plan",
      lockMessage: "Upgrade to Professional Plan to unlock Diamond.",
    },
  ];

  return {
    userId,
    currentXp: xp,
    currentPlan: plan,
    tier: activeTier,
    potentialTier,
    isLocked,
    lockReason,
    nextTier: nextTierName ? {
      name: nextTierName,
      xpRequired,
      xpNeeded,
      isPlanLocked: isNextTierPlanLocked,
      requiredPlan: nextTierRequiredPlan,
      lockMessage: nextTierRequiredPlan === "Standard Plan" 
        ? "Upgrade to Standard Plan to unlock Platinum."
        : "Upgrade to Professional Plan to unlock Diamond.",
    } : null,
    progressPercentage,
    tiersProgress,
  };
};

/**
 * Helper to fetch a user's subscription plan.
 * First checks the simulated `subscription_status` table in db.
 * If not found or Free, checks the real `companyhassoftware` table in db2 for the user's company.
 */
const getUserSubscriptionPlan = async (userId) => {
  
  // 1. Check for a simulated active plan in local subscription_status
  const simulatedPlanSql = `
    SELECT plan_name 
    FROM subscription_status 
    WHERE user_id = ? AND status = 'active'
    ORDER BY id DESC 
    LIMIT 1
  `;
  const simulatedPlan = await new Promise((resolve) => {
    db.query(simulatedPlanSql, [userId], (err, results) => {
      if (err || !results || results.length === 0) {
        resolve(null);
      } else {
        resolve(results[0].plan_name);
      }
    });
  });

  if (simulatedPlan !== null) {
    return simulatedPlan;
  }

  // 2. Fallback: Fetch the real plan from companyhassoftware in db2
  try {
    // Find Company ID associated with user
    const companyUserSql = `
      SELECT Company_idCompany 
      FROM company_has_asipiya_user 
      WHERE Asipiya_User_idAsipiya_User = ? AND Status = '1'
      LIMIT 1
    `;
    const companyId = await new Promise((resolve) => {
      db2.query(companyUserSql, [userId], (err, results) => {
        if (err || !results || results.length === 0) {
          resolve(null);
        } else {
          resolve(results[0].Company_idCompany);
        }
      });
    });

    if (companyId) {
      const realPlanSql = `
        SELECT plan_name 
        FROM companyhassoftware 
        WHERE company_id = ? AND software_id = 1
        LIMIT 1
      `;
      const realPlan = await new Promise((resolve) => {
        db2.query(realPlanSql, [companyId], (err, results) => {
          if (err || !results || results.length === 0) {
            resolve(null);
          } else {
            resolve(results[0].plan_name);
          }
        });
      });

      if (realPlan) {
        return realPlan;
      }
    }
  } catch (err) {
    console.error(`[LoyaltyService] Error checking real subscription for user ${userId}:`, err);
  }

  return simulatedPlan || "Free Plan";
};

/**
 * Awards XP to a user based on a specific trigger type, logging it and upserting the cumulative total.
 * 
 * @param {number|string} userId - User ID
 * @param {string} triggerType - One of 'DAILY_LOGIN', 'INVOICE_CREATION', 'GRN_CREATION', 'APPOINTMENT_CREATION'
 * @param {object} [connection] - Optional MySQL connection pool to run in an active transaction
 * @returns {Promise<object>} Current loyalty status after update
 */
const awardUserXp = async (userId, triggerType, connection = null) => {
  const queryExecutor = connection || db;
  const normalizedTrigger = triggerType.toUpperCase();
  const xpAmount = XP_TRIGGERS[normalizedTrigger];

  if (!xpAmount) {
    throw new Error(`Invalid trigger type: ${triggerType}`);
  }

  // 1. Insert detailed XP log
  const logSql = "INSERT INTO xp_logs (user_id, trigger_type, xp_awarded) VALUES (?, ?, ?)";
  await new Promise((resolve, reject) => {
    queryExecutor.query(logSql, [userId, triggerType.toLowerCase(), xpAmount], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });

  // 2. Upsert cumulative total in user_loyalty
  const upsertSql = `
    INSERT INTO user_loyalty (user_id, current_xp) 
    VALUES (?, ?) 
    ON DUPLICATE KEY UPDATE current_xp = current_xp + ?, updated_at = CURRENT_TIMESTAMP
  `;
  await new Promise((resolve, reject) => {
    queryExecutor.query(upsertSql, [userId, xpAmount, xpAmount], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });

  // 3. Fetch cumulative total
  const selectSql = "SELECT current_xp FROM user_loyalty WHERE user_id = ? LIMIT 1";
  const updatedXp = await new Promise((resolve, reject) => {
    queryExecutor.query(selectSql, [userId], (err, results) => {
      if (err) reject(err);
      else resolve(results && results.length ? results[0].current_xp : xpAmount);
    });
  });

  // 4. Fetch subscription status / plan (using our smart helper)
  const currentPlan = await getUserSubscriptionPlan(userId);

  const status = calculateUserTier(userId, updatedXp, currentPlan);

  // Fetch recent XP logs
  const logsSql = `
    SELECT id, trigger_type as label, xp_awarded as xp, created_at as timestamp
    FROM xp_logs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 5
  `;
  const recentLogs = await new Promise((resolve, reject) => {
    queryExecutor.query(logsSql, [userId], (err, results) => {
      if (err) reject(err);
      else {
        const mapped = (results || []).map((row) => {
          let label = "Activity Award";
          if (row.label === "daily_login") label = "Daily Login";
          else if (row.label === "invoice_creation") label = "Create Invoice";
          else if (row.label === "grn_creation") label = "Create GRN Note";
          else if (row.label === "appointment_creation") label = "Create Appointment";
          
          const ts = new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return {
            id: row.id,
            label,
            xp: row.xp,
            timestamp: ts
          };
        });
        resolve(mapped);
      }
    });
  });
  status.logs = recentLogs;
  return status;
};

/**
 * Retrieves the current loyalty status for a user.
 * 
 * @param {number|string} userId - User ID
 * @returns {Promise<object>} Current loyalty status
 */
const getUserLoyaltyStatus = async (userId, planName = null) => {
  // Fetch XP
  const selectSql = "SELECT current_xp FROM user_loyalty WHERE user_id = ? LIMIT 1";
  const currentXp = await new Promise((resolve, reject) => {
    db.query(selectSql, [userId], (err, results) => {
      if (err) reject(err);
      else resolve(results && results.length ? results[0].current_xp : 0);
    });
  });

  // Fetch active plan (using our smart helper, falling back if planName is not passed from frontend)
  const currentPlan = planName || await getUserSubscriptionPlan(userId);

  // Fetch recent XP logs
  const logsSql = `
    SELECT id, trigger_type as label, xp_awarded as xp, created_at as timestamp
    FROM xp_logs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 5
  `;
  const recentLogs = await new Promise((resolve, reject) => {
    db.query(logsSql, [userId], (err, results) => {
      if (err) reject(err);
      else {
        const mapped = (results || []).map((row) => {
          let label = "Activity Award";
          if (row.label === "daily_login") label = "Daily Login";
          else if (row.label === "invoice_creation") label = "Create Invoice";
          else if (row.label === "grn_creation") label = "Create GRN Note";
          else if (row.label === "appointment_creation") label = "Create Appointment";
          
          const ts = new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return {
            id: row.id,
            label,
            xp: row.xp,
            timestamp: ts
          };
        });
        resolve(mapped);
      }
    });
  });

  const status = calculateUserTier(userId, currentXp, currentPlan);
  status.logs = recentLogs;
  return status;
};

module.exports = {
  XP_THRESHOLDS,
  XP_TRIGGERS,
  calculateUserTier,
  awardUserXp,
  getUserLoyaltyStatus,
};
