const dbService = require("../services/walletDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const { creditDebitLogHelper, findAccountByNameAndGroup } = require("./accountingController");
const { fetchBranch } = require("../services/branchDBService");

const createWallet = async (req, res) => {
  try {
    const {
      Date: walletDate,
      Type,
      Wallet_Category_idWallet_Category,
      Amount,
      Note,
      Branch_idBranch,
      User_idUser,
      Accounting_Accounts_id,
      project_id,
      Wallet_SubCategory_id
    } = req.body;

    const filename = req.file ? req.file.filename : null;
    const Status = 1;
    const sanitizedAccountId = Accounting_Accounts_id === "" ? null : Accounting_Accounts_id;
    const sanitizedProjectId = project_id === "" || project_id === "null" || project_id === undefined ? null : project_id;
    const sanitizedSubCategoryId = Wallet_SubCategory_id === "" || Wallet_SubCategory_id === "null" || Wallet_SubCategory_id === undefined ? null : Wallet_SubCategory_id;

    const wallet = await dbService.insertWallet(
      walletDate,
      Type,
      Wallet_Category_idWallet_Category,
      Amount,
      Note,
      Branch_idBranch,
      filename,
      sanitizedAccountId,
      Status,
      sanitizedProjectId,
      sanitizedSubCategoryId
    );

    const wallet_id = wallet.insertId;

    // --- Double Entry Accounting (Only if Bank Account is provided) ---
    if (Accounting_Accounts_id) {
      try {
        const branch = await fetchBranch(Branch_idBranch);
        const companyId = branch[0].Company_idCompany;
        
        const bankAccountDBService = require("../services/bankAccountDBService");
        const bankAccountLogDBService = require("../services/bankAccountLogDBService");

        const accountDetails = await bankAccountDBService.getAccountById(Accounting_Accounts_id, Branch_idBranch);
        if (accountDetails && accountDetails.length > 0) {
          const isCash = accountDetails[0].account_name.toLowerCase().includes("cash");
          const paymentAccountName = isCash ? "Cash in Hand" : "Bank Account";

          const doubleEntryAccountId = await findAccountByNameAndGroup(paymentAccountName, "Assets", companyId, Branch_idBranch);
          let otherSideAccountId;
          let description = `Wallet ${Type === "1" ? "Earning" : "Expense"}: ${Note} (Ref: ${wallet_id})`;

          if (Type === "1") {
            // Dr Cash/Bank, Cr Other Income
            otherSideAccountId = await findAccountByNameAndGroup("Other Income (Rental, etc.)", "Income", companyId, Branch_idBranch);
            
            if (doubleEntryAccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: Amount,
                description,
                type: "Wallet Earning",
                accountId: doubleEntryAccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit"
              });
            }
            
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Income",
              amount: Amount,
              description,
              type: "Wallet Earning",
              accountId: otherSideAccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "credit"
            });
          } else {
            // Dr Expense, Cr Cash/Bank
            const categoryRes = await dbService.fetchCategory(Branch_idBranch);
            const category = categoryRes.find(c => c.idWallet_Category == Wallet_Category_idWallet_Category);
            
            otherSideAccountId = await findAccountByNameAndGroup(category.Description, "Expenses", companyId, Branch_idBranch);
            if (!otherSideAccountId) {
              otherSideAccountId = await findAccountByNameAndGroup("General Expenses", "Expenses", companyId, Branch_idBranch);
            }

            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: Amount,
              description,
              type: "Wallet Expense",
              accountId: otherSideAccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "debit"
            });
            
            if (doubleEntryAccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: Amount,
                description,
                type: "Wallet Expense",
                accountId: doubleEntryAccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "credit"
              });
            }
          }

          // Update the balance of the specific selected sub-account
          const currentBal = parseFloat(accountDetails[0].account_balance || 0);
          const amtParsed = parseFloat(Amount);
          const isDebit = Type === "1";
          const newSubBalance = isDebit ? (currentBal + amtParsed) : (currentBal - amtParsed);

          await bankAccountDBService.updateCompanyBankAccountBalance(
            Accounting_Accounts_id,
            newSubBalance,
            Branch_idBranch
          );

          // Add a log for the specific sub bank account update
          const debitVal = isDebit ? Amount : "0.00";
          const creditVal = isDebit ? "0.00" : Amount;

          await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
            Accounting_Accounts_id,
            `Wallet ${Type === "1" ? "Earning" : "Expense"}`,
            `Wallet transaction: ${Note} (Ref: ${wallet_id})`,
            `Amount: ${Amount}`,
            debitVal,
            creditVal,
            newSubBalance,
            accountDetails[0].user || User_idUser,
            isDebit ? "received" : "paid",
            `Wallet transaction updated selected account balance`,
            new Date(),
            User_idUser,
            wallet_id,
            "-",
            "0",
            Branch_idBranch
          );
        }
      } catch (accErr) {
        console.error("Accounting error:", accErr);
      }
    }
    // ----------------------------

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Earnings & Expenses",
      wallet_id,
      "create",
      Branch_idBranch
    );

    res.json({
      message: "Wallet added successfully",
    });
  } catch (err) {
    res.status(500).json({ message: "Error creating wallet", error: err.message });
  }
};

const createCategory = async (req, res) => {
  try {
    const { Type, Description, Branch_idBranch } = req.body;
    await dbService.insertCategory(Type, Description, Branch_idBranch);
    res.json({
      message: "Category added successfully",
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating wallet", error: err.message });
  }
};

// Function to get category by branch ID
const getCategory = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const category = await dbService.fetchCategory(Branch_idBranch);
    res.json(category);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching category", error: err.message });
  }
};

// Function to update a category by ID
const updateCategory = async (req, res) => {
  try {
    const { idWallet_Category } = req.params;
    const { Type, Description } = req.body;
    await dbService.updateCategory(Type, Description, idWallet_Category);
    res.json({ message: "Category updated successfully" });
  } catch (err) {
    console.error("Error updating Category:", err);
    res
      .status(500)
      .json({ message: "Error updating Category", error: err.message });
  }
};

const getWallet = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const wallet = await dbService.fetchWallet(Branch_idBranch);
    if (wallet.length === 0) {
      return res.status(404).json({ message: "Wallet is empty" });
    }
    await Promise.all(
      wallet.map(async (wallet) => {
        if (wallet.Wallet_File !== null) {
          const baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
            wallet.Wallet_File
          }`;
          wallet.files = baseUrl;
        }
      })
    );
    res.json(wallet);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching wallet",
      error: err.message,
    });
  }
};

const updateWallet = async (req, res) => {
  try {
    const { idWallet } = req.params;
    const { Date: walletDate, Type, Wallet_Category_idWallet_Category, Amount, Note, Branch_idBranch, Wallet_File, User_idUser, Accounting_Accounts_id, project_id, Wallet_SubCategory_id } = req.body;
    const filename = req.file ? req.file.filename : Wallet_File;
    
    const sanitizedAccountId = Accounting_Accounts_id === "" ? null : Accounting_Accounts_id;
    const sanitizedProjectId = project_id === "" || project_id === "null" || project_id === undefined ? null : project_id;
    const sanitizedSubCategoryId = Wallet_SubCategory_id === "" || Wallet_SubCategory_id === "null" || Wallet_SubCategory_id === undefined ? null : Wallet_SubCategory_id;

    await dbService.updateWallet(
      walletDate,
      Type,
      Wallet_Category_idWallet_Category,
      Amount,
      Note,
      filename,
      sanitizedAccountId,
      sanitizedProjectId,
      sanitizedSubCategoryId,
      idWallet
    );

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Earnings & Expenses",
      idWallet,
      "edit",
      Branch_idBranch
    );

    res.json({ message: "Wallet updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error updating wallet", error: err.message });
  }
};

const walletDelete = async (req, res) => {
  try {
    const { idWallet } = req.params;
    const { Branch_idBranch, User_idUser } = req.body;

    // Fetch wallet info before delete to reverse accounting
    const wallets = await dbService.fetchWallet(Branch_idBranch);
    const walletToReverse = wallets.find(w => w.idWallet == idWallet);

    await dbService.deleteWallet(idWallet);

    // --- Reverse Accounting (Only if associated with an account) ---
    if (walletToReverse && walletToReverse.Accounting_Accounts_id) {
      try {
        const branch = await fetchBranch(Branch_idBranch);
        const companyId = branch[0].Company_idCompany;
        
        const bankAccountDBService = require("../services/bankAccountDBService");
        const bankAccountLogDBService = require("../services/bankAccountLogDBService");

        const accountDetails = await bankAccountDBService.getAccountById(walletToReverse.Accounting_Accounts_id, Branch_idBranch);
        if (accountDetails && accountDetails.length > 0) {
          const isCash = accountDetails[0].account_name.toLowerCase().includes("cash");
          const paymentAccountName = isCash ? "Cash in Hand" : "Bank Account";

          const doubleEntryAccountId = await findAccountByNameAndGroup(paymentAccountName, "Assets", companyId, Branch_idBranch);
          let otherSideAccountId;
          let description = `REVERSAL: Wallet ${walletToReverse.Type === "1" ? "Earning" : "Expense"}: ${walletToReverse.Note} (Ref: ${idWallet})`;
          const Amount = walletToReverse.Amount;

          if (walletToReverse.Type === "1") {
            // Reverse: Cr Cash/Bank, Dr Other Income
            otherSideAccountId = await findAccountByNameAndGroup("Other Income (Rental, etc.)", "Income", companyId, Branch_idBranch);
            
            if (doubleEntryAccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: Amount,
                description,
                type: "Wallet Reversal",
                accountId: doubleEntryAccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "credit"
              });
            }
            
            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Income",
              amount: Amount,
              description,
              type: "Wallet Reversal",
              accountId: otherSideAccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "debit"
            });
          } else {
            // Reverse: Cr Expense, Dr Cash/Bank
            const categoryRes = await dbService.fetchCategory(Branch_idBranch);
            const category = categoryRes.find(c => c.idWallet_Category == walletToReverse.Wallet_Category_idWallet_Category);
            
            otherSideAccountId = await findAccountByNameAndGroup(category.Description, "Expenses", companyId, Branch_idBranch);
            if (!otherSideAccountId) {
              otherSideAccountId = await findAccountByNameAndGroup("General Expenses", "Expenses", companyId, Branch_idBranch);
            }

            await creditDebitLogHelper({
              accountType: "Chartered Account",
              group: "Expenses",
              amount: Amount,
              description,
              type: "Wallet Reversal",
              accountId: otherSideAccountId,
              branchId: Branch_idBranch,
              userId: User_idUser,
              companyId,
              transactionType: "credit"
            });
            
            if (doubleEntryAccountId) {
              await creditDebitLogHelper({
                accountType: "Chartered Account",
                group: "Assets",
                amount: Amount,
                description,
                type: "Wallet Reversal",
                accountId: doubleEntryAccountId,
                branchId: Branch_idBranch,
                userId: User_idUser,
                companyId,
                transactionType: "debit"
              });
            }
          }

          // Reverse the balance of the specific selected sub-account
          const currentBal = parseFloat(accountDetails[0].account_balance || 0);
          const amtParsed = parseFloat(Amount);
          // If Earnings (Type 1): subtraction (reverse the debit). If Expense (Type 2): addition (reverse the credit).
          const isDebit = walletToReverse.Type === "1";
          const newSubBalance = isDebit ? (currentBal - amtParsed) : (currentBal + amtParsed);

          await bankAccountDBService.updateCompanyBankAccountBalance(
            walletToReverse.Accounting_Accounts_id,
            newSubBalance,
            Branch_idBranch
          );

          // Add a reversal log for the specific sub bank account
          const debitVal = isDebit ? "0.00" : Amount;
          const creditVal = isDebit ? Amount : "0.00";

          await bankAccountLogDBService.insertCompanyBankAccountUpdateLog(
            walletToReverse.Accounting_Accounts_id,
            `Wallet Reversal`,
            `Wallet reversal: ${walletToReverse.Note} (Ref: ${idWallet})`,
            `Reversed Amount: ${Amount}`,
            debitVal,
            creditVal,
            newSubBalance,
            accountDetails[0].user || User_idUser,
            isDebit ? "paid" : "received",
            `Wallet transaction reversal updated selected account balance`,
            new Date(),
            User_idUser,
            idWallet,
            "-",
            "0",
            Branch_idBranch
          );
        }
      } catch (accErr) {
        console.error("Accounting reversal error:", accErr);
      }
    }
    // ----------------------------

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Earnings & Expenses",
      idWallet,
      "deleted",
      Branch_idBranch
    );

    res.json({ message: "Wallet deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting wallet", error: err.message });
  }
};

const getEarning = async (req, res) => {
  try {
    const { Branch_idBranch ,fromDate,toDate} = req.params;

    const wallet = await dbService.fetchEarning(Branch_idBranch,fromDate,toDate);
    await Promise.all(
      wallet.map(async (wallet) => {
        if (wallet.Wallet_File !== null) {
          const baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
            wallet.Wallet_File
          }`;
          wallet.files = baseUrl;
        }
      })
    );
    res.json(wallet);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching Earning",
      error: err.message,
    });
  }
};

const getExpenses = async (req, res) => {
  try {
    const { Branch_idBranch ,fromDate,toDate} = req.params;

    const wallet = await dbService.fetchExpenses(Branch_idBranch,fromDate,toDate);
    
    await Promise.all(
      wallet.map(async (wallet) => {
        if (wallet.Wallet_File !== null) {
          const baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
            wallet.Wallet_File
          }`;
          wallet.files = baseUrl;
        }
      })
    );
    res.json(wallet);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching Expenses",
      error: err.message,
    });
  }
};

const createSubCategory = async (req, res) => {
  try {
    const { Description, Wallet_Category_idWallet_Category, Branch_idBranch } = req.body;
    await dbService.insertSubCategory(Description, Wallet_Category_idWallet_Category, Branch_idBranch);
    res.json({ message: "Subcategory added successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error creating subcategory", error: err.message });
  }
};

const getSubCategory = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const subCategories = await dbService.fetchSubCategory(Branch_idBranch);
    res.json(subCategories);
  } catch (err) {
    res.status(500).json({ message: "Error fetching subcategories", error: err.message });
  }
};

const updateSubCategoryById = async (req, res) => {
  try {
    const { idWallet_SubCategory } = req.params;
    const { Description, Wallet_Category_idWallet_Category } = req.body;
    await dbService.updateSubCategory(Description, Wallet_Category_idWallet_Category, idWallet_SubCategory);
    res.json({ message: "Subcategory updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error updating subcategory", error: err.message });
  }
};

const deleteSubCategoryById = async (req, res) => {
  try {
    const { idWallet_SubCategory } = req.params;
    await dbService.deleteSubCategory(idWallet_SubCategory);
    res.json({ message: "Subcategory deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting subcategory", error: err.message });
  }
};

module.exports = {
  createWallet,
  createCategory,
  getCategory,
  updateCategory,
  getWallet,
  updateWallet,
  walletDelete,
  getEarning,
  getExpenses,
  createSubCategory,
  getSubCategory,
  updateSubCategoryById,
  deleteSubCategoryById
};
