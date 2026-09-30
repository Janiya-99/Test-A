const dbService = require("../services/reportDBService");
const db = require("../db/db");

const getPnLReportData = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const routeId = req.query.routeId ? Number(req.query.routeId) : null;
    let data = {};
    let invoice_total_amount = 0;
    let damage_total_amount = 0;
    let expense_total_amount = 0;
    let total_profit = 0;
    let invoice_profit = 0;
    let total_invoice_item_cost = 0;
    const [rule] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT inventory_valuation_method, profit_loss_by_paid_amount FROM rules WHERE Branch_idBranch = ?",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });
    const valuationMethod = rule?.inventory_valuation_method || "LATEST";
    const profitLossByPaidAmount = rule?.profit_loss_by_paid_amount || 0;

    let invoices_data = [];

    if (profitLossByPaidAmount === 1) {
      // CASH-BASIS P&L: Calculate from Payments
      const payments = await dbService.fetchPayments(from, to, Branch_idBranch);
      if (payments.length !== 0) {
        const results = await Promise.all(
          payments.map(async (payment) => {
            const payment_amount = parseFloat(payment.Debit || 0);
            if (payment_amount <= 0) return null;

            let invoice = null;
            if (payment.Type_Id) {
              invoice = await dbService.fetchInvoiceById(payment.Type_Id);
            }

            if (invoice) {
              if (routeId && invoice.Route_idRoute !== routeId) {
                return null;
              }
              const invoice_items = await dbService.fetchInvoiceItems(invoice.idInvoice);
              let total_cost = 0;
              const has_return_items = invoice_items.some(item => item.Discount_Type === "RTN");

              if (has_return_items) {
                let new_items_cost = 0;
                let returned_items_cost = 0;

                await Promise.all(
                  invoice_items.map(async (item) => {
                    let unitCost = 0;
                    if (item.is_manual_item === 1 || item.Item_idItem <= 0) {
                      unitCost = parseFloat(item.manual_cost || 0);
                    } else if (item.Variation_Id && item.Variation_Id > 0) {
                      const variation_cost = await dbService.getVariationCostById(item.Variation_Id);
                      unitCost = parseFloat((variation_cost[0] && variation_cost[0].Cost) || 0);
                    } else {
                      const item_cost = await dbService.getitemCostByid(item.Item_idItem);
                      unitCost = (valuationMethod === "AVERAGE" && item_cost[0] && item_cost[0].Real_Cost !== null)
                        ? parseFloat(item_cost[0].Real_Cost)
                        : parseFloat((item_cost[0] && item_cost[0].Cost) || 0);
                    }

                    item.unit_cost = unitCost;

                    if (item.Discount_Type === "RTN") {
                      returned_items_cost += unitCost * parseFloat(item.Qty || 0);
                    } else {
                      new_items_cost += unitCost * parseFloat(item.Qty || 0);
                    }
                  })
                );

                total_cost = new_items_cost - returned_items_cost;
              } else {
                await Promise.all(
                  invoice_items.map(async (item) => {
                    let unitCost = 0;
                    if (item.is_manual_item === 1 || item.Item_idItem <= 0) {
                      unitCost = parseFloat(item.manual_cost || 0);
                    } else if (item.Variation_Id && item.Variation_Id > 0) {
                      const variation_cost = await dbService.getVariationCostById(item.Variation_Id);
                      unitCost = parseFloat((variation_cost[0] && variation_cost[0].Cost) || 0);
                    } else {
                      const item_cost = await dbService.getitemCostByid(item.Item_idItem);
                      unitCost = (valuationMethod === "AVERAGE" && item_cost[0] && item_cost[0].Real_Cost !== null)
                        ? parseFloat(item_cost[0].Real_Cost)
                        : parseFloat((item_cost[0] && item_cost[0].Cost) || 0);
                    }

                    item.unit_cost = unitCost;

                    total_cost += unitCost * parseFloat(item.Qty);
                  })
                );
              }

              const net_amount = parseFloat(invoice.Net_Amount || 0);
              const vat_amount = parseFloat(invoice.Vat_Amount || 0);
              const scale_ratio = net_amount > 0 ? (payment_amount / net_amount) : 0;
              const payment_vat = vat_amount * scale_ratio;
              const payment_amount_ex_vat = payment_amount - payment_vat;

              const cost_ratio = net_amount > 0 ? (total_cost / net_amount) : 0;
              const payment_cost = payment_amount * cost_ratio;
              const payment_profit = payment_amount_ex_vat - payment_cost;

              return {
                isLinked: true,
                payment_amount: payment_amount_ex_vat,
                payment_cost,
                payment_profit,
                invoice_data: {
                  ...invoice,
                  idInvoice: invoice.idInvoice,
                  Invoice_Number: invoice.Invoice_Number,
                  Date: payment.Date_Time,
                  Total: parseFloat(invoice.Total || 0) * scale_ratio,
                  Discount_Amount: parseFloat(invoice.Discount_Amount || 0) * scale_ratio,
                  Vat_Amount: payment_vat,
                  Extra_Charge: parseFloat(invoice.Extra_Charge || 0) * scale_ratio,
                  Net_Amount: payment_amount_ex_vat,
                  profit: payment_profit,
                  cost: payment_cost,
                  item_count: invoice_items.length,
                  items: invoice_items.map((it) => ({
                    ...it,
                    Qty: parseFloat(it.Qty) * scale_ratio,
                    Total_Amount: parseFloat(it.Total_Amount) * scale_ratio,
                    unit_cost: it.unit_cost,
                  })),
                }
              };
            } else {
              const payment_profit = payment_amount;
              const payment_cost = 0;

              return {
                isLinked: false,
                payment_amount,
                payment_cost,
                payment_profit,
                invoice_data: {
                  idInvoice: 0,
                  Invoice_Number: payment.receipt_number || `PMT-${payment.idCustomer_Credit_Log}`,
                  displayName: payment.displayName || payment.Name || "Customer Payment",
                  Name: payment.displayName || payment.Name || "Customer Payment",
                  Date: payment.Date_Time,
                  Total: payment_amount,
                  Discount_Amount: 0,
                  Vat_Amount: 0,
                  Extra_Charge: 0,
                  Net_Amount: payment_amount,
                  profit: payment_profit,
                  cost: payment_cost,
                  item_count: 0,
                  items: [],
                }
              };
            }
          })
        );

        // Aggregate results
        results.forEach((res) => {
          if (res) {
            invoice_total_amount += res.payment_amount;
            total_invoice_item_cost += res.payment_cost;
            invoice_profit += res.payment_profit;
            invoices_data.push(res.invoice_data);
          }
        });
      }
    } else {
      // ACCRUAL-BASIS P&L: Calculate from whole Invoices (Existing Logic)
      const invoices = await dbService.fetchInvoices(from, to, Branch_idBranch, routeId);
      if (invoices.length !== 0) {
        await Promise.all(
          invoices.map(async (invoice, index) => {
            let invoice_data = {};
            const net_amount = parseFloat(invoice.Net_Amount || 0);
            const vat_amount = parseFloat(invoice.Vat_Amount || 0);
            const net_amount_ex_vat = net_amount - vat_amount;
            invoice_total_amount += net_amount_ex_vat;

            const invoice_items = await dbService.fetchInvoiceItems(
              invoice.idInvoice
            );
            let cost = 0;
            const has_return_items = invoice_items.some(item => item.Discount_Type === "RTN");

            if (has_return_items) {
              let new_items_cost = 0;
              let returned_items_cost = 0;

              await Promise.all(
                invoice_items.map(async (item) => {
                  let unitCost = 0;
                  if (item.is_manual_item === 1 || item.Item_idItem <= 0) {
                    unitCost = parseFloat(item.manual_cost || 0);
                  } else if (item.Variation_Id && item.Variation_Id > 0) {
                    const variation_cost = await dbService.getVariationCostById(item.Variation_Id);
                    unitCost = parseFloat((variation_cost[0] && variation_cost[0].Cost) || 0);
                  } else {
                    const item_cost = await dbService.getitemCostByid(item.Item_idItem);
                    unitCost = (valuationMethod === "AVERAGE" && item_cost[0] && item_cost[0].Real_Cost !== null)
                      ? parseFloat(item_cost[0].Real_Cost)
                      : parseFloat((item_cost[0] && item_cost[0].Cost) || 0);
                  }

                  item.unit_cost = unitCost;

                  if (item.Discount_Type === "RTN") {
                    returned_items_cost += unitCost * parseFloat(item.Qty || 0);
                  } else {
                    new_items_cost += unitCost * parseFloat(item.Qty || 0);
                  }
                })
              );

              cost = new_items_cost - returned_items_cost;
              total_invoice_item_cost += cost;
            } else {
              await Promise.all(
                invoice_items.map(async (item, index) => {
                  let unitCost = 0;
                  if (item.is_manual_item === 1 || item.Item_idItem <= 0) {
                    unitCost = parseFloat(item.manual_cost || 0);
                  } else if (item.Variation_Id && item.Variation_Id > 0) {
                    const variation_cost = await dbService.getVariationCostById(item.Variation_Id);
                    unitCost = parseFloat((variation_cost[0] && variation_cost[0].Cost) || 0);
                  } else {
                    const item_cost = await dbService.getitemCostByid(
                      item.Item_idItem
                    );
                    unitCost = (valuationMethod === "AVERAGE" && item_cost[0] && item_cost[0].Real_Cost !== null)
                      ? parseFloat(item_cost[0].Real_Cost)
                      : parseFloat((item_cost[0] && item_cost[0].Cost) || 0);
                  }

                  item.unit_cost = unitCost;

                  let item_total_cost = unitCost * parseFloat(item.Qty);
                  total_invoice_item_cost += item_total_cost;
                  cost += item_total_cost;
                })
              );
            }

            let profit = net_amount_ex_vat - cost;
            invoice_profit += profit;
            invoice_data = {
              ...invoice,
              Net_Amount: net_amount_ex_vat,
              profit: profit,
              cost: cost,
              item_count: invoice_items.length,
              items: invoice_items,
            };
            invoices_data.push(invoice_data);
          })
        );
      }
    }

    const damages = await dbService.fetchDamages(from, to, Branch_idBranch);
    let damages_data = [];
    if (damages.length !== 0) {
      await Promise.all(
        damages.map(async (damage, index) => {
          damage_total_amount += parseFloat(damage.Total_Amount);
          const damage_items = await dbService.fetchDamageItems(
            damage.idDamage_Note
          );
          let damage_data = {
            ...damage,
            damage_items: damage_items,
          };
          damages_data.push(damage_data);
        })
      );
    }

    const expenses = await dbService.fetchExpenses(from, to, Branch_idBranch);

    const expense_total = await dbService.fetchExpenseTotal(
      from,
      to,
      Branch_idBranch
    );

    if (expense_total[0].Total !== null) {
      expense_total_amount = parseFloat(expense_total[0].Total);
    }

    const purchase_returns = await dbService.fetchPurchaseReturns(
      from,
      to,
      Branch_idBranch
    );

    const purchase_return_total = await dbService.fetchPurchaseReturnTotal(
      from,
      to,
      Branch_idBranch
    );
    const purchase_return_total_amount = parseFloat(
      (purchase_return_total && purchase_return_total[0]?.Total) || 0
    );

    total_profit =
      invoice_profit - (damage_total_amount + expense_total_amount);

    data = {
      invoices: invoices_data,
      damages: damages_data,
      expenses: expenses,
      purchase_returns: purchase_returns,
      purchase_return_total_amount: purchase_return_total_amount,
      total_profit: total_profit,
      invoice_total_amount: invoice_total_amount,
      damage_total_amount: damage_total_amount,
      expense_total_amount: expense_total_amount,
      invoice_profit: invoice_profit,
      total_invoice_item_cost: total_invoice_item_cost,
    };

    res.json(data);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching quotations",
      error: err.message,
    });
  }
};

const getMonthlySales = async (req, res) => {
  try {
    const { year, Branch_idBranch } = req.params;
    const { salesmanId } = req.query;

    const [rule] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT profit_loss_by_paid_amount FROM rules WHERE Branch_idBranch = ?",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });
    const profitLossByPaidAmount = rule?.profit_loss_by_paid_amount || 0;

    const monthlySales = profitLossByPaidAmount === 1
      ? await dbService.getMonthlySalesSummaryCashBasis(year, Branch_idBranch, salesmanId)
      : await dbService.getMonthlySalesSummary(year, Branch_idBranch, salesmanId);

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const salesData = {};

    // Initialize all months with default structure
    monthNames.forEach((month) => {
      salesData[month] = {
        invoice_count: 0,
        total_discount: 0,
        total_net: 0,
        sold_qty: 0,
        free_qty: 0,
      };
    });

    // Fill the actual data
    for (const row of monthlySales) {
      const monthIndex = row.month - 1;
      const monthName = monthNames[monthIndex];
      salesData[monthName] = {
        invoice_count: parseInt(row.invoice_count || 0),
        total_discount: parseFloat(row.total_discount || 0),
        total_net: parseFloat(row.total_net || 0),
        sold_qty: parseFloat(row.sold_qty || 0),
        free_qty: parseFloat(row.free_qty || 0),
      };
    }

    res.json(salesData);
  } catch (err) {
    console.error("Error in monthly sales report:", err);
    res.status(500).json({
      message: "Failed to fetch monthly sales data.",
      error: err.message,
    });
  }
};

const getDailySales = async (req, res) => {
  try {
    const { year, month, Branch_idBranch } = req.params;
    const { salesmanId } = req.query;

    const [rule] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT profit_loss_by_paid_amount FROM rules WHERE Branch_idBranch = ?",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });
    const profitLossByPaidAmount = rule?.profit_loss_by_paid_amount || 0;

    const dailySales = profitLossByPaidAmount === 1
      ? await dbService.getDailySalesSummaryCashBasis(year, month, Branch_idBranch, salesmanId)
      : await dbService.getDailySalesSummary(year, month, Branch_idBranch, salesmanId);

    // Map to day-wise object
    const salesData = {};
    for (let i = 1; i <= 31; i++) {
      salesData[i] = {
        invoice_count: 0,
        total_discount: 0,
        total_net: 0,
        sold_qty: 0,
        free_qty: 0,
      };
    }

    dailySales.forEach((row) => {
      salesData[row.day] = {
        invoice_count: row.invoice_count || 0,
        total_discount: parseFloat(row.total_discount || 0),
        total_net: parseFloat(row.total_net || 0),
        sold_qty: parseFloat(row.sold_qty || 0),
        free_qty: parseFloat(row.free_qty || 0),
      };
    });

    res.json(salesData);
  } catch (err) {
    console.error("Error in daily sales report:", err);
    res.status(500).json({
      message: "Failed to fetch daily sales data.",
      error: err.message,
    });
  }
};

const fetchUsersByBranch = (req, res) => {
  const branchId = parseInt(req.params.branchId);

  if (isNaN(branchId)) {
    return res.status(400).json({ message: "Invalid branch ID." });
  }

  const query = `SELECT * FROM user WHERE Branch_idBranch = ?`;

  db.query(query, [branchId], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ message: "Failed to fetch users." });
    }

    res.json(results);
  });
};




const getSerialReport = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status || "all";

    const offset = (page - 1) * limit;

    const data = await dbService.fetchSerialNumbersReport(
      Branch_idBranch,
      limit,
      offset,
      search,
      status
    );

    const total = await dbService.countSerialNumbersReport(
      Branch_idBranch,
      search,
      status
    );

    res.json({
      success: true,
      data,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("Error fetching serial report:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch serial report data.",
      error: err.message,
    });
  }
};

const getSerialDetails = async (req, res) => {
  try {
    const { serialId, Branch_idBranch } = req.params;

    const details = await dbService.getSerialNumberDetails(serialId, Branch_idBranch);

    if (!details) {
      return res.status(404).json({
        success: false,
        message: "Serial number not found or access denied.",
      });
    }

    res.json({
      success: true,
      data: details,
    });
  } catch (err) {
    console.error("Error fetching serial details:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch serial details.",
      error: err.message,
    });
  }
};

const getWarehouseStockReport = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { warehouseId, categoryId, search, warehouseType, responsibleUserId } = req.query;

    const stock = await dbService.fetchWarehouseStockReport(
      Branch_idBranch,
      warehouseId,
      categoryId,
      search,
      warehouseType,
      responsibleUserId
    );

    res.json({
      success: true,
      data: stock
    });
  } catch (err) {
    console.error("Error fetching warehouse stock report:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch warehouse stock report data.",
      error: err.message,
    });
  }
};

const getDateRangeSalesReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const { salesmanId } = req.query;

    const sales = await dbService.getDateRangeSalesSummary(from, to, Branch_idBranch, salesmanId);
    const returns = await dbService.getDateRangeReturnsSummary(from, to, Branch_idBranch, salesmanId);

    const totalSales = sales.reduce((sum, item) => sum + parseFloat(item.Net_Amount || 0), 0);
    const totalReturns = returns.reduce((sum, item) => sum + parseFloat(item.Total_Amount || 0), 0);
    const totalDiscount = sales.reduce((sum, item) => sum + parseFloat(item.Discount_Amount || 0), 0);

    res.json({
      sales,
      returns,
      summary: {
        total_sales: totalSales,
        total_returns: totalReturns,
        net_sales: totalSales - totalReturns,
        invoice_count: sales.length,
        return_count: returns.length,
        total_discount: totalDiscount,
      }
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching date range sales report data",
      error: err.message,
    });
  }
};

const getDueInstallmentInvoicesReport = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { from, to, customer } = req.query;

    // Fetch invoices that have installment payments
    let query = `
      SELECT DISTINCT 
        inv.idInvoice,
        inv.Invoice_Number,
        inv.Date AS Invoice_Date,
        (SELECT SUM(Amount) FROM installment_payment WHERE Invoice_idInvoice = inv.idInvoice) AS Net_Amount,
        (SELECT SUM(Paid_Amount) FROM installment_payment WHERE Invoice_idInvoice = inv.idInvoice) AS Invoice_Paid,
        (SELECT SUM(Balance_Amount) FROM installment_payment WHERE Invoice_idInvoice = inv.idInvoice) AS Invoice_Balance,
        c.displayName AS Customer_Name,
        c.phoneNumber AS Customer_Contact
      FROM installment_payment ip
      INNER JOIN invoice inv ON ip.Invoice_idInvoice = inv.idInvoice
      INNER JOIN customer c ON ip.Customer_idCustomer = c.idCustomer
      WHERE ip.Branch_idBranch = ?
    `;
    const params = [Branch_idBranch];

    if (customer && customer !== "all") {
      query += ` AND ip.Customer_idCustomer = ?`;
      params.push(customer);
    }
    if (from && to) {
      query += ` AND DATE(inv.Date) BETWEEN ? AND ?`;
      params.push(from, to);
    }

    query += ` ORDER BY inv.idInvoice DESC`;

    const invoices = await new Promise((resolve, reject) => {
      db.query(query, params, (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });

    if (invoices.length === 0) {
      return res.json([]);
    }

    const invoiceIds = invoices.map(i => i.idInvoice);

    // Fetch all installments for these invoices
    const installmentQuery = `
      SELECT 
        ip.idInstallment_Payment,
        ip.Invoice_idInvoice,
        ip.Date AS Installment_Date,
        ip.Term,
        ip.Amount,
        ip.Penalty_Amount,
        ip.Total_Pending_Amount,
        ip.Paid_Amount,
        ip.Balance_Amount,
        ip.Status,
        ip.Paid_Date
      FROM installment_payment ip
      WHERE ip.Invoice_idInvoice IN (?)
      ORDER BY ip.Invoice_idInvoice DESC, ip.Term ASC
    `;

    const installments = await new Promise((resolve, reject) => {
      db.query(installmentQuery, [invoiceIds], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });

    // Group installments by Invoice
    const grouped = invoices.map(inv => {
      const invInstallments = installments.filter(inst => inst.Invoice_idInvoice === inv.idInvoice);
      return {
        ...inv,
        installments: invInstallments
      };
    });

    res.json(grouped);
  } catch (err) {
    console.error("Error generating due installment invoice report:", err);
    res.status(500).json({
      message: "Error generating due installment invoice report",
      error: err.message
    });
  }
};

const getManufacturingReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.query;
    if (!from || !to || !Branch_idBranch) {
      return res.status(400).json({ message: "Parameters from, to, and Branch_idBranch are required." });
    }
    const data = await dbService.getManufacturingReportData(from, to, Branch_idBranch);
    res.json(data);
  } catch (err) {
    console.error("Error generating manufacturing report:", err);
    res.status(500).json({
      message: "Error generating manufacturing report",
      error: err.message
    });
  }
};

const getDailySalesBreakdown = async (req, res) => {
  try {
    const { year, month, day, Branch_idBranch } = req.params;
    const { salesmanId } = req.query;

    const [rule] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT profit_loss_by_paid_amount FROM rules WHERE Branch_idBranch = ?",
        [Branch_idBranch],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        }
      );
    });
    const profitLossByPaidAmount = rule?.profit_loss_by_paid_amount || 0;

    const breakdown = profitLossByPaidAmount === 1
      ? await dbService.getDailySalesBreakdownCashBasis(year, month, day, Branch_idBranch, salesmanId)
      : await dbService.getDailySalesBreakdown(year, month, day, Branch_idBranch, salesmanId);

    res.json(breakdown);
  } catch (err) {
    console.error("Error in daily sales breakdown:", err);
    res.status(500).json({
      message: "Failed to fetch daily sales breakdown.",
      error: err.message,
    });
  }
};

const getGrnReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const data = await dbService.fetchGrnReportData(from, to, Branch_idBranch);
    res.json(data);
  } catch (err) {
    console.error("Error in getGrnReport:", err);
    res.status(500).json({
      message: "Failed to fetch GRN report data.",
      error: err.message,
    });
  }
};

const getPurchaseOrderReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const { supplierId } = req.query;
    const data = await dbService.fetchPurchaseOrderReportData(from, to, Branch_idBranch, supplierId);
    res.json(data);
  } catch (err) {
    console.error("Error in getPurchaseOrderReport:", err);
    res.status(500).json({
      message: "Failed to fetch Purchase Order report data.",
      error: err.message,
    });
  }
};

const getBrandWiseSalesReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const data = await dbService.fetchBrandWiseSalesReportData(from, to, Branch_idBranch);
    res.json(data);
  } catch (err) {
    console.error("Error in getBrandWiseSalesReport:", err);
    res.status(500).json({
      message: "Failed to fetch brand-wise sales report data.",
      error: err.message,
    });
  }
};

const getDailyItemSalesReport = async (req, res) => {
  try {
    const { date, Branch_idBranch } = req.params;
    const { salesmanId, categoryId } = req.query;
    if (!date || !Branch_idBranch) {
      return res.status(400).json({ message: "date and Branch_idBranch are required." });
    }
    const data = await dbService.getDailyItemWiseSalesReportData(date, Branch_idBranch, salesmanId, categoryId);
    res.json(data);
  } catch (err) {
    console.error("Error in getDailyItemSalesReport:", err);
    res.status(500).json({
      message: "Failed to fetch daily item-wise sales report data.",
      error: err.message,
    });
  }
};

const getCashierSalesSummaryReport = async (req, res) => {
  try {
    const { from, to, Branch_idBranch } = req.params;
    const { cashierId } = req.query;

    const rows = await dbService.getCashierSalesSummary(
      from,
      to,
      Branch_idBranch,
      cashierId
    );

    // Employee_idEmployee is NOT NULL but can be 0 when no user/employee context existed
    const refIds = [
      ...new Set(rows.map((r) => Number(r.cashierRefId)).filter((id) => id > 0)),
    ];
    const identities = await dbService.getCashierIdentities(refIds);
    const identityMap = new Map(
      identities.map((u) => [Number(u.idAsipiya_User), u])
    );

    const cashiers = rows.map((row) => {
      const identity = identityMap.get(Number(row.cashierRefId));
      const cashierName = identity
        ? `${identity.First_Name || ""} ${identity.Last_Name || ""}`.trim() ||
        identity.Email
        : "Unknown Cashier";

      const cashTotal = parseFloat(row.cashTotal || 0);
      const cardTotal = parseFloat(row.cardTotal || 0);
      const chequeTotal = parseFloat(row.chequeTotal || 0);
      const bankTotal = parseFloat(row.bankTotal || 0);
      const otherTotal = parseFloat(row.otherTotal || 0);
      const creditBalance = parseFloat(row.creditBalanceTotal || 0);

      const totalCollected =
        cashTotal + cardTotal + chequeTotal + bankTotal + otherTotal;

      return {
        cashierRefId: Number(row.cashierRefId),
        cashierName,
        cashierEmail: identity ? identity.Email : null,
        invoiceCount: Number(row.invoiceCount || 0),
        cashTotal,
        cardTotal,
        chequeTotal,
        bankTotal,
        otherTotal,
        creditBalance,
        totalCollected,
        totalSales: totalCollected + creditBalance,
      };
    });

    const summary = cashiers.reduce(
      (acc, c) => {
        acc.totalCash += c.cashTotal;
        acc.totalCard += c.cardTotal;
        acc.totalCheque += c.chequeTotal;
        acc.totalBank += c.bankTotal;
        acc.totalOther += c.otherTotal;
        acc.totalCredit += c.creditBalance;
        acc.grandTotalSales += c.totalSales;
        acc.grandTotalCollected += c.totalCollected;
        acc.invoiceCount += c.invoiceCount;
        return acc;
      },
      {
        totalCash: 0,
        totalCard: 0,
        totalCheque: 0,
        totalBank: 0,
        totalOther: 0,
        totalCredit: 0,
        grandTotalSales: 0,
        grandTotalCollected: 0,
        invoiceCount: 0,
      }
    );

    const topCashier = cashiers.reduce(
      (top, c) => (!top || c.totalSales > top.totalSales ? c : top),
      null
    );

    res.json({
      success: true,
      from,
      to,
      cashiers,
      summary: {
        ...summary,
        topCashierName: topCashier ? topCashier.cashierName : null,
        topCashierSales: topCashier ? topCashier.totalSales : 0,
      },
    });
  } catch (err) {
    console.error("Error in cashier sales summary report:", err);
    res.status(500).json({
      message: "Error fetching cashier sales summary report data",
      error: err.message,
    });
  }
};

const getBranchCashiers = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const cashiers = await dbService.getBranchCashiers(Branch_idBranch);

    res.json(
      cashiers.map((c) => ({
        idAsipiya_User: c.idAsipiya_User,
        name:
          `${c.First_Name || ""} ${c.Last_Name || ""}`.trim() || c.Email,
        email: c.Email,
      }))
    );
  } catch (err) {
    console.error("Error fetching branch cashiers:", err);
    res.status(500).json({
      message: "Failed to fetch branch cashiers.",
      error: err.message,
    });
  }
};

module.exports = {
  getPnLReportData,
  getMonthlySales,
  getDailySales,
  fetchUsersByBranch,
  getSerialReport,
  getSerialDetails,
  getWarehouseStockReport,
  getDateRangeSalesReport,
  getDueInstallmentInvoicesReport,
  getManufacturingReport,
  getDailySalesBreakdown,
  getGrnReport,
  getPurchaseOrderReport,
  getBrandWiseSalesReport,
  getDailyItemSalesReport,
  getCashierSalesSummaryReport,
  getBranchCashiers,
};


