const db = require("../db/db");
const db2 = require("../db/db2");
const axios = require("axios");

const SMS_API_KEY = "ASIP_BOOK:e192a2212049e6e686b81ad15ce3ae8e3ae744c06427d4e5c4d1260f0f034bf5";
const SMS_API_URL = "https://smsportalserver.asipiya.com/api/external/sms";

// Get SMS settings template for an event and branch
const getSmsTemplate = (branchId, eventKey) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM sms_templates WHERE branch_id = ? AND event_key = ?";
    db.query(query, [branchId, eventKey], (err, results) => {
      if (err) return reject(err);
      resolve(results[0] || null);
    });
  });
};

// Check if company has registered in Asipiya Notify SMS Portal
const checkCompanySmsActive = async (companyId) => {
  try {
    const res = await axios.get(
      `https://smsportalserver.asipiya.com/api/external/companies/${companyId}/info`,
      {
        headers: {
          "x-api-key": SMS_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 5000
      }
    );
    return !!(res.data && res.data.company);
  } catch (err) {
    return false;
  }
};

// Get Company Id by Branch Id (searches db and db2)
const getCompanyIdByBranch = (branchId) => {
  return new Promise((resolve) => {
    const query = "SELECT Company_idCompany FROM branch WHERE idBranch = ?";
    db.query(query, [branchId], (err, results) => {
      if (!err && results.length > 0 && results[0].Company_idCompany) {
        return resolve(results[0].Company_idCompany);
      }
      db2.query(query, [branchId], (err2, results2) => {
        if (!err2 && results2.length > 0 && results2[0].Company_idCompany) {
          return resolve(results2[0].Company_idCompany);
        }
        resolve(null);
      });
    });
  });
};

// Fetch approved mask for the company
const fetchApprovedMask = async (companyId) => {
  try {
    const res = await axios.get(
      `https://smsportalserver.asipiya.com/api/external/companies/${companyId}/info`,
      {
        headers: {
          "x-api-key": SMS_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 5000
      }
    );
    const data = res.data;
    if (data && data.masks && data.masks.length > 0) {
      // 1. Look for default approved mask
      const defaultApproved = data.masks.find(m => m.isDefault && m.status === "APPROVED");
      if (defaultApproved) return defaultApproved.maskName;

      // 2. Look for approved transactional mask
      const transactionalApproved = data.masks.find(m => m.status === "APPROVED" && m.maskType === "TRANSACTIONAL");
      if (transactionalApproved) return transactionalApproved.maskName;

      // 3. Look for any approved mask
      const approvedMask = data.masks.find(m => m.status === "APPROVED");
      if (approvedMask) return approvedMask.maskName;
    }
    return "Asipiya"; // Default fallback
  } catch (error) {
    console.error(`[SMS-Service] Error fetching masks for company ${companyId}:`, error.message);
    return "Asipiya"; // Default fallback
  }
};

// Resolve company owner or admin user from db2
const resolveCompanyUser = (companyId) => {
  return new Promise((resolve) => {
    const sql = `
      SELECT u.idAsipiya_User, u.First_Name, u.Last_Name, u.Email, u.Contact_No_01, c.Name as Company_Name
      FROM company_has_asipiya_user cu
      JOIN asipiya_user u ON u.idAsipiya_User = cu.Asipiya_User_idAsipiya_User
      JOIN company c ON c.idCompany = cu.Company_idCompany
      WHERE cu.Company_idCompany = ? AND cu.Status = '1'
      ORDER BY (CASE WHEN cu.Role = 'Owner' THEN 1 WHEN cu.Role = 'Admin' THEN 2 ELSE 3 END) ASC
      LIMIT 1
    `;
    db2.query(sql, [companyId], (err, rows) => {
      if (err || !rows || rows.length === 0) return resolve(null);
      resolve(rows[0]);
    });
  });
};

// Retrieve user details from db2
const getUserDetails = (userId, companyId) => {
  return new Promise((resolve) => {
    const sql = `
      SELECT u.idAsipiya_User, u.First_Name, u.Last_Name, u.Email, u.Contact_No_01, c.Name as Company_Name
      FROM asipiya_user u
      LEFT JOIN company c ON c.idCompany = ?
      WHERE u.idAsipiya_User = ?
      LIMIT 1
    `;
    db2.query(sql, [companyId, userId], (err, rows) => {
      if (err || !rows || rows.length === 0) return resolve(null);
      resolve(rows[0]);
    });
  });
};

// Provision user to the Asipiya Notify SMS Portal
const provisionUserInSmsPortal = async (userParam, companyId) => {
  try {
    let userObj = userParam;
    if (!userObj || typeof userObj !== "object") {
      userObj = await getUserDetails(userParam, companyId);
    }
    if (!userObj) {
      userObj = await resolveCompanyUser(companyId);
    }
    if (!userObj) return false;

    let cleanPhone = (userObj.Contact_No_01 || "0770000000").replace(/[\s\-\+\(\)]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "94" + cleanPhone.slice(1);
    } else if (!cleanPhone.startsWith("94")) {
      cleanPhone = "94" + cleanPhone;
    }

    const payload = {
      externalUserId: userObj.idAsipiya_User,
      fullName: `${userObj.First_Name || ""} ${userObj.Last_Name || ""}`.trim() || "User",
      email: userObj.Email || `user${userObj.idAsipiya_User}@asipbook.com`,
      contactNumber: cleanPhone,
      externalCompanyId: companyId,
      companyName: userObj.Company_Name || "Asipbook Company",
      systemLabel: "ASIP_BOOK"
    };

    await axios.post(
      "https://smsportalserver.asipiya.com/api/external/provision-user",
      payload,
      {
        headers: {
          "x-api-key": SMS_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 5000
      }
    );
    console.log(`[SMS-Service] User ${userObj.idAsipiya_User} successfully provisioned to SMS portal.`);
    return { success: true, userId: userObj.idAsipiya_User };
  } catch (err) {
    console.error(`[SMS-Service] Error provisioning user to SMS portal:`, err.response?.data || err.message);
    return null;
  }
};

// Main trigger function to evaluate template, replace variables, and send SMS
const triggerSMSNotification = async (branchId, eventKey, recipientPhone, data, userId = null) => {
  try {
    if (!recipientPhone) {
      console.log(`[SMS-Service] No recipient phone number provided for event ${eventKey}. Skipping.`);
      return;
    }

    // 1. Get branch template config
    const config = await getSmsTemplate(branchId, eventKey);
    if (!config || config.is_enabled !== 1 || !config.template_text) {
      console.log(`[SMS-Service] SMS template for event '${eventKey}' is disabled or not configured on branch ${branchId}.`);
      return;
    }

    // 2. Get company details
    const companyId = await getCompanyIdByBranch(branchId);
    if (!companyId) {
      console.error(`[SMS-Service] Could not resolve company for branch ${branchId}.`);
      return;
    }

    // 3. Verify company registration
    const isSmsActive = await checkCompanySmsActive(companyId);
    if (!isSmsActive) {
      console.log(`[SMS-Service] Company ${companyId} has not activated SMS Mask (Asipiya Notify). Skipping.`);
      return;
    }

    // 4. Resolve a valid user ID if missing or invalid (<= 1)
    let resolvedUserId = userId;
    if (!resolvedUserId || Number(resolvedUserId) <= 1) {
      const companyUser = await resolveCompanyUser(companyId);
      if (companyUser) {
        resolvedUserId = companyUser.idAsipiya_User;
      }
    }

    // 5. Fetch approved mask
    const maskName = await fetchApprovedMask(companyId);

    // 6. Build dynamic message content
    let message = config.template_text;
    for (const key in data) {
      message = message.replace(new RegExp(`{${key}}`, "g"), data[key] !== undefined && data[key] !== null ? data[key] : "");
    }

    // Clean phone number: should be in country format (e.g. starting with 94 for Sri Lanka, 11 digits without '+' or spaces)
    let cleanPhone = recipientPhone.toString().replace(/[\s\-\+\(\)]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "94" + cleanPhone.slice(1);
    } else if (!cleanPhone.startsWith("94")) {
      cleanPhone = "94" + cleanPhone;
    }

    if (!cleanPhone || cleanPhone.length < 9) {
      console.log(`[SMS-Service] Invalid recipient phone number '${recipientPhone}' for event ${eventKey}. Skipping.`);
      return;
    }

    const payload = {
      campaignName: `Asipbook Alert - ${eventKey.replace(/_/g, " ").toUpperCase()}`,
      mask: maskName,
      externalUserId: resolvedUserId || 1,
      externalCompanyId: companyId,
      numbers: cleanPhone,
      content: message,
      systemLabel: "ASIP_BOOK"
    };

    console.log(`[SMS-Service] Sending SMS payload to ${cleanPhone}:`, payload);

    let apiResponse;
    try {
      apiResponse = await axios.post(SMS_API_URL, payload, {
        headers: {
          "x-api-key": SMS_API_KEY,
          "Content-Type": "application/json"
        }
      });
    } catch (sendErr) {
      const errMsg = sendErr.response?.data?.message || sendErr.message || "";
      // If user was not found in SMS system, auto-provision and retry
      if (typeof errMsg === "string" && errMsg.includes("not found in SMS system")) {
        console.log(`[SMS-Service] User ${payload.externalUserId} not found in SMS system. Attempting auto-provision...`);
        const provResult = await provisionUserInSmsPortal(payload.externalUserId, companyId);
        if (provResult && provResult.success) {
          payload.externalUserId = provResult.userId;
          console.log(`[SMS-Service] Retrying SMS send with provisioned user ${payload.externalUserId}...`);
          apiResponse = await axios.post(SMS_API_URL, payload, {
            headers: {
              "x-api-key": SMS_API_KEY,
              "Content-Type": "application/json"
            }
          });
        } else {
          // If provisioning this user failed, fall back to provisioning company owner and retry
          const ownerUser = await resolveCompanyUser(companyId);
          if (ownerUser && ownerUser.idAsipiya_User !== payload.externalUserId) {
            const ownerProv = await provisionUserInSmsPortal(ownerUser, companyId);
            if (ownerProv && ownerProv.success) {
              payload.externalUserId = ownerProv.userId;
              console.log(`[SMS-Service] Retrying SMS send with company owner ${payload.externalUserId}...`);
              apiResponse = await axios.post(SMS_API_URL, payload, {
                headers: {
                  "x-api-key": SMS_API_KEY,
                  "Content-Type": "application/json"
                }
              });
            } else {
              throw sendErr;
            }
          } else {
            throw sendErr;
          }
        }
      } else {
        throw sendErr;
      }
    }

    console.log(`[SMS-Service] SMS successfully scheduled. UUID:`, apiResponse?.data?.data?.uuid);
    return apiResponse?.data;
  } catch (error) {
    console.error(`[SMS-Service] Error triggering SMS notification for event '${eventKey}':`, error.response?.data || error.message);
  }
};

const saveSmsTemplates = (branchId, configs) => {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(configs) || configs.length === 0) return resolve();
    
    // Bulk insert with ON DUPLICATE KEY UPDATE
    const query = `
      INSERT INTO sms_templates (branch_id, event_key, template_text, is_enabled)
      VALUES ?
      ON DUPLICATE KEY UPDATE 
        template_text = VALUES(template_text),
        is_enabled = VALUES(is_enabled)
    `;
    
    const values = configs.map(cfg => [branchId, cfg.event_key, cfg.template_text, cfg.is_enabled ? 1 : 0]);
    db.query(query, [values], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const getBranchSmsSettings = (branchId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM sms_templates WHERE branch_id = ?";
    db.query(query, [branchId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Direct SMS sending (used for OTP, critical transactional alerts, etc.)
const sendDirectSMS = async ({ branchId, recipientPhone, message, userId = null, campaignName = "Loyalty OTP" }) => {
  try {
    if (!recipientPhone) {
      console.log("[SMS-Service] No recipient phone number provided for direct SMS.");
      return { success: false, message: "Recipient phone number required" };
    }

    // 1. Get company details
    const companyId = await getCompanyIdByBranch(branchId);
    if (!companyId) {
      console.error(`[SMS-Service] Could not resolve company for branch ${branchId}.`);
      return { success: false, message: "Branch company not found" };
    }

    // 2. Resolve a valid user ID
    let resolvedUserId = userId;
    if (!resolvedUserId || Number(resolvedUserId) <= 1) {
      const companyUser = await resolveCompanyUser(companyId);
      if (companyUser) {
        resolvedUserId = companyUser.idAsipiya_User;
      }
    }

    // 3. Fetch approved mask
    const maskName = await fetchApprovedMask(companyId);

    // 4. Format phone number
    let cleanPhone = recipientPhone.toString().replace(/[\s\-\+\(\)]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "94" + cleanPhone.slice(1);
    } else if (!cleanPhone.startsWith("94")) {
      cleanPhone = "94" + cleanPhone;
    }

    if (!cleanPhone || cleanPhone.length < 9) {
      console.log(`[SMS-Service] Invalid recipient phone number '${recipientPhone}'.`);
      return { success: false, message: "Invalid phone number format" };
    }

    const payload = {
      campaignName: campaignName || "Asipbook Alert",
      mask: maskName || "Asipiya",
      externalUserId: resolvedUserId || 1,
      externalCompanyId: companyId,
      numbers: cleanPhone,
      content: message,
      systemLabel: "ASIP_BOOK"
    };

    console.log(`[SMS-Service] Sending direct SMS payload to ${cleanPhone}:`, payload);

    let apiResponse;
    try {
      apiResponse = await axios.post(SMS_API_URL, payload, {
        headers: {
          "x-api-key": SMS_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 10000
      });
    } catch (sendErr) {
      const errMsg = sendErr.response?.data?.message || sendErr.message || "";
      if (typeof errMsg === "string" && errMsg.includes("not found in SMS system")) {
        console.log(`[SMS-Service] User ${payload.externalUserId} not found in SMS system. Auto-provisioning...`);
        const provResult = await provisionUserInSmsPortal(payload.externalUserId, companyId);
        if (provResult && provResult.success) {
          payload.externalUserId = provResult.userId;
          apiResponse = await axios.post(SMS_API_URL, payload, {
            headers: {
              "x-api-key": SMS_API_KEY,
              "Content-Type": "application/json"
            },
            timeout: 10000
          });
        } else {
          const ownerUser = await resolveCompanyUser(companyId);
          if (ownerUser && ownerUser.idAsipiya_User !== payload.externalUserId) {
            const ownerProv = await provisionUserInSmsPortal(ownerUser, companyId);
            if (ownerProv && ownerProv.success) {
              payload.externalUserId = ownerProv.userId;
              apiResponse = await axios.post(SMS_API_URL, payload, {
                headers: {
                  "x-api-key": SMS_API_KEY,
                  "Content-Type": "application/json"
                },
                timeout: 10000
              });
            } else {
              throw sendErr;
            }
          } else {
            throw sendErr;
          }
        }
      } else {
        throw sendErr;
      }
    }

    console.log(`[SMS-Service] Direct SMS successfully scheduled. UUID:`, apiResponse?.data?.data?.uuid);
    return { success: true, data: apiResponse?.data };
  } catch (error) {
    console.error(`[SMS-Service] Error sending direct SMS:`, error.response?.data || error.message);
    return { success: false, error: error.response?.data?.message || error.message };
  }
};

module.exports = {
  triggerSMSNotification,
  sendDirectSMS,
  getSmsTemplate,
  saveSmsTemplates,
  getBranchSmsSettings,
  provisionUserInSmsPortal,
  resolveCompanyUser,
};

