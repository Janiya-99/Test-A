const dbService = require("../services/customerReturnDBService");
const itemDbService = require("../services/productDBService");
const { productHistoryLogHelper } = itemDbService;
const branchDBService = require("../services/branchDBService");

const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const db = require("../db/db");
const approvalService = require("../services/approvalService");


const createCustomerReturn = async (req, res) => {
  try {
    const {
      Date,
      Customer_idCustomer,
      Total_Amount,
      Branch_idBranch,
      items,
      Reason,
      Return_Type,
      User_idUser,
      Invoice_idInvoice,
      Return_Receipt_No,
      Employee_idEmployee,
    } = req.body;

    const itemsList = items || [];

    const customerReturn = await dbService.createCustomerReturn(
      Date,
      Customer_idCustomer,
      Total_Amount,
      itemsList.length,
      Branch_idBranch,
      Reason,
      Return_Type,
      Invoice_idInvoice,
      Return_Receipt_No,
      Employee_idEmployee,
    );

    const idCustomer_Return = customerReturn.insertId;

    // APPROVAL ENGINE: Check if approval is required
    let approvalRequired = false;
    const companyId = req.user?.company_id || req.headers["company_id"] || 1;
    
    try {
      approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        Branch_idBranch,
        "CREATE_CUSTOMER_RETURN"
      );
      
      if (approvalRequired) {
        await new Promise((resolve, reject) => {
          db.query(
            "UPDATE customer_return SET approval_status = 'PENDING_APPROVAL' WHERE idCustomer_Return = ?",
            [idCustomer_Return],
            (err) => (err ? reject(err) : resolve())
          );
        });
        console.log(`[RETURN] Customer Return ${idCustomer_Return} requires approval (PENDING_APPROVAL)`);
      }
    } catch (err) {
      console.error("Approval check failed for Customer Return, defaulting to ACTIVE", err);
    }

    await Promise.all(
      itemsList.map(async (item) => {
        const Item = await itemDbService.fetchItem(item.Item_idItem);

        if (item.Item_Description == " " || !item.Item_Description) {
          item.Item_Description = item.Item_Long_Description;
        }

        await dbService.insertItems(
          idCustomer_Return,
          item.Item_idItem,
          item.Item_Description,
          item.Cost,
          item.Qty_Type,
          item.Qty,
          item.Total,
          Branch_idBranch,
          item.Variation_Id,
          item.Invoice_Item_Id,
          item.Item_Return_Type || Return_Type || "return",
        );

        if (item.Item_Has_Serial === 1 && Array.isArray(item.Serial_No)) {
          item.Serial_No.map(async (serial_number) => {
            serial_no_id = await dbService.getSerials(serial_number);
            await dbService.insertCustomerReturnSerials(
              idCustomer_Return,
              serial_no_id.ID,
            );
          });
        }
      }),
    );

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Customer Return",
      idCustomer_Return,
      "create",
      Branch_idBranch,
    );
    
    // Trigger Approval Request if needed
    if (approvalRequired) {
      const createdBy = User_idUser || req.user?.idUser || req.user?.id || 1;
      try {
        await approvalService.triggerApprovalRequest(
          "customer_return",
          idCustomer_Return,
          Branch_idBranch,
          companyId,
          Total_Amount,
          createdBy
        );
      } catch (err) {
        console.error("[RETURN] Error triggering approval webhook:", err);
      }
    }

    res.json({
      message: approvalRequired
        ? "Customer Return submitted for approval. It will take effect once approved."
        : "Customer Return is added successfully",
      approval_required: !!approvalRequired,
      approval_status: approvalRequired ? "PENDING_APPROVAL" : "ACTIVE",
      idCustomer_Return,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating Customer Return", error: err.message });
  }
};

const getProcessReturns = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const customerReturns = await dbService.fetchCustomerItems(Branch_idBranch);

    if (customerReturns.length === 0) {
      return res.json([]);
    }

    await Promise.all(
      customerReturns.map(async (customerReturn) => {
        const items = await dbService.fetchItems(
          customerReturn.idCustomer_Return,
        );
        for (const item of items) {
          if (item.Item_Has_Serial === 1) {
            const serialNumbers = await dbService.fetchSerialNoForItem(
              customerReturn.idCustomer_Return,
            );
            item.Serial_No = serialNumbers;
          }
        }
        customerReturn.items = items;
      }),
    );

    res.json(customerReturns);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const getCustomerReturnById = async (req, res) => {
  try {
    const { idCustomer_Return } = req.params;
    const customerReturn =
      await dbService.fetchCustomerReturn(idCustomer_Return);

    const items = await dbService.fetchItems(
      customerReturn[0].idCustomer_Return,
    );

    for (const item of items) {
      const serialNumbers =
        await dbService.fetchSerialNoForItem(idCustomer_Return);
      item.Serial_No = serialNumbers;
    }
    customerReturn[0].items = items;
    res.json(customerReturn[0]);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const updateCustomerReturn = async (req, res) => {
  try {
    const { idCustomer_Return } = req.params;
    const {
      Date,
      Total_Amount,
      Branch_idBranch,
      items,
      Reason,
      Return_Type,
      User_idUser,
      Return_Receipt_No,
      Employee_idEmployee,
    } = req.body;

    const itemsList = items || [];

    await dbService.updateCustomerReturn(
      Date,
      itemsList.length,
      Total_Amount,
      idCustomer_Return,
      Reason,
      Return_Type,
      Return_Receipt_No,
      Employee_idEmployee,
    );

    await dbService.deleteItems(idCustomer_Return);
    await Promise.all(
      itemsList.map(async (item) => {
        if (item.Item_Description == " " || !item.Item_Description) {
          item.Item_Description = item.Item_Long_Description;
        }

        await dbService.insertItems(
          idCustomer_Return,
          item.Item_idItem,
          item.Item_Description,
          item.Cost,
          item.Qty_Type,
          item.Qty,
          item.Total,
          Branch_idBranch,
          item.Variation_Id,
          null,
          item.Item_Return_Type || Return_Type || "return",
        );

        await dbService.deleteCustomerRetrunSerials(idCustomer_Return);
        if (item.Item_Has_Serial === 1 && Array.isArray(item.Serial_No)) {
          item.Serial_No.map(async (serial_number) => {
            serial_no_id = await dbService.getSerials(serial_number);
            await dbService.insertCustomerReturnSerials(
              idCustomer_Return,
              serial_no_id.ID,
            );
          });
        }
      }),
    );

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Customer Return",
      idCustomer_Return,
      "edit",
      Branch_idBranch,
    );

    res.json({
      message: "Customer Return has been updated successfully",
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating customer return", error: err.message });
  }
};

const processCustomerReturn = async (req, res) => {
  try {
    const { idCustomer_Return, Branch_idBranch, User_idUser, Selected_Invoice_Ids } = req.body;
    console.log("Process Customer Return Request Body:", req.body);
    console.log("Processing ID:", idCustomer_Return);

    await dbService.processCustomerReturnTransaction(
      idCustomer_Return,
      Branch_idBranch,
      User_idUser,
      Array.isArray(Selected_Invoice_Ids) && Selected_Invoice_Ids.length > 0
        ? Selected_Invoice_Ids
        : null,
    );

    res.json({
      message: "Customer Return Processed successfully",
    });
  } catch (err) {
    // Handle specific errors
    if (err.message === "Customer Return record not found") {
      return res.status(404).json({ message: err.message });
    }
    if (err.message === "Customer Return already processed") {
      return res.status(400).json({ message: err.message });
    }

    res.status(500).json({
      message: "Error processing customer return",
      error: err.message,
    });
  }
};

const unprocessCustomerReturn = async (req, res) => {
  try {
    const { idCustomer_Return, Branch_idBranch, User_idUser } = req.body;
    console.log("Unprocess Customer Return Request Body:", req.body);

    await dbService.unprocessCustomerReturnTransaction(
      idCustomer_Return,
      Branch_idBranch,
      User_idUser,
    );

    res.json({
      message: "Customer Return Unprocessed successfully",
    });
  } catch (err) {
    if (err.message === "Customer Return record not found") {
      return res.status(404).json({ message: err.message });
    }
    if (err.message === "Customer Return is not processed yet") {
      return res.status(400).json({ message: err.message });
    }

    res.status(500).json({
      message: "Error unprocessing customer return",
      error: err.message,
    });
  }
};


const getSoldSerials = async (req, res) => {
  try {
    const { Item_idItem } = req.params;
    const { branchId } = req.query;

    const serials = await dbService.fetchSoldSerials(Item_idItem, branchId);
    if (!serials || serials.length === 0) {
      return res.status(404).json({ message: "No sold serial numbers found" });
    }
    res.json(serials);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching sold serials",
      error: err.message,
    });
  }
};

const checkReturnSerial = async (req, res) => {
  try {
    const { serial_numbers } = req.body;

    const checkSerials = await dbService.checkReturnSerial(serial_numbers);

    if (checkSerials.length === 0) {
      res
        .status(200)
        .json({ message: "The item is not found or already in stock" });
    } else {
      // If matching serial numbers found, send the list of existing serial numbers
      res.status(200).json({ existing_serial_numbers: checkSerials });
    }
  } catch (err) {
    res.status(500).json({
      message: "Error checking serials",
      error: err.message,
    });
  }
};

const getCustomerInvoicesForReturn = async (req, res) => {
  try {
    const { customerId, branchId } = req.params;
    const invoices = await dbService.fetchCustomerInvoicesForReturn(
      customerId,
      branchId,
    );
    res.json(invoices);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching invoices for return",
      error: err.message,
    });
  }
};

const getInvoiceItemsForReturn = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    console.log("📦 Fetching invoice items for invoiceId:", invoiceId);
    const items = await dbService.fetchInvoiceItemsForReturn(invoiceId);
    console.log("📦 Found items:", items.length, items);
    res.json(items);
  } catch (err) {
    console.error("📦 Error fetching invoice items:", err);
    res.status(500).json({
      message: "Error fetching invoice items for return",
      error: err.message,
    });
  }
};
const getCustomerOutstandingInvoices = async (req, res) => {
  try {
    const { customerId, branchId } = req.params;
    const invoices = await dbService.fetchCustomerOutstandingInvoices(
      customerId,
      branchId,
    );
    res.json(invoices);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching outstanding invoices",
      error: err.message,
    });
  }
};

const deleteCustomerReturnById = async (req, res) => {
  try {
    const { idCustomer_Return } = req.params;

    // Fetch the return to guard: only pending (Status=0) can be deleted
    const records = await dbService.fetchCustomerReturn(idCustomer_Return);
    if (!records || records.length === 0) {
      return res.status(404).json({ message: "Customer Return not found" });
    }
    const record = records[0];
    if (record.Status == 1) {
      return res.status(400).json({
        message: "Cannot delete a processed Customer Return.",
      });
    }

    await dbService.deleteCustomerReturn(idCustomer_Return);

    // Log the action — non-critical, don't let log failure block the response
    try {
      await userLogDbService.insertLog(
        record.User_idUser || null,
        currentDate(),
        "Customer Return",
        idCustomer_Return,
        "delete",
        record.Branch_idBranch,
      );
    } catch (logErr) {
      console.warn("Warning: could not write user log for delete:", logErr.message);
    }

    res.json({ message: "Customer Return deleted successfully" });
  } catch (err) {
    res.status(500).json({
      message: "Error deleting Customer Return",
      error: err.message,
    });
  }
};

const lookupBarcodeForReturn = async (req, res) => {
  try {
    const { barcode, branchId } = req.params;
    const { customerId } = req.query;

    const result = await dbService.lookupBarcodeForCustomerReturn(
      barcode,
      branchId,
      customerId,
    );

    if (!result) {
      return res.status(404).json({
        message: `No product, serial, or invoice found matching "${barcode}"`,
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Error looking up barcode for customer return:", err);
    res.status(500).json({
      message: "Error looking up barcode",
      error: err.message,
    });
  }
};

module.exports = {
  createCustomerReturn,
  getProcessReturns,
  getCustomerReturnById,
  updateCustomerReturn,
  processCustomerReturn,
  unprocessCustomerReturn,
  checkReturnSerial,
  getCustomerInvoicesForReturn,
  getInvoiceItemsForReturn,
  getCustomerOutstandingInvoices,
  deleteCustomerReturnById,
  getSoldSerials,
  lookupBarcodeForReturn,
};
