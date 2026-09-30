const { get } = require("../routes/invoiceRoutes");
const dbService = require("../services/bankAccountDBService");
const logDbService = require("../services/bankAccountLogDBService");
const { fetchBranch } = require("../services/branchDBService");
const { creditDebitLogHelper, findAccountByNameAndGroup } = require("./accountingController");

const createBankAccount = async (req, res) => {
  try {
    const {
      bank_type,
      account_name,
      bank_branch,
      bank_name,
      account_number,
      account_balance,
      user,
    } = req.body;

    const { branch_id } = req.params;

    const initial_balance = account_balance ? parseFloat(account_balance).toFixed(2) : "0.00";
    
    // Get the main Bank Account parent ID for this branch
    const parent_account_id = await dbService.getMainBankAccountByBranch(branch_id);
    if (!parent_account_id) {
      return res.status(400).json({
        success: false,
        message: "Main Bank Account (Chart of Accounts) not found for this branch",
      });
    }

    // Fetch company ID from branch
    const branchDetails = await fetchBranch(branch_id);
    const companyId = branchDetails?.[0]?.Company_idCompany;

    const code = account_number ? String(account_number).trim().slice(-8) : null;
    const type = "Assets";
    const cashflow = "Non Applicable";
    const acc_type_group = "Assets";
    const description = null;
    const status = 1;
    const primary_account = 0;
    const tracking_no = "-";

    const result = await dbService.insertCompanyBankAccount(
      bank_type,
      bank_name,
      account_name,
      account_number,
      bank_branch,
      "0.00",
      code,
      type,
      cashflow,
      acc_type_group,
      description,
      user,
      status,
      primary_account,
      tracking_no,
      branch_id,
      parent_account_id,
      companyId
    );

    // Success response
    res.status(201).json({
      success: true,
      message: "Bank account created successfully",
      data: result,
    });

    if (result) {
      const initBalVal = account_balance ? parseFloat(account_balance) : 0;
      if (initBalVal > 0) {
        try {
          // Use already fetched branchDetails and companyId
          if (companyId) {
            let equityAccountId = await findAccountByNameAndGroup("Opening Balance Equity", "Equity", companyId, branch_id);
            if (!equityAccountId) {
              const prefix = "6000";
              const defaultEquityCode = `${prefix}-001`;
              const insertEquityQuery = `
                INSERT INTO accounting_accounts 
                (Account_Type, Account_Name, Account_Number, Account_Balance, Account_Code, Type, Group_Of_Type, Description, User_idUser, Status, Branch_idBranch, companyId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `;
              const dbInstance = require("../db/db");
              const equityResult = await new Promise((resolve, reject) => {
                dbInstance.query(insertEquityQuery, [
                  "Equity", "Opening Balance Equity", "-", 0, defaultEquityCode, "Equity", "Equity", "Opening Balance Equity account", user || 1, 1, branch_id, companyId
                ], (err, resVal) => err ? reject(err) : resolve(resVal));
              });
              equityAccountId = equityResult.insertId;
            }

            // 3. Debit the new sub-bank account directly
            await creditDebitLogHelper({
              accountType: "Bank Account",
              group: "Assets",
              amount: initBalVal,
              description: `Opening balance for bank account: ${account_name}`,
              type: "Opening Balance",
              accountId: result.insertId,
              branchId: branch_id,
              userId: user || 1,
              companyId,
              transactionType: "debit"
            });

            // 4. Credit the Opening Balance Equity account
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Equity",
              amount: initBalVal,
              description: `Opening balance for bank account: ${account_name}`,
              type: "Opening Balance",
              accountId: equityAccountId,
              branchId: branch_id,
              userId: user || 1,
              companyId,
              transactionType: "credit"
            });
          }
        } catch (accError) {
          console.error("Error posting double entry for bank opening balance:", accError);
        }
      } else {
        // Create initial log entry for the new bank account (only if balance is 0, since creditDebitLogHelper handles it otherwise)
        try {
          const type = "Account Creation";
          const description = "Initial opening balance";
          const note = "-";
          const debit = "0.00";
          const credit = "0.00";
          const balance = "0.00";
          const updated_status = null;
          const updated_note = null;
          const updated_user = null;
          const payment_id = "0";
          const contra_account = "-";
          const reconcilation_status = "0";

          await logDbService.insertCompanyBankAccountLog(
            result.insertId,
            type,
            description,
            note,
            debit,
            credit,
            balance,
            user,
            updated_status,
            updated_note,
            updated_user,
            payment_id,
            contra_account,
            reconcilation_status,
            branch_id
          );
        } catch (logError) {
          console.error("Error creating initial bank account log:", logError);
        }
      }
    }
  } catch (error) {
    console.error("Error creating bank account:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create bank account",
      error: error.message,
    });
  }
};

const getAllCompanyBankAccounts = async (req, res) => {
  try {
    const { branch_id } = req.params;

    const parent_account_id = await dbService.getMainBankAccountByBranch(branch_id);
    if (!parent_account_id) {
       return res.status(200).json({
        success: true,
        message: "No bank accounts found for this branch",
        accounts: [],
      });
    }

    const results = await dbService.getAllCompanyBankAccounts(branch_id, parent_account_id);

    if (results?.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No bank accounts found for this branch",
        accounts: [],
      });
    }

    res.status(200).json({
      success: true,
      message: "Bank accounts retrieved successfully",
      accounts: results,
    });
  } catch (error) {
    console.error("Error retrieving bank accounts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve bank accounts",
      error: error.message,
    });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const { account_id } = req.params;
    const { updated_user, branch_id } = req.body;

    const checkAccount = await dbService.getAccountById(account_id, branch_id);
    if (checkAccount.length === 0 || !checkAccount) {
      return res.status(404).json({
        success: false,
        message: "Bank account not found",
      });
    }

    const deleteResult = await dbService.deleteBankAccount(
      account_id,
      branch_id
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete bank account",
      });
    }
    res.status(200).json({
      success: true,
      message: "Bank account deleted successfully",
    });
    console.log("Delete result", deleteResult);
    console.log("Acc", checkAccount[0]);
    console.log("Updated user", updated_user);

    if (deleteResult.affectedRows > 0) {
      // Log the deletion of the bank account
      try {
        const bank_acc_id = checkAccount[0].idbank;
        const type = "Account Deactivation";
        const description = checkAccount[0].description;
        const note = checkAccount[0].note || "-";
        const debit = checkAccount[0].debit || "0.00";
        const credit = checkAccount[0].credit || "0.00";
        const balance = checkAccount[0].account_balance;
        const user = checkAccount[0].user;
        const updated_status = "updated to inactive";
        const updated_note = `Account deactivated by ${updated_user} `;
        const updated_date_time = new Date();
        const payment_id = checkAccount[0].payment_id || "0";
        const contra_account = checkAccount[0].contra_account || "-";
        const reconcilation_status =
          checkAccount[0].reconcilation_status || "0";

        await logDbService.insertCompanyBankAccountUpdateLog(
          bank_acc_id,
          type,
          description,
          note,
          debit,
          credit,
          balance,
          user,
          updated_status,
          updated_note,
          updated_date_time,
          updated_user,
          payment_id,
          contra_account,
          reconcilation_status,
          branch_id
        );
      } catch (logError) {
        console.error("Error creating initial bank account log:", logError);
      }
    }
  } catch (error) {
    console.error("Error deleting bank account:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete bank account",
      error: error.message,
    });
  }
};

const updateAccount = async (req, res) => {
  try {
    const { account_id } = req.params;
    const {
      bank_type,
      account_name,
      bank_branch,
      bank_name,
      account_number,
      updated_user,
      branch_id,
    } = req.body;

    //validate req.body
    if (
      !bank_type ||
      !account_name ||
      !bank_branch ||
      !bank_name ||
      !account_number
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!branch_id || !updated_user) {
      return res.status(400).json({
        success: false,
        message: "Branch ID and Updated User are required",
      });
    }

    const existingAccount = await dbService.getAccountById(
      account_id,
      branch_id
    );
    if (!existingAccount || existingAccount.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Bank account not found",
      });
    }

    // Update the bank account
    const result = await dbService.updateCompanyBankAccount(
      account_id,
      bank_type,
      bank_name,
      account_name,
      account_number,
      bank_branch,
      updated_user,
      branch_id
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to update bank account",
      });
    }

    res.status(200).json({
      success: true,
      message: "Bank account updated successfully",
    });

    // Log the update action
    try {
      const account = existingAccount[0];
      const bank_acc_id = account.idbank;
      const type = "Account Update";
      const description = account.description;
      const note = account.note || "-";
      const debit = account.debit || "0.00";
      const credit = account.credit || "0.00";
      const balance = account.account_balance;
      const user = account.user;
      const updated_status = "updated";
      const updated_note = `Account updated by user ID: ${updated_user}`;
      const updated_date_time = new Date();
      const payment_id = account.payment_id || "0";
      const contra_account = account.contra_account || "-";
      const reconcilation_status = account.reconcilation_status || "0";

      await logDbService.insertCompanyBankAccountUpdateLog(
        bank_acc_id,
        type,
        description,
        note,
        debit,
        credit,
        balance,
        user,
        updated_status,
        updated_note,
        updated_date_time,
        updated_user,
        payment_id,
        contra_account,
        reconcilation_status,
        branch_id
      );
    } catch (logError) {
      console.error("Error creating account update log:", logError);
    }
  } catch (error) {
    console.error("Error updating bank account:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update bank account",
      error: error.message,
    });
  }
};

const getBankAccountLogs = async (req, res) => {
  try {
    const { account_id, branch_id } = req.params;
    const { from, to } = req.query;
    const logs = await logDbService.getCompanyBankAccountLogs(account_id, branch_id, from, to);
    res.status(200).json({
      success: true,
      logs: logs || [],
    });
  } catch (error) {
    console.error("Error retrieving bank account logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve account logs",
      error: error.message,
    });
  }
};

module.exports = {
  createBankAccount,
  getAllCompanyBankAccounts,
  deleteAccount,
  updateAccount,
  getBankAccountLogs,
};
