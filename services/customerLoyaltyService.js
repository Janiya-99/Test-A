const db = require("../db/db");
const crypto = require("crypto");
const smsService = require("./smsService");
const transporter = require("../utils/emailTransporter");

/**
 * Customer Loyalty & Points Service
 * Handles multi-tenant SaaS loyalty points calculations, settings, customer ledgers, and dashboard aggregation.
 */

// Default settings when not configured yet for a branch
const DEFAULT_SETTINGS = {
  earn_point_type: "spend_ratio", // 'spend_ratio', 'fixed_per_bill', 'percentage'
  spend_amount_per_point: 100.0,
  points_per_spend: 1.0,
  fixed_points_per_bill: 10.0,
  min_bill_amount_to_earn: 0.0,
  max_points_per_bill: 0.0, // 0 = unlimited
  redemption_point_value: 1.0, // 1 point = 1.00 currency unit
  min_points_to_redeem: 50.0,
  max_redemption_percentage: 50.0,
  max_points_per_redemption: 0.0,
  points_expiry_days: 365,
  enable_tier_system: 1,
  tier_bronze_min_points: 0,
  tier_silver_min_points: 500,
  tier_gold_min_points: 2000,
  tier_platinum_min_points: 5000,
  tier_silver_multiplier: 1.1,
  tier_gold_multiplier: 1.25,
  tier_platinum_multiplier: 1.5,
  terms_and_conditions:
    "Earn loyalty points on qualifying purchases. Points can be redeemed for discounts on future invoices. Points expire after 365 days of inactivity.",
};

// Helper to resolve company ID for a branch
const getCompanyId = (branchId) => {
  return new Promise((resolve) => {
    const query = "SELECT Company_idCompany FROM branch WHERE idBranch = ?";
    db.query(query, [branchId], (err, rows) => {
      if (!err && rows && rows.length > 0) {
        resolve(rows[0].Company_idCompany);
      } else {
        resolve(null);
      }
    });
  });
};

/**
 * Get Loyalty Settings for a branch
 */
const getLoyaltySettings = async (branchId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM loyalty_settings WHERE branch_id = ?";
    db.query(query, [branchId], async (err, rows) => {
      if (err) return reject(err);
      if (rows && rows.length > 0) {
        return resolve(rows[0]);
      }

      // If no branch settings, return defaults with resolved companyId
      const companyId = await getCompanyId(branchId);
      resolve({
        ...DEFAULT_SETTINGS,
        branch_id: Number(branchId),
        company_id: companyId,
      });
    });
  });
};

/**
 * Save or update Loyalty Settings
 */
const saveLoyaltySettings = async (branchId, data) => {
  const companyId = data.company_id || (await getCompanyId(branchId));

  const settings = {
    branch_id: Number(branchId),
    company_id: companyId,
    earn_point_type: data.earn_point_type || DEFAULT_SETTINGS.earn_point_type,
    spend_amount_per_point:
      parseFloat(data.spend_amount_per_point) || DEFAULT_SETTINGS.spend_amount_per_point,
    points_per_spend:
      parseFloat(data.points_per_spend) || DEFAULT_SETTINGS.points_per_spend,
    fixed_points_per_bill:
      parseFloat(data.fixed_points_per_bill) || DEFAULT_SETTINGS.fixed_points_per_bill,
    min_bill_amount_to_earn:
      parseFloat(data.min_bill_amount_to_earn) || 0.0,
    max_points_per_bill:
      parseFloat(data.max_points_per_bill) || 0.0,
    redemption_point_value:
      parseFloat(data.redemption_point_value) || DEFAULT_SETTINGS.redemption_point_value,
    min_points_to_redeem:
      parseFloat(data.min_points_to_redeem) || DEFAULT_SETTINGS.min_points_to_redeem,
    max_redemption_percentage:
      parseFloat(data.max_redemption_percentage) || DEFAULT_SETTINGS.max_redemption_percentage,
    max_points_per_redemption:
      parseFloat(data.max_points_per_redemption) || 0.0,
    points_expiry_days:
      parseInt(data.points_expiry_days, 10) ?? DEFAULT_SETTINGS.points_expiry_days,
    enable_tier_system:
      data.enable_tier_system === 0 || data.enable_tier_system === false ? 0 : 1,
    tier_bronze_min_points:
      parseInt(data.tier_bronze_min_points, 10) || 0,
    tier_silver_min_points:
      parseInt(data.tier_silver_min_points, 10) || 500,
    tier_gold_min_points:
      parseInt(data.tier_gold_min_points, 10) || 2000,
    tier_platinum_min_points:
      parseInt(data.tier_platinum_min_points, 10) || 5000,
    tier_silver_multiplier:
      parseFloat(data.tier_silver_multiplier) || 1.1,
    tier_gold_multiplier:
      parseFloat(data.tier_gold_multiplier) || 1.25,
    tier_platinum_multiplier:
      parseFloat(data.tier_platinum_multiplier) || 1.5,
    terms_and_conditions:
      data.terms_and_conditions || DEFAULT_SETTINGS.terms_and_conditions,
  };

  const sql = `
    INSERT INTO loyalty_settings (
      branch_id, company_id, earn_point_type, spend_amount_per_point, points_per_spend,
      fixed_points_per_bill, min_bill_amount_to_earn, max_points_per_bill,
      redemption_point_value, min_points_to_redeem, max_redemption_percentage,
      max_points_per_redemption, points_expiry_days, enable_tier_system,
      tier_bronze_min_points, tier_silver_min_points, tier_gold_min_points, tier_platinum_min_points,
      tier_silver_multiplier, tier_gold_multiplier, tier_platinum_multiplier, terms_and_conditions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      company_id = VALUES(company_id),
      earn_point_type = VALUES(earn_point_type),
      spend_amount_per_point = VALUES(spend_amount_per_point),
      points_per_spend = VALUES(points_per_spend),
      fixed_points_per_bill = VALUES(fixed_points_per_bill),
      min_bill_amount_to_earn = VALUES(min_bill_amount_to_earn),
      max_points_per_bill = VALUES(max_points_per_bill),
      redemption_point_value = VALUES(redemption_point_value),
      min_points_to_redeem = VALUES(min_points_to_redeem),
      max_redemption_percentage = VALUES(max_redemption_percentage),
      max_points_per_redemption = VALUES(max_points_per_redemption),
      points_expiry_days = VALUES(points_expiry_days),
      enable_tier_system = VALUES(enable_tier_system),
      tier_bronze_min_points = VALUES(tier_bronze_min_points),
      tier_silver_min_points = VALUES(tier_silver_min_points),
      tier_gold_min_points = VALUES(tier_gold_min_points),
      tier_platinum_min_points = VALUES(tier_platinum_min_points),
      tier_silver_multiplier = VALUES(tier_silver_multiplier),
      tier_gold_multiplier = VALUES(tier_gold_multiplier),
      tier_platinum_multiplier = VALUES(tier_platinum_multiplier),
      terms_and_conditions = VALUES(terms_and_conditions)
  `;

  const values = [
    settings.branch_id,
    settings.company_id,
    settings.earn_point_type,
    settings.spend_amount_per_point,
    settings.points_per_spend,
    settings.fixed_points_per_bill,
    settings.min_bill_amount_to_earn,
    settings.max_points_per_bill,
    settings.redemption_point_value,
    settings.min_points_to_redeem,
    settings.max_redemption_percentage,
    settings.max_points_per_redemption,
    settings.points_expiry_days,
    settings.enable_tier_system,
    settings.tier_bronze_min_points,
    settings.tier_silver_min_points,
    settings.tier_gold_min_points,
    settings.tier_platinum_min_points,
    settings.tier_silver_multiplier,
    settings.tier_gold_multiplier,
    settings.tier_platinum_multiplier,
    settings.terms_and_conditions,
  ];

  return new Promise((resolve, reject) => {
    db.query(sql, values, (err, result) => {
      if (err) return reject(err);
      resolve({ success: true, settings });
    });
  });
};

/**
 * Determine Tier based on lifetime points and settings
 */
const determineTier = (lifetimePoints, settings = DEFAULT_SETTINGS) => {
  const points = parseFloat(lifetimePoints) || 0;
  if (!settings.enable_tier_system) {
    return {
      tier: "Standard",
      multiplier: 1.0,
      nextTier: null,
      progressPercentage: 100,
    };
  }

  const pPlat = settings.tier_platinum_min_points || 5000;
  const pGold = settings.tier_gold_min_points || 2000;
  const pSilv = settings.tier_silver_min_points || 500;

  if (points >= pPlat) {
    return {
      tier: "Platinum",
      multiplier: parseFloat(settings.tier_platinum_multiplier) || 1.5,
      nextTier: null,
      pointsNeeded: 0,
      progressPercentage: 100,
    };
  } else if (points >= pGold) {
    const range = pPlat - pGold;
    const progress = Math.min(100, Math.round(((points - pGold) / range) * 100));
    return {
      tier: "Gold",
      multiplier: parseFloat(settings.tier_gold_multiplier) || 1.25,
      nextTier: "Platinum",
      pointsNeeded: pPlat - points,
      progressPercentage: progress,
    };
  } else if (points >= pSilv) {
    const range = pGold - pSilv;
    const progress = Math.min(100, Math.round(((points - pSilv) / range) * 100));
    return {
      tier: "Silver",
      multiplier: parseFloat(settings.tier_silver_multiplier) || 1.1,
      nextTier: "Gold",
      pointsNeeded: pGold - points,
      progressPercentage: progress,
    };
  } else {
    const range = pSilv;
    const progress = Math.min(100, Math.round((points / range) * 100));
    return {
      tier: "Bronze",
      multiplier: 1.0,
      nextTier: "Silver",
      pointsNeeded: pSilv - points,
      progressPercentage: progress,
    };
  }
};

/**
 * Calculate earned points for a given bill total
 */
const calculateEarnedPoints = (billAmount, currentTier = "Bronze", settings = DEFAULT_SETTINGS) => {
  const amount = parseFloat(billAmount) || 0;
  if (amount <= 0 || amount < (parseFloat(settings.min_bill_amount_to_earn) || 0)) {
    return 0;
  }

  let basePoints = 0;
  const earnType = settings.earn_point_type || "spend_ratio";

  if (earnType === "fixed_per_bill") {
    basePoints = parseFloat(settings.fixed_points_per_bill) || 0;
  } else if (earnType === "percentage") {
    const pct = parseFloat(settings.points_per_spend) || 1.0;
    basePoints = (amount * pct) / 100;
  } else {
    // spend_ratio (e.g. 1 point for every 100 spent)
    const spendUnit = parseFloat(settings.spend_amount_per_point) || 100;
    const pointsPerUnit = parseFloat(settings.points_per_spend) || 1;
    basePoints = Math.floor(amount / spendUnit) * pointsPerUnit;
  }

  // Tier multiplier
  let multiplier = 1.0;
  if (settings.enable_tier_system) {
    if (currentTier === "Platinum") multiplier = parseFloat(settings.tier_platinum_multiplier) || 1.5;
    else if (currentTier === "Gold") multiplier = parseFloat(settings.tier_gold_multiplier) || 1.25;
    else if (currentTier === "Silver") multiplier = parseFloat(settings.tier_silver_multiplier) || 1.1;
  }

  let finalPoints = Math.round(basePoints * multiplier * 100) / 100;

  // Max points cap per bill
  const maxCap = parseFloat(settings.max_points_per_bill) || 0;
  if (maxCap > 0 && finalPoints > maxCap) {
    finalPoints = maxCap;
  }

  return finalPoints;
};

/**
 * Fetch complete Customer Loyalty Profile & recent transactions
 */
const getCustomerLoyaltyProfile = async (customerId, branchId = null) => {
  return new Promise((resolve, reject) => {
    // 1. Fetch customer details
    const custSql = `
      SELECT idCustomer, Title, First_Name, middleName, lastName, displayName,
             phoneNumber, mobileNumber, companyEmail, officialEmail, Branch_idBranch, profileImage
      FROM customer WHERE idCustomer = ?
    `;

    db.query(custSql, [customerId], async (err, custRows) => {
      if (err) return reject(err);
      if (!custRows || custRows.length === 0) {
        return reject(new Error("Customer not found"));
      }

      const customer = custRows[0];
      const effectiveBranchId = branchId || customer.Branch_idBranch;

      // 2. Fetch or initialize customer_loyalty record
      const loyaltySql = `SELECT * FROM customer_loyalty WHERE customer_id = ?`;
      db.query(loyaltySql, [customerId], async (err2, loyaltyRows) => {
        if (err2) return reject(err2);

        const settings = await getLoyaltySettings(effectiveBranchId);

        let loyaltyData = null;
        if (loyaltyRows && loyaltyRows.length > 0) {
          loyaltyData = loyaltyRows[0];
        } else {
          // Default empty record
          loyaltyData = {
            customer_id: customerId,
            branch_id: effectiveBranchId,
            company_id: await getCompanyId(effectiveBranchId),
            current_points: 0.0,
            lifetime_points_earned: 0.0,
            lifetime_points_redeemed: 0.0,
            current_tier: "Bronze",
            last_activity_date: null,
          };
        }

        const tierInfo = determineTier(loyaltyData.lifetime_points_earned, settings);
        const pointValue = parseFloat(settings.redemption_point_value) || 1.0;
        const currentPoints = parseFloat(loyaltyData.current_points) || 0.0;
        const equivalentValue = Math.round(currentPoints * pointValue * 100) / 100;

        // 3. Fetch recent transaction ledger logs
        const logsSql = `
          SELECT id, invoice_id, transaction_type, points, points_balance_after,
                 bill_amount, reference_note, created_at
          FROM customer_loyalty_logs
          WHERE customer_id = ?
          ORDER BY id DESC
          LIMIT 50
        `;

        db.query(logsSql, [customerId], (err3, logsRows) => {
          if (err3) return reject(err3);

          resolve({
            customer: {
              id: customer.idCustomer,
              name:
                customer.displayName ||
                [customer.Title, customer.First_Name, customer.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                "Valued Customer",
              phone: customer.mobileNumber || customer.phoneNumber || "-",
              email: customer.companyEmail || customer.officialEmail || "-",
              profileImage: customer.profileImage,
              branchId: customer.Branch_idBranch,
            },
            loyalty: {
              currentPoints,
              equivalentValue,
              lifetimeEarned: parseFloat(loyaltyData.lifetime_points_earned) || 0.0,
              lifetimeRedeemed: parseFloat(loyaltyData.lifetime_points_redeemed) || 0.0,
              tier: tierInfo.tier,
              tierMultiplier: tierInfo.multiplier,
              nextTier: tierInfo.nextTier,
              pointsNeeded: tierInfo.pointsNeeded,
              progressPercentage: tierInfo.progressPercentage,
              lastActivityDate: loyaltyData.last_activity_date,
              settings: {
                pointValue,
                minPointsToRedeem: parseFloat(settings.min_points_to_redeem) || 50,
                maxRedemptionPercentage: parseFloat(settings.max_redemption_percentage) || 50,
              },
            },
            transactions: logsRows || [],
          });
        });
      });
    });
  });
};

/**
 * Manually adjust points (credit or debit) for a customer
 */
const adjustCustomerPoints = async ({
  customerId,
  branchId,
  points,
  type, // 'MANUAL_ADD' or 'MANUAL_DEDUCT'
  note = "",
  userId = null,
}) => {
  const pts = Math.abs(parseFloat(points));
  if (!pts || pts <= 0) {
    throw new Error("Points amount must be greater than 0");
  }

  if (type !== "MANUAL_ADD" && type !== "MANUAL_DEDUCT") {
    throw new Error("Adjustment type must be MANUAL_ADD or MANUAL_DEDUCT");
  }

  const companyId = await getCompanyId(branchId);
  const settings = await getLoyaltySettings(branchId);

  return new Promise((resolve, reject) => {
    db.getConnection((connErr, connection) => {
      if (connErr) return reject(connErr);

      connection.beginTransaction(async (txErr) => {
        if (txErr) {
          connection.release();
          return reject(txErr);
        }

        try {
          // 1. Get or create customer loyalty record with lock
          const selectSql = `SELECT * FROM customer_loyalty WHERE customer_id = ? FOR UPDATE`;
          connection.query(selectSql, [customerId], (err, rows) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                reject(err);
              });
            }

            let currentPoints = 0.0;
            let lifetimeEarned = 0.0;
            let lifetimeRedeemed = 0.0;
            let exists = false;

            if (rows && rows.length > 0) {
              exists = true;
              currentPoints = parseFloat(rows[0].current_points) || 0.0;
              lifetimeEarned = parseFloat(rows[0].lifetime_points_earned) || 0.0;
              lifetimeRedeemed = parseFloat(rows[0].lifetime_points_redeemed) || 0.0;
            }

            let newBalance = currentPoints;
            let finalDelta = pts;

            if (type === "MANUAL_ADD") {
              newBalance = currentPoints + pts;
              lifetimeEarned += pts;
            } else {
              // Deduct
              if (pts > currentPoints) {
                return connection.rollback(() => {
                  connection.release();
                  reject(new Error(`Cannot deduct ${pts} points. Current balance is only ${currentPoints}`));
                });
              }
              newBalance = currentPoints - pts;
              lifetimeRedeemed += pts;
              finalDelta = -pts;
            }

            const tierInfo = determineTier(lifetimeEarned, settings);

            const upsertSql = exists
              ? `UPDATE customer_loyalty SET current_points = ?, lifetime_points_earned = ?, lifetime_points_redeemed = ?, current_tier = ?, last_activity_date = NOW() WHERE customer_id = ?`
              : `INSERT INTO customer_loyalty (customer_id, branch_id, company_id, current_points, lifetime_points_earned, lifetime_points_redeemed, current_tier, last_activity_date) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;

            const upsertParams = exists
              ? [newBalance, lifetimeEarned, lifetimeRedeemed, tierInfo.tier, customerId]
              : [customerId, branchId, companyId, newBalance, lifetimeEarned, lifetimeRedeemed, tierInfo.tier];

            connection.query(upsertSql, upsertParams, (err2) => {
              if (err2) {
                return connection.rollback(() => {
                  connection.release();
                  reject(err2);
                });
              }

              // Insert transaction log
              const logSql = `
                INSERT INTO customer_loyalty_logs (
                  customer_id, branch_id, company_id, invoice_id,
                  transaction_type, points, points_balance_after,
                  bill_amount, reference_note, created_by
                ) VALUES (?, ?, ?, NULL, ?, ?, ?, 0.00, ?, ?)
              `;

              connection.query(
                logSql,
                [customerId, branchId, companyId, type, finalDelta, newBalance, note || "Manual adjustment", userId],
                (err3) => {
                  if (err3) {
                    return connection.rollback(() => {
                      connection.release();
                      reject(err3);
                    });
                  }

                  connection.commit((commitErr) => {
                    if (commitErr) {
                      return connection.rollback(() => {
                        connection.release();
                        reject(commitErr);
                      });
                    }

                    connection.release();
                    resolve({
                      success: true,
                      newBalance,
                      tier: tierInfo.tier,
                      transactionType: type,
                      points: finalDelta,
                    });
                  });
                }
              );
            });
          });
        } catch (e) {
          connection.rollback(() => {
            connection.release();
            reject(e);
          });
        }
      });
    });
  });
};

/**
 * Automatically award loyalty points when an invoice is created/paid
 */
const awardPointsForInvoice = async ({
  customerId,
  invoiceId,
  invoiceNumber,
  totalAmount,
  branchId,
  userId = null,
}) => {
  if (!customerId || !branchId) return null;

  try {
    // 1. Verify loyalty is enabled in branch rules
    const rulesCheckSql = "SELECT enable_loyalty FROM rules WHERE Branch_idBranch = ?";
    const rulesRes = await new Promise((res, rej) => {
      db.query(rulesCheckSql, [branchId], (err, rows) => {
        if (err) return rej(err);
        res(rows);
      });
    });

    if (!rulesRes || rulesRes.length === 0 || Number(rulesRes[0].enable_loyalty) !== 1) {
      console.log(`[CustomerLoyalty] Loyalty disabled for branch ${branchId}. Skipping points award.`);
      return null;
    }

    const settings = await getLoyaltySettings(branchId);
    const companyId = await getCompanyId(branchId);

    // 2. Prevent duplicate awards if this invoice was already processed
    if (invoiceId) {
      const existingAward = await new Promise((res, rej) => {
        db.query(
          "SELECT id FROM customer_loyalty_logs WHERE invoice_id = ? AND transaction_type = 'EARNED'",
          [invoiceId],
          (err, rows) => (err ? rej(err) : res(rows))
        );
      });
      if (existingAward && existingAward.length > 0) {
        console.log(`[CustomerLoyalty] Points already awarded for invoice #${invoiceNumber || invoiceId}`);
        return { success: true, alreadyAwarded: true };
      }
    }

    // 3. Fetch current customer tier
    const custLoyaltyRes = await new Promise((res, rej) => {
      db.query("SELECT * FROM customer_loyalty WHERE customer_id = ?", [customerId], (err, rows) => {
        if (err) return rej(err);
        res(rows);
      });
    });

    const currentTier = custLoyaltyRes && custLoyaltyRes.length > 0 ? custLoyaltyRes[0].current_tier : "Bronze";
    const earnedPoints = calculateEarnedPoints(totalAmount, currentTier, settings);

    if (earnedPoints <= 0) {
      console.log(`[CustomerLoyalty] 0 points calculated for invoice #${invoiceNumber} (Amount: ${totalAmount})`);
      return null;
    }

    // 3. Credit points to customer in customer_loyalty and customer_loyalty_logs
    let currentBalance = 0;
    let lifetimeEarned = 0;
    let lifetimeRedeemed = 0;
    const exists = custLoyaltyRes && custLoyaltyRes.length > 0;

    if (exists) {
      currentBalance = parseFloat(custLoyaltyRes[0].current_points) || 0;
      lifetimeEarned = parseFloat(custLoyaltyRes[0].lifetime_points_earned) || 0;
      lifetimeRedeemed = parseFloat(custLoyaltyRes[0].lifetime_points_redeemed) || 0;
    }

    const newBalance = currentBalance + earnedPoints;
    const newLifetimeEarned = lifetimeEarned + earnedPoints;
    const newTierInfo = determineTier(newLifetimeEarned, settings);

    if (exists) {
      await new Promise((res, rej) => {
        db.query(
          `UPDATE customer_loyalty 
           SET current_points = current_points + ?, 
               lifetime_points_earned = lifetime_points_earned + ?, 
               current_tier = ?, 
               last_activity_date = NOW() 
           WHERE customer_id = ?`,
          [earnedPoints, earnedPoints, newTierInfo.tier, customerId],
          (err) => (err ? rej(err) : res())
        );
      });
    } else {
      await new Promise((res, rej) => {
        db.query(
          `INSERT INTO customer_loyalty (customer_id, branch_id, company_id, current_points, lifetime_points_earned, lifetime_points_redeemed, current_tier, last_activity_date) 
           VALUES (?, ?, ?, ?, ?, 0.00, ?, NOW())`,
          [customerId, branchId, companyId, earnedPoints, earnedPoints, newTierInfo.tier],
          (err) => (err ? rej(err) : res())
        );
      });
    }

    // Read fresh updated balance after atomic update
    const balanceRows = await new Promise((res, rej) => {
      db.query("SELECT current_points FROM customer_loyalty WHERE customer_id = ?", [customerId], (err, rows) => {
        if (err) return rej(err);
        res(rows || []);
      });
    });
    const finalBalance = balanceRows && balanceRows.length > 0 ? parseFloat(balanceRows[0].current_points) || 0 : earnedPoints;

    // 4. Log transaction
    const logSql = `
      INSERT INTO customer_loyalty_logs (
        customer_id, branch_id, company_id, invoice_id,
        transaction_type, points, points_balance_after,
        bill_amount, reference_note, created_by
      ) VALUES (?, ?, ?, ?, 'EARNED', ?, ?, ?, ?, ?)
    `;

    await new Promise((res, rej) => {
      db.query(
        logSql,
        [
          customerId,
          branchId,
          companyId,
          invoiceId || null,
          earnedPoints,
          finalBalance,
          parseFloat(totalAmount) || 0.0,
          `Earned on Invoice #${invoiceNumber || invoiceId || ""}`,
          userId,
        ],
        (err) => {
          if (err) return rej(err);
          res();
        }
      );
    });

    console.log(`[CustomerLoyalty] ✅ Awarded ${earnedPoints} pts to customer #${customerId} for invoice #${invoiceNumber}. Balance: ${finalBalance}`);
    return {
      success: true,
      earnedPoints,
      newBalance: finalBalance,
      tier: newTierInfo.tier,
    };
  } catch (error) {
    console.error("[CustomerLoyalty] ❌ Error awarding invoice points:", error);
    return null;
  }
};

/**
 * Company-wide Loyalty Dashboard Statistics
 */
const getCompanyLoyaltyDashboard = async (branchId) => {
  const companyId = await getCompanyId(branchId);
  const settings = await getLoyaltySettings(branchId);
  const pointValue = parseFloat(settings.redemption_point_value) || 1.0;

  return new Promise((resolve, reject) => {
    // 1. Overall Aggregates
    const statsSql = `
      SELECT 
        COUNT(cl.id) AS total_enrolled,
        COALESCE(SUM(cl.current_points), 0) AS total_active_points,
        COALESCE(SUM(cl.lifetime_points_earned), 0) AS total_points_issued,
        COALESCE(SUM(cl.lifetime_points_redeemed), 0) AS total_points_redeemed,
        COALESCE(AVG(cl.current_points), 0) AS avg_points_per_customer
      FROM customer_loyalty cl
      JOIN customer c ON c.idCustomer = cl.customer_id
      WHERE (c.Branch_idBranch = ? OR cl.company_id = ?)
    `;

    db.query(statsSql, [branchId, companyId], (err, statsRows) => {
      if (err) return reject(err);

      const stats = statsRows[0] || {};
      const totalActivePoints = parseFloat(stats.total_active_points) || 0;
      const totalIssued = parseFloat(stats.total_points_issued) || 0;
      const totalRedeemed = parseFloat(stats.total_points_redeemed) || 0;
      const totalEnrolled = parseInt(stats.total_enrolled, 10) || 0;
      const avgPoints = Math.round((parseFloat(stats.avg_points_per_customer) || 0) * 10) / 10;
      const totalLiabilityValue = Math.round(totalActivePoints * pointValue * 100) / 100;

      // 2. Tier Distribution
      const tierSql = `
        SELECT cl.current_tier, COUNT(cl.id) AS count
        FROM customer_loyalty cl
        JOIN customer c ON c.idCustomer = cl.customer_id
        WHERE (c.Branch_idBranch = ? OR cl.company_id = ?)
        GROUP BY cl.current_tier
      `;

      db.query(tierSql, [branchId, companyId], (err2, tierRows) => {
        if (err2) return reject(err2);

        const tierMap = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0 };
        (tierRows || []).forEach((row) => {
          if (row.current_tier && tierMap.hasOwnProperty(row.current_tier)) {
            tierMap[row.current_tier] = parseInt(row.count, 10) || 0;
          }
        });

        // 3. Top Loyal Customers Leaderboard
        const topCustSql = `
          SELECT c.idCustomer, c.displayName, c.First_Name, c.lastName, c.mobileNumber, c.phoneNumber, c.profileImage,
                 cl.current_points, cl.lifetime_points_earned, cl.lifetime_points_redeemed, cl.current_tier
          FROM customer_loyalty cl
          JOIN customer c ON c.idCustomer = cl.customer_id
          WHERE (c.Branch_idBranch = ? OR cl.company_id = ?)
          ORDER BY cl.current_points DESC
          LIMIT 10
        `;

        db.query(topCustSql, [branchId, companyId], (err3, topRows) => {
          if (err3) return reject(err3);

          const topCustomers = (topRows || []).map((c, idx) => ({
            rank: idx + 1,
            id: c.idCustomer,
            name: c.displayName || [c.First_Name, c.lastName].filter(Boolean).join(" ") || `Customer #${c.idCustomer}`,
            phone: c.mobileNumber || c.phoneNumber || "-",
            currentPoints: parseFloat(c.current_points) || 0,
            lifetimeEarned: parseFloat(c.lifetime_points_earned) || 0,
            lifetimeRedeemed: parseFloat(c.lifetime_points_redeemed) || 0,
            tier: c.current_tier || "Bronze",
            profileImage: c.profileImage,
            equivalentValue: Math.round((parseFloat(c.current_points) || 0) * pointValue * 100) / 100,
          }));

          // 4. Recent Activity Ledger
          const recentLogsSql = `
            SELECT cll.id, cll.transaction_type, cll.points, cll.points_balance_after,
                   cll.bill_amount, cll.reference_note, cll.created_at,
                   c.idCustomer, c.displayName, c.First_Name, c.lastName
            FROM customer_loyalty_logs cll
            JOIN customer c ON c.idCustomer = cll.customer_id
            WHERE (cll.branch_id = ? OR cll.company_id = ?)
            ORDER BY cll.id DESC
            LIMIT 25
          `;

          db.query(recentLogsSql, [branchId, companyId], (err4, logRows) => {
            if (err4) return reject(err4);

            const recentActivity = (logRows || []).map((l) => ({
              id: l.id,
              customerId: l.idCustomer,
              customerName:
                l.displayName || [l.First_Name, l.lastName].filter(Boolean).join(" ") || `Customer #${l.idCustomer}`,
              type: l.transaction_type,
              points: parseFloat(l.points) || 0,
              balanceAfter: parseFloat(l.points_balance_after) || 0,
              billAmount: parseFloat(l.bill_amount) || 0,
              note: l.reference_note || "",
              createdAt: l.created_at,
            }));

            resolve({
              stats: {
                totalEnrolled,
                totalIssued,
                totalRedeemed,
                totalActivePoints,
                totalLiabilityValue,
                avgPoints,
                pointValue,
              },
              tierDistribution: {
                bronze: tierMap.Bronze,
                silver: tierMap.Silver,
                gold: tierMap.Gold,
                platinum: tierMap.Platinum,
              },
              topCustomers,
              recentActivity,
              settings,
            });
          });
        });
      });
    });
  });
};

/**
 * Paginated Company Customer Loyalty Directory with Search & Filtering
 */
const getCompanyCustomersLoyaltyList = async (branchId, options = {}) => {
  const { page = 1, limit = 10, search = "", tier = "" } = options;
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const companyId = await getCompanyId(branchId);
  const settings = await getLoyaltySettings(branchId);
  const pointValue = parseFloat(settings.redemption_point_value) || 1.0;

  const whereClauses = ["(c.Branch_idBranch = ? OR c.idCustomer IN (SELECT customer_id FROM customer_loyalty WHERE company_id = ?))"];
  const params = [branchId, companyId];

  if (search && search.trim() !== "") {
    whereClauses.push("(c.displayName LIKE ? OR c.First_Name LIKE ? OR c.lastName LIKE ? OR c.mobileNumber LIKE ? OR c.companyEmail LIKE ?)");
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s, s);
  }

  if (tier && tier.trim() !== "" && tier !== "All") {
    whereClauses.push("COALESCE(cl.current_tier, 'Bronze') = ?");
    params.push(tier.trim());
  }

  const whereSql = whereClauses.join(" AND ");

  // Count query
  const countSql = `
    SELECT COUNT(c.idCustomer) AS total
    FROM customer c
    LEFT JOIN customer_loyalty cl ON cl.customer_id = c.idCustomer
    WHERE ${whereSql}
  `;

  return new Promise((resolve, reject) => {
    db.query(countSql, params, (err, countRows) => {
      if (err) return reject(err);

      const totalRecords = countRows[0]?.total || 0;
      const totalPages = Math.ceil(totalRecords / parseInt(limit, 10)) || 1;

      // Data query
      const dataSql = `
        SELECT c.idCustomer, c.displayName, c.First_Name, c.lastName, c.mobileNumber, c.phoneNumber,
               c.companyEmail, c.officialEmail, c.profileImage, c.created_at,
               COALESCE(cl.current_points, 0) AS current_points,
               COALESCE(cl.lifetime_points_earned, 0) AS lifetime_points_earned,
               COALESCE(cl.lifetime_points_redeemed, 0) AS lifetime_points_redeemed,
               COALESCE(cl.current_tier, 'Bronze') AS current_tier,
               cl.last_activity_date
        FROM customer c
        LEFT JOIN customer_loyalty cl ON cl.customer_id = c.idCustomer
        WHERE ${whereSql}
        ORDER BY cl.current_points DESC, c.idCustomer DESC
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, parseInt(limit, 10), parseInt(offset, 10)];

      db.query(dataSql, dataParams, (err2, rows) => {
        if (err2) return reject(err2);

        const customers = (rows || []).map((c) => {
          const pts = parseFloat(c.current_points) || 0;
          return {
            id: c.idCustomer,
            name: c.displayName || [c.First_Name, c.lastName].filter(Boolean).join(" ") || `Customer #${c.idCustomer}`,
            phone: c.mobileNumber || c.phoneNumber || "-",
            email: c.companyEmail || c.officialEmail || "-",
            profileImage: c.profileImage,
            currentPoints: pts,
            equivalentValue: Math.round(pts * pointValue * 100) / 100,
            lifetimeEarned: parseFloat(c.lifetime_points_earned) || 0,
            lifetimeRedeemed: parseFloat(c.lifetime_points_redeemed) || 0,
            tier: c.current_tier || "Bronze",
            lastActivityDate: c.last_activity_date,
            createdAt: c.created_at,
          };
        });

        resolve({
          data: customers,
          pagination: {
            currentPage: parseInt(page, 10),
            totalPages,
            totalRecords,
            limit: parseInt(limit, 10),
          },
          settings: {
            pointValue,
          },
        });
      });
    });
  });
};

/**
 * Revert customer loyalty points when an invoice is cancelled or deleted
 */
const revertPointsForInvoice = async (invoiceId) => {
  if (!invoiceId) return;
  try {
    const logs = await new Promise((res, rej) => {
      db.query(
        "SELECT * FROM customer_loyalty_logs WHERE invoice_id = ? AND transaction_type = 'EARNED'",
        [invoiceId],
        (err, rows) => (err ? rej(err) : res(rows))
      );
    });
    if (!logs || logs.length === 0) return;

    for (const log of logs) {
      const { customer_id, branch_id, company_id, points } = log;
      const ptsToDeduct = parseFloat(points) || 0;
      if (ptsToDeduct <= 0) continue;

      const custLoyalty = await new Promise((res, rej) => {
        db.query("SELECT * FROM customer_loyalty WHERE customer_id = ?", [customer_id], (err, rows) =>
          err ? rej(err) : res(rows)
        );
      });

      if (custLoyalty && custLoyalty.length > 0) {
        const cur = custLoyalty[0];
        const newBalance = Math.max(0, (parseFloat(cur.current_points) || 0) - ptsToDeduct);
        const newLifetime = Math.max(0, (parseFloat(cur.lifetime_points_earned) || 0) - ptsToDeduct);
        const settings = await getLoyaltySettings(branch_id);
        const newTier = determineTier(newLifetime, settings);

        await new Promise((res, rej) => {
          db.query(
            "UPDATE customer_loyalty SET current_points = ?, lifetime_points_earned = ?, current_tier = ?, last_activity_date = NOW() WHERE customer_id = ?",
            [newBalance, newLifetime, newTier.tier, customer_id],
            (err) => (err ? rej(err) : res())
          );
        });

        await new Promise((res, rej) => {
          db.query(
            `INSERT INTO customer_loyalty_logs (
              customer_id, branch_id, company_id, invoice_id,
              transaction_type, points, points_balance_after,
              bill_amount, reference_note, created_by
            ) VALUES (?, ?, ?, ?, 'EXPIRED', ?, ?, 0.00, ?, NULL)`,
            [
              customer_id,
              branch_id,
              company_id,
              invoiceId,
              -ptsToDeduct,
              newBalance,
              `Reversed points for deleted/modified Invoice #${invoiceId}`,
            ],
            (err) => (err ? rej(err) : res())
          );
        });
        console.log(`[CustomerLoyalty] 🔄 Reverted ${ptsToDeduct} pts for customer #${customer_id} on invoice #${invoiceId}`);
      }
    }
  } catch (err) {
    console.error("[CustomerLoyalty] Error reverting points for invoice:", err);
  }
};

// Helpers for contact masking
const maskPhoneNumber = (phone) => {
  if (!phone) return "";
  const s = phone.toString().trim();
  if (s.length <= 4) return s;
  return s.slice(0, 3) + " *** *" + s.slice(-3);
};

const maskEmailAddress = (email) => {
  if (!email || !email.includes("@")) return "";
  const parts = email.trim().split("@");
  const user = parts[0];
  const domain = parts[1];
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
};

/**
 * Check customer loyalty redemption eligibility for checkout (AddInvoice & POS)
 */
const checkRedemptionEligibility = async ({ customerId, branchId, billAmount = 0 }) => {
  return new Promise((resolve, reject) => {
    if (!customerId) return reject(new Error("Customer ID is required"));

    // 1. Fetch customer details
    const custSql = `
      SELECT idCustomer, Title, First_Name, lastName, displayName,
             phoneNumber, mobileNumber, companyEmail, officialEmail, Branch_idBranch
      FROM customer WHERE idCustomer = ?
    `;

    db.query(custSql, [customerId], async (err, custRows) => {
      if (err) return reject(err);
      if (!custRows || custRows.length === 0) return reject(new Error("Customer not found"));

      const customer = custRows[0];
      const effectiveBranchId = branchId || customer.Branch_idBranch;

      // 2. Check if loyalty is enabled in branch rules
      let isLoyaltyEnabled = true;
      try {
        const [ruleRows] = await new Promise((res, rej) => {
          db.query("SELECT enable_loyalty FROM rules WHERE Branch_idBranch = ?", [effectiveBranchId], (rErr, rows) => {
            if (rErr) return rej(rErr);
            res([rows]);
          });
        });
        if (ruleRows && ruleRows.length > 0) {
          isLoyaltyEnabled = ruleRows[0].enable_loyalty === 1;
        }
      } catch (rErr) {
        console.warn("[CustomerLoyalty] Could not check branch rules:", rErr.message);
      }

      // 3. Fetch loyalty settings
      const settings = await getLoyaltySettings(effectiveBranchId);

      // 4. Fetch customer loyalty balance
      const loyaltySql = "SELECT * FROM customer_loyalty WHERE customer_id = ?";
      db.query(loyaltySql, [customerId], (err2, loyaltyRows) => {
        if (err2) return reject(err2);

        const loyalty = (loyaltyRows && loyaltyRows.length > 0) ? loyaltyRows[0] : null;
        const currentPoints = loyalty ? Math.max(0, parseFloat(loyalty.current_points) || 0) : 0;
        const pointValue = parseFloat(settings.redemption_point_value) || 1.0;
        const minPointsToRedeem = parseFloat(settings.min_points_to_redeem) || 50.0;
        const maxRedemptionPercentage = parseFloat(settings.max_redemption_percentage) || 50.0;
        const maxPointsPerRedemption = parseFloat(settings.max_points_per_redemption) || 0.0;
        const currentTier = loyalty?.current_tier || "Bronze";

        const phone = customer.mobileNumber || customer.phoneNumber || "";
        const email = customer.companyEmail || customer.officialEmail || "";

        // Calculate maximum redeemable points for this specific bill
        const numericBill = Math.max(0, parseFloat(billAmount) || 0);
        let maxAllowedPointsForBill = currentPoints;

        if (numericBill > 0 && maxRedemptionPercentage > 0) {
          const maxDiscountFromBill = (numericBill * maxRedemptionPercentage) / 100;
          const maxPointsFromBill = maxDiscountFromBill / pointValue;
          maxAllowedPointsForBill = Math.min(maxAllowedPointsForBill, maxPointsFromBill);
        }

        if (maxPointsPerRedemption > 0) {
          maxAllowedPointsForBill = Math.min(maxAllowedPointsForBill, maxPointsPerRedemption);
        }

        const maxRedeemablePoints = Math.max(0, Math.floor(maxAllowedPointsForBill));
        const canRedeem = isLoyaltyEnabled && currentPoints >= minPointsToRedeem && (numericBill > 0 ? maxRedeemablePoints >= minPointsToRedeem : true);

        resolve({
          customerId: customer.idCustomer,
          customerName: customer.displayName || [customer.Title, customer.First_Name, customer.lastName].filter(Boolean).join(" ") || "Valued Customer",
          isLoyaltyEnabled,
          currentPoints,
          pointValue,
          equivalentValue: Math.round(currentPoints * pointValue * 100) / 100,
          currentTier,
          minPointsToRedeem,
          maxRedemptionPercentage,
          maxPointsPerRedemption,
          canRedeem,
          maxRedeemablePoints,
          maxDiscountAmount: Math.round(maxRedeemablePoints * pointValue * 100) / 100,
          contacts: {
            hasPhone: !!phone,
            phone: phone,
            maskedPhone: maskPhoneNumber(phone),
            hasEmail: !!email,
            email: email,
            maskedEmail: maskEmailAddress(email),
          }
        });
      });
    });
  });
};

/**
 * Request OTP for loyalty points redemption
 */
const requestRedemptionOTP = async ({ customerId, branchId, pointsToRedeem, channel, billAmount = 0, userId = null }) => {
  const points = parseFloat(pointsToRedeem);
  if (!points || points <= 0) {
    throw new Error("Please enter a valid points amount to redeem");
  }

  const eligibility = await checkRedemptionEligibility({ customerId, branchId, billAmount });
  if (!eligibility.isLoyaltyEnabled) {
    throw new Error("Customer loyalty is currently disabled for this branch");
  }

  if (points < eligibility.minPointsToRedeem) {
    throw new Error(`Minimum points required to redeem is ${eligibility.minPointsToRedeem}`);
  }

  if (points > eligibility.currentPoints) {
    throw new Error(`Customer only has ${eligibility.currentPoints} points available`);
  }

  if (billAmount > 0 && points > eligibility.maxRedeemablePoints) {
    throw new Error(`Maximum redeemable points for this bill is ${eligibility.maxRedeemablePoints} (${eligibility.maxRedemptionPercentage}% max bill limit)`);
  }

  if (eligibility.maxPointsPerRedemption > 0 && points > eligibility.maxPointsPerRedemption) {
    throw new Error(`Maximum points allowed per redemption is ${eligibility.maxPointsPerRedemption}`);
  }

  const normChannel = (channel || "SMS").toUpperCase();
  if (normChannel !== "SMS" && normChannel !== "EMAIL") {
    throw new Error("Verification channel must be 'SMS' or 'EMAIL'");
  }

  let recipient = "";
  if (normChannel === "SMS") {
    if (!eligibility.contacts.hasPhone) {
      throw new Error("Customer does not have a phone number registered for SMS verification");
    }
    recipient = eligibility.contacts.phone;
  } else {
    if (!eligibility.contacts.hasEmail) {
      throw new Error("Customer does not have an email address registered for Email verification");
    }
    recipient = eligibility.contacts.email;
  }

  const discountAmount = Math.round(points * eligibility.pointValue * 100) / 100;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const redemptionToken = crypto.randomBytes(24).toString("hex");
  const companyId = await getCompanyId(branchId);

  // Invalidate any previous pending OTPs for this customer
  await new Promise((res) => {
    db.query(
      "UPDATE loyalty_redemption_otps SET status = 'EXPIRED' WHERE customer_id = ? AND status = 'PENDING'",
      [customerId],
      () => res()
    );
  });

  // Insert new OTP record (valid for 10 minutes)
  const insertSql = `
    INSERT INTO loyalty_redemption_otps (
      customer_id, branch_id, company_id, channel, recipient,
      otp_code, points_to_redeem, discount_amount, status,
      redemption_token, expires_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?)
  `;

  await new Promise((res, rej) => {
    db.query(
      insertSql,
      [customerId, branchId, companyId, normChannel, recipient, otpCode, points, discountAmount, redemptionToken, userId || null],
      (err, result) => (err ? rej(err) : res(result))
    );
  });

  // Dispatch OTP code
  if (normChannel === "SMS") {
    const smsText = `Your Asipbook verification code is ${otpCode} to redeem ${points} loyalty points (LKR ${discountAmount.toFixed(2)} discount). Valid for 10 minutes.`;
    const smsResult = await smsService.sendDirectSMS({
      branchId,
      recipientPhone: recipient,
      message: smsText,
      userId,
      campaignName: "Loyalty Redemption OTP",
    });
    if (smsResult && !smsResult.success) {
      console.error("[CustomerLoyalty] Direct SMS delivery failed:", smsResult);
      throw new Error(smsResult.error || smsResult.message || "Failed to deliver SMS verification code. Please check recipient phone number or choose Email.");
    }
  } else {
    const mailOptions = {
      from: `"Asipbook Loyalty" <${process.env.EMAIL_USER || "security@asipbook.com"}>`,
      to: recipient,
      subject: `Your Loyalty Points Redemption OTP: ${otpCode}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">Asipbook Loyalty Program</h2>
            <p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Points Redemption Verification</p>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 20px;">
            <p style="color: #475569; font-size: 14px; margin: 0 0 10px 0;">Use the following 6-digit verification code to redeem <strong>${points} points</strong> (Discount value: <strong>LKR ${discountAmount.toFixed(2)}</strong>):</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e293b; padding: 12px 24px; background: #e0e7ff; border-radius: 8px; display: inline-block; margin: 8px 0;">
              ${otpCode}
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin: 12px 0 0 0;">This code is valid for 10 minutes. Do not share it with anyone.</p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">If you did not initiate this points redemption, please contact store management immediately.</p>
        </div>
      `,
    };
    try {
      await transporter.sendMail(mailOptions);
    } catch (mErr) {
      console.error("[CustomerLoyalty] Error sending email OTP:", mErr);
      throw new Error(`Failed to send Email verification code: ${mErr.message || "Email server error"}`);
    }
  }

  return {
    success: true,
    redemptionToken,
    channel: normChannel,
    maskedRecipient: normChannel === "SMS" ? maskPhoneNumber(recipient) : maskEmailAddress(recipient),
    pointsToRedeem: points,
    discountAmount,
    cooldownSeconds: 45,
    message: `Verification code sent via ${normChannel}`,
  };
};

/**
 * Resend OTP for loyalty points redemption
 */
const resendRedemptionOTP = async ({ redemptionToken, userId = null }) => {
  if (!redemptionToken) throw new Error("Redemption token is required");

  const [otpRow] = await new Promise((res, rej) => {
    db.query(
      `SELECT *,
              TIMESTAMPDIFF(SECOND, COALESCE(updated_at, created_at), NOW()) AS elapsed_seconds
       FROM loyalty_redemption_otps 
       WHERE redemption_token = ? AND (status = 'PENDING' OR (status = 'EXPIRED' AND expires_at > NOW()))`,
      [redemptionToken],
      (err, rows) => (err ? rej(err) : res(rows))
    );
  });

  if (!otpRow) {
    throw new Error("No active pending redemption found for this token");
  }

  // Enforce 40s cooldown using MySQL clock comparison
  if (otpRow.elapsed_seconds !== null && otpRow.elapsed_seconds >= 0 && otpRow.elapsed_seconds < 40) {
    const waitSeconds = Math.ceil(45 - otpRow.elapsed_seconds);
    throw new Error(`Please wait ${waitSeconds} seconds before requesting another code`);
  }

  // Generate new OTP
  const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
  await new Promise((res, rej) => {
    db.query(
      "UPDATE loyalty_redemption_otps SET otp_code = ?, expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE), status = 'PENDING', updated_at = NOW() WHERE id = ?",
      [newOtp, otpRow.id],
      (err) => (err ? rej(err) : res())
    );
  });

  // Re-dispatch
  if (otpRow.channel === "SMS") {
    const smsText = `Your new Asipbook verification code is ${newOtp} to redeem ${otpRow.points_to_redeem} loyalty points (LKR ${parseFloat(otpRow.discount_amount).toFixed(2)} discount). Valid for 10 minutes.`;
    const smsResult = await smsService.sendDirectSMS({
      branchId: otpRow.branch_id,
      recipientPhone: otpRow.recipient,
      message: smsText,
      userId,
      campaignName: "Loyalty Redemption OTP Resend",
    });
    if (smsResult && !smsResult.success) {
      console.error("[CustomerLoyalty] Direct SMS resend failed:", smsResult);
      throw new Error(smsResult.error || smsResult.message || "Failed to resend SMS verification code. Please check phone number or try Email.");
    }
  } else {
    const mailOptions = {
      from: `"Asipbook Loyalty" <${process.env.EMAIL_USER || "security@asipbook.com"}>`,
      to: otpRow.recipient,
      subject: `Your Loyalty Points Redemption OTP: ${newOtp}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #4f46e5; margin: 0; font-size: 22px;">Asipbook Loyalty Program</h2>
            <p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Points Redemption Verification (Resent)</p>
          </div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 20px;">
            <p style="color: #475569; font-size: 14px; margin: 0 0 10px 0;">Use the following 6-digit verification code to redeem <strong>${otpRow.points_to_redeem} points</strong> (Discount value: <strong>LKR ${parseFloat(otpRow.discount_amount).toFixed(2)}</strong>):</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e293b; padding: 12px 24px; background: #e0e7ff; border-radius: 8px; display: inline-block; margin: 8px 0;">
              ${newOtp}
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin: 12px 0 0 0;">This code is valid for 10 minutes. Do not share it with anyone.</p>
          </div>
        </div>
      `,
    };
    try {
      await transporter.sendMail(mailOptions);
    } catch (mErr) {
      console.error("[CustomerLoyalty] Error sending email OTP:", mErr);
      throw new Error(`Failed to resend Email verification code: ${mErr.message || "Email server error"}`);
    }
  }

  return {
    success: true,
    cooldownSeconds: 45,
    message: "A new verification code has been sent",
  };
};

/**
 * Verify OTP for loyalty points redemption
 */
const verifyRedemptionOTP = async ({ redemptionToken, otpCode }) => {
  if (!redemptionToken) throw new Error("Redemption token is required");
  if (!otpCode || !otpCode.toString().trim()) throw new Error("Please enter the 6-digit verification code");

  const [otpRow] = await new Promise((res, rej) => {
    db.query(
      `SELECT *,
              (expires_at < NOW()) AS is_expired,
              TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS seconds_remaining
       FROM loyalty_redemption_otps 
       WHERE redemption_token = ?`,
      [redemptionToken],
      (err, rows) => (err ? rej(err) : res(rows))
    );
  });

  if (!otpRow) {
    throw new Error("Invalid verification session");
  }

  if (otpRow.status === "VERIFIED") {
    return {
      success: true,
      redemptionToken,
      pointsToRedeem: parseFloat(otpRow.points_to_redeem),
      discountAmount: parseFloat(otpRow.discount_amount),
      message: "Already verified",
    };
  }

  if (otpRow.status === "USED") {
    throw new Error("This verification code has already been applied");
  }

  // Check expiration using MySQL's clock to prevent timezone discrepancies
  if (otpRow.is_expired === 1 || (otpRow.seconds_remaining !== null && otpRow.seconds_remaining <= 0)) {
    await new Promise((res) => db.query("UPDATE loyalty_redemption_otps SET status = 'EXPIRED' WHERE id = ?", [otpRow.id], () => res()));
    throw new Error("Verification code has expired. Please request a new one.");
  }

  if (otpRow.otp_code.trim() !== otpCode.toString().trim()) {
    throw new Error("Invalid 6-digit verification code. Please check and try again.");
  }

  // Update status to VERIFIED
  await new Promise((res, rej) => {
    db.query(
      "UPDATE loyalty_redemption_otps SET status = 'VERIFIED', verified_at = NOW() WHERE id = ?",
      [otpRow.id],
      (err) => (err ? rej(err) : res())
    );
  });

  return {
    success: true,
    redemptionToken,
    pointsToRedeem: parseFloat(otpRow.points_to_redeem),
    discountAmount: parseFloat(otpRow.discount_amount),
    message: "Loyalty redemption authorized successfully!",
  };
};

/**
 * Finalize points redemption upon invoice creation or POS sale
 */
const redeemPointsForInvoice = async ({
  customerId,
  branchId,
  invoiceId,
  invoiceNumber = null,
  pointsToRedeem,
  discountAmount,
  redemptionToken,
  userId = null,
  connection = null,
}) => {
  const queryRunner = (sql, params) =>
    new Promise((resolve, reject) => {
      const runner = connection || db;
      runner.query(sql, params, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

  try {
    if (!customerId || !redemptionToken) {
      console.log("[CustomerLoyalty] Missing customerId or redemptionToken for points redemption");
      return null;
    }

    // 1. Verify token status in DB
    const otpRows = await queryRunner(
      "SELECT * FROM loyalty_redemption_otps WHERE redemption_token = ? AND customer_id = ? AND status = 'VERIFIED' FOR UPDATE",
      [redemptionToken, customerId]
    );

    if (!otpRows || otpRows.length === 0) {
      console.error(`[CustomerLoyalty] No verified redemption token found for customer #${customerId} with token ${redemptionToken}`);
      return null;
    }

    const otpRecord = otpRows[0];
    const actualPoints = parseFloat(otpRecord.points_to_redeem) || parseFloat(pointsToRedeem) || 0;
    const actualDiscount = parseFloat(otpRecord.discount_amount) || parseFloat(discountAmount) || 0;

    if (actualPoints <= 0) return null;

    // 2. Mark token as USED
    await queryRunner(
      "UPDATE loyalty_redemption_otps SET status = 'USED', used_at = NOW(), invoice_id = ? WHERE id = ?",
      [invoiceId, otpRecord.id]
    );

    // 3. Deduct points from customer_loyalty
    await queryRunner(
      `UPDATE customer_loyalty 
       SET current_points = GREATEST(0, current_points - ?),
           lifetime_points_redeemed = lifetime_points_redeemed + ?,
           last_activity_date = NOW()
       WHERE customer_id = ?`,
      [actualPoints, actualPoints, customerId]
    );

    // 4. Fetch updated balance
    const custLoyaltyRows = await queryRunner(
      "SELECT current_points, company_id FROM customer_loyalty WHERE customer_id = ?",
      [customerId]
    );
    const newBalance = custLoyaltyRows && custLoyaltyRows.length > 0 ? parseFloat(custLoyaltyRows[0].current_points) || 0 : 0;
    const companyId = custLoyaltyRows && custLoyaltyRows.length > 0 ? custLoyaltyRows[0].company_id : (await getCompanyId(branchId));

    // 5. Insert transaction log
    const refNote = `Redeemed for Invoice #${invoiceNumber || invoiceId} (LKR ${actualDiscount.toFixed(2)} discount)`;
    await queryRunner(
      `INSERT INTO customer_loyalty_logs (
        customer_id, branch_id, company_id, invoice_id,
        transaction_type, points, points_balance_after,
        bill_amount, reference_note, created_by
      ) VALUES (?, ?, ?, ?, 'REDEEMED', ?, ?, ?, ?, ?)`,
      [
        customerId,
        branchId || otpRecord.branch_id,
        companyId,
        invoiceId,
        -actualPoints,
        newBalance,
        actualDiscount,
        refNote,
        userId || null,
      ]
    );

    console.log(`[CustomerLoyalty] ⭐ Successfully redeemed ${actualPoints} points (LKR ${actualDiscount}) for customer #${customerId} on invoice #${invoiceNumber || invoiceId}. New balance: ${newBalance}`);

    // Asynchronous confirmation alert (fire-and-forget)
    try {
      if (otpRecord.channel === "SMS" && otpRecord.recipient) {
        const confirmMsg = `Asipbook: You redeemed ${actualPoints} loyalty points (LKR ${actualDiscount.toFixed(2)} discount) on Invoice #${invoiceNumber || invoiceId}. New balance: ${newBalance} pts. Thank you!`;
        smsService.sendDirectSMS({
          branchId: otpRecord.branch_id,
          recipientPhone: otpRecord.recipient,
          message: confirmMsg,
          userId,
          campaignName: "Loyalty Redemption Confirmation",
        }).catch((sErr) => console.warn("[CustomerLoyalty] Could not send redemption confirmation SMS:", sErr.message));
      } else if (otpRecord.channel === "EMAIL" && otpRecord.recipient) {
        const confirmMail = {
          from: `"Asipbook Loyalty" <${process.env.EMAIL_USER || "security@asipbook.com"}>`,
          to: otpRecord.recipient,
          subject: `Loyalty Points Redeemed: Invoice #${invoiceNumber || invoiceId}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #16a34a; margin: 0; font-size: 22px;">Loyalty Redemption Confirmed</h2>
                <p style="color: #64748b; margin: 4px 0 0 0; font-size: 14px;">Invoice #${invoiceNumber || invoiceId}</p>
              </div>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 16px;">
                <p style="margin: 0 0 8px 0; color: #334155; font-size: 14px;">Points Redeemed: <strong>${actualPoints} pts</strong></p>
                <p style="margin: 0 0 8px 0; color: #16a34a; font-size: 14px;">Discount Applied: <strong>LKR ${actualDiscount.toFixed(2)}</strong></p>
                <p style="margin: 0; color: #334155; font-size: 14px;">Remaining Points Balance: <strong>${newBalance} pts</strong></p>
              </div>
              <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">Thank you for your loyalty!</p>
            </div>
          `,
        };
        transporter.sendMail(confirmMail).catch((mErr) => console.warn("[CustomerLoyalty] Could not send redemption confirmation Email:", mErr.message));
      }
    } catch (confErr) {
      console.warn("[CustomerLoyalty] Confirmation notification error:", confErr);
    }

    return {
      success: true,
      pointsRedeemed: actualPoints,
      discountAmount: actualDiscount,
      newBalance,
    };
  } catch (error) {
    console.error("[CustomerLoyalty] Error during points redemption:", error);
    throw error;
  }
};

module.exports = {
  getLoyaltySettings,
  saveLoyaltySettings,
  determineTier,
  calculateEarnedPoints,
  getCustomerLoyaltyProfile,
  adjustCustomerPoints,
  awardPointsForInvoice,
  revertPointsForInvoice,
  getCompanyLoyaltyDashboard,
  getCompanyCustomersLoyaltyList,
  checkRedemptionEligibility,
  requestRedemptionOTP,
  resendRedemptionOTP,
  verifyRedemptionOTP,
  redeemPointsForInvoice,
};

