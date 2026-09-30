const dbService = require("../services/expencesDBService");
const approvalService = require("../services/approvalService");

const createExpenses = async (req, res) => {
  try {
    const { branch_id, date, reason, amount } = req.body;
    const companyId = req.user?.company_id || req.headers["company_id"] || 1;
    const createdBy = req.user?.idUser || req.user?.id || 1;

    let approvalRequired = false;
    try {
      approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        branch_id,
        "RECORD_EXPENSE"
      );
    } catch (appErr) {
      console.error("Approval check failed for RECORD_EXPENSE:", appErr);
    }

    if (approvalRequired) {
      const pendingUpdates = req.body;
      await approvalService.triggerApprovalRequest({
        action_type: "RECORD_EXPENSE",
        module_name: "Expense",
        erp_record_id: null,
        company_id: companyId,
        branch_id: branch_id,
        initiated_by: createdBy,
        payload_summary: {
          action: "RECORD_EXPENSE",
          pending_updates: pendingUpdates,
        },
      });
      console.log(`[EXPENSE] Triggered approval request for recording expense`);
      return res.json({
        message: "Expense creation submitted for approval. It will be recorded once approved.",
        approval_required: true,
        approval_status: "PENDING_APPROVAL",
      });
    }

    await dbService.insertExpenses(branch_id, date, reason, amount);

    res.json({
      message: "Expense added successfully",
    });
  } catch (err) {
    console.error("Error creating expense:", err);
    res
      .status(500)
      .json({ message: "Error creating expense", error: err.message });
  }
};

const getExpenses = async (req, res) => {
  try {
    const { branch_id } = req.params;

    const expenses = await dbService.fetchExpenses(branch_id);

    res.json(expenses);
  } catch (err) {
    console.error("Error fetching expenses:", err);
    res
      .status(500)
      .json({ message: "Error fetching expenses", error: err.message });
  }
};

const getExpensesByDate = async (req, res) => {
  const { date } = req.params;
  try {
    const expenses = await dbService.fetchExpensesbyDate(date);
    res.json(expenses);
  } catch (err) {
    console.error("Error fetching expenses:", err);
    res
      .status(500)
      .json({ message: "Error fetching expenses", error: err.message });
  }
};

const deleteExpenses = async (req, res) => {
  try {
    const { ex_id } = req.params;
    await dbService.deleteExpenses(ex_id);
    res.json({ message: "expences deleted successfully" });
  } catch (err) {
    console.error("Error deleting expences:", err);
    res
      .status(500)
      .json({ message: "Error deleting expences", error: err.message });
  }
};

const applyPendingExpenseCreate = async (pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[EXPENSE] No pending updates found for expense creation`);
    return;
  }
  const { branch_id, date, reason, amount } = pendingUpdates;
  await dbService.insertExpenses(branch_id, date, reason, amount);
};

module.exports = {
  createExpenses,
  getExpenses,
  deleteExpenses,
  getExpensesByDate,
  applyPendingExpenseCreate,
};
