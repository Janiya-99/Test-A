const dbService = require("../services/branchDBService");

/**
 * Helper middleware to check if the current user's branch is the main branch
 * @param {number} userBranchId - The branch ID of the current user
 * @returns {Promise<boolean>} True if main branch, false otherwise
 */
const checkMainBranchAccess = async (userBranchId) => {
  try {
    const isMain = await dbService.checkIsMainBranch(userBranchId);
    return isMain;
  } catch (error) {
    console.error("Error checking main branch access:", error);
    return false;
  }
};

const getBranchAddress = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const address = await dbService.fetchBranch(Branch_idBranch);
    if (address.length === 0) {
      return res.status(404).json({ message: "Branch not found" });
    }
    res.json(address[0]);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching branch by ID", error: err.message });
  }
};

const getBranchPaymentDetails = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const paymentDetails = await dbService.fetchPaymentDetails(Branch_idBranch);
    if (paymentDetails.length === 0) {
      return res.json({});
    }
    res.json(paymentDetails[0]);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching branch by ID", error: err.message });
  }
};

const getAccountDetails = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const branch = await dbService.fetchBranch(Branch_idBranch);
    if (branch.length === 0) {
      return res.status(404).json({ message: "Branch not found" });
    }
    const company = await dbService.fetchCompany(branch[0].Company_idCompany);
    if (company.length === 0) {
      return res.status(404).json({ message: "Company not found" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
      company[0].Logo
    }`;
    let returnData = {
      Address1: branch[0].Address1,
      Address2: branch[0].Address2,
      Address3: branch[0].Address3,
      Contact_No: branch[0].Contact_No,
      Print_Size: branch[0].Print_Size,
      Company: company[0].Name,
      Logo: baseUrl,
    };
    res.json(returnData);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching branch by ID", error: err.message });
  }
};

const createBranch = async (req, res) => {
  try {
    const {
      Name,
      Address1,
      Address2,
      Address3,
      Contact_No,
      Company_idCompany,
      User_idUser,
      Current_Branch_idBranch, // The current user's branch
      stock_type = "general",
      copy_quantities = false,
    } = req.body;

    // Check if the current user is on the main branch
    if (Current_Branch_idBranch) {
      const isMainBranch = await checkMainBranchAccess(Current_Branch_idBranch);
      if (!isMainBranch) {
        return res.status(403).json({
          success: false,
          message:
            "Only the main branch can create new branches. Please switch to the main branch to perform this action.",
        });
      }
    }

    // Check Branch Limit
    const branchLimit = await dbService.getBranchLimit(Company_idCompany);
    const currentBranchCount =
      await dbService.getActiveBranchCount(Company_idCompany);

    if (currentBranchCount >= branchLimit) {
      return res.status(403).json({
        success: false,
        message: `Branch limit reached! Your plan allows ${branchLimit} branch(es). Please upgrade to add more.`,
      });
    }

    // Determine source branch (Current branch if main, or query main branch of company)
    let sourceBranchId = Current_Branch_idBranch;
    if (!sourceBranchId) {
      const mainBranchObj = await dbService.getMainBranchByCompany(Company_idCompany);
      sourceBranchId = mainBranchObj?.idBranch;
    }

    const branch = await dbService.insertBranch(
      Name,
      Address1,
      Address2,
      Address3,
      Contact_No,
      Company_idCompany,
      stock_type,
      sourceBranchId
    );

    const Branch_idBranch = branch.insertId;

    // Create payment details
    await dbService.insertPaymentDetails(Branch_idBranch);

    // Create default warehouse for this branch
    await dbService.createDefaultWarehouse(Branch_idBranch, Name, User_idUser);

    // Create default rules with POS enabled (copy from sibling branch or default)
    await dbService.createDefaultRules(
      Branch_idBranch,
      Company_idCompany,
      User_idUser,
    );

    if (User_idUser) {
      await dbService.createDefaultUserPrivileges(User_idUser, Branch_idBranch);
    }

    // If stock_type is "general", clone catalog items from sourceBranchId
    let clonedCount = 0;
    if (stock_type === "general" && sourceBranchId) {
      try {
        const cloneResult = await dbService.cloneCatalogForBranch(
          sourceBranchId,
          Branch_idBranch,
          { copyQuantities: Boolean(copy_quantities), userId: User_idUser }
        );
        clonedCount = cloneResult?.clonedCount || 0;
      } catch (cloneErr) {
        console.error("Error cloning catalog to new branch:", cloneErr);
      }
    }

    // Fetch the created branch to return
    const createdBranch = await dbService.fetchBranch(Branch_idBranch);

    res.status(200).json({
      success: true,
      message: `Branch added successfully.${clonedCount > 0 ? ` Cloned ${clonedCount} catalog items.` : ""}`,
      branch: createdBranch[0],
      clonedCount,
    });
  } catch (err) {
    console.error("Error creating branch:", err);
    res.status(500).json({
      success: false,
      message: "Error creating branch",
      error: err.message,
    });
  }
};


const updateBranch = async (req, res) => {
  const { idBranch } = req.params;
  try {
    const {
      Company,
      Name,
      Address1,
      Address2,
      Address3,
      Contact_No,
      Current_Branch_idBranch,
    } = req.body;

    // Check if the current user is on the main branch
    if (Current_Branch_idBranch) {
      const isMainBranch = await checkMainBranchAccess(Current_Branch_idBranch);
      if (!isMainBranch) {
        return res.status(403).json({
          success: false,
          message:
            "Only the main branch can update branch details. Please switch to the main branch to perform this action.",
        });
      }
    }

    await dbService.updateBranch(
      idBranch,
      Name,
      Address1,
      Address2,
      Address3,
      Contact_No,
    );

    const branch = await dbService.fetchBranch(idBranch);

    await dbService.updateCompany(branch[0].Company_idCompany, Company);

    res
      .status(200)
      .json({ success: true, message: "Branch updated successfully" });
  } catch (err) {
    console.error("Error updating branch:", err);
    res.status(500).json({
      success: false,
      message: "Error updating branch",
      error: err.message,
    });
  }
};

const changeBranchLogo = async (req, res) => {
  try {
    const { Branch_idBranch, img } = req.body;
    const { filename } = req.file;
    const branch = await dbService.fetchBranch(Branch_idBranch);
    await dbService.updateCompanyImage(branch[0].Company_idCompany, filename);
    res.status(200).json({ message: "Logo has been successfully" });
  } catch (err) {
    console.error("Error creating branch:", err);
    res
      .status(500)
      .json({ message: "Error creating branch", error: err.message });
  }
};

const updatePaymentDetails = async (req, res) => {
  const { Branch_idBranch } = req.params;
  try {
    const { Penalty_Percentage, Interest_Rate } = req.body;

    await dbService.updatePaymentDatails(
      Branch_idBranch,
      Penalty_Percentage,
      Interest_Rate,
    );
    res.status(200).json({ message: "Payment Details updated successfully" });
  } catch (err) {
    console.error("Error updating payment details:", err);
    res
      .status(500)
      .json({ message: "Error updating payment details", error: err.message });
  }
};

const getBranchRuleDetails = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    // 🔍 DEBUG: Log entry
    console.log(
      `[GET-BRANCH-RULES] Request received for Branch ID: ${Branch_idBranch}`,
    );

    const ruleDetails = await dbService.fetchRuleDetails(Branch_idBranch);

    if (!ruleDetails || ruleDetails.length === 0) {
      console.warn(
        `[GET-BRANCH-RULES] ⚠️ No rules found for Branch ID ${Branch_idBranch}. Returning default/empty rules.`,
      );
      // Return default/empty rules instead of 404 to prevent frontend Promise.all from failing
      return res.json({
        Invoice_No_Strat_From: 1,
        Invoice_No_Start_With: "INV",
        // Add other default fields if necessary, or just an empty structure that the frontend can handle
        baseUrl: null,
        baseFooterUrl: null,
      });
    }

    // 🔍 DEBUG: Log raw rules data
    console.log(`[GET-BRANCH-RULES] Raw rules data:`, ruleDetails[0]);

    let baseUrl = null;
    // Check if property exists before accessing to avoid crashes
    if (ruleDetails[0] && ruleDetails[0].Invoice_Header) {
      baseUrl = `${req.protocol}://${req.get("host")}/uploads/${
        ruleDetails[0].Invoice_Header
      }`;
    }

    let baseFooterUrl = null;
    if (ruleDetails[0] && ruleDetails[0].Invoice_Footer) {
      baseFooterUrl = `${req.protocol}://${req.get("host")}/uploads/${
        ruleDetails[0].Invoice_Footer
      }`;
    }

    let data = {
      ...ruleDetails[0],
      baseUrl,
      baseFooterUrl,
    };

    console.log(
      `[GET-BRANCH-RULES] ✅ Successfully processed rules for Branch ID ${Branch_idBranch}`,
    );
    res.json(data);
  } catch (err) {
    console.error(`[GET-BRANCH-RULES] ❌ Error in getBranchRuleDetails:`, err);
    res
      .status(500)
      .json({ message: "Error fetching branch by ID", error: err.message });
  }
};

const updateRuleDetails = async (req, res) => {
  const { Branch_idBranch } = req.params;
  try {
    const {
      Invoice_No_Strat_From,
      Invoice_No_Start_With,
      Quotations_No_Start_With,
      Quotations_No_Start_From,
      Order_No_Strat_From,
      Order_No_Start_With,
      Invoice_Has_Header,
      Print_Type,
      POS,
      vat_enabled,
      vat_percentage,
      vat_type,
      salesman_enabled,
      salesman_required,
      salesman_invoice_update,
      Explicit_Stock_Check,
      Automatic_Categorization,
      Explicit_Warehouse_Deduct,
      advanced_invoice_generation,
      advanced_invoice_number,
      salesman_type,
      enable_net_items_post_discount,
      allow_bonus_products,
    } = req.body;

    // Helper to clean "undefined" strings from FormData
    const clean = (val) => (val === "undefined" || val === "null" ? null : val);

    const safe_Invoice_No_Strat_From = clean(Invoice_No_Strat_From);
    const safe_Invoice_No_Start_With = clean(Invoice_No_Start_With);
    const safe_Quotations_No_Start_With = clean(Quotations_No_Start_With);
    const safe_Quotations_No_Start_From = clean(Quotations_No_Start_From);
    const safe_Order_No_Strat_From = clean(Order_No_Strat_From);
    const safe_Order_No_Start_With = clean(Order_No_Start_With);
    // Provide default '0' for flags if undefined/null to prevent DB errors
    const safe_Invoice_Has_Header = clean(Invoice_Has_Header) || "0";
    const safe_Print_Type = clean(Print_Type) || "0";
    const safe_POS = clean(POS) || "0";
    const safe_vat_enabled = clean(vat_enabled) || "0";
    // Please fix vat_percentage to default to 0 if empty
    const safe_vat_percentage =
      clean(vat_percentage) === "" ? "0" : clean(vat_percentage) || "0";
    const safe_vat_type = clean(vat_type) || "exclusive";
    const safe_salesman_enabled = clean(salesman_enabled) || "0";
    const safe_salesman_required = clean(salesman_required) || "0";
    const safe_salesman_invoice_update = clean(salesman_invoice_update) || "0";
    const safe_Explicit_Stock_Check = clean(Explicit_Stock_Check) || "0";
    const safe_Automatic_Categorization =
      clean(Automatic_Categorization) || "0";
    const safe_Explicit_Warehouse_Deduct =
      clean(Explicit_Warehouse_Deduct) || "0";
    const safe_advanced_invoice_generation =
      clean(advanced_invoice_generation) || "0";
    const safe_advanced_invoice_number =
      clean(advanced_invoice_number) || "0";
    const safe_salesman_type = clean(salesman_type) || "salesman";
    const safe_allow_bonus_products = clean(allow_bonus_products) || "0";

    // 🔍 DEBUG: Log update request body
    console.log(
      `[UPDATE-RULES] Request Body for Branch ${Branch_idBranch}:`,
      JSON.stringify(req.body, null, 2),
    );

    // 🔍 DEBUG: Log extracted values
    console.log(`[UPDATE-RULES] Extracted Values:`, {
      safe_Invoice_No_Strat_From,
      safe_Invoice_No_Start_With,
      safe_Quotations_No_Start_With,
      safe_Quotations_No_Start_From,
      safe_advanced_invoice_generation,
      safe_advanced_invoice_number,
      safe_salesman_type,
    });

    let headerFilename = null;
    let footerFilename = null;

    // Check if header image is present in the request
    if (req.files && req.files.headerImg && req.files.headerImg[0].filename) {
      headerFilename = req.files.headerImg[0].filename;
    }

    // Check if footer image is present in the request
    if (req.files && req.files.footerImg && req.files.footerImg[0].filename) {
      footerFilename = req.files.footerImg[0].filename;
    }

    // Pass vat_enabled and vat_percentage to the dbService methods
    // Pass vat_enabled and vat_percentage to the dbService methods
    if (headerFilename && footerFilename) {
      await dbService.updateRuleDetailsWithHeaderAndFooter(
        Branch_idBranch,
        safe_Invoice_No_Strat_From,
        safe_Invoice_No_Start_With,
        safe_Quotations_No_Start_With,
        safe_Quotations_No_Start_From,
        safe_Order_No_Strat_From,
        safe_Order_No_Start_With,
        safe_Invoice_Has_Header,
        safe_Print_Type,
        safe_POS,
        headerFilename,
        footerFilename,
        safe_vat_enabled,
        safe_vat_percentage,
        safe_vat_type,
        safe_salesman_enabled,
        safe_salesman_required,
        safe_salesman_invoice_update,
        safe_Explicit_Stock_Check,
        safe_Automatic_Categorization,
        safe_Explicit_Warehouse_Deduct,
        safe_advanced_invoice_generation,
        safe_advanced_invoice_number,
        safe_salesman_type,
      );
    } else if (headerFilename) {
      await dbService.updateRuleDetailsWithHeader(
        Branch_idBranch,
        safe_Invoice_No_Strat_From,
        safe_Invoice_No_Start_With,
        safe_Quotations_No_Start_With,
        safe_Quotations_No_Start_From,
        safe_Order_No_Strat_From,
        safe_Order_No_Start_With,
        safe_Invoice_Has_Header,
        safe_Print_Type,
        safe_POS,
        headerFilename,
        safe_vat_enabled,
        safe_vat_percentage,
        safe_vat_type,
        safe_salesman_enabled,
        safe_salesman_required,
        safe_salesman_invoice_update,
        safe_Explicit_Stock_Check,
        safe_Automatic_Categorization,
        safe_Explicit_Warehouse_Deduct,
        safe_advanced_invoice_generation,
        safe_advanced_invoice_number,
        safe_salesman_type,
      );
    } else if (footerFilename) {
      await dbService.updateRuleDetailsWithFooter(
        Branch_idBranch,
        safe_Invoice_No_Strat_From,
        safe_Invoice_No_Start_With,
        safe_Quotations_No_Start_With,
        safe_Quotations_No_Start_From,
        safe_Order_No_Strat_From,
        safe_Order_No_Start_With,
        safe_Invoice_Has_Header,
        safe_Print_Type,
        safe_POS,
        footerFilename,
        safe_vat_enabled,
        safe_vat_percentage,
        safe_vat_type,
        safe_salesman_enabled,
        safe_salesman_required,
        safe_salesman_invoice_update,
        safe_Explicit_Stock_Check,
        safe_Automatic_Categorization,
        safe_Explicit_Warehouse_Deduct,
        safe_advanced_invoice_generation,
        safe_advanced_invoice_number,
        safe_salesman_type,
      );
    } else {
      await dbService.updateRuleDetails(
        Branch_idBranch,
        safe_Invoice_No_Strat_From,
        safe_Invoice_No_Start_With,
        safe_Quotations_No_Start_With,
        safe_Quotations_No_Start_From,
        safe_Order_No_Strat_From,
        safe_Order_No_Start_With,
        safe_Invoice_Has_Header,
        safe_Print_Type,
        safe_POS,
        safe_vat_enabled,
        safe_vat_percentage,
        safe_vat_type,
        safe_salesman_enabled,
        safe_salesman_required,
        safe_salesman_invoice_update,
        safe_Explicit_Stock_Check,
        safe_Automatic_Categorization,
        safe_Explicit_Warehouse_Deduct,
        safe_advanced_invoice_generation,
        safe_advanced_invoice_number,
        safe_salesman_type,
        safe_allow_bonus_products,
      );
    }

    const safe_enable_net_items_post_discount = clean(enable_net_items_post_discount) || "0";
    await dbService.updateNetItemsRule(Branch_idBranch, safe_enable_net_items_post_discount);

    res.status(200).json({ message: "Rules Details updated successfully" });
  } catch (err) {
    console.error("Error updating rules details:", err);
    res
      .status(500)
      .json({ message: "Error updating rules details", error: err.message });
  }
};

const getUserPrivilages = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    let users = await dbService.getUsersByBranch(Branch_idBranch);

    let data = [];
    users = await Promise.all(
      users.map(async (user) => {
        let user_data = {};
        if (user.Role !== 1) {
          const user_privilages = await dbService.getUsersPrivilages(
            user.idUser,
          );
          user_data = {
            ...user,
            ...user_privilages[0],
          };
          data.push(user_data);
        }
      }),
    );

    res.json(data);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res
      .status(500)
      .json({ message: "Error fetching customer", error: err.message });
  }
};

const updatePrivilagesDetails = async (req, res) => {
  const { idUser } = req.params;
  const {
    Account,
    Customer_Management,
    Add_Customer,
    Edit_Customer,
    Change_Customer_Status,
    Customer_Credit_Logs,
    Record_Payment,
    Customer_Returns,
    Add_Customer_Return,
    Edit_Customer_Return,
    Process_Customer_Return,
    Quotation_Management,
    Add_Quotation,
    Edit_Quotation,
    Delete_Quotation,
    Invoices,
    Add_Invoices,
    Edit_Invoices,
    Delete_Invoices,
    Maximum_Item_Discount,
    Maximum_Bill_Discount,
    Due_Payments,
    Process_Due_Payments,
    Product_Category_Management,
    Add_Edit_Product_Category_Management,
    Products_Management,
    Add_Products,
    Edit_Products,
    Add_Quantity,
    Adjust_Quantity,
    Change_Status_Products,
    GRN,
    Add_Grns,
    Edit_Grns,
    Process_Grns,
    Barcodes,
    Damage_Note,
    Add_Damage_Note,
    Suppliers_Management,
    Add_Suppliers_Management,
    Edit_Suppliers_Management,
    Change_Suppliers_Management_Status,
    Delete_Suppliers_Management,
    Supplier_Credit_Logs,
    Purchase_Returns,
    Add_Purchase_Returns,
    Edit_Purchase_Returns,
    Process_Purchase_Returns,
    Salesmen,
    Add_Salesmen,
    Edit_Salesmen,
    Change_Salesmen_Status,
    Earnings_Expenses,
    Add_Earnings_Expenses,
    Earnings_Expenses_Cateogry,
    Reports,
    Item_Reports,
    Customer_Credit_Log_Reports,
    Invoice_Detail_Reports,
    Stock_Card_Reports,
    PL_Reports,
    Apps,
    Stock_Detail_Reports,
    Supplier_Reports,
    Earning_Reports,
    Expenses_Reports,
    Customer_Reports,
    User_Reports,
    Product_Reports,
    Payment_Reports,
    Return_Reports,
    Monthly_Sales_Reports,
    Daily_Sales_Reports,
    POS,
  } = req.body;

  try {
    // Assuming dbService.updateUserPrivileges is a function to update user privileges in the database
    await dbService.updateUserPrivileges(
      idUser,
      Account,
      Customer_Management,
      Add_Customer,
      Edit_Customer,
      Change_Customer_Status,
      Customer_Credit_Logs,
      Record_Payment,
      Customer_Returns,
      Add_Customer_Return,
      Edit_Customer_Return,
      Process_Customer_Return,
      Quotation_Management,
      Add_Quotation,
      Edit_Quotation,
      Delete_Quotation,
      Invoices,
      Add_Invoices,
      Edit_Invoices,
      Delete_Invoices,
      Maximum_Item_Discount,
      Maximum_Bill_Discount,
      Due_Payments,
      Process_Due_Payments,
      Product_Category_Management,
      Add_Edit_Product_Category_Management,
      Products_Management,
      Add_Products,
      Edit_Products,
      Add_Quantity,
      Adjust_Quantity,
      Change_Status_Products,
      GRN,
      Add_Grns,
      Edit_Grns,
      Process_Grns,
      Barcodes,
      Damage_Note,
      Add_Damage_Note,
      Suppliers_Management,
      Add_Suppliers_Management,
      Edit_Suppliers_Management,
      Change_Suppliers_Management_Status,
      Delete_Suppliers_Management,
      Supplier_Credit_Logs,
      Purchase_Returns,
      Add_Purchase_Returns,
      Edit_Purchase_Returns,
      Process_Purchase_Returns,
      Salesmen,
      Add_Salesmen,
      Edit_Salesmen,
      Change_Salesmen_Status,
      Earnings_Expenses,
      Add_Earnings_Expenses,
      Earnings_Expenses_Cateogry,
      Reports,
      Item_Reports,
      Customer_Credit_Log_Reports,
      Invoice_Detail_Reports,
      Stock_Card_Reports,
      PL_Reports,
      Apps,
      Stock_Detail_Reports,
      Supplier_Reports,
      Earning_Reports,
      Expenses_Reports,
      Customer_Reports,
      User_Reports,
      Product_Reports,
      Payment_Reports,
      Return_Reports,
      Monthly_Sales_Reports,
      Daily_Sales_Reports,
      POS,
    );

    res.status(200).json({ message: "Privileges updated successfully" });
  } catch (err) {
    console.error("Error updating privileges:", err);
    res
      .status(500)
      .json({ message: "Error updating privileges", error: err.message });
  }
};

// GET /api/branch/list/:Company_idCompany
const getAllBranches = async (req, res) => {
  try {
    const { Company_idCompany } = req.params;
    const branches = await dbService.getAllBranchesByCompany(Company_idCompany);

    // Transform response to include full logo URL
    const baseUrl = `${req.protocol}://${req.get("host")}/uploads/`;
    const branchesWithUrls = branches.map((branch) => ({
      ...branch,
      CompanyLogoUrl: branch.CompanyLogo
        ? `${baseUrl}${branch.CompanyLogo}`
        : null,
      isActive: branch.Status === "1",
    }));

    res.json({
      success: true,
      count: branchesWithUrls.length,
      branches: branchesWithUrls,
    });
  } catch (err) {
    console.error("Error fetching branches:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching branches",
      error: err.message,
    });
  }
};

// PATCH /api/branch/:idBranch/status
const updateBranchStatus = async (req, res) => {
  try {
    const { idBranch } = req.params;
    const { status, Current_Branch_idBranch } = req.body; // '1' for active, '0' for inactive

    // Check if the current user is on the main branch
    if (Current_Branch_idBranch) {
      const isMainBranch = await checkMainBranchAccess(Current_Branch_idBranch);
      if (!isMainBranch) {
        return res.status(403).json({
          success: false,
          message:
            "Only the main branch can change branch status. Please switch to the main branch to perform this action.",
        });
      }
    }

    if (!["0", "1"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be '0' or '1'",
      });
    }

    await dbService.updateBranchStatus(idBranch, status);

    res.json({
      success: true,
      message: `Branch ${
        status === "1" ? "activated" : "deactivated"
      } successfully`,
    });
  } catch (err) {
    console.error("Error updating branch status:", err);
    res.status(500).json({
      success: false,
      message: "Error updating branch status",
      error: err.message,
    });
  }
};

// DELETE /api/branch/:idBranch
const deleteBranch = async (req, res) => {
  try {
    const { idBranch } = req.params;
    const { Current_Branch_idBranch } = req.body;

    // Check if the current user is on the main branch
    if (Current_Branch_idBranch) {
      const isMainBranch = await checkMainBranchAccess(Current_Branch_idBranch);
      if (!isMainBranch) {
        return res.status(403).json({
          success: false,
          message:
            "Only the main branch can delete branches. Please switch to the main branch to perform this action.",
        });
      }
    }

    // Safeguard: Check if branch has active items or stock before allowing deletion
    const stockSummary = await dbService.getBranchStockSummary(idBranch);
    if (stockSummary && (stockSummary.total_items > 0 || stockSummary.total_stock > 0)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete branch with active inventory (${stockSummary.total_items} items, ${stockSummary.total_stock} stock). Please deactivate the branch instead to preserve inventory history.`,
      });
    }

    await dbService.deleteBranch(idBranch);

    res.json({
      success: true,
      message: "Branch deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting branch:", err);
    res.status(500).json({
      success: false,
      message: "Error deleting branch",
      error: err.message,
    });
  }
};

// POST /api/branch/:idBranch/sync-catalog
const syncBranchCatalog = async (req, res) => {
  try {
    const { idBranch } = req.params;
    const { Current_Branch_idBranch, copy_quantities = false, User_idUser } = req.body;

    // Check if current user is on main branch
    if (Current_Branch_idBranch) {
      const isMainBranch = await checkMainBranchAccess(Current_Branch_idBranch);
      if (!isMainBranch) {
        return res.status(403).json({
          success: false,
          message: "Only the main branch can trigger catalog synchronization.",
        });
      }
    }

    const sourceBranchId = Current_Branch_idBranch;
    const result = await dbService.syncCatalogToBranch(
      sourceBranchId,
      idBranch,
      { copyQuantities: Boolean(copy_quantities), userId: User_idUser }
    );

    res.json({
      success: true,
      message: result.message,
      syncedCount: result.syncedCount,
    });
  } catch (err) {
    console.error("Error syncing branch catalog:", err);
    res.status(500).json({
      success: false,
      message: "Failed to sync catalog",
      error: err.message,
    });
  }
};

// GET /api/branch/:idBranch/stock-summary
const getBranchStockSummary = async (req, res) => {
  try {
    const { idBranch } = req.params;
    const summary = await dbService.getBranchStockSummary(idBranch);
    res.json({
      success: true,
      summary,
    });
  } catch (err) {
    console.error("Error fetching branch stock summary:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching branch stock summary",
      error: err.message,
    });
  }
};


// POST /api/branch/:idBranch/set-main
const transferMainBranch = async (req, res) => {
  try {
    const { idBranch } = req.params; // New main branch ID
    const { Current_Branch_idBranch } = req.body; // Current user's branch

    // Check if the current user is on the main branch
    if (!Current_Branch_idBranch) {
      return res.status(400).json({
        success: false,
        message: "Current branch ID is required",
      });
    }

    const isMainBranch = await checkMainBranchAccess(Current_Branch_idBranch);
    if (!isMainBranch) {
      return res.status(403).json({
        success: false,
        message:
          "Only the current main branch can transfer main branch privileges.",
      });
    }

    // Prevent transferring to the same branch
    if (parseInt(idBranch) === parseInt(Current_Branch_idBranch)) {
      return res.status(400).json({
        success: false,
        message: "This branch is already the main branch",
      });
    }

    // Get company ID from the target branch
    const companyId = await dbService.getCompanyIdByBranch(idBranch);
    if (!companyId) {
      return res.status(404).json({
        success: false,
        message: "Target branch not found",
      });
    }

    // Verify both branches belong to the same company
    const currentCompanyId = await dbService.getCompanyIdByBranch(
      Current_Branch_idBranch,
    );
    if (companyId !== currentCompanyId) {
      return res.status(403).json({
        success: false,
        message:
          "Cannot transfer main branch status to a branch in a different company",
      });
    }

    // Transfer main branch designation
    await dbService.transferMainBranch(idBranch, companyId);

    res.json({
      success: true,
      message: "Main branch transferred successfully",
    });
  } catch (err) {
    console.error("Error transferring main branch:", err);
    res.status(500).json({
      success: false,
      message: "Error transferring main branch",
      error: err.message,
    });
  }
};

const updateValuationMethod = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { inventory_valuation_method } = req.body;
  try {
    if (!["FIFO", "AVERAGE", "LATEST"].includes(inventory_valuation_method)) {
      return res.status(400).json({
        success: false,
        message: "Invalid valuation method. Must be 'FIFO', 'AVERAGE', or 'LATEST'",
      });
    }

    await dbService.updateValuationMethod(Branch_idBranch, inventory_valuation_method);

    res.status(200).json({
      success: true,
      message: "Inventory valuation method updated successfully",
    });
  } catch (err) {
    console.error("Error updating valuation method:", err);
    res.status(500).json({
      success: false,
      message: "Error updating valuation method",
      error: err.message,
    });
  }
};

const updateProfitLossByPaidAmount = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { profit_loss_by_paid_amount } = req.body;
  try {
    const value = parseInt(profit_loss_by_paid_amount) === 1 ? 1 : 0;
    await dbService.updateProfitLossByPaidAmount(Branch_idBranch, value);

    res.status(200).json({
      success: true,
      message: "Profit & Loss setting updated successfully",
    });
  } catch (err) {
    console.error("Error updating Profit & Loss setting:", err);
    res.status(500).json({
      success: false,
      message: "Error updating Profit & Loss setting",
      error: err.message,
    });
  }
};

const updateGeminiApiKey = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { gemini_api_key } = req.body;
  try {
    await dbService.updateGeminiApiKey(Branch_idBranch, gemini_api_key);
    res.json({ success: true, message: "Gemini API key updated successfully" });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error updating Gemini API key",
      error: err.message,
    });
  }
};

const updateLoyaltyStatus = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { enable_loyalty } = req.body;
  try {
    const value = parseInt(enable_loyalty) === 1 ? 1 : 0;
    await dbService.updateLoyaltyStatus(Branch_idBranch, value);
    res.status(200).json({
      success: true,
      message: "Customer Loyalty System status updated successfully",
      enable_loyalty: value,
    });
  } catch (err) {
    console.error("Error updating Loyalty status:", err);
    res.status(500).json({
      success: false,
      message: "Error updating Loyalty status",
      error: err.message,
    });
  }
};

const updateStockManagementMode = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { stock_management_mode } = req.body;
  try {
    const mode = stock_management_mode === "SUPPLIER_WISE" ? "SUPPLIER_WISE" : "ITEM_WISE";
    await dbService.updateStockManagementMode(Branch_idBranch, mode);
    res.status(200).json({
      success: true,
      message: "Stock Management Mode updated successfully",
      stock_management_mode: mode,
    });
  } catch (err) {
    console.error("Error updating Stock Management Mode:", err);
    res.status(500).json({
      success: false,
      message: "Error updating Stock Management Mode",
      error: err.message,
    });
  }
};

const updateGiftVoucherStatus = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { enable_gift_voucher } = req.body;
  try {
    const value = parseInt(enable_gift_voucher) === 1 ? 1 : 0;
    await dbService.updateGiftVoucherStatus(Branch_idBranch, value);
    res.status(200).json({
      success: true,
      message: "Gift Voucher System status updated successfully",
      enable_gift_voucher: value,
    });
  } catch (err) {
    console.error("Error updating Gift Voucher status:", err);
    res.status(500).json({
      success: false,
      message: "Error updating Gift Voucher status",
      error: err.message,
    });
  }
};

const getSmsSettings = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const smsService = require("../services/smsService");
    const settings = await smsService.getBranchSmsSettings(branch_id);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error fetching SMS settings",
      error: err.message,
    });
  }
};

const saveSmsSettings = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const { configs, userId, companyId } = req.body;
    const smsService = require("../services/smsService");
    await smsService.saveSmsTemplates(branch_id, configs);

    // Auto-provision user or company owner to SMS portal if needed
    try {
      const directCompanyId = companyId || req.user?.companyid || req.user?.companyId;
      const activeUserId = userId || req.user?.id || req.user?.userId;
      if (directCompanyId) {
        smsService.provisionUserInSmsPortal(activeUserId || null, directCompanyId).catch(() => {});
      }
    } catch (provErr) {}

    res.json({ success: true, message: "SMS settings saved successfully" });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Error saving SMS settings",
      error: err.message,
    });
  }
};

const getSmsPortalInfo = async (req, res) => {
  try {
    const { branch_id } = req.params;
    const directCompanyId = req.query.companyId || req.query.company_id || req.user?.companyid || req.user?.companyId;
    const axios = require("axios");
    const dbConnection = require("../db/db");
    const db2Connection = require("../db/db2");
    
    const resolveCompanyId = () => {
      return new Promise((resolve) => {
        if (directCompanyId) return resolve(Number(directCompanyId));
        
        // 1. Try resolving company from db (asipiya_test)
        const query = "SELECT Company_idCompany FROM branch WHERE idBranch = ?";
        dbConnection.query(query, [branch_id], (err, results) => {
          if (!err && results.length > 0 && results[0].Company_idCompany) {
            return resolve(results[0].Company_idCompany);
          }
          // 2. Try resolving company from db2 (account center / branch registry)
          db2Connection.query(query, [branch_id], (err2, results2) => {
            if (!err2 && results2.length > 0 && results2[0].Company_idCompany) {
              return resolve(results2[0].Company_idCompany);
            }
            resolve(null);
          });
        });
      });
    };

    const companyId = await resolveCompanyId();
    if (!companyId) {
      return res.status(404).json({ success: false, message: "Company not found for branch" });
    }

    const apiKey = "ASIP_BOOK:e192a2212049e6e686b81ad15ce3ae8e3ae744c06427d4e5c4d1260f0f034bf5";
    
    try {
      const portalRes = await axios.get(
        `https://smsportalserver.asipiya.com/api/external/companies/${companyId}/info`,
        {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json"
          }
        }
      );
      return res.json({ success: true, info: portalRes.data });
    } catch (apiErr) {
      console.error("SMS Portal API error:", apiErr.response?.data || apiErr.message);
      return res.status(apiErr.response?.status || 500).json({
        success: false,
        notFound: apiErr.response?.status === 404,
        message: apiErr.response?.data?.message || "Failed to fetch details from SMS portal",
        error: apiErr.response?.data || apiErr.message
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message
    });
  }
};


const updateRouteManagementStatus = async (req, res) => {
  const { Branch_idBranch } = req.params;
  const { enable_route_management } = req.body;
  try {
    const value = parseInt(enable_route_management) === 1 ? 1 : 0;
    await dbService.updateRouteManagementStatus(Branch_idBranch, value);
    res.status(200).json({
      success: true,
      message: "Route-Wise Customer Management status updated successfully",
      enable_route_management: value,
    });
  } catch (err) {
    console.error("Error updating Route Management status:", err);
    res.status(500).json({
      success: false,
      message: "Error updating Route Management status",
      error: err.message,
    });
  }
};

module.exports = {
  updateRouteManagementStatus,
  updateStockManagementMode,
  updateGiftVoucherStatus,
  updateLoyaltyStatus,
  updateGeminiApiKey,
  updateProfitLossByPaidAmount,
  updateValuationMethod,
  getBranchAddress,
  createBranch,
  updateBranch,
  changeBranchLogo,
  getAccountDetails,
  updatePaymentDetails,
  getBranchPaymentDetails,
  getBranchRuleDetails,
  updateRuleDetails,
  getUserPrivilages,
  updatePrivilagesDetails,
  getAllBranches,
  updateBranchStatus,
  deleteBranch,
  transferMainBranch,
  getSmsSettings,
  saveSmsSettings,
  getSmsPortalInfo,
  syncBranchCatalog,
  getBranchStockSummary,
};


