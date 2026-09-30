const express = require("express");
const router = express.Router();
const {
  createBankAccount,
  getAllCompanyBankAccounts,
  deleteAccount,
  updateAccount,
  getBankAccountLogs,
} = require("../controllers/bankAccountsController");

router.post("/create/:branch_id", createBankAccount);
router.get("/all/:branch_id", getAllCompanyBankAccounts);
router.post("/deactivate/:account_id", deleteAccount);
router.put("/update/:account_id", updateAccount);
router.get("/logs/:account_id/:branch_id", getBankAccountLogs);
module.exports = router;
