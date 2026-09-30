const giftVoucherService = require("../services/giftVoucherService");

/**
 * Controller for Gift Voucher endpoints
 */

const getSettings = async (req, res) => {
  const { branchId } = req.params;
  try {
    const settings = await giftVoucherService.getGiftVoucherSettings(branchId);
    res.status(200).json({ success: true, settings });
  } catch (err) {
    console.error("[GiftVoucherController] getSettings error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const saveSettings = async (req, res) => {
  const { branchId } = req.params;
  try {
    const result = await giftVoucherService.saveGiftVoucherSettings(branchId, req.body);
    res.status(200).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] saveSettings error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const issueVoucher = async (req, res) => {
  try {
    const {
      branchId,
      amount,
      customerId,
      recipientName,
      recipientPhone,
      recipientEmail,
      expiryDays,
      notes,
      userId,
      customCode,
      issueType,   // NEW: 'DIRECT_ISSUED' (default) | 'PROMOTIONAL'
      companyId,
    } = req.body;

    const resolvedIssueType = issueType === "PROMOTIONAL" ? "PROMOTIONAL" : "DIRECT_ISSUED";

    const result = await giftVoucherService.issueGiftVoucher({
      branchId,
      amount,
      customerId,
      recipientName,
      recipientPhone,
      recipientEmail,
      expiryDays,
      notes,
      userId,
      issueType: resolvedIssueType,
      customCode,
    });

    // If promotional, record accounting entry (best-effort, non-blocking)
    if (resolvedIssueType === "PROMOTIONAL" && result.success && result.voucher) {
      giftVoucherService
        .recordPromotionalVoucherAccounting({
          voucherId: result.voucher.id,
          amount,
          branchId,
          companyId: companyId || result.voucher?.company_id,
          userId,
          voucherCode: result.voucher.voucher_code,
        })
        .catch((err) =>
          console.error("[GiftVoucherController] Promotional accounting error:", err)
        );
    }

    res.status(201).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] issueVoucher error:", err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const batchGenerate = async (req, res) => {
  try {
    const { branchId, count, amount, expiryDays, notes, userId } = req.body;
    const result = await giftVoucherService.batchGenerateVouchers({
      branchId,
      count,
      amount,
      expiryDays,
      notes,
      userId,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] batchGenerate error:", err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const verifyVoucher = async (req, res) => {
  const { code } = req.params;
  const { branchId, billAmount } = req.query;

  try {
    const result = await giftVoucherService.verifyVoucherForRedemption({
      code,
      branchId,
      billAmount,
    });
    if (!result.valid) {
      return res.status(400).json(result);
    }
    res.status(200).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] verifyVoucher error:", err);
    res.status(500).json({ valid: false, message: err.message });
  }
};

const claimVoucher = async (req, res) => {
  try {
    const { voucherCode, invoiceId, invoiceNumber, customerId, branchId, userId } = req.body;
    const result = await giftVoucherService.claimVoucherForInvoice({
      voucherCode,
      invoiceId,
      invoiceNumber,
      customerId,
      branchId,
      userId,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] claimVoucher error:", err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const voidVoucher = async (req, res) => {
  const { id } = req.params;
  const { reason, userId } = req.body;

  try {
    const result = await giftVoucherService.voidVoucher(id, reason, userId);
    res.status(200).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] voidVoucher error:", err);
    res.status(400).json({ success: false, message: err.message });
  }
};

const getList = async (req, res) => {
  const { branchId } = req.params;
  try {
    const result = await giftVoucherService.getGiftVoucherList(branchId, req.query);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[GiftVoucherController] getList error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDashboard = async (req, res) => {
  const { branchId } = req.params;
  try {
    const result = await giftVoucherService.getGiftVoucherDashboard(branchId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[GiftVoucherController] getDashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getVoucher = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await giftVoucherService.getGiftVoucherById(id);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("[GiftVoucherController] getVoucher error:", err);
    res.status(404).json({ success: false, message: err.message });
  }
};

/**
 * GET /gift-vouchers/unlinked/:branchId?search=...
 * Returns ACTIVE vouchers for the quick modal picker in POS / AddInvoice
 */
const getUnlinkedVouchers = async (req, res) => {
  const { branchId } = req.params;
  const { search } = req.query;
  try {
    const vouchers = await giftVoucherService.getUnlinkedVouchers(branchId, search || "");
    res.status(200).json({ success: true, data: vouchers });
  } catch (err) {
    console.error("[GiftVoucherController] getUnlinkedVouchers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /gift-vouchers/invoice-vouchers
 * Converts ACTIVE DIRECT_ISSUED vouchers into a formal invoice.
 * Accounting: DR Cash/Bank  CR Gift Voucher Liability
 */
const invoiceVouchers = async (req, res) => {
  try {
    const {
      voucherIds,
      branchId,
      companyId,
      customerId,
      paymentMethod,
      bankAccountId,
      userId,
      notes,
    } = req.body;

    if (!voucherIds || !Array.isArray(voucherIds) || voucherIds.length === 0) {
      return res.status(400).json({ success: false, message: "No vouchers selected" });
    }

    const result = await giftVoucherService.invoiceGiftVouchers({
      voucherIds,
      branchId,
      companyId,
      customerId,
      paymentMethod: paymentMethod || "cash",
      bankAccountId: bankAccountId || null,
      userId,
      notes,
    });

    res.status(200).json(result);
  } catch (err) {
    console.error("[GiftVoucherController] invoiceVouchers error:", err);
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSettings,
  saveSettings,
  issueVoucher,
  batchGenerate,
  verifyVoucher,
  claimVoucher,
  voidVoucher,
  getList,
  getDashboard,
  getVoucher,
  getUnlinkedVouchers,
  invoiceVouchers,
};
