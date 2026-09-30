const axios = require("axios");

const CRM_API_URL = (process.env.CRM_API_URL || "http://localhost:8001").replace(/\/$/, "");

/**
 * Notifies the CRM system about a newly created document (invoice/quotation/estimate) linked to a CRM deal.
 * @param {Object} data 
 */
const notifyCrmDocumentCreated = async (data) => {
  const {
    type,
    asipBookDocumentId,
    documentNumber,
    amount,
    currency,
    status,
    dealId,
    companyId,
    branchId,
    branchName,
    documentDate,
    viewUrl,
  } = data;

  if (!dealId) {
    return;
  }

  try {
    const webhookUrl = `${CRM_API_URL}/api/asipbook/webhook`;
    await axios.post(
      webhookUrl,
      {
        type,
        asipBookDocumentId,
        documentNumber,
        amount: Number(amount) || 0,
        currency: currency || "LKR",
        status: status || "created",
        dealId: Number(dealId),
        companyId: companyId ? Number(companyId) : undefined,
        branchId: branchId ? Number(branchId) : undefined,
        branchName: branchName || undefined,
        documentDate: documentDate || new Date(),
        viewUrl: viewUrl || undefined,
      },
      {
        timeout: 4000,
      }
    );
    console.log(`[CRM Webhook] Successfully notified CRM about ${type} #${documentNumber} for Deal #${dealId}`);
  } catch (err) {
    console.warn(`[CRM Webhook] Failed to notify CRM for ${type} #${documentNumber}:`, err.response?.data?.message || err.message);
  }
};

/**
 * Notifies the CRM system when a customer is created in AsipBook
 * @param {Object} customerData
 */
const notifyCrmCustomerCreated = async (customerData) => {
  const { asipBookCustomerId } = customerData;
  if (!asipBookCustomerId) return;

  try {
    const webhookUrl = `${CRM_API_URL}/api/asipbook/webhook/customer`;
    await axios.post(webhookUrl, customerData, { timeout: 4000 });
    console.log(`[CRM Webhook] Successfully notified CRM about Customer #${asipBookCustomerId}`);
  } catch (err) {
    console.warn(`[CRM Webhook] Failed to notify CRM for Customer #${asipBookCustomerId}:`, err.response?.data?.message || err.message);
  }
};

module.exports = {
  notifyCrmDocumentCreated,
  notifyCrmCustomerCreated,
};
