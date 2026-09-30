const express = require("express");
const router = express.Router();
const {
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
} = require("../controllers/reportController");

router.get("/get-pnl-report/:from/:to/:Branch_idBranch", getPnLReportData);
router.get("/monthly-sales/:year/:Branch_idBranch", getMonthlySales);
router.get("/daily-sales/:year/:month/:Branch_idBranch", getDailySales);
router.get("/daily-sales-breakdown/:year/:month/:day/:Branch_idBranch", getDailySalesBreakdown);
router.get("/daily-item-sales/:date/:Branch_idBranch", getDailyItemSalesReport);
router.get("/branch/:branchId", fetchUsersByBranch);
router.get("/date-range-sales/:from/:to/:Branch_idBranch", getDateRangeSalesReport);
router.get("/cashier-sales-summary/:from/:to/:Branch_idBranch", getCashierSalesSummaryReport);
router.get("/branch-cashiers/:Branch_idBranch", getBranchCashiers);
router.get("/due-installments-invoices/:Branch_idBranch", getDueInstallmentInvoicesReport);
router.get("/grn-report/:from/:to/:Branch_idBranch", getGrnReport);
router.get("/purchase-order-report/:from/:to/:Branch_idBranch", getPurchaseOrderReport);
router.get("/brand-wise-sales/:from/:to/:Branch_idBranch", getBrandWiseSalesReport);

router.get("/serial-report/:Branch_idBranch", getSerialReport);
router.get("/serial-report/details/:serialId/:Branch_idBranch", getSerialDetails);
router.get("/warehouse-stock-report/:Branch_idBranch", getWarehouseStockReport);
router.get("/manufacturing-report", getManufacturingReport);


module.exports = router;

