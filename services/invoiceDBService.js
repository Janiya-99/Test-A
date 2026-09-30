const db = require("../db/db");
const db2 = require("../db/db2");
const {
  fetchInstallmentByInvoice,
  fetchInstallmentsForInvoiceList,
} = require("./installmentDBService");

const getSiblingBranchIds = (branchId) => {
  return new Promise((resolve, reject) => {
    // 1. Get Company ID from db2
    const companyQuery =
      "SELECT Company_idCompany FROM branch WHERE idBranch = ?";
    db2.query(companyQuery, [branchId], (err, results) => {
      if (err) return reject(err);
      if (results.length === 0) return resolve([branchId]); // Fallback

      const companyId = results[0].Company_idCompany;

      // 2. Get all branches for this company from db2
      const branchesQuery =
        "SELECT idBranch FROM branch WHERE Company_idCompany = ?";
      db2.query(branchesQuery, [companyId], (err2, branchRows) => {
        if (err2) return reject(err2);

        const ids = branchRows.map((b) => b.idBranch);
        resolve(ids.length > 0 ? ids : [branchId]);
      });
    });
  });
};

const getLastInvoice = async (Branch_idBranch) => {
  try {
    // Use strict Branch_idBranch filtering
    const branchIds = [Branch_idBranch];
    const query =
      "SELECT * FROM invoice WHERE Branch_idBranch IN (?) ORDER BY idInvoice DESC LIMIT 1";
    return new Promise((resolve, reject) => {
      db.query(query, [branchIds], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      });
    });
  } catch (err) {
    throw err;
  }
};

const getLastInvoiceBySalesmanPrefix = async (Branch_idBranch, prefix) => {
  try {
    // Use strict Branch_idBranch filtering (same as getLastInvoice)
    const branchIds = [Branch_idBranch];
    // Optimized query to prevent slow backwards primary key scans.
    // By sorting by length and string value, it avoids full table scans
    // and returns the highest invoice number for the prefix very fast.
    const query =
      "SELECT Invoice_Number FROM invoice WHERE Branch_idBranch IN (?) AND Invoice_Number LIKE ? ORDER BY LENGTH(Invoice_Number) DESC, Invoice_Number DESC LIMIT 1";
    return new Promise((resolve, reject) => {
      db.query(query, [branchIds, `${prefix}%`], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      });
    });
  } catch (err) {
    throw err;
  }
};

const getLastInvoiceBySalesman = async (Branch_idBranch, employeeId) => {
  try {
    const branchIds = [Branch_idBranch];
    const query =
      "SELECT Invoice_Number FROM invoice WHERE Branch_idBranch IN (?) AND Employee_idEmployee = ? ORDER BY idInvoice DESC LIMIT 1";
    return new Promise((resolve, reject) => {
      db.query(query, [branchIds, employeeId], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      });
    });
  } catch (err) {
    throw err;
  }
};

const checkInvoice = (Invoice_Number, Branch_idBranch) => {
  const query = `SELECT * FROM invoice WHERE Invoice_Number = ? AND Branch_idBranch = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [Invoice_Number, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const insertInvoice = (
  Invoice_Number,
  Quotation_idQuotation,
  Date,
  Customer_idCustomer,
  Address,
  Employee_idEmployee,
  Total,
  Discount_Type,
  Discount_Presentage,
  Discount_Amount,
  Discount2_Type,
  Discount2_Presentage,
  Discount2_Amount,
  Net_Amount,
  Item_Count,
  Note,
  Payment_Type,
  Interest_Amount,
  Interest_Presentage,
  Interest_Type,
  Paid_Amount,
  Balance_Amount,
  Credit_Balance,
  Total_Credit_Balance,
  Created_Date,
  created_at,
  Branch_idBranch,
  Payment_Method,
  Card_Type,
  Card_Number,
  Transaction_Id,
  Receipt,
  Cheque_Type,
  Cheque_No,
  Cheque_Date,
  Cheque_Name,
  Bank_Account_Id,
  Vat_Amount,
  Vat_Type,
  Extra_Charge_Label,
  Extra_Charge,
  user,
  place_of_supply,
  custom_fields_data,
  connection,
) => {
  let actualConnection = connection;
  let actualCustomFields = custom_fields_data;

  // Backward compatibility check for other call sites that omit custom_fields_data
  if (custom_fields_data && (custom_fields_data.query || typeof custom_fields_data.query === "function")) {
    actualConnection = custom_fields_data;
    actualCustomFields = null;
  }

  const query = `INSERT INTO invoice 
 (Invoice_Number, Quotation_idQuotation, Date, Customer_idCustomer, Address, Employee_idEmployee, Total, Discount_Type, Discount_Presentage, Discount_Amount, Discount2_Type, Discount2_Presentage, Discount2_Amount, Net_Amount, Item_Count, Note, Payment_Type, Interest_Amount, Interest_Presentage, Interest_Type, Paid_Amount, Balance_Amount, Credit_Balance, Total_Credit_Balance, Created_Date, created_at, Branch_idBranch, Payment_Method, Card_Type, Card_Number, Transaction_Id, Receipt, Cheque_Type, Cheque_No, Cheque_Date, Cheque_Name, Bank_Account_Id, Vat_Amount, Vat_Type, Extra_Charge_Label, Extra_Charge, user, place_of_supply, custom_fields_data)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return new Promise((resolve, reject) => {
    (actualConnection || db).query(
      query,
      [
        Invoice_Number,
        Quotation_idQuotation || 0,
        Date,
        Customer_idCustomer,
        Address,
        Employee_idEmployee,
        Total,
        Discount_Type || "percentage",
        parseFloat(Discount_Presentage) || 0,
        parseFloat(Discount_Amount) || 0,
        Discount2_Type || "percentage",
        parseFloat(Discount2_Presentage) || 0,
        parseFloat(Discount2_Amount) || 0,
        Net_Amount,
        Item_Count,
        Note,
        Payment_Type || 1,
        parseFloat(Interest_Amount) || 0,
        parseFloat(Interest_Presentage) || 0,
        Interest_Type || "Amount",
        Paid_Amount,
        Balance_Amount,
        Credit_Balance,
        Total_Credit_Balance,
        Created_Date,
        created_at,
        Branch_idBranch,
        Payment_Method,
        Card_Type,
        Card_Number,
        Transaction_Id,
        Receipt,
        Cheque_Type,
        Cheque_No,
        Cheque_Date,
        Cheque_Name,
        Bank_Account_Id,
        parseFloat(Vat_Amount) || 0,
        Vat_Type,
        Extra_Charge_Label,
        Extra_Charge,
        user,
        place_of_supply,
        actualCustomFields ? (typeof actualCustomFields === "string" ? actualCustomFields : JSON.stringify(actualCustomFields)) : null,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      },
    );
  });
};

const updateInvoice = (
  idInvoice,
  Invoice_Number,
  Quotation_idQuotation,
  Customer_idCustomer,
  Date,
  Employee_idEmployee,
  Total,
  Discount_Type,
  Discount_Presentage,
  Discount_Amount,
  Discount2_Type,
  Discount2_Presentage,
  Discount2_Amount,
  Net_Amount,
  Item_Count,
  Note,
  Payment_Type,
  Paid_Amount,
  Balance_Amount,
  Credit_Balance,
  Total_Credit_Balance,
  Payment_Method,
  Card_Type,
  Card_Number,
  Transaction_Id,
  Receipt,
  Cheque_Type,
  Cheque_No,
  Cheque_Date,
  Cheque_Name,
  Vat_Amount,
  Extra_Charge_Label,
  Extra_Charge,
  Interest_Amount,
  Interest_Presentage,
  Interest_Type,
  Bank_Account_Id,
  place_of_supply,
  custom_fields_data,
  connection,
) => {
  let actualConnection = connection;
  let actualCustomFields = custom_fields_data;

  // Backward compatibility check for other call sites that omit custom_fields_data
  if (custom_fields_data && (custom_fields_data.query || typeof custom_fields_data.query === "function")) {
    actualConnection = custom_fields_data;
    actualCustomFields = null;
  }

  const query = `UPDATE invoice SET
  Invoice_Number = ?, 
  Quotation_idQuotation = ?, 
  Customer_idCustomer = ?,
  Date = ?, 
  Employee_idEmployee = ?, 
  Total = ?, 
  Discount_Type = ?, 
  Discount_Presentage = ?, 
  Discount_Amount = ?, 
  Discount2_Type = ?, 
  Discount2_Presentage = ?, 
  Discount2_Amount = ?, 
  Net_Amount = ?, 
  Item_Count = ?, 
  Note = ?, 
  Payment_Type = ?, 
  Paid_Amount = ?, 
  Balance_Amount = ?, 
  Credit_Balance = ?, 
  Total_Credit_Balance = ?,
  Payment_Method = ?,
  Card_Type = ?,
  Card_Number = ?,
  Transaction_Id = ?,
  Receipt = ?,
  Cheque_Type = ?,
  Cheque_No = ?,
  Cheque_Date = ?,
  Cheque_Name = ?,
  Vat_Amount = ?,
  Extra_Charge_Label = ?,
  Extra_Charge = ?,
  Interest_Amount = ?,
  Interest_Presentage = ?,
  Interest_Type = ?,
  Bank_Account_Id = ?,
  place_of_supply = ?,
  custom_fields_data = ?
WHERE idInvoice = ?`;

  return new Promise((resolve, reject) => {
    (actualConnection || db).query(
      query,
      [
        Invoice_Number || '',
        Quotation_idQuotation !== undefined && Quotation_idQuotation !== null ? Quotation_idQuotation : 0,
        Customer_idCustomer || 1,
        Date,
        Employee_idEmployee || 1,
        Total !== undefined && Total !== null ? Total : 0,
        Discount_Type || 'percentage',
        Discount_Presentage !== undefined && Discount_Presentage !== null ? Discount_Presentage : 0,
        Discount_Amount !== undefined && Discount_Amount !== null ? Discount_Amount : 0,
        Discount2_Type || 'percentage',
        Discount2_Presentage !== undefined && Discount2_Presentage !== null ? Discount2_Presentage : 0,
        Discount2_Amount !== undefined && Discount2_Amount !== null ? Discount2_Amount : 0,
        Net_Amount !== undefined && Net_Amount !== null ? Net_Amount : 0,
        Item_Count !== undefined && Item_Count !== null ? Item_Count : 0,
        Note || '',
        Payment_Type !== undefined && Payment_Type !== null ? Payment_Type : 1,
        Paid_Amount !== undefined && Paid_Amount !== null ? Paid_Amount : 0,
        Balance_Amount !== undefined ? Balance_Amount : null,
        Credit_Balance !== undefined ? Credit_Balance : null,
        Total_Credit_Balance !== undefined && Total_Credit_Balance !== null ? Total_Credit_Balance : 0,
        Payment_Method || 'cash',
        Card_Type,
        Card_Number,
        Transaction_Id,
        Receipt,
        Cheque_Type,
        Cheque_No,
        Cheque_Date,
        Cheque_Name,
        Vat_Amount !== undefined && Vat_Amount !== null ? Vat_Amount : 0,
        Extra_Charge_Label,
        Extra_Charge,
        Interest_Amount !== undefined && Interest_Amount !== null ? Interest_Amount : 0,
        Interest_Presentage !== undefined && Interest_Presentage !== null ? Interest_Presentage : 0,
        Interest_Type || 'Amount',
        Bank_Account_Id,
        place_of_supply,
        actualCustomFields ? (typeof actualCustomFields === "string" ? actualCustomFields : JSON.stringify(actualCustomFields)) : null,
        idInvoice,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      },
    );
  });
};

const updateInvoiceBalance = (
  idInvoice,
  Paid_Amount,
  Balance_Amount,
  Credit_Balance,
  connection,
) => {
  const query = `UPDATE invoice SET Paid_Amount = ?, Balance_Amount = ?, Credit_Balance = ? WHERE idInvoice = ?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Paid_Amount, Balance_Amount, Credit_Balance, idInvoice],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const insertInvoiceItem = (
  Invoice_idInvoice,
  Item_idItem,
  Item_Has_Serial,
  Serial_No_Id,
  Description,
  Long_Description,
  Qty_Type,
  Qty,
  Rate,
  Amount,
  Discount_Type,
  Discount,
  Total_Amount,
  Branch_idBranch,
  Variation_Id,
  Remarks,
  arg17,
  arg18,
  arg19,
  Detailed_Description,
) => {
  let connection = null;
  let is_bonus_line = 0;
  let promo_rule_id = null;

  // Detect connection object which has query method
  if (arg17 && typeof arg17.query === "function") {
    connection = arg17;
    is_bonus_line = arg18 !== undefined ? arg18 : 0;
    promo_rule_id = arg19 !== undefined ? arg19 : null;
  } else {
    is_bonus_line = arg17 !== undefined ? arg17 : 0;
    promo_rule_id = arg18 !== undefined ? arg18 : null;
    if (arg19 && typeof arg19.query === "function") {
      connection = arg19;
    }
  }

  const query =
    "INSERT INTO invoice_has_item (Invoice_idInvoice, Item_idItem, Item_Has_Serial, Serial_No_Id, Description, Long_Description, Qty_Type, Qty, Rate, Amount, Discount_Type, Discount, Total_Amount, Branch_idBranch, Variation_Id, Remarks, is_bonus_line, promo_rule_id, Detailed_Description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Invoice_idInvoice,
        Item_idItem,
        Item_Has_Serial,
        Serial_No_Id,
        Description,
        Long_Description,
        Qty_Type,
        Qty,
        Rate,
        Amount,
        Discount_Type || "percentage",
        parseFloat(Discount) || 0,
        Total_Amount,
        Branch_idBranch,
        Variation_Id || null,
        Remarks || null,
        is_bonus_line,
        promo_rule_id,
        Detailed_Description || null,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      },
    );
  });
};

const deleteInvoiceItem = (Invoice_idInvoice, connection) => {
  const query = "DELETE FROM invoice_has_item WHERE Invoice_idInvoice = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Invoice_idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const insertInvoiceSerials = (
  Invoice_idInvoice,
  Item_Serial_No_id,
  connection,
) => {
  try {
    const query =
      "INSERT INTO invoice_has_item_serial_no (Invoice_idInvoice, Item_Serial_No_id) VALUES (?,?)";
    return new Promise((resolve, reject) => {
      (connection || db).query(
        query,
        [Invoice_idInvoice, Item_Serial_No_id],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        },
      );
    });
  } catch (error) {
    throw error;
  }
};

const updateSerials = (serial_number, connection) => {
  try {
    const checkQuery = `
      SELECT sn.ID, sn.GRN_idGRN, g.Status AS grn_status, g.Bill_no AS grn_bill_no
      FROM item_has_serial_no sn
      LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
      WHERE sn.Serial_No = ? AND sn.Qty = 1
      LIMIT 1
    `;
    const updateQuery =
      "UPDATE item_has_serial_no SET Qty = 0 WHERE Serial_No = ?";
    const selectQuery = "SELECT * FROM item_has_serial_no WHERE Serial_No = ?";

    return new Promise((resolve, reject) => {
      (connection || db).query(checkQuery, [serial_number], (checkErr, checkRows) => {
        if (checkErr) {
          return reject(checkErr);
        }
        if (checkRows && checkRows.length > 0) {
          const row = checkRows[0];
          if (row.GRN_idGRN && Number(row.GRN_idGRN) > 0 && String(row.grn_status) !== "1") {
            return reject(
              new Error(
                `Serial number '${serial_number}' belongs to unprocessed GRN (${row.grn_bill_no || row.GRN_idGRN}). Please process the GRN before invoicing.`
              )
            );
          }
        }

        (connection || db).query(updateQuery, [serial_number], (err, result) => {
          if (err) {
            reject(err);
          } else {
            // After updating, select the updated row
            (connection || db).query(
              selectQuery,
              [serial_number],
              (err, updatedResult) => {
                if (err) {
                  reject(err);
                } else {
                  if (updatedResult.length > 0) {
                    resolve(updatedResult[0]); // Return the first item from the array
                  } else {
                    resolve(null); // No row found with the provided serial number
                  }
                }
              },
            );
          }
        });
      });
    });
  } catch (error) {
    throw error;
  }
};

const fetchSerials = (Item_idItem) => {
  const query = `
    SELECT sn.* 
    FROM item_has_serial_no sn
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE sn.Qty = 1 
      AND sn.Item_idItem = ?
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Item_idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoices = (Branch_idBranch, scopedUserId = null) => {
  let query = `
    SELECT 
      i.*, 
      CASE
        WHEN i.Payment_Method = 'split' THEN i.Payment_Method
        ELSE COALESCE(
          (SELECT ccl.Payment_Method
           FROM customer_credit_log ccl
           WHERE ccl.Type = 'PAYMENT'
             AND ccl.Type_Id = CAST(i.idInvoice AS CHAR)
           LIMIT 1),
          i.Payment_Method
        )
      END AS Payment_Method,
      c.Title, 
      c.displayName, 
      c.vatNo,
      c.billingCity,
      c.mobileNumber,
      c.phoneNumber,
      em.Employee_Name,
      COALESCE((
        SELECT SUM(CAST(Debit AS DECIMAL(10,2))) 
        FROM customer_credit_log 
        WHERE Type = 'PAYMENT' 
          AND Type_Id = i.idInvoice 
          AND Customer_idCustomer = i.Customer_idCustomer
      ), 0) AS Paid_Amount_credit
    FROM invoice i 
    LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer 
    LEFT JOIN employee em ON i.Employee_idEmployee = em.idEmployee
    WHERE i.Branch_idBranch = ?
      AND (i.approval_status IS NULL OR i.approval_status != 'REJECTED')
  `;
  const params = [Branch_idBranch];

  if (scopedUserId) {
    query += ` AND (
      i.idInvoice IN (
        SELECT Task_ID FROM user_log 
        WHERE Task_Type = 'Invoice' AND User_idUser = ? AND Task_Category = 'create'
      )
      OR i.Employee_idEmployee = ?
      OR i.Route_idRoute IN (
        SELECT idRoute FROM distribution_route WHERE Default_Salesperson_Id = ? OR Default_Driver_Id = ?
      )
    )`;
    params.push(scopedUserId, scopedUserId, scopedUserId, scopedUserId);
  }

  query += ` ORDER BY i.idInvoice DESC`;

  return new Promise((resolve, reject) => {
    db.query(query, params, async (err, results) => {
      if (err) {
        reject(err);
      } else {
        try {
          const invoices = JSON.parse(JSON.stringify(results));
          const invoiceIds = invoices.map((i) => i.idInvoice);

          if (invoiceIds.length === 0) {
            return resolve(invoices);
          }

          // Batch fetch all related data
          const [allItems, allServiceDates, allInstallments] =
            await Promise.all([
              fetchInvoiceItemsForInvoiceList(invoiceIds),
              fetchServiceDatesForInvoiceList(invoiceIds),
              fetchInstallmentsForInvoiceList(invoiceIds),
            ]);

          // Group items by Invoice
          const itemsMap = {};
          allItems.forEach((item) => {
            if (!itemsMap[item.Invoice_idInvoice]) {
              itemsMap[item.Invoice_idInvoice] = [];
            }
            itemsMap[item.Invoice_idInvoice].push(item);
          });

          // Group service dates by Invoice AND Item
          const serviceDatesMap = {};
          allServiceDates.forEach((sd) => {
            const key = `${sd.Invoice_idInvoice}_${sd.Item_idItem}`;
            if (!serviceDatesMap[key]) {
              serviceDatesMap[key] = [];
            }
            serviceDatesMap[key].push(sd.Date);
          });

          // Group installments by Invoice
          const installmentsMap = {};
          allInstallments.forEach((inst) => {
            if (!installmentsMap[inst.Invoice_idInvoice]) {
              installmentsMap[inst.Invoice_idInvoice] = [];
            }
            installmentsMap[inst.Invoice_idInvoice].push(inst);
          });

          // Map data back to invoices
          const invoicesWithDetails = invoices.map((invoice) => {
            let Payment_Type_Name;
            switch (invoice.Payment_Type) {
              case 1:
                Payment_Type_Name = "full";
                break;
              case 2:
                Payment_Type_Name = "installment";
                break;
              case 3:
                Payment_Type_Name = "credit";
                break;
              default:
                Payment_Type_Name = "unknown";
            }

            const invoiceItems = itemsMap[invoice.idInvoice] || [];
            const itemsWithDetails = invoiceItems.map((item) => ({
              ...item,
              serviceDates:
                serviceDatesMap[`${invoice.idInvoice}_${item.Item_idItem}`] ||
                [],
              installments:
                invoice.Payment_Type === 2
                  ? installmentsMap[invoice.idInvoice] || []
                  : [],
            }));

            return {
              ...invoice,
              Payment_Type_Name,
              items: itemsWithDetails,
              installmentDetails:
                invoice.Payment_Type === 2
                  ? installmentsMap[invoice.idInvoice] || []
                  : [],
            };
          });

          resolve(invoicesWithDetails);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

const fetchInvoiceItemsForInvoiceList = (invoiceIds) => {
  if (!invoiceIds || invoiceIds.length === 0) return Promise.resolve([]);
  const query = `
          SELECT 
            ihi.*, 
            i.Type, 
            i.Cost, 
            i.Real_Cost, 
            i.Qty as Current_Stock, 
            COALESCE(i.Description, ihi.Description) as Item_Name, 
            COALESCE(i.Long_Description, ihi.Long_Description) as Item_Long_Description,
            i.Item_Description as Item_Additional_Description,
            i.Item_Code,
            ic.Description as Item_Category_Name,
            ihi.Variation_Id,
            si.ID as Serial_No_Id, 
            si.Serial_No as Serial_Number,
            qt.Description AS Unit_Name,
            qt.Description AS Unit,
            ihimd.supplier_name AS manual_supplier_name,
            ihimd.cost AS manual_cost
          FROM invoice_has_item ihi 
          LEFT JOIN item i ON ihi.Item_idItem = i.idItem 
          LEFT JOIN item_category ic ON i.Item_Category_idItem_Category = ic.idItem_Category
          LEFT JOIN item_has_serial_no si ON ihi.Serial_No_Id = si.ID  
          LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(ihi.Qty_Type, i.Qty_Type)
          LEFT JOIN invoice_has_item_manual_details ihimd ON ihi.ID = ihimd.invoice_has_item_id AND ihi.Branch_idBranch = ihimd.Branch_idBranch
          WHERE ihi.Invoice_idInvoice IN (?)
        `;
  return new Promise((resolve, reject) => {
    db.query(query, [invoiceIds], (err, results) => {
      if (err) {
        reject(err);
      } else {
        const items = JSON.parse(JSON.stringify(results));
        const itemIds = items.map((item) => item.Item_idItem).filter(Boolean);
        if (itemIds.length === 0) return resolve(items);

        const fieldQuery = `
          SELECT 
            pfd.item_id,
            pfd.field_id,
            pfd.value,
            pf.field_name,
            pf.field_type
          FROM product_field_data pfd
          LEFT JOIN product_fields pf ON pfd.field_id = pf.id
          WHERE pfd.item_id IN (?)
        `;
        db.query(fieldQuery, [itemIds], (fieldErr, fieldResults) => {
          if (fieldErr) return reject(fieldErr);

          const customFieldsMap = {};
          for (const field of fieldResults) {
            if (!customFieldsMap[field.item_id]) {
              customFieldsMap[field.item_id] = [];
            }
            customFieldsMap[field.item_id].push({
              fieldId: field.field_id,
              fieldName: field.field_name,
              fieldType: field.field_type,
              value: field.value,
            });
          }

          const enrichedItems = items.map((item) => ({
            ...item,
            customFields: customFieldsMap[item.Item_idItem] || [],
          }));
          resolve(enrichedItems);
        });
      }
    });
  });
};

const fetchServiceDatesForInvoiceList = (invoiceIds) => {
  if (!invoiceIds || invoiceIds.length === 0) return Promise.resolve([]);
  const query = `SELECT * FROM item_has_service_dates WHERE Invoice_idInvoice IN (?)`;
  return new Promise((resolve, reject) => {
    db.query(query, [invoiceIds], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchServiceDateInvoices = (Invoice_idInvoice, Item_idItem) => {
  const query =
    "SELECT Date FROM item_has_service_dates WHERE Invoice_idInvoice = ? AND Item_idItem = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Invoice_idInvoice, Item_idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoice = (idInvoice) => {
  const query = `
    SELECT 
      i.idInvoice,
      i.Invoice_Number,
      i.Quotation_idQuotation,
      i.Date AS Invoice_Date,
      i.Customer_idCustomer,
      i.Address,
      i.Employee_idEmployee,
      i.Total,
      i.Discount_Type,
      i.Discount_Presentage,
      i.Discount_Amount,
      i.Discount2_Type,
      i.Discount2_Presentage,
      i.Discount2_Amount,
      i.Net_Amount,
      i.Item_Count,
      i.Note,
      i.Payment_Type,
      i.Interest_Amount,
      i.Interest_Presentage,
      i.Interest_Type,
      i.Paid_Amount,
      i.Balance_Amount,
      i.Credit_Balance,
      i.Total_Credit_Balance,
      i.Created_Date,
      i.created_at,
      i.Branch_idBranch,
      i.Payment_Method,
      i.Card_Type,
      i.Card_Number,
      i.Transaction_Id,
      i.Receipt,
      i.Cheque_Type,
      i.Cheque_No,
      i.Cheque_Date,
      i.Cheque_Name,
      i.Bank_Account_Id,
      ba.bank_name AS Bank_Name,
      ba.account_no AS Bank_Account_No,
      ba.account_name AS Bank_Account_Name,
      i.Vat_Amount,
      i.Vat_Type,
      i.Extra_Charge_Label,
      i.Extra_Charge,
      i.place_of_supply,
      i.custom_fields_data,
      c.Title,
      c.First_Name,
      c.displayName,
      c.companyName,
      c.phoneNumber,
      c.shippingAddress1,
      c.shippingAddress2,
      c.shippingAddress3,
      c.billingAddress1,
      c.billingAddress2,
      c.billingAddress3,
      c.mobileNumber,
      c.shippingCity,
      c.shippingProvince,
      c.shippingPostalCode,
      c.shippingCountry,
      c.vatNo,
      c.billingCity,
      c.companyEmail,
      c.officialEmail

    FROM invoice i
    LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
    LEFT JOIN company_bank_accounts ba ON i.Bank_Account_Id = ba.idbank
    WHERE i.idInvoice = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

// Reconstructs the split-payment breakdown for a "split" Payment_Method invoice
// from the customer_credit_log PAYMENT rows written per split item at invoice creation.
// Joins accounting_accounts (not company_bank_accounts - see fetchInvoice's Bank_Account_Id join,
// which points at the wrong table for this Bank_Account_Id).
const fetchSplitPayments = (idInvoice) => {
  const query = `
    SELECT
      ccl.idCustomer_Credit_Log AS id,
      ccl.Payment_Method AS method,
      ccl.Debit AS amount,
      ccl.Card_Type AS card_type,
      ccl.Card_Number AS card_number,
      ccl.Transaction_Id AS transaction_id,
      ccl.Cheque_No AS cheque_no,
      ccl.Cheque_Date AS cheque_date,
      ccl.Cheque_Name AS cheque_name,
      ccl.Cheque_Type AS cheque_type,
      ccl.Cheque_Status AS cheque_status,
      ccl.Bank_Account_Id AS bank_account_id,
      cba.Account_Name AS bank_account_name,
      ccl.Note AS note
    FROM customer_credit_log ccl
    LEFT JOIN accounting_accounts cba ON ccl.Bank_Account_Id = cba.idAccounting_Accounts
    WHERE ccl.Type = 'PAYMENT' AND ccl.Type_Id = ?
      AND ccl.Payment_Method IN ('cash','card','cheque','bank','online','koko','mintpay')
    ORDER BY ccl.idCustomer_Credit_Log ASC`;

  return new Promise((resolve, reject) => {
    db.query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoiceItems = (idInvoice, connection) => {
  const query =
    "SELECT ihi.*, ihimd.supplier_name AS manual_supplier_name, ihimd.cost AS manual_cost, i.Type, i.Cost, i.Real_Cost, i.Qty as Current_Stock, COALESCE(i.Description, ihi.Description) as Item_Name, COALESCE(i.Long_Description, ihi.Long_Description) as Item_Long_Description, i.Item_Description as Item_Additional_Description, i.Item_Code, ic.Description as Item_Category_Name, ihi.Variation_Id, si.ID as Serial_No_Id, si.Serial_No as Serial_Number, qt.Description AS Unit_Name, qt.Description AS Unit FROM invoice_has_item ihi LEFT JOIN item i ON ihi.Item_idItem = i.idItem LEFT JOIN item_category ic ON i.Item_Category_idItem_Category = ic.idItem_Category LEFT JOIN item_has_serial_no si ON ihi.Serial_No_Id = si.ID LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(ihi.Qty_Type, i.Qty_Type) LEFT JOIN invoice_has_item_manual_details ihimd ON ihi.ID = ihimd.invoice_has_item_id AND ihi.Branch_idBranch = ihimd.Branch_idBranch WHERE ihi.Invoice_idInvoice = ? ORDER BY ihi.ID ASC";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        const items = JSON.parse(JSON.stringify(results));
        const itemIds = items.map((item) => item.Item_idItem).filter(Boolean);
        if (itemIds.length === 0) return resolve(items);

        const fieldQuery = `
          SELECT 
            pfd.item_id,
            pfd.field_id,
            pfd.value,
            pf.field_name,
            pf.field_type
          FROM product_field_data pfd
          LEFT JOIN product_fields pf ON pfd.field_id = pf.id
          WHERE pfd.item_id IN (?)
        `;
        (connection || db).query(fieldQuery, [itemIds], (fieldErr, fieldResults) => {
          if (fieldErr) return reject(fieldErr);

          const customFieldsMap = {};
          for (const field of fieldResults) {
            if (!customFieldsMap[field.item_id]) {
              customFieldsMap[field.item_id] = [];
            }
            customFieldsMap[field.item_id].push({
              fieldId: field.field_id,
              fieldName: field.field_name,
              fieldType: field.field_type,
              value: field.value,
            });
          }

          const enrichedItems = items.map((item) => ({
            ...item,
            customFields: customFieldsMap[item.Item_idItem] || [],
          }));
          resolve(enrichedItems);
        });
      }
    });
  });
};

const insertSerialNumbers = (
  GRN_idGRN,
  Item_idItem,
  Qty,
  Serial_No,
  Branch_idBranch,
  connection,
  variation_id = null,
) => {
  const query =
    "INSERT INTO item_has_serial_no (GRN_idGRN, Item_idItem, Qty, Serial_No, Branch_idBranch, variation_id) VALUES (? , ? , ? , ? ,? , ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [GRN_idGRN, Item_idItem, Qty, Serial_No, Branch_idBranch, variation_id],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      },
    );
  });
};

const updateSerialQty = (ID, connection) => {
  const query = "UPDATE item_has_serial_no SET Qty = 1 WHERE ID = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [ID], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteInvoice = (idInvoice, connection) => {
  const query = "DELETE FROM invoice WHERE idInvoice = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

/**
 * Get count of invoices for a company within a date range
 * @param {number} companyId - Company ID
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<number>} Count of invoices
 */
const getInvoiceCountForMonth = (companyId, startDate, endDate) => {
  return new Promise((resolve, reject) => {
    // First, get all branch IDs for this company from db2
    const branchQuery =
      "SELECT idBranch FROM branch WHERE Company_idCompany = ?";

    db2.query(branchQuery, [companyId], (branchErr, branches) => {
      if (branchErr) return reject(branchErr);

      if (branches.length === 0) {
        return resolve(0);
      }

      const branchIds = branches.map((b) => b.idBranch);

      // Now count invoices for those branches within the date range
      const countQuery = `
        SELECT COUNT(*) as count 
        FROM invoice 
        WHERE Branch_idBranch IN (?) 
        AND Date >= ? 
        AND Date <= ?
      `;

      db.query(countQuery, [branchIds, startDate, endDate], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results[0].count || 0);
        }
      });
    });
  });
};

const fetchInvoicesPaginated = (
  Branch_idBranch,
  limit,
  offset,
  search,
  customerId,
  salesmanId,
  date,
  user,
  customFilters,
  scopedUserId = null,
) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Use strict Branch_idBranch filtering instead of sibling branch aggregation
      const branchIds = [Branch_idBranch];

      let countQuery = `
        SELECT COUNT(*) as total
        FROM invoice i
        LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
        LEFT JOIN employee em ON i.Employee_idEmployee = em.idEmployee
        WHERE i.Branch_idBranch IN (?)
          AND (i.approval_status IS NULL OR i.approval_status != 'REJECTED')
      `;

      let query = `
        SELECT 
          i.*, 
          CASE
            WHEN i.Payment_Method = 'split' THEN i.Payment_Method
            ELSE COALESCE(
              (SELECT ccl.Payment_Method
               FROM customer_credit_log ccl
               WHERE ccl.Type = 'PAYMENT'
                 AND ccl.Type_Id = CAST(i.idInvoice AS CHAR)
               LIMIT 1),
              i.Payment_Method
            )
          END AS Payment_Method,
          c.Title, 
          c.displayName, 
          c.vatNo,
          c.billingCity,
          c.mobileNumber,
          c.phoneNumber,
          em.Employee_Name,
          COALESCE((
            SELECT SUM(CAST(Debit AS DECIMAL(10,2))) 
            FROM customer_credit_log 
            WHERE Type = 'PAYMENT' 
              AND Type_Id = i.idInvoice 
              AND Customer_idCustomer = i.Customer_idCustomer
          ), 0) AS Paid_Amount_credit
        FROM invoice i 
        LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer 
        LEFT JOIN employee em ON i.Employee_idEmployee = em.idEmployee
        WHERE i.Branch_idBranch IN (?)
          AND (i.approval_status IS NULL OR i.approval_status != 'REJECTED')
      `;

      const params = [branchIds];
      const countParams = [branchIds];

      if (search) {
        const paymentMatch = search.match(/^P(\d+)$/i);
        if (paymentMatch) {
          const receiptId = paymentMatch[1];
          const searchCondition = ` AND (i.Invoice_Number LIKE ? OR c.displayName LIKE ? OR i.idInvoice IN (SELECT Type_Id FROM customer_credit_log WHERE Type = 'PAYMENT' AND (idCustomer_Credit_Log = ? OR receipt_number = ? OR receipt_number LIKE ?)))`;
          countQuery += searchCondition;
          query += searchCondition;
          const searchParam = `%${search}%`;
          params.push(searchParam, searchParam, receiptId, search, searchParam);
          countParams.push(searchParam, searchParam, receiptId, search, searchParam);
        } else {
          const searchCondition = ` AND (i.Invoice_Number LIKE ? OR c.displayName LIKE ? OR i.idInvoice IN (SELECT Type_Id FROM customer_credit_log WHERE Type = 'PAYMENT' AND (receipt_number = ? OR receipt_number LIKE ?)))`;
          countQuery += searchCondition;
          query += searchCondition;
          const searchParam = `%${search}%`;
          params.push(searchParam, searchParam, search, searchParam);
          countParams.push(searchParam, searchParam, search, searchParam);
        }
      }

      if (customerId) {
        const customerCondition = ` AND i.Customer_idCustomer = ?`;
        countQuery += customerCondition;
        query += customerCondition;
        params.push(customerId);
        countParams.push(customerId);
      }

      if (salesmanId) {
        const salesmanCondition = ` AND i.Employee_idEmployee = ?`;
        countQuery += salesmanCondition;
        query += salesmanCondition;
        params.push(salesmanId);
        countParams.push(salesmanId);
      }

      if (date) {
        const dateCondition = ` AND i.Date = ?`;
        countQuery += dateCondition;
        query += dateCondition;
        params.push(date);
        countParams.push(date);
      }

      if (user) {
        const userCondition = ` AND i.user LIKE ?`;
        countQuery += userCondition;
        query += userCondition;
        const userParam = `%${user}%`;
        params.push(userParam);
        countParams.push(userParam);
      }

      if (customFilters) {
        try {
          const filters = typeof customFilters === 'string' ? JSON.parse(customFilters) : customFilters;
          Object.keys(filters).forEach(key => {
            const val = filters[key];
            if (val !== undefined && val !== null && val !== '') {
              const condition = ` AND JSON_UNQUOTE(JSON_EXTRACT(i.custom_fields_data, '$.${key}')) LIKE ?`;
              countQuery += condition;
              query += condition;
              const filterParam = `%${val}%`;
              params.push(filterParam);
              countParams.push(filterParam);
            }
          });
        } catch (e) {
          console.error("Error parsing customFilters:", e);
        }
      }

      if (scopedUserId) {
        const userScopeCondition = ` AND (
          i.idInvoice IN (
            SELECT Task_ID FROM user_log 
            WHERE Task_Type = 'Invoice' AND User_idUser = ? AND Task_Category = 'create'
          )
          OR i.Employee_idEmployee = ?
          OR i.Route_idRoute IN (
            SELECT idRoute FROM distribution_route WHERE Default_Salesperson_Id = ? OR Default_Driver_Id = ?
          )
        )`;
        countQuery += userScopeCondition;
        query += userScopeCondition;
        params.push(scopedUserId, scopedUserId, scopedUserId, scopedUserId);
        countParams.push(scopedUserId, scopedUserId, scopedUserId, scopedUserId);
      }

      query += ` ORDER BY i.idInvoice DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      // 1. Get total count
      db.query(countQuery, countParams, (err, countResult) => {
        if (err) return reject(err);
        const total = countResult[0].total;

        // 2. Get paginated invoices
        db.query(query, params, async (err, results) => {
          if (err) return reject(err);

          if (results.length === 0) return resolve({ invoices: [], total });

          try {
            const invoices = JSON.parse(JSON.stringify(results));

            const invoicesWithDetails = await Promise.all(
              invoices.map(async (invoice) => {
                let Payment_Type_Name;
                switch (invoice.Payment_Type) {
                  case 1:
                    Payment_Type_Name = "full";
                    break;
                  case 2:
                    Payment_Type_Name = "installment";
                    break;
                  case 3:
                    Payment_Type_Name = "credit";
                    break;
                  default:
                    Payment_Type_Name = "unknown";
                }

                return {
                  ...invoice,
                  Payment_Type_Name,
                };
              }),
            );

            resolve({ invoices: invoicesWithDetails, total });
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      reject(error);
    }
  });
};

const fetchInstallmentInvoicesByCustomer = (CustomerId, Branch_idBranch) => {
  const query = `
    SELECT 
      i.*, 
      c.Title, 
      c.displayName, 
      em.Employee_Name,
      COALESCE((
        SELECT SUM(CAST(Debit AS DECIMAL(10,2))) 
        FROM customer_credit_log 
        WHERE Type = 'PAYMENT' 
          AND Type_Id = i.idInvoice 
          AND Customer_idCustomer = i.Customer_idCustomer
      ), 0) AS Paid_Amount_credit
    FROM invoice i 
    INNER JOIN customer c ON i.Customer_idCustomer = c.idCustomer 
    LEFT JOIN employee em ON i.Employee_idEmployee = em.idEmployee
    WHERE i.Branch_idBranch = ? 
    AND i.Customer_idCustomer = ?
    AND i.Payment_Type = 2
    ORDER BY i.idInvoice DESC
  `;

  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, CustomerId], async (err, results) => {
      if (err) {
        reject(err);
      } else {
        try {
          const invoices = JSON.parse(JSON.stringify(results));
          resolve(invoices);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

const fetchUnpaidInvoicesForApp = (Branch_idBranch) => {
  const query = `
    SELECT 
      i.*, 
      c.displayName AS customerName,
      COALESCE((
        SELECT SUM(CAST(Debit AS DECIMAL(10,2))) 
        FROM customer_credit_log 
        WHERE Type = 'PAYMENT' 
          AND Type_Id = i.idInvoice 
          AND Customer_idCustomer = i.Customer_idCustomer
      ), 0) AS Paid_Amount_credit
    FROM invoice i 
    LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer 
    WHERE i.Branch_idBranch = ? 
    AND (i.Payment_Type = 2 OR i.Payment_Type = 3)
    AND (CAST(i.Net_Amount AS DECIMAL(10,2)) - CAST(i.Paid_Amount AS DECIMAL(10,2)) - (
        SELECT COALESCE(SUM(CAST(Debit AS DECIMAL(10,2))), 0) 
        FROM customer_credit_log 
        WHERE Type = 'PAYMENT' 
          AND Type_Id = i.idInvoice 
          AND Customer_idCustomer = i.Customer_idCustomer
    )) > 0
    ORDER BY i.idInvoice DESC
  `;

  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], async (err, results) => {
      if (err) {
        reject(err);
      } else {
        try {
          const invoices = JSON.parse(JSON.stringify(results));
          const invoiceIds = invoices.map((i) => i.idInvoice);

          if (invoiceIds.length === 0) {
            return resolve(invoices);
          }

          const allInstallments =
            await fetchInstallmentsForInvoiceList(invoiceIds);

          // Group installments by Invoice
          const installmentsMap = {};
          allInstallments.forEach((inst) => {
            if (!installmentsMap[inst.Invoice_idInvoice]) {
              installmentsMap[inst.Invoice_idInvoice] = [];
            }
            installmentsMap[inst.Invoice_idInvoice].push(inst);
          });

          // Map data back to invoices
          const invoicesWithDetails = invoices.map((invoice) => {
            return {
              ...invoice,
              installments: installmentsMap[invoice.idInvoice] || [],
            };
          });

          resolve(invoicesWithDetails);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

module.exports = {
  insertInvoice,
  getLastInvoice,
  getLastInvoiceBySalesmanPrefix,
  getLastInvoiceBySalesman,
  insertInvoiceItem,
  fetchInvoices,
  fetchInvoice,
  fetchSplitPayments,
  fetchInvoiceItems,
  fetchSerials,
  updateSerials,
  insertInvoiceSerials,
  insertSerialNumbers,
  fetchServiceDateInvoices,
  checkInvoice,
  deleteInvoiceItem,
  updateInvoice,
  updateInvoiceBalance,
  updateSerialQty,
  deleteInvoice,
  getInvoiceCountForMonth,
  fetchInvoicesPaginated,
  fetchInstallmentInvoicesByCustomer,
  fetchUnpaidInvoicesForApp,
};
