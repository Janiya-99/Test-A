const express = require("express");
const router = express.Router();
const {
  getDashboardData,
  getNotifications,
  getTopProducts,
  getCustomerAnalytics,
  getRevenueExpenses,
  getLowStockItems,
  getCreditExceededCustomers,
} = require("../controllers/dashboardController");

// New dashboard analytics endpoints
router.get("/top-products/:Branch_idBranch", getTopProducts);
router.get("/customer-analytics/:Branch_idBranch", getCustomerAnalytics);
router.get("/revenue-expenses/:Branch_idBranch", getRevenueExpenses);
router.get("/low-stock/:Branch_idBranch", getLowStockItems);
router.get("/credit-exceeded/:Branch_idBranch", getCreditExceededCustomers);

// Existing dashboard endpoints
router.get("/notifications/:Branch_idBranch", getNotifications);
router.get("/:Branch_idBranch", getDashboardData);

module.exports = router;

