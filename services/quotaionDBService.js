const db = require("../db/db");
const db2 = require("../db/db2");

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

const getLastQuotation = async (Branch_idBranch) => {
  try {
    // Use strict Branch_idBranch filtering
    const branchIds = [Branch_idBranch];
    const query =
      "SELECT * FROM quotation WHERE Branch_idBranch IN (?) ORDER BY idQuotation DESC LIMIT 1";
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

const insertQuotation = (
  Quotation_Number,
  Customer_idCustomer,
  Date,
  Expire_Date,
  SubTotal,
  Discount_Type,
  Discount,
  Total,
  Note,
  Address,
  Branch_idBranch,
  Extra_Charge_Label,
  Extra_Charge,
  items, // unused here but kept for signature consistency if needed
  connection, // 🆕
  custom_fields_data,
  Is_Multi_Option,
  Options_Data,
) => {
  console.log(Address);
  console.log(Branch_idBranch);
  const query =
    "INSERT INTO quotation (Quotation_Number, Customer_idCustomer, Date, Expire_Date, SubTotal, Discount_Type,Discount, Total, Note, Status, Address, Branch_idBranch, Extra_Charge_Label, Extra_Charge, custom_fields_data, Is_Multi_Option, Options_Data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Quotation_Number,
        Customer_idCustomer,
        Date,
        Expire_Date,
        SubTotal,
        Discount_Type,
        Discount,
        Total,
        Note,
        0,
        Address,
        Branch_idBranch,
        Extra_Charge_Label,
        Extra_Charge,
        custom_fields_data,
        Is_Multi_Option || 0,
        Options_Data || null,
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

const updateQuotation = (
  Customer_idCustomer,
  Date,
  Expire_Date,
  SubTotal,
  Discount_Type,
  Discount,
  Total,
  Note,
  Extra_Charge_Label,
  Extra_Charge,
  Address,
  idQuotation,
  connection, // 🆕
  custom_fields_data,
  Is_Multi_Option,
  Options_Data,
) => {
  const query = `UPDATE quotation 
  SET 
  Customer_idCustomer=?,
  Date=?,
  Expire_Date=?, 
  SubTotal=?, 
  Discount_Type=?,
  Discount=?,
  Total=?,
  Note=?,
  Extra_Charge_Label=?,
  Extra_Charge=?,
  Address=?,
  custom_fields_data=?,
  Is_Multi_Option=?,
  Options_Data=?
  WHERE 
  idQuotation=?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Customer_idCustomer,
        Date,
        Expire_Date,
        SubTotal,
        Discount_Type,
        Discount,
        Total,
        Note,
        Extra_Charge_Label,
        Extra_Charge,
        Address,
        custom_fields_data,
        Is_Multi_Option || 0,
        Options_Data || null,
        idQuotation,
      ],
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

const insertQuotationItem = (
  Quotation_idQuotation,
  Item_idItem,
  Rate,
  Qty_Type,
  Qty,
  Amount,
  Discount_Type,
  Discount,
  Total_Amount,
  Long_Description,
  Branch_idBranch,
  Variation_Id, // ✅ Added Variation_Id parameter
  connection, // 🆕
  is_material_issue = 0,
  issue_item_id = null,
  issue_note_id = null,
) => {
  const query =
    "INSERT INTO quotation_has_item (Quotation_idQuotation, Item_idItem, Rate, Qty_Type, Qty, Amount, Discount_Type, Discount, Total_Amount, Long_Description, Branch_idBranch, Variation_Id, is_material_issue, issue_item_id, issue_note_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Quotation_idQuotation,
        Item_idItem,
        Rate,
        Qty_Type || "",
        Qty,
        Amount,
        Discount_Type || "",
        Discount || 0,
        Total_Amount,
        Long_Description,
        Branch_idBranch,
        Variation_Id || null, // ✅ Handle null/undefined variation IDs
        is_material_issue || 0,
        issue_item_id || null,
        issue_note_id || null,
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

const fetchQuotations = (
  Branch_idBranch,
  page,
  pageSize,
  searchQuery,
  dateFrom,
  dateTo,
  status,
  customerId,
  scopedUserId = null,
) => {
  return new Promise((resolve, reject) => {
    let baseQuery = `
      FROM quotation q 
      INNER JOIN customer c ON q.Customer_idCustomer = c.idCustomer 
      WHERE q.Branch_idBranch = ?
    `;
    let queryParams = [Branch_idBranch];

    if (scopedUserId) {
      baseQuery += ` AND (
        q.idQuotation IN (
          SELECT Task_ID FROM user_log 
          WHERE Task_Type = 'Quotation' AND User_idUser = ? AND Task_Category = 'create'
        )
      )`;
      queryParams.push(scopedUserId);
    }

    // Add filters
    if (searchQuery) {
      baseQuery += ` AND (q.Quotation_Number LIKE ? OR c.displayName LIKE ?)`;
      queryParams.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    if (dateFrom) {
      baseQuery += ` AND q.Date >= ?`;
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      baseQuery += ` AND q.Date <= ?`;
      queryParams.push(dateTo);
    }

    if (status !== null && status !== undefined && status !== "all") {
      baseQuery += ` AND q.Status = ?`;
      queryParams.push(status);
    }

    if (customerId) {
      baseQuery += ` AND q.Customer_idCustomer = ?`;
      queryParams.push(customerId);
    }

    // First fetch total count
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;

    db.query(countQuery, queryParams, (err, countResult) => {
      if (err) return reject(err);

      const total = countResult[0].total;

      // Then fetch data with pagination
      const dataQuery = `
        SELECT q.*, c.Title, c.displayName, c.mobileNumber, c.phoneNumber 
        ${baseQuery} 
        ORDER BY q.idQuotation DESC 
        LIMIT ? OFFSET ?
      `;

      // Calculate offset
      const offset = (page - 1) * pageSize;
      queryParams.push(parseInt(pageSize), parseInt(offset));

      db.query(dataQuery, queryParams, (err, results) => {
        if (err) return reject(err);

        resolve({
          data: JSON.parse(JSON.stringify(results)),
          total: total,
        });
      });
    });
  });
};

const fetchQuotation = (idQuotation) => {
  const query =
    "SELECT q.*, c.Title, c.displayName, c.companyEmail, c.phoneNumber , c.shippingAddress1, c.shippingAddress2, c.shippingAddress3, c.mobileNumber, c.shippingCity , c.shippingProvince , c.shippingPostalCode	 , c.shippingCountry FROM quotation q INNER JOIN customer c ON q.Customer_idCustomer = c.idCustomer WHERE q.idQuotation = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idQuotation], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchQuotationItems = (idQuotation) => {
  // LEFT JOIN so manual items (Item_idItem = -1 or NULL) are not silently dropped.
  // COALESCE falls back to the stored Long_Description when the item table has no match.
  // LEFT JOIN quantity_type to resolve the correct unit name / qty type.
  const query =
    "SELECT qi.*, COALESCE(i.Description, qi.Long_Description) as Item_Name, i.Long_Description as Item_Long_Name, i.image, COALESCE(i.Item_Has_Serial, 0) AS Item_Has_Serial, COALESCE(i.Item_Has_Serial, 0) AS Serial_No, i.Type, i.Cost, i.Real_Cost, qhimd.supplier_name AS manual_supplier_name, qhimd.cost AS manual_cost, qt.Description AS Unit_Name, qt.Description AS Unit FROM quotation_has_item qi LEFT JOIN item i ON qi.Item_idItem = i.idItem AND qi.Item_idItem > 0 LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(qi.Qty_Type, i.Qty_Type) LEFT JOIN quotation_has_item_manual_details qhimd ON qi.Id = qhimd.quotation_has_item_id AND qi.Branch_idBranch = qhimd.Branch_idBranch WHERE qi.Quotation_idQuotation = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idQuotation], (err, results) => {
      if (err) {
        reject(err);
      } else {
        // ✅ Variation_Id and manual items (no catalogue product) are now included
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteQuotation = (idQuotation, connection) => {
  const query = "DELETE FROM quotation WHERE idQuotation = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idQuotation], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchQuotationByCustomerId = (Customer_idCustomer) => {
  const query =
    "SELECT idQuotation, Quotation_Number, Date FROM quotation WHERE Customer_idCustomer = ? AND status = 0 ORDER BY idQuotation DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Customer_idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const statusUpdate = (idQuotation, connection) => {
  const query = "UPDATE quotation SET Status = 1 WHERE idQuotation = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idQuotation], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteQuotationItems = (idGRN, connection) => {
  const query =
    "DELETE FROM quotation_has_item WHERE Quotation_idQuotation = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idGRN], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

/**
 * Get count of quotations for a company within a date range
 * @param {number} companyId - Company ID
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Promise<number>} Count of quotations
 */
const getQuotationCountForMonth = (companyId, startDate, endDate) => {
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

      // Now count quotations for those branches within the date range
      const countQuery = `
        SELECT COUNT(*) as count 
        FROM quotation 
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

const checkQuotation = (Quotation_Number, Branch_idBranch) => {
  const query = `SELECT * FROM quotation WHERE Quotation_Number = ? AND Branch_idBranch = ?`;

  return new Promise((resolve, reject) => {
    db.query(query, [Quotation_Number, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const finalizeQuotationOption = (idQuotation, optionId, connection) => {
  return new Promise((resolve, reject) => {
    const conn = connection || db;
    // 1. Fetch quotation to get Options_Data and Branch_idBranch
    const fetchQuery = "SELECT Options_Data, Branch_idBranch FROM quotation WHERE idQuotation = ?";
    conn.query(fetchQuery, [idQuotation], async (err, rows) => {
      if (err) return reject(err);
      if (rows.length === 0) return reject(new Error("Quotation not found"));

      const quotation = rows[0];
      const branchId = quotation.Branch_idBranch;
      if (!quotation.Options_Data) {
        return reject(new Error("Quotation is not a multi-option quotation"));
      }

      let options = [];
      try {
        options = JSON.parse(quotation.Options_Data);
      } catch (e) {
        return reject(new Error("Invalid options data format"));
      }

      const selectedOption = options.find(opt => String(opt.id) === String(optionId));
      if (!selectedOption) {
        return reject(new Error("Selected option not found in quotation data"));
      }

      try {
        // 2. Delete existing quotation items
        await deleteQuotationItems(idQuotation, conn);

        // 3. Insert new quotation items from selected option
        for (const item of selectedOption.items) {
          // Skip empty or incomplete items
          if (!item.Item_idItem && !item.Item_Name && !item.product) {
            continue;
          }
          let longDesc = item.Long_Description || "";
          if (
            (item.is_manual_item || !item.Item_idItem || Number(item.Item_idItem) <= 0) &&
            (item.Item_Name || item.product)
          ) {
            if (typeof longDesc !== "string" || !longDesc.trim().startsWith("{")) {
              longDesc = JSON.stringify({
                name: item.Item_Name || item.product,
                description: item.Long_Description || "",
              });
            }
          }

          await insertQuotationItem(
            idQuotation,
            item.Item_idItem || -1,
            item.Rate || 0,
            item.Qty_Type || "",
            item.Qty || 1,
            item.Amount || item.Total_Amount || 0, // Amount
            item.Discount_Type || "",
            item.Discount || 0,
            item.Total_Amount || item.Amount || 0,
            longDesc || item.Item_Name || item.product || "",
            branchId,
            item.Variation_Id || null,
            conn
          );
        }

        // 4. Update quotation main details (totals, selected option id, keep status pending = 0)
        const updateQuery = `
          UPDATE quotation
          SET SubTotal = ?,
              Discount_Type = ?,
              Discount = ?,
              Total = ?,
              Selected_Option_Id = ?,
              Status = 0
          WHERE idQuotation = ?
        `;
        conn.query(
          updateQuery,
          [
            selectedOption.SubTotal || 0,
            selectedOption.Discount_Type || "percentage",
            selectedOption.Discount || 0,
            selectedOption.Total || 0,
            optionId,
            idQuotation
          ],
          (updateErr, updateResults) => {
            if (updateErr) return reject(updateErr);
            resolve(updateResults);
          }
        );
      } catch (execErr) {
        reject(execErr);
      }
    });
  });
};

module.exports = {
  insertQuotation,
  getLastQuotation,
  insertQuotationItem,
  fetchQuotations,
  fetchQuotation,
  fetchQuotationItems,
  deleteQuotation,
  fetchQuotationByCustomerId,
  statusUpdate,
  deleteQuotationItems,
  updateQuotation,
  getQuotationCountForMonth,
  checkQuotation,
  finalizeQuotationOption,
};

