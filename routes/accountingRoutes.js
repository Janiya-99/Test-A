const express = require('express');
const router = express.Router();
const accountingController = require('../controllers/accountingController');

// Define accounting analytics endpoints
router.get('/accounts', accountingController.getAllChartAccounts);
router.post('/accounts', accountingController.createUserAccount);
router.get('/accounts/:id/logs', accountingController.getChartAccountLogs);
router.get('/summary', accountingController.getAccountingSummary);
router.get('/trial-balance', accountingController.getTrialBalance);
router.get('/advanced-profit-and-loss', accountingController.getAdvancedProfitAndLoss);
router.get('/balance-sheet', accountingController.getBalanceSheet);
router.post('/initialize', accountingController.initializeAccounts);
router.post('/manual-journal', accountingController.createManualJournal);
router.post('/reconcile', accountingController.reconcileAccountLogs);
router.post('/sync-inventory-valuation', accountingController.syncInventoryValuation);

module.exports = router;
