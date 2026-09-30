const dbService = require("../services/pLReportDBService");
const db = require("../db/db");

const getPLReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const routeId = req.query.routeId ? Number(req.query.routeId) : null;

    const [rule] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT inventory_valuation_method FROM rules WHERE Branch_idBranch = ?",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });
    const valuationMethod = rule?.inventory_valuation_method || "LATEST";
    const useRealCost = valuationMethod === "AVERAGE";

    const summary = {};

    const invoiceTotal = await dbService.fetchInvoiceTotal(
      from,
      to,
      Branch_idBranch,
      routeId
    );
    const invoiceCost = await dbService.fetchInvoiceCost(
      from,
      to,
      Branch_idBranch,
      useRealCost,
      routeId
    );
    const expensesTotal = await dbService.fetchExpensesTotal(
      from,
      to,
      Branch_idBranch
    );
    const damageTotal = await dbService.fetchDamageTotal(
      from,
      to,
      Branch_idBranch
    );
    const purchaseReturnTotal = await dbService.fetchPurchaseReturnTotal(
      from,
      to,
      Branch_idBranch
    );

    summary.invoiceTotal = invoiceTotal[0].Total;
    summary.invoiceCost = invoiceCost[0].Cost;
    summary.expensesTotal = expensesTotal[0].Total;
    summary.damageTotal = damageTotal[0].Total;
    summary.purchaseReturnTotal = purchaseReturnTotal[0].Total;

    const invoices = await dbService.fetchInvoices(from, to, Branch_idBranch, routeId);
    await Promise.all(
      invoices.map(async (invoice) => {
        const items = await dbService.fetchInvoiceItems(invoice.idInvoice);
        invoice.items = items;
      })
    );

    const damages = await dbService.fetchDamages(from, to, Branch_idBranch);
    await Promise.all(
      damages.map(async (damage) => {
        const items = await dbService.fetchDamageItems(damage.idDamage_Note);
        damage.items = items;
      })
    );

    const expenses = await dbService.fetchExpenses(from, to, Branch_idBranch);
    const purchaseReturns = await dbService.fetchPurchaseReturns(
      from,
      to,
      Branch_idBranch
    );

    res.json({
      summary: summary,
      invoices: invoices,
      damages: damages,
      expenses: expenses,
      purchaseReturns: purchaseReturns,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating expense", error: err.message });
  }
};

module.exports = {
  getPLReport,
};
