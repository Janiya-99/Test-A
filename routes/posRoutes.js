const express = require("express");
const router = express.Router();
const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomerById,
  getItems,
  getItemById,
  getItemByBarcode,
  createPos,
  getSuspendedPos,
  getPosById,
  createPlot,
  getPlotLogs,
  closePlot,
  updatePlot,
  getPlotAmount,
  deletePos,
  openRegister,
  closeRegister,
  checkRegisterStatus,
  fetchTodaySales,
  fetchTodayProfit,
  addCashTransaction,
  fetchRegisterHistory,
  fetchRegisterDetails,
} = require("../controllers/posController");

router.post("/create-customer", createCustomer);
router.post("/create-pos", createPos);
router.post("/create-plot", createPlot);
router.post("/close-plot", closePlot);
router.post("/open-register", openRegister);
router.post("/close-register", closeRegister);
router.post("/cash-transaction", addCashTransaction);
router.put("/edit-customer/:idCustomer", updateCustomerById);
router.put("/update-plot", updatePlot);
router.get("/get-customer-by-id/:idCustomer", getCustomerById);
router.get("/get-customer/:Branch_idBranch", getCustomers);
router.get("/get-items/:Branch_idBranch", getItems);
router.get("/get-item-by-id/:idItem", getItemById);
router.get("/get-item-by-barcode/:barcode/:branchId", getItemByBarcode);
router.get("/get-suspended-pos/:Branch_idBranch", getSuspendedPos);
router.delete("/delete-pos/:idPos", deletePos);
router.get("/get-pos-by-id/:idPos", getPosById);
router.get("/plot-logs/:Branch_idBranch", getPlotLogs);
router.get("/get-plot-amount/:idPlot", getPlotAmount);
router.get("/check-register-status", checkRegisterStatus);
router.get("/today-sales", fetchTodaySales);
router.get("/today-profit", fetchTodayProfit);
router.get("/register-history/:userId/:branchId", fetchRegisterHistory);
router.get("/register-details/:registryId", fetchRegisterDetails);

module.exports = router;
