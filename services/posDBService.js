const db = require("../db/db");
const db2 = require("../db/db2");

/**
 * Fetch active customers for a branch
 */
const fetchCustomer = (Branch_idBranch, salesmanId = null) => {
  let query = `
    SELECT 
      c.*,
      COALESCE(
        (SELECT CAST(ccl.Total_Credit_Balance AS DECIMAL(10,2)) 
         FROM customer_credit_log ccl 
         WHERE ccl.Customer_idCustomer = c.idCustomer 
         ORDER BY ccl.idCustomer_Credit_Log DESC LIMIT 1), 
        COALESCE((SELECT SUM(GREATEST(0, CAST(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2)))) 
                  FROM invoice i WHERE i.Customer_idCustomer = c.idCustomer), 0)
      ) AS Total_Credit_Balance
    FROM customer c
    WHERE c.Branch_idBranch = ? AND c.status = 1 AND (c.approval_status IS NULL OR c.approval_status NOT IN ('PENDING_APPROVAL', 'REJECTED'))
  `;
  const params = [Branch_idBranch];
  if (salesmanId && salesmanId !== "" && salesmanId !== "null" && salesmanId !== "undefined") {
    query += ` AND c.Agent_idEmployee = ?`;
    params.push(salesmanId);
  }
  query += ` ORDER BY c.First_Name ASC`;

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Fetch active items for a branch (lightweight projection for POS grid)
 */
/**
 * Fetch active items for a branch or company
 */
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

/**
 * Fetch active items for a branch or company
 */
const fetchItems = async (Branch_idBranch) => {
  try {
    // Use strict Branch_idBranch filtering so POS only displays items/stock for the currently selected branch
    const branchIds = [Branch_idBranch];
    const query = `
      SELECT image, idItem, Description, Long_Description, Item_Code, Rate, Qty, Type
      FROM item
      WHERE Branch_idBranch IN (?) AND Status = 1 AND (is_visible = 1 OR is_visible IS NULL) AND Type IN (?, '2', 'Item', 'Service') AND (approval_status IS NULL OR approval_status NOT IN ('PENDING_APPROVAL', 'REJECTED'))
    `;

    return new Promise((resolve, reject) => {
      db.query(query, [branchIds, "1"], (err, results) => {
        if (err) return reject(err);
        resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  } catch (err) {
    throw err;
  }
};

const fetchItemsPaginated = async (
  Branch_idBranch,
  limit,
  offset,
  search,
  categoryId,
) => {
  try {
    // Use strict Branch_idBranch filtering so POS only displays items/stock for the currently selected branch
    const branchIds = [Branch_idBranch];
    return new Promise((resolve, reject) => {
      let countQuery = `
        SELECT COUNT(DISTINCT i.idItem) as total 
        FROM item i 
        LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN product_barcodes pb ON pb.item_id = i.idItem
        WHERE i.Branch_idBranch IN (?) AND i.Status = 1 AND (i.is_visible = 1 OR i.is_visible IS NULL) AND i.Type IN (?, '2', 'Item', 'Service') AND (i.approval_status IS NULL OR i.approval_status NOT IN ('PENDING_APPROVAL', 'REJECTED'))
      `;

      let itemQuery = `
        SELECT DISTINCT
          i.image, i.idItem, i.Description, i.Long_Description, i.Item_Code, i.Rate, i.Qty, i.Type,
          ic.Description AS Category, 
          qt.Description AS Quantity_Type 
        FROM item i 
        LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN product_barcodes pb ON pb.item_id = i.idItem
        WHERE i.Branch_idBranch IN (?) AND i.Status = 1 AND (i.is_visible = 1 OR i.is_visible IS NULL) AND i.Type IN (?, '2', 'Item', 'Service') AND (i.approval_status IS NULL OR i.approval_status NOT IN ('PENDING_APPROVAL', 'REJECTED'))
      `;

      const params = [branchIds, "1"]; // Parameters array starts with branchIds

      if (search) {
        const searchCondition = ` AND (i.Description LIKE ? OR i.Item_Code LIKE ? OR i.product_brand LIKE ? OR i.barcode LIKE ? OR pb.barcode LIKE ?)`;
        countQuery += searchCondition;
        itemQuery += searchCondition;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (categoryId && categoryId !== "All") {
        const categoryCondition = ` AND ic.Description = ?`;
        countQuery += categoryCondition;
        itemQuery += categoryCondition;
        params.push(categoryId);
      }

      itemQuery += ` ORDER BY i.idItem DESC LIMIT ? OFFSET ?`;

      // 1. Get total count
      db.query(countQuery, params, (err, countResult) => {
        if (err) return reject(err);
        const total = countResult[0].total;

        // 2. Get paginated items
        db.query(itemQuery, [...params, limit, offset], (err, items) => {
          if (err) return reject(err);
          resolve({ items, total });
        });
      });
    });
  } catch (err) {
    throw err;
  }
};

/**
 * Find an item by barcode value within a branch (or sibling branches).
 * Searches both the legacy item.barcode column and the product_barcodes mapping table.
 * Returns the full item row if found, or null.
 */
const findItemByBarcode = async (barcode, Branch_idBranch) => {
  try {
    // Use strict Branch_idBranch filtering so POS only returns barcode items for the currently selected branch
    const branchIds = [Branch_idBranch];
    const query = `
      SELECT DISTINCT i.*
      FROM item i
      LEFT JOIN product_barcodes pb ON pb.item_id = i.idItem
      LEFT JOIN item_variations iv ON iv.item_id = i.idItem
      WHERE i.Branch_idBranch IN (?)
        AND i.Status = 1
        AND (i.is_visible = 1 OR i.is_visible IS NULL)
        AND i.Type IN (?, '2', 'Item', 'Service')
        AND (i.barcode = ? OR pb.barcode = ? OR iv.barcode = ? OR iv.product_sku = ?)
      LIMIT 1
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [branchIds, "1", barcode, barcode, barcode, barcode], (err, results) => {
        if (err) return reject(err);
        resolve(results.length > 0 ? JSON.parse(JSON.stringify(results[0])) : null);
      });
    });
  } catch (err) {
    throw err;
  }
};

/**
 * Get one item by id (full row)
 */
const getItemById = (idItem) => {
  const query = `
    SELECT *
    FROM item
    WHERE idItem = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [idItem], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Get available serial numbers for an item
 */
const getItemSerialNumbers = (Item_idItem) => {
  const query = `
    SELECT sn.*
    FROM item_has_serial_no sn
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE sn.Item_idItem = ? 
      AND sn.Qty = 1
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Item_idItem], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Insert POS header, return insertId
 */
const insertPos = (
  Customer_idCustomer,
  Date_Time,
  Employee_idEmployee,
  Total_Item_Count,
  Total,
  Discount_Type,
  Discount_Percentage,
  Discount_Amount,
  Tax,
  Tax_Amount,
  Net_Amount,
  Paid_Amount,
  Balance_Amount,
  Payment_Type,
  Cash_Payment,
  Card_Payment,
  Status,
  Branch_idBranch,
  Extra_Charge = 0,
  Extra_Charge_Label = "Extra Charge",
  connection,
) => {
  const query = `
    INSERT INTO pos (
      Customer_idCustomer,
      Date_Time,
      Employee_idEmployee,
      Total_Item_Count,
      Total,
      Discount_Type,
      Discount_Percentage,
      Discount_Amount,
      Tax,
      Tax_Amount,
      Net_Amount,
      Paid_Amount,
      Balance_Amount,
      Payment_Type,
      Cash_Payment,
      Card_Payment,
      Status,
      Branch_idBranch,
      Extra_Charge,
      Extra_Charge_Label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    Customer_idCustomer,
    Date_Time,
    Employee_idEmployee,
    Total_Item_Count,
    Total,
    Discount_Type,
    Discount_Percentage,
    Discount_Amount,
    Tax,
    Tax_Amount,
    Net_Amount,
    Paid_Amount,
    Balance_Amount,
    Payment_Type,
    Cash_Payment,
    Card_Payment,
    Status,
    Branch_idBranch,
    Extra_Charge,
    Extra_Charge_Label,
  ];
  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) return reject(err);
      resolve(results.insertId);
    });
  });
};

/**
 * Update POS header
 */
const updatePos = (
  idPos,
  Customer_idCustomer,
  Date_Time,
  Employee_idEmployee,
  Total_Item_Count,
  Total,
  Discount_Type,
  Discount_Percentage,
  Discount_Amount,
  Tax,
  Tax_Amount,
  Net_Amount,
  Paid_Amount,
  Balance_Amount,
  Payment_Type,
  Cash_Payment,
  Card_Payment,
  Status,
  Branch_idBranch,
  Extra_Charge = 0,
  Extra_Charge_Label = "Extra Charge",
  connection,
) => {
  const query = `
    UPDATE pos
    SET
      Customer_idCustomer = ?,
      Date_Time = ?,
      Employee_idEmployee = ?,
      Total_Item_Count = ?,
      Total = ?,
      Discount_Type = ?,
      Discount_Percentage = ?,
      Discount_Amount = ?,
      Tax = ?,
      Tax_Amount = ?,
      Net_Amount = ?,
      Paid_Amount = ?,
      Balance_Amount = ?,
      Payment_Type = ?,
      Cash_Payment = ?,
      Card_Payment = ?,
      Status = ?,
      Branch_idBranch = ?,
      Extra_Charge = ?,
      Extra_Charge_Label = ?
    WHERE idPos = ?
  `;
  const values = [
    Customer_idCustomer,
    Date_Time,
    Employee_idEmployee,
    Total_Item_Count,
    Total,
    Discount_Type,
    Discount_Percentage,
    Discount_Amount,
    Tax,
    Tax_Amount,
    Net_Amount,
    Paid_Amount,
    Balance_Amount,
    Payment_Type,
    Cash_Payment,
    Card_Payment,
    Status,
    Branch_idBranch,
    Extra_Charge,
    Extra_Charge_Label,
    idPos,
  ];
  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

/**
 * Insert POS item line
 * NOTE: Columns order must match table:
 * Discount_Percentage comes BEFORE Discount_Amount
 * Serial column is `Serial_No` (capital I)
 */
const insertPosItem = (
  Pos_idPos,
  Item_idItem,
  Item_Has_Serial,
  Serial_No_id,
  Serial_Number,
  Qty,
  Rate,
  Amount,
  Discount_Type,
  Discount_Percentage,
  Discount_Amount,
  Net_Amount,
  Branch_idBranch,
  Variation_Id = null, // Added Variation_Id parameter with default null
  connection,
) => {
  const query = `
    INSERT INTO pos_items (
      Pos_idPos,
      Item_idItem,
      Item_Has_Serial,
      Serial_No_Id,
      Serial_Number,
      Qty,
      Rate,
      Amount,
      Discount_Type,
      Discount_Percentage,
      Discount_Amount,
      Net_Amount,
      Branch_idBranch,
      Variation_Id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    Pos_idPos,
    Item_idItem,
    Item_Has_Serial,
    Serial_No_id,
    Serial_Number,
    Qty,
    Rate,
    Amount,
    Discount_Type,
    Discount_Percentage,
    Discount_Amount,
    Net_Amount,
    Branch_idBranch,
    Variation_Id, // Added Variation_Id to values array
  ];

  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) {
        console.error("❌ insertPosItem error:", err.sqlMessage, values);
        return reject(err);
      }
      resolve(results.insertId);
    });
  });
};

/**
 * Fetch suspended POS headers for a branch
 */
const fetchSuspendedPos = (Branch_idBranch) => {
  const query = `
    SELECT p.*,
           COALESCE(c.displayName, 'Walk-in Customer') AS Customer
    FROM pos p
    LEFT JOIN customer c ON p.Customer_idCustomer = c.idCustomer
    WHERE p.Branch_idBranch = ? AND p.Status = 2
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Fetch a single POS header by id
 */
const getPosById = (idPos) => {
  const query = `
    SELECT p.*,
           DATE_FORMAT(p.Date_Time, '%Y-%m-%d %H:%i:%s') AS Date_Time,
           COALESCE(c.displayName, 'Walk-in Customer') AS Customer
    FROM pos p
    LEFT JOIN customer c ON p.Customer_idCustomer = c.idCustomer
    WHERE p.idPos = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [idPos], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Fetch POS items for a given POS id
 * Joins item to provide descriptive fields to the UI
 * Also joins item_variations to include variation names in Item_Name
 */
const fetchPosItems = (Pos_idPos) => {
  const query = `
    SELECT
      i.*,
      pi.*,
      iv.description as variation_description,
      iv.item_code as variation_item_code,
      CASE 
        WHEN pi.Variation_Id IS NOT NULL AND iv.description IS NOT NULL
        THEN CONCAT(COALESCE(i.Description, ''), ' - ', COALESCE(iv.description, ''))
        ELSE COALESCE(i.Description, '')
      END as Item_Name
    FROM pos_items pi
    LEFT JOIN item i ON pi.Item_idItem = i.idItem
    LEFT JOIN item_variations iv ON pi.Variation_Id = iv.id
    WHERE pi.Pos_idPos = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Pos_idPos], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Return a serial row by serial number
 * (Used to either lock/validate serials for suspended, or consume on complete)
 */
const selectSerials = (serial_number) => {
  const selectQuery = `
    SELECT *
    FROM item_has_serial_no
    WHERE Serial_No = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(selectQuery, [serial_number], (err, rows) => {
      if (err) return reject(err);
      if (rows && rows.length > 0) {
        resolve(rows[0]);
      } else {
        resolve(null);
      }
    });
  });
};

/**
 * Delete all items for a POS (used before re-inserting on update)
 */
const deletePosItemsByPosId = (Pos_idPos, connection) => {
  const query = `
    DELETE FROM pos_items
    WHERE Pos_idPos = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Pos_idPos], (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

/**
 * Check if a plot exists for a branch at a given Date_Time
 */

const checkPlotExist = (Date_Time, Branch_idBranch) => {
  const query = `
    SELECT *
    FROM plot
    WHERE DATE(Date_Time) = ? AND Branch_idBranch = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Date_Time, Branch_idBranch], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Insert plot header, return insertId
 */
const insertPlot = (Date_Time, Amount, Branch_idBranch, connection) => {
  const query = `
    INSERT INTO plot (Date_Time, Amount, Branch_idBranch)
    VALUES (?, ?, ?)
  `;
  const values = [Date_Time, Amount, Branch_idBranch];
  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) return reject(err);
      resolve(results.insertId);
    });
  });
};

/**
 * Insert plot denominations breakdown
 */

const createPlotAmount = (
  Plot_idPlot,
  Denomination,
  Quantity,
  Total,
  Branch_idBranch,
  connection,
) => {
  const query = `
    INSERT INTO plot_amount (
      Plot_idPlot,
      Denomination,
      Quantity,
      Total,
      Branch_idBranch
    ) VALUES (?, ?, ?, ?, ?)
  `;
  const values = [Plot_idPlot, Denomination, Quantity, Total, Branch_idBranch];
  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.insertId);
      }
    });
  });
};

/**
 * Fetch plot creation logs for a branch
 */

const fetchPlotLogs = (Branch_idBranch) => {
  const query = `
    SELECT
      l.Date_Time,
      CONCAT(u.First_Name, ' ', u.Last_Name) AS User
    FROM user_log l
    LEFT JOIN user u ON l.User_idUser = u.idUser
    WHERE l.Branch_idBranch = ? AND l.Task_Category = 'plot-create'
    ORDER BY l.Date_Time DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

/**
 * Close a plot by setting Status = 1
 */
const closePlot = (idPlot, connection) => {
  const query = `
    UPDATE plot
    SET Status = 1
    WHERE idPlot = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idPlot], (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

/**
 * Update plot header
 */
const updatePlot = (idPlot, Date_Time, Amount, Branch_idBranch, connection) => {
  const query = `
    UPDATE plot
    SET Date_Time = ?, Amount = ?, Branch_idBranch = ?
    WHERE idPlot = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Date_Time, Amount, Branch_idBranch, idPlot],
      (err, results) => {
        if (err) return reject(err);
        resolve(results.affectedRows);
      },
    );
  });
};

/**
 * Update plot_amount row
 */
const updatePlotAmount = (
  idPlotAmount,
  Denomination,
  Quantity,
  Total,
  connection,
) => {
  const query = `
    UPDATE plot_amount
    SET Denomination = ?, Quantity = ?, Total = ?
    WHERE idPlotAmount = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Denomination, Quantity, Total, idPlotAmount],
      (err, results) => {
        if (err) return reject(err);
        resolve(results.affectedRows);
      },
    );
  });
};

/**
 * Fetch plot_amount rows for a given plot id
 */
const fetchPlotAmountRows = (idPlot) => {
  const query = `
    SELECT idPlotAmount, Denomination, Quantity, Total
    FROM plot_amount
    WHERE Plot_idPlot = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [idPlot], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getPlotById = (idPlot) => {
  const query = `SELECT * FROM plot WHERE idPlot = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [idPlot], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getResults = (query, params) => {
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getCashierStatus = (userId, branchId) => {
  const query = `
    SELECT * FROM cashier_start 
    WHERE user_id = ? AND branch_id = ? AND status = 'open' 
    LIMIT 1
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [userId, branchId], (err, results) => {
      if (err) return reject(err);
      resolve(results[0] ? JSON.parse(JSON.stringify(results[0])) : null);
    });
  });
};

const closePlotWithCarry = (idPlot, carryForward, connection) => {
  const query = `
    UPDATE plot
    SET Status = 1, Carry_Forward = ?
    WHERE idPlot = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [carryForward, idPlot], (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

const getLastClosedPlot = (Branch_idBranch) => {
  const query = `
    SELECT * FROM plot
    WHERE Branch_idBranch = ? AND Status = 1
    ORDER BY idPlot DESC
    LIMIT 1
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) return reject(err);
      resolve(results[0]);
    });
  });
};

const fetchPosItemsForPosList = (posIds) => {
  if (!posIds || posIds.length === 0) return Promise.resolve([]);
  const query = `
    SELECT
      i.*,
      pi.*,
      iv.description as variation_description,
      iv.item_code as variation_item_code,
      CASE 
        WHEN pi.Variation_Id IS NOT NULL AND iv.description IS NOT NULL
        THEN CONCAT(COALESCE(i.Description, ''), ' - ', COALESCE(iv.description, ''))
        ELSE COALESCE(i.Description, '')
      END as Item_Name
    FROM pos_items pi
    LEFT JOIN item i ON pi.Item_idItem = i.idItem
    LEFT JOIN item_variations iv ON pi.Variation_Id = iv.id
    WHERE pi.Pos_idPos IN (?)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [posIds], (err, results) => {
      if (err) return reject(err);
      resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const formatDbDateTime = (dateVal) => {
  if (!dateVal) return null;
  if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateVal)) {
    return dateVal;
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const options = {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  const formatter = new Intl.DateTimeFormat("en-GB", options);
  const parts = formatter.formatToParts(d);
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  const hour = parts.find((p) => p.type === "hour").value;
  const minute = parts.find((p) => p.type === "minute").value;
  const second = parts.find((p) => p.type === "second").value;
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const getTodaySales = async (userId, branchId, knownRegistryId = null) => {
  try {
    // 1. Get Active Registry Session
    // Priority: use knownRegistryId passed from frontend (most accurate)
    // Fallback: look up open registry by userId + branchId
    let registry = null;
    if (knownRegistryId) {
      const registryRows = await getResults(
        "SELECT * FROM cashier_start WHERE id = ? AND status = 'open' LIMIT 1",
        [knownRegistryId]
      );
      registry = registryRows[0] ? JSON.parse(JSON.stringify(registryRows[0])) : null;
    }
    if (!registry) {
      registry = await getCashierStatus(userId, branchId);
    }

    if (!registry) {
      return {
        totalSales: 0, cashSales: 0, cardSales: 0, creditSales: 0,
        splitSales: 0, kokoSales: 0, mintpaySales: 0,
        totalCashIn: 0, totalCashOut: 0, initialCash: 0, cashInHand: 0,
        totalProfit: "0.00",
      };
    }

    const registryId = registry.id;
    const initialCash = parseFloat(registry.opening_balance || 0);
    const openingTimeFormatted = formatDbDateTime(registry.opening_time);

    console.log(`[getTodaySales] registryId=${registryId}, opening=${openingTimeFormatted}`);

    // 2. Fetch POS sales for this session.
    //
    // We scope sales EXCLUSIVELY via pos_transactions.registry_id.
    // Both cash AND card payments are now logged in pos_transactions (see createPos fix).
    // DO NOT filter by Branch_idBranch — pos branch (e.g. 548) differs from
    // cashier_start branch (e.g. 434 from account center).
    const sessionSalesQuery = `
      SELECT
        idPos,
        Net_Amount,
        Paid_Amount,
        Balance_Amount,
        Cash_Payment,
        Card_Payment,
        Payment_Type
      FROM pos
      WHERE Status = 1
        AND idPos IN (SELECT DISTINCT pos_id FROM pos_transactions WHERE registry_id = ? AND pos_id > 0)
    `;
    const params = [registryId];

    const salesRows = await getResults(sessionSalesQuery, params);
    console.log(`[getTodaySales] Found ${salesRows.length} sales rows for registry ${registryId}`);

    let totalSales = 0, cashSales = 0, cardSales = 0;
    let creditSales = 0, splitSales = 0, kokoSales = 0, mintpaySales = 0;

    salesRows.forEach((sale) => {
      const net  = parseFloat(sale.Net_Amount  || 0);
      const paid = parseFloat(sale.Paid_Amount || 0);
      const cashPay = parseFloat(sale.Cash_Payment || 0);
      const cardPay = parseFloat(sale.Card_Payment || 0);
      const bal  = parseFloat(sale.Balance_Amount || 0);
      const pType = sale.Payment_Type;

      totalSales += net;

      if (pType === 3 || (cashPay > 0 && cardPay > 0)) {
        splitSales += net;
        cashSales  += (cashPay - Math.max(bal, 0));
        cardSales  += cardPay;
      } else if (pType === 2 || cardPay > 0) {
        cardSales += cardPay;
      } else {
        cashSales += (cashPay - Math.max(bal, 0));
      }

      if (net > paid) creditSales += (net - paid);
    });

    // Koko / Mintpay detection via invoice notes (soft – errors are non-fatal)
    try {
      // Scope Koko/Mintpay detection to the same session via pos table joined to pos_transactions
      const invoiceQuery = `
        SELECT i.Note, i.Net_Amount FROM invoice i
        JOIN pos p ON p.Invoice_Number = i.Invoice_Number
        WHERE i.Note IS NOT NULL AND i.Note != ''
          AND p.idPos IN (SELECT DISTINCT pos_id FROM pos_transactions WHERE registry_id = ? AND pos_id > 0)
      `;
      const invParams = [registryId];
      const invoiceRows = await getResults(invoiceQuery, invParams);
      invoiceRows.forEach((inv) => {
        const note = inv.Note || "";
        const net  = parseFloat(inv.Net_Amount || 0);
        if (note.includes("POS Transaction KOKO ID:")) {
          kokoSales += net;
          cardSales  = Math.max(0, cardSales - net);
        } else if (note.includes("POS Transaction MINTPAY ID:")) {
          mintpaySales += net;
          cardSales    = Math.max(0, cardSales - net);
        }
      });
    } catch (invErr) {
      console.error("[getTodaySales] Koko/Mintpay note lookup failed (non-fatal):", invErr.message);
    }

    // 3. Profit for this session (registry_id scope, same as sales)
    const profitQuery = `
      SELECT COALESCE(SUM(pi.Net_Amount - (COALESCE(it.Cost, 0) * pi.Qty)), 0) AS totalProfit
      FROM pos_items pi
      JOIN pos p  ON pi.Pos_idPos  = p.idPos
      JOIN item it ON pi.Item_idItem = it.idItem
      WHERE p.Status = 1
        AND p.idPos IN (SELECT DISTINCT pos_id FROM pos_transactions WHERE registry_id = ? AND pos_id > 0)
    `;
    const profitParams = [registryId];

    const profitResult = await getResults(profitQuery, profitParams);
    const totalProfit  = profitResult[0] ? profitResult[0].totalProfit : 0;

    // 4. Cash In / Out from pos_transactions for this registry
    // cashIn = only Cash payment_method (not card) — tracks physical cash in drawer
    // totalCashIn displayed on the UI = Cash only (not card)
    const transResult = await getResults(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'In' AND (payment_method = 'Cash' OR payment_method IS NULL) THEN amount ELSE 0 END), 0) AS cashIn,
         COALESCE(SUM(CASE WHEN type = 'Out' THEN amount ELSE 0 END), 0) AS cashOut
       FROM pos_transactions WHERE registry_id = ?`,
      [registryId]
    );
    const { cashIn, cashOut } = transResult[0] || { cashIn: 0, cashOut: 0 };

    const cashInHand = initialCash + (parseFloat(cashIn) - parseFloat(cashOut));

    return {
      totalSales:   parseFloat(totalSales),
      cashSales:    parseFloat(cashSales),
      cardSales:    parseFloat(cardSales),
      creditSales:  parseFloat(creditSales),
      splitSales:   parseFloat(splitSales),
      kokoSales:    parseFloat(kokoSales),
      mintpaySales: parseFloat(mintpaySales),
      totalCashIn:  parseFloat(cashIn),
      totalCashOut: parseFloat(cashOut),
      initialCash:  parseFloat(initialCash),
      cashInHand:   parseFloat(cashInHand),
      totalProfit:  parseFloat(totalProfit).toFixed(2),
    };
  } catch (error) {
    throw error;
  }
};


module.exports = {
  fetchCustomer,
  fetchItems,
  getItemById,
  getItemSerialNumbers,
  insertPos,
  updatePos,
  insertPosItem,
  fetchSuspendedPos,
  getPosById,
  fetchPosItems,
  selectSerials,
  deletePosItemsByPosId,
  checkPlotExist,
  insertPlot,
  createPlotAmount,
  fetchPlotLogs,
  closePlot,
  updatePlot,
  updatePlotAmount,
  fetchPlotAmountRows,
  getPlotById,
  closePlotWithCarry,
  getLastClosedPlot,
  fetchItemsPaginated,
  findItemByBarcode,
  deletePos: async (idPos) => {
    // 1. Delete items first
    const deleteItemsQuery = "DELETE FROM pos_items WHERE Pos_idPos = ?";
    await new Promise((resolve, reject) => {
      db.query(deleteItemsQuery, [idPos], (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });

    // 2. Delete header
    const deleteHeaderQuery = "DELETE FROM pos WHERE idPos = ?";
    return new Promise((resolve, reject) => {
      db.query(deleteHeaderQuery, [idPos], (err, res) => {
        if (err) reject(err);
        else resolve(res.affectedRows);
      });
    });
  },

  /**
   * Insert Cashier Start (Open Registry)
   */
  /**
   * Insert Cashier Start (Open Registry)
   */
  insertCashierStart: (
    user_id,
    branch_id,
    company_id,
    opening_balance,
    denominations,
    notes,
    connection,
  ) => {
    const query = `
      INSERT INTO cashier_start (
        user_id,
        branch_id,
        company_id,
        opening_balance,
        denominations,
        notes,
        status,
        opening_time
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', NOW())
    `;
    const values = [
      user_id,
      branch_id,
      company_id,
      opening_balance,
      denominations,
      notes,
    ];
    return new Promise((resolve, reject) => {
      (connection || db).query(query, values, (err, results) => {
        if (err) return reject(err);
        resolve(results.insertId);
      });
    });
  },

  /**
   * Update Cashier Start (Close Registry)
   */
  updateCashierStart: (
    id,
    closing_balance,
    closing_denominations,
    notes,
    connection,
  ) => {
    // We update denominations to include closing breakdown if needed, or just append notes?
    // Usually closing has its own denominations count.
    // The table has `denominations` column which stores opening denominations.
    // If we want to store closing denominations, we might need another column or update the JSON.
    // For now, I'll store closing notes and balance, and update status.
    // Ideally closing status should record separate denominations.
    // But per schema I created: `denominations` LONGTEXT.
    // I'll append closing denominations to `denominations` or the user provided schema had it?
    // My schema: `denominations` LONGTEXT NULL.
    // I will assume `denominations` stores opening, and if I need closing I should have added it.
    // For now, assume closing note is enough or we rely on the `cashier_start` table structure.

    const query = `
      UPDATE cashier_start
      SET 
        closing_balance = ?,
        closing_time = NOW(),
        status = 'closed',
        notes = CONCAT(COALESCE(notes, ''), ' | Closing Note: ', ?)
      WHERE id = ?
    `;
    return new Promise((resolve, reject) => {
      (connection || db).query(
        query,
        [closing_balance, notes, id],
        (err, results) => {
          if (err) return reject(err);
          resolve(results.affectedRows);
        },
      );
    });
  },

  getResult: (id) => {
    return new Promise((resolve, reject) => {
      const query = "SELECT * FROM cashier_start WHERE id = ?";
      db.query(query, [id], (err, results) => {
        if (err) return reject(err);
        resolve(results[0]);
      });
    });
  },

  getCashierStatus: (user_id, branch_id) => {
    return new Promise((resolve, reject) => {
      const query = `
            SELECT * FROM cashier_start 
            WHERE user_id = ? AND branch_id = ? AND status = 'open'
            ORDER BY id DESC LIMIT 1`;
      db.query(query, [user_id, branch_id], (err, results) => {
        if (err) return reject(err);
        resolve(results[0]);
      });
    });
  },

  /**
   * Insert POS Transaction (Cash Ledger)
   */
  insertPosTransaction: (
    pos_id,
    registry_id,
    type,
    amount,
    description,
    payment_method,
    connection,
  ) => {
    const query = `
      INSERT INTO pos_transactions (
        pos_id,
        registry_id,
        type,
        amount,
        description,
        payment_method,
        datetime
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;
    const values = [
      pos_id,
      registry_id,
      type,
      amount,
      description,
      payment_method,
    ];
    return new Promise((resolve, reject) => {
      (connection || db).query(query, values, (err, results) => {
        if (err) return reject(err);
        resolve(results.insertId);
      });
    });
  },

  getTodaySales,

  /**
   * Get Today's Profit Breakdown
   * Calculates revenue, discounts, cost, expenses, and profit
   */
  getTodayProfit: async (userId, branchId, vatSettings = {}) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { vatEnabled = false, vatPercentage = 0, vatType = "exclusive" } = vatSettings;

      // 1. Get Active Registry Session
      const registry = await getCashierStatus(userId, branchId);
      if (!registry) {
        return {
          productsRevenue: 0,
          orderDiscount: 0,
          productsCost: 0,
          expenses: 0,
          vatAmount: 0,
          profit: 0,
        };
      }
      const registryId = registry.id;

      // 2. Get Revenue, Discounts, and Tax from POS table
      const revenueQuery = `
        SELECT
          COALESCE(SUM(Total), 0) as productsRevenue,
          COALESCE(SUM(Discount_Amount), 0) as orderDiscount,
          COALESCE(SUM(IFNULL(Tax_Amount, 0)), 0) as taxAmount
        FROM pos
        WHERE Employee_idEmployee = ? AND Branch_idBranch = ? AND Date_Time LIKE ? AND Status = 1
      `;
      const revenueResult = await getResults(revenueQuery, [
        userId,
        branchId,
        `${today}%`,
      ]);
      const { productsRevenue, orderDiscount } = revenueResult[0];
      let taxAmount = parseFloat(revenueResult[0].taxAmount || 0);

      // 3. If Tax_Amount is not stored on pos rows, derive VAT from revenue
      // Only override if vatEnabled and taxAmount is 0 (fallback calculation)
      if (vatEnabled && taxAmount === 0 && vatPercentage > 0) {
        const gross = parseFloat(productsRevenue) - parseFloat(orderDiscount);
        if (vatType === "exclusive") {
          taxAmount = gross * (vatPercentage / 100);
        } else if (vatType === "inclusive") {
          taxAmount = gross - gross / (1 + vatPercentage / 100);
        }
        // inclusive_portion: VAT is informational, no deduction
      }

      // 4. Calculate Products' Cost (Cost of Goods Sold)
      const costQuery = `
        SELECT 
          COALESCE(SUM(COALESCE(it.Cost, 0) * pi.Qty), 0) as productsCost
        FROM pos_items pi
        JOIN pos p ON pi.Pos_idPos = p.idPos
        JOIN item it ON pi.Item_idItem = it.idItem
        WHERE p.Employee_idEmployee = ? AND p.Branch_idBranch = ? AND p.Date_Time LIKE ? AND p.Status = 1
      `;
      const costResult = await getResults(costQuery, [
        userId,
        branchId,
        `${today}%`,
      ]);
      const { productsCost } = costResult[0];

      // 5. Get Expenses (Cash Out transactions, excluding change given)
      const expensesQuery = `
        SELECT
          COALESCE(SUM(amount), 0) as expenses
        FROM pos_transactions
        WHERE registry_id = ? 
          AND type = 'Out' 
          AND description NOT LIKE '%Change Given%'
      `;
      const expensesResult = await getResults(expensesQuery, [registryId]);
      const { expenses } = expensesResult[0];

      // 6. Calculate Profit (Revenue ex-VAT - Discount - Cost - Expenses)
      // Profit = Revenue - Discount - VAT - Cost - Expenses
      const profit =
        parseFloat(productsRevenue) -
        parseFloat(orderDiscount) -
        taxAmount -
        parseFloat(productsCost) -
        parseFloat(expenses);

      return {
        productsRevenue: parseFloat(productsRevenue).toFixed(2),
        orderDiscount: parseFloat(orderDiscount).toFixed(2),
        productsCost: parseFloat(productsCost).toFixed(2),
        expenses: parseFloat(expenses).toFixed(2),
        vatAmount: parseFloat(taxAmount).toFixed(2),
        profit: parseFloat(profit).toFixed(2),
      };
    } catch (error) {
      throw error;
    }
  },

  /**
   * Fetch Register History for User/Branch
   */
  getRegisterHistory: (userId, branchId) => {
    const query = `
      SELECT * FROM cashier_start
      WHERE user_id = ? AND branch_id = ?
      ORDER BY id DESC
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [userId, branchId], (err, results) => {
        if (err) return reject(err);
        resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  /**
   * Fetch Detailed Register Info
   * Including Session, Cash Transactions, POS Sales, and Items
   */
  getRegisterDetails: async (registryId) => {
    try {
      // 1. Get Session Info
      const sessionQuery = `SELECT * FROM cashier_start WHERE id = ?`;
      const sessionResult = await getResults(sessionQuery, [registryId]);
      const session = sessionResult[0];

      if (!session) return null;

      // 2. Get Cash Transactions
      const transQuery = `SELECT * FROM pos_transactions WHERE registry_id = ? ORDER BY datetime DESC`;
      const transactions = await getResults(transQuery, [registryId]);

      // 3. Get Sales (POS Headers) linked to this session
      // We assume sales for this user & branch within the time window belong to this session.
      // Or we can rely on logical time range.
      const startTime = session.opening_time;
      const endTime = session.closing_time || new Date(); // Use current time if still open

      const posQuery = `
        SELECT * FROM pos
        WHERE Employee_idEmployee = ?
        AND Branch_idBranch = ?
        AND Date_Time >= ?
        AND Date_Time <= ?
        ORDER BY Date_Time DESC
      `;
      // Note: Date_Time in DB might be string. Ensure comparison works or cast if needed.
      // Usually MySQL string comparison works for ISO-like dates.
      const sales = await getResults(posQuery, [
        session.user_id,
        session.branch_id,
        startTime,
        endTime,
      ]);

      // 4. Get All Items for these sales
      // If there are no sales, items is empty
      let items = [];
      if (sales.length > 0) {
        const posIds = sales.map((s) => s.idPos);
        const placeholders = posIds.map(() => "?").join(",");
        const itemsQuery = `
          SELECT 
            pi.*, 
            i.Description as Item_Name,
            i.Item_Code 
          FROM pos_items pi
          LEFT JOIN item i ON pi.Item_idItem = i.idItem
          WHERE pi.Pos_idPos IN (${placeholders})
        `;
        items = await getResults(itemsQuery, posIds);
      }

      return {
        session,
        transactions,
        sales,
        items,
      };
    } catch (err) {
      throw err;
    }
  },

  /**
   * Get count of completed POS transactions for a company within a date range
   * @param {number} companyId - Company ID
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format
   * @returns {Promise<number>} Count of completed POS transactions
   */
  getPosCountForMonth: (companyId, startDate, endDate) => {
    return new Promise((resolve, reject) => {
      console.log(
        `[getPosCountForMonth] Starting - Company: ${companyId}, Dates: ${startDate} to ${endDate}`,
      );

      // First, get all branch IDs for this company from db2
      const branchQuery =
        "SELECT idBranch FROM branch WHERE Company_idCompany = ?";

      db2.query(branchQuery, [companyId], (branchErr, branches) => {
        if (branchErr) {
          console.error(`[getPosCountForMonth] Branch query error:`, branchErr);
          return reject(branchErr);
        }

        console.log(`[getPosCountForMonth] Branches found:`, branches);

        if (branches.length === 0) {
          console.log(
            `[getPosCountForMonth] No branches found for company ${companyId}`,
          );
          return resolve(0);
        }

        const branchIds = branches.map((b) => b.idBranch);
        console.log(`[getPosCountForMonth] Branch IDs:`, branchIds);

        // Now count POS entries for those branches within the date range
        // Only count completed transactions (Status = 1)
        // Use DATE() to compare only the date part of the timestamp
        const countQuery = `
          SELECT COUNT(*) as count 
          FROM pos 
          WHERE Branch_idBranch IN (?) 
          AND DATE(Date_Time) >= ? 
          AND DATE(Date_Time) <= ?
          AND Status = 1
        `;

        console.log(`[getPosCountForMonth] Executing query with params:`, {
          branchIds,
          startDate,
          endDate,
        });

        // First, let's check what POS records actually exist
        const diagnosticQuery = `
          SELECT idPos, Date_Time, Status, Branch_idBranch 
          FROM pos 
          WHERE Branch_idBranch IN (?)
          ORDER BY Date_Time DESC
          LIMIT 10
        `;

        db.query(diagnosticQuery, [branchIds], (diagErr, diagResults) => {
          if (!diagErr) {
            console.log(
              `[getPosCountForMonth] Recent POS records in database:`,
              diagResults,
            );
          }

          // Now run the actual count query
          db.query(
            countQuery,
            [branchIds, startDate, endDate],
            (err, results) => {
              if (err) {
                console.error(`[getPosCountForMonth] Count query error:`, err);
                reject(err);
              } else {
                const count = results[0].count || 0;
                console.log(`[getPosCountForMonth] Query result:`, results);
                console.log(`[getPosCountForMonth] Final count: ${count}`);
                resolve(count);
              }
            },
          );
        });
      });
    });
  },
  fetchPosItemsForPosList,
};
