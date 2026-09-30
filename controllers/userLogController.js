const dbService = require("../services/userLogDBService");

const getLog = async (req, res) => {
  try {
    const { Branch_idBranch, from, to } = req.params;
    const userLog = await dbService.fetchLog(
      Branch_idBranch,
      `${from} 00:00`,
      `${to} 23:59`
    );

    for (let i = 0; i < userLog.length; i++) {
      const user = await dbService.fetchUserById(userLog[i].User_idUser);
      userLog[i].User =
        user?.[0]?.First_Name + " " + user?.[0]?.Last_Name || "Unknown User";

      switch (userLog[i].Task_Type) {
        case "Customer":
          const customer = await dbService.fetchCustomerById(
            userLog[i].Task_ID
          );
          userLog[i].customer =
            customer?.[0]?.displayName || "Deleted Customer";
          break;

        case "Supplier":
          const supplier = await dbService.fetchSupplierById(
            userLog[i].Task_ID
          );
          userLog[i].supplier =
            supplier?.[0]?.Company_Name || "Deleted Supplier";
          break;

        case "Item":
          const item = await dbService.fetchItemById(userLog[i].Task_ID);
          userLog[i].item = item?.[0]?.Description || "Deleted Item";
          break;

        case "Earnings & Expenses":
        case "Damage Note":
          // user already set above
          break;

        case "Purchase Return":
          const purchaseReturn = await dbService.fetchPurchaseReturnById(
            userLog[i].Task_ID
          );
          userLog[i].Company_Name =
            purchaseReturn?.[0]?.Company_Name || "Deleted Supplier";
          userLog[i].Total_Amount = purchaseReturn?.[0]?.Total_Amount || 0;
          break;

        case "GRN":
          const grn = await dbService.fetchGrnById(userLog[i].Task_ID);
          userLog[i].Bill_no = grn?.[0]?.Bill_no || "Not Found";
          userLog[i].Supplier_Name = grn?.[0]?.Company_Name || "Unknown";
          break;

        case "Invoice":
          const invoice = await dbService.fetchInvoicebyId(userLog[i].Task_ID);
          userLog[i].Invoice_Number =
            invoice?.[0]?.Invoice_Number || "Not Found";
          userLog[i].Customer_Name = invoice?.[0]?.displayName || "Unknown";
          break;

        case "Quotation":
          const quotation = await dbService.fetchQuotationById(
            userLog[i].Task_ID
          );
          userLog[i].Quotation_Number =
            quotation?.[0]?.Quotation_Number || "Not Found";
          userLog[i].Customer_Name = quotation?.[0]?.displayName || "Unknown";
          break;

        case "Customer Return":
          const customerReturn = await dbService.fetchCustomerReturnById(
            userLog[i].Task_ID
          );
          userLog[i].Return_Id = userLog[i].Task_ID;
          userLog[i].Customer_Name =
            customerReturn?.[0]?.displayName || "Unknown";
          userLog[i].Return_Type = customerReturn?.[0]?.Return_Type || "return";
          break;

        case "Warehouse":
        case "Stock Transfer":
          // Warehouse and Stock Transfer use Task_Category as the action
          // Additional details can be added if needed
          break;

        default:
          break;
      }

      // Generate formatted activity text
      const userName = userLog[i].User;
      const category = userLog[i].Task_Category;
      const taskType = userLog[i].Task_Type;
      let activityText = "";

      switch (taskType) {
        case "GRN":
          if (category === "create") {
            activityText = `${userName} created new GRN (Bill No: ${userLog[i].Bill_no})`;
          } else if (category === "edit") {
            activityText = `${userName} edited GRN (Bill No: ${userLog[i].Bill_no})`;
          } else if (category === "process") {
            activityText = `${userName} processed GRN (Bill No: ${userLog[i].Bill_no})`;
          } else if (category === "delete") {
            activityText = `${userName} deleted GRN #${userLog[i].Task_ID}`;
          }
          break;

        case "Invoice":
          if (category === "create") {
            activityText = `${userName} created Invoice #${userLog[i].Invoice_Number}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Invoice #${userLog[i].Invoice_Number}`;
          } else if (category === "process") {
            activityText = `${userName} processed Invoice #${userLog[i].Invoice_Number}`;
          } else if (category === "delete") {
            activityText = `${userName} deleted Invoice #${userLog[i].Task_ID}`;
          }
          break;

        case "Customer Return":
          if (category === "create") {
            activityText = `${userName} created Customer Return #${userLog[i].Return_Id}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Customer Return #${userLog[i].Return_Id}`;
          } else if (category === "process") {
            activityText = `${userName} processed Customer Return #${userLog[i].Return_Id} (${userLog[i].Return_Type})`;
          }
          break;

        case "Purchase Return":
          if (category === "create") {
            activityText = `${userName} created Purchase Return for ${userLog[i].Company_Name}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Purchase Return for ${userLog[i].Company_Name}`;
          } else if (category === "process") {
            activityText = `${userName} processed Purchase Return for ${userLog[i].Company_Name}`;
          }
          break;

        case "Quotation":
          if (category === "create") {
            activityText = `${userName} created Quotation #${userLog[i].Quotation_Number}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Quotation #${userLog[i].Quotation_Number}`;
          } else if (category === "delete") {
            activityText = `${userName} deleted Quotation #${userLog[i].Task_ID}`;
          }
          break;

        case "Customer":
          if (category === "create") {
            activityText = `${userName} added new customer: ${userLog[i].customer}`;
          } else if (category === "edit") {
            activityText = `${userName} updated customer: ${userLog[i].customer}`;
          } else if (category === "add-manual-credit") {
            activityText = `${userName} manually added credit for customer: ${userLog[i].customer}`;
          }
          break;

        case "Supplier":
          if (category === "create") {
            activityText = `${userName} added new supplier: ${userLog[i].supplier}`;
          } else if (category === "edit") {
            activityText = `${userName} updated supplier: ${userLog[i].supplier}`;
          }
          break;

        case "Item":
          if (category === "create") {
            activityText = `${userName} added new item: ${userLog[i].item}`;
          } else if (category === "edit") {
            activityText = `${userName} updated item: ${userLog[i].item}`;
          } else if (category === "delete") {
            activityText = `${userName} deleted item: ${userLog[i].item}`;
          }
          break;

        case "Earnings & Expenses":
          if (category === "create") {
            activityText = `${userName} added earnings/expenses entry`;
          } else if (category === "edit") {
            activityText = `${userName} updated earnings/expenses entry`;
          } else if (category === "deleted") {
            activityText = `${userName} deleted earnings/expenses entry`;
          }
          break;

        case "Damage Note":
          if (category === "create") {
            activityText = `${userName} created Damage Note #${userLog[i].Task_ID}`;
          }
          break;

        case "Warehouse":
          if (category === "created") {
            activityText = `${userName} created warehouse #${userLog[i].Task_ID}`;
          } else if (category === "edited") {
            activityText = `${userName} updated warehouse #${userLog[i].Task_ID}`;
          }
          break;

        case "Stock Transfer":
          if (category === "transferred") {
            activityText = `${userName} transferred stock from warehouse #${userLog[i].Task_ID}`;
          }
          break;

        default:
          activityText = `${userName} ${category} ${taskType} #${userLog[i].Task_ID}`;
          break;
      }

      userLog[i].activityText = activityText;
    }

    res.json(userLog);
  } catch (err) {
    console.error("Error fetching user log:", err);
    res
      .status(500)
      .json({ message: "Error fetching user log", error: err.message });
  }
};

const getLogByUser = async (req, res) => {
  try {
    const { Branch_idBranch, userId } = req.params;
    const userLog = await dbService.fetchLogByUser(Branch_idBranch, userId);

    for (let i = 0; i < userLog.length; i++) {
      const user = await dbService.fetchUserById(userLog[i].User_idUser);
      userLog[i].User = user?.[0]?.User_Name || "Unknown User";

      switch (userLog[i].Task_Type) {
        case "Customer":
          const customer = await dbService.fetchCustomerById(
            userLog[i].Task_ID
          );
          userLog[i].customer =
            customer?.[0]?.displayName || "Deleted Customer";
          break;

        case "Supplier":
          const supplier = await dbService.fetchSupplierById(
            userLog[i].Task_ID
          );
          userLog[i].supplier =
            supplier?.[0]?.Company_Name || "Deleted Supplier";
          break;

        case "Item":
          const item = await dbService.fetchItemById(userLog[i].Task_ID);
          userLog[i].item = item?.[0]?.Description || "Deleted Item";
          break;

        case "Earnings & Expenses":
        case "Damage Note":
          // no further action
          break;

        case "Purchase Return":
          const purchaseReturn = await dbService.fetchPurchaseReturnById(
            userLog[i].Task_ID
          );
          userLog[i].Company_Name =
            purchaseReturn?.[0]?.Company_Name || "Deleted Supplier";
          userLog[i].Total_Amount = purchaseReturn?.[0]?.Total_Amount || 0;
          break;

        case "GRN":
          const grn = await dbService.fetchGrnById(userLog[i].Task_ID);
          userLog[i].Bill_no = grn?.[0]?.Bill_no || "Not Found";
          userLog[i].Supplier_Name = grn?.[0]?.Company_Name || "Unknown";
          break;

        case "Invoice":
          const invoice = await dbService.fetchInvoicebyId(userLog[i].Task_ID);
          userLog[i].Invoice_Number =
            invoice?.[0]?.Invoice_Number || "Not Found";
          userLog[i].Customer_Name = invoice?.[0]?.displayName || "Unknown";
          break;

        case "Quotation":
          const quotation = await dbService.fetchQuotationById(
            userLog[i].Task_ID
          );
          userLog[i].Quotation_Number =
            quotation?.[0]?.Quotation_Number || "Not Found";
          userLog[i].Customer_Name = quotation?.[0]?.displayName || "Unknown";
          break;

        case "Customer Return":
          const customerReturn = await dbService.fetchCustomerReturnById(
            userLog[i].Task_ID
          );
          userLog[i].Return_Id = userLog[i].Task_ID;
          userLog[i].Customer_Name =
            customerReturn?.[0]?.displayName || "Unknown";
          userLog[i].Return_Type = customerReturn?.[0]?.Return_Type || "return";
          break;

        case "Warehouse":
        case "Stock Transfer":
          // Warehouse and Stock Transfer use Task_Category as the action
          // Additional details can be added if needed
          break;

        default:
          break;
      }

      // Generate formatted activity text
      const userName = userLog[i].User;
      const category = userLog[i].Task_Category;
      const taskType = userLog[i].Task_Type;
      let activityText = "";

      switch (taskType) {
        case "GRN":
          if (category === "create") {
            activityText = `${userName} created new GRN (Bill No: ${userLog[i].Bill_no})`;
          } else if (category === "edit") {
            activityText = `${userName} edited GRN (Bill No: ${userLog[i].Bill_no})`;
          } else if (category === "process") {
            activityText = `${userName} processed GRN (Bill No: ${userLog[i].Bill_no})`;
          } else if (category === "delete") {
            activityText = `${userName} deleted GRN #${userLog[i].Task_ID}`;
          }
          break;

        case "Invoice":
          if (category === "create") {
            activityText = `${userName} created Invoice #${userLog[i].Invoice_Number}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Invoice #${userLog[i].Invoice_Number}`;
          } else if (category === "process") {
            activityText = `${userName} processed Invoice #${userLog[i].Invoice_Number}`;
          } else if (category === "delete") {
            activityText = `${userName} deleted Invoice #${userLog[i].Task_ID}`;
          }
          break;

        case "Customer Return":
          if (category === "create") {
            activityText = `${userName} created Customer Return #${userLog[i].Return_Id}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Customer Return #${userLog[i].Return_Id}`;
          } else if (category === "process") {
            activityText = `${userName} processed Customer Return #${userLog[i].Return_Id} (${userLog[i].Return_Type})`;
          }
          break;

        case "Purchase Return":
          if (category === "create") {
            activityText = `${userName} created Purchase Return for ${userLog[i].Company_Name}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Purchase Return for ${userLog[i].Company_Name}`;
          } else if (category === "process") {
            activityText = `${userName} processed Purchase Return for ${userLog[i].Company_Name}`;
          }
          break;

        case "Quotation":
          if (category === "create") {
            activityText = `${userName} created Quotation #${userLog[i].Quotation_Number}`;
          } else if (category === "edit") {
            activityText = `${userName} edited Quotation #${userLog[i].Quotation_Number}`;
          } else if (category === "delete") {
            activityText = `${userName} deleted Quotation #${userLog[i].Task_ID}`;
          }
          break;

        case "Customer":
          if (category === "create") {
            activityText = `${userName} added new customer: ${userLog[i].customer}`;
          } else if (category === "edit") {
            activityText = `${userName} updated customer: ${userLog[i].customer}`;
          } else if (category === "add-manual-credit") {
            activityText = `${userName} manually added credit for customer: ${userLog[i].customer}`;
          }
          break;

        case "Supplier":
          if (category === "create") {
            activityText = `${userName} added new supplier: ${userLog[i].supplier}`;
          } else if (category === "edit") {
            activityText = `${userName} updated supplier: ${userLog[i].supplier}`;
          }
          break;

        case "Item":
          if (category === "create") {
            activityText = `${userName} added new item: ${userLog[i].item}`;
          } else if (category === "edit") {
            activityText = `${userName} updated item: ${userLog[i].item}`;
          } else if (category === "delete") {
            activityText = `${userName} deleted item: ${userLog[i].item}`;
          }
          break;

        case "Earnings & Expenses":
          if (category === "create") {
            activityText = `${userName} added earnings/expenses entry`;
          } else if (category === "edit") {
            activityText = `${userName} updated earnings/expenses entry`;
          } else if (category === "deleted") {
            activityText = `${userName} deleted earnings/expenses entry`;
          }
          break;

        case "Damage Note":
          if (category === "create") {
            activityText = `${userName} created Damage Note #${userLog[i].Task_ID}`;
          }
          break;

        case "Warehouse":
          if (category === "created") {
            activityText = `${userName} created warehouse #${userLog[i].Task_ID}`;
          } else if (category === "edited") {
            activityText = `${userName} updated warehouse #${userLog[i].Task_ID}`;
          }
          break;

        case "Stock Transfer":
          if (category === "transferred") {
            activityText = `${userName} transferred stock from warehouse #${userLog[i].Task_ID}`;
          }
          break;

        default:
          activityText = `${userName} ${category} ${taskType} #${userLog[i].Task_ID}`;
          break;
      }

      userLog[i].activityText = activityText;
    }

    res.json(userLog);
  } catch (err) {
    console.error("Error fetching user log:", err);
    res
      .status(500)
      .json({ message: "Error fetching user log", error: err.message });
  }
};

module.exports = {
  getLog,
  getLogByUser,
};
