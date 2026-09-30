const db = require("../db/db");
const db2 = require("../db/db2");

// Use Asia/Colombo time and format as 'YYYY-MM-DD HH:mm:ss'
function getColomboDateTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

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

const insertStockCard = (
  Item_idItem,
  Description,
  Transaction_Type,
  Transaction_ID,
  Cost,
  Real_Cost,
  Sell_Price,
  IN_Stock,
  Out_Stock,
  SIH,
  Branch_idBranch,
  connection,
  Variation_Id = null,
) => {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
  const day = currentDate.getDate().toString().padStart(2, "0");
  const hours = currentDate.getHours().toString().padStart(2, "0");
  const minutes = currentDate.getMinutes().toString().padStart(2, "0");
  const seconds = currentDate.getSeconds().toString().padStart(2, "0");

  const Date_Time = getColomboDateTime();

  const query =
    "INSERT INTO stock_card (Date,Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch, Variation_Id) VALUES (?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Date_Time,
        Item_idItem,
        Description,
        Transaction_Type,
        Transaction_ID,
        Cost,
        Real_Cost,
        Sell_Price,
        IN_Stock,
        Out_Stock,
        SIH,
        Branch_idBranch,
        Variation_Id,
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

const fetchItemsSIN = async (Branch_idBranch, category) => {
  let query;
  let params;
  const siblingBranches = await getSiblingBranchIds(Branch_idBranch);

  // 1. Fetch Main Items (Existing Logic)
  if (category === "all") {
    query = `
      WITH LastStock AS (
        SELECT
          sc.Item_idItem,
          sc.SIH,
          ROW_NUMBER() OVER (PARTITION BY sc.Item_idItem ORDER BY sc.idStock_Card DESC) AS rn
        FROM stock_card sc
        WHERE sc.Branch_idBranch = ? AND sc.Variation_Id IS NULL
      )
      SELECT 
        i.idItem,
        i.Item_Code,
        i.Real_Cost, 
        i.Cost, 
        i.Rate, 
        i.Qty,
        i.Item_Category_idItem_Category, 
        ic.Description AS Item_Category, 
        i.Description, 
        qt.Description AS Quantity_Type, 
        i.Item_Has_Serial,
        i.Brand_Name,
        COALESCE(SUM(sc.IN_Stock), 0) AS Total_In_Stock, 
        COALESCE(SUM(sc.Out_Stock), 0) AS Total_Out_Stock,
        COALESCE(MAX(ls.SIH), i.Qty) AS Stock_In_Hand,
        'Main' as Row_Type
        FROM item i
        LEFT JOIN stock_card sc ON sc.Item_idItem = i.idItem AND sc.Variation_Id IS NULL AND sc.Branch_idBranch = ?
        LEFT JOIN quantity_type qt ON qt.idQuantity_Type = i.Qty_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN LastStock ls ON i.idItem = ls.Item_idItem AND ls.rn = 1
        WHERE i.Branch_idBranch IN (?)
        GROUP BY 
        i.idItem,
        i.Item_Code,
        i.Real_Cost, 
        i.Qty,
        i.Cost, 
        i.Rate, 
        i.Item_Category_idItem_Category, 
        ic.Description, 
        i.Description, 
        qt.Description,
        i.Item_Has_Serial,
        i.Brand_Name;
    `;
    params = [Branch_idBranch, Branch_idBranch, siblingBranches];
  } else {
    query = `
      WITH LastStock AS (
        SELECT
          sc.Item_idItem,
          sc.SIH,
          ROW_NUMBER() OVER (PARTITION BY sc.Item_idItem ORDER BY sc.idStock_Card DESC) AS rn
        FROM stock_card sc
        WHERE sc.Branch_idBranch = ? AND sc.Variation_Id IS NULL
      )
      SELECT 
        i.idItem,
        i.Item_Code,
        i.Real_Cost, 
        i.Cost, 
        i.Rate, 
        i.Qty,
        i.Item_Category_idItem_Category, 
        ic.Description AS Item_Category, 
        i.Description, 
        qt.Description AS Quantity_Type, 
        i.Item_Has_Serial,
        i.Brand_Name,
        COALESCE(SUM(sc.IN_Stock), 0) AS Total_In_Stock, 
        COALESCE(SUM(sc.Out_Stock), 0) AS Total_Out_Stock,
        COALESCE(MAX(ls.SIH), i.Qty) AS Stock_In_Hand,
        'Main' as Row_Type
        FROM item i
        LEFT JOIN stock_card sc ON sc.Item_idItem = i.idItem AND sc.Variation_Id IS NULL AND sc.Branch_idBranch = ?
        LEFT JOIN quantity_type qt ON qt.idQuantity_Type = i.Qty_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN LastStock ls ON i.idItem = ls.Item_idItem AND ls.rn = 1
        WHERE i.Item_Category_idItem_Category = ? AND i.Branch_idBranch IN (?)
        GROUP BY 
          i.idItem,
          i.Item_Code,
          i.Real_Cost, 
          i.Cost, 
          i.Rate, 
          i.Qty,
          i.Item_Category_idItem_Category, 
          ic.Description, 
          i.Description, 
          qt.Description,
          i.Item_Has_Serial,
          i.Brand_Name;
    `;
    params = [Branch_idBranch, Branch_idBranch, category, siblingBranches];
  }

  // 2. Fetch Variations (New Logic)
  // We need to fetch variations for distinct items found in the first step?
  // Or just fetch all variations for the branch's items.
  // The filtering by category applies to the parent item.

  let variationQuery;
  let variationParams;

  if (category === "all") {
    variationQuery = `
        WITH LastStockVar AS (
          SELECT
            sc.Item_idItem,
            sc.Variation_Id,
            sc.SIH,
            ROW_NUMBER() OVER (PARTITION BY sc.Item_idItem, sc.Variation_Id ORDER BY sc.idStock_Card DESC) AS rn
          FROM stock_card sc
          WHERE sc.Branch_idBranch = ? AND sc.Variation_Id IS NOT NULL
        )
        SELECT 
            iv.item_id as idItem,
            iv.item_code as Item_Code,
            iv.cost as Cost,
            iv.rate as Rate,
            iv.cost as Real_Cost,
            iv.qty as Qty,
            i.Item_Category_idItem_Category,
            ic.Description as Item_Category,
            CONCAT(i.Description, ' - ', iv.description) as Description,
            qt.Description as Quantity_Type,
            COALESCE(SUM(sc.IN_Stock), 0) AS Total_In_Stock, 
            COALESCE(SUM(sc.Out_Stock), 0) AS Total_Out_Stock,
            COALESCE(MAX(lsv.SIH), iv.qty) AS Stock_In_Hand,
            'Variation' as Row_Type,
            i.Brand_Name as Brand_Name,
            i.Item_Has_Serial as Item_Has_Serial
        FROM item_variations iv
        JOIN item i ON iv.item_id = i.idItem
        LEFT JOIN stock_card sc ON sc.Item_idItem = i.idItem AND sc.Variation_Id = iv.id AND sc.Branch_idBranch = ?
        LEFT JOIN quantity_type qt ON qt.idQuantity_Type = i.Qty_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN LastStockVar lsv ON lsv.Item_idItem = i.idItem AND lsv.Variation_Id = iv.id AND lsv.rn = 1
        WHERE i.Branch_idBranch IN (?)
        GROUP BY 
            iv.id,
            iv.item_id,
            iv.item_code,
            iv.cost,
            iv.rate,
            iv.qty,
            i.Item_Category_idItem_Category,
            ic.Description,
            i.Description,
            iv.description,
            qt.Description,
            i.Brand_Name,
            i.Item_Has_Serial
      `;
    variationParams = [Branch_idBranch, Branch_idBranch, siblingBranches];
  } else {
    variationQuery = `
        WITH LastStockVar AS (
          SELECT
            sc.Item_idItem,
            sc.Variation_Id,
            sc.SIH,
            ROW_NUMBER() OVER (PARTITION BY sc.Item_idItem, sc.Variation_Id ORDER BY sc.idStock_Card DESC) AS rn
          FROM stock_card sc
          WHERE sc.Branch_idBranch = ? AND sc.Variation_Id IS NOT NULL
        )
        SELECT 
            iv.item_id as idItem,
            iv.item_code as Item_Code,
            iv.cost as Cost,
            iv.rate as Rate,
            iv.cost as Real_Cost,
            iv.qty as Qty,
            i.Item_Category_idItem_Category,
            ic.Description as Item_Category,
            CONCAT(i.Description, ' - ', iv.description) as Description,
            qt.Description as Quantity_Type,
            COALESCE(SUM(sc.IN_Stock), 0) AS Total_In_Stock, 
            COALESCE(SUM(sc.Out_Stock), 0) AS Total_Out_Stock,
            COALESCE(MAX(lsv.SIH), iv.qty) AS Stock_In_Hand,
            'Variation' as Row_Type,
            i.Brand_Name as Brand_Name,
            i.Item_Has_Serial as Item_Has_Serial
        FROM item_variations iv
        JOIN item i ON iv.item_id = i.idItem
        LEFT JOIN stock_card sc ON sc.Item_idItem = i.idItem AND sc.Variation_Id = iv.id AND sc.Branch_idBranch = ?
        LEFT JOIN quantity_type qt ON qt.idQuantity_Type = i.Qty_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN LastStockVar lsv ON lsv.Item_idItem = i.idItem AND lsv.Variation_Id = iv.id AND lsv.rn = 1
        WHERE i.Item_Category_idItem_Category = ? AND i.Branch_idBranch IN (?)
        GROUP BY 
            iv.id,
            iv.item_id,
            iv.item_code,
            iv.cost,
            iv.rate,
            iv.qty,
            i.Item_Category_idItem_Category,
            ic.Description,
            i.Description,
            iv.description,
            qt.Description,
            i.Brand_Name,
            i.Item_Has_Serial
      `;
    variationParams = [Branch_idBranch, Branch_idBranch, category, siblingBranches];
  }

  return new Promise((resolve, reject) => {
    // Run Main Query
    db.query(query, params, (err, mainResults) => {
      if (err) {
        return reject(err);
      }

      // Run Variation Query
      db.query(variationQuery, variationParams, (varErr, varResults) => {
        if (varErr) {
          return reject(varErr);
        }

        // Combine results
        // We might want to sort them so variations appear after their main item, but the frontend table sorts or displays them.
        // The current controller loop just pushes them.
        // Let's concat.

        const combined = mainResults.concat(varResults);

        // Optional: Sort by Description to group Item and its variations (since names are similar)
        // combined.sort((a, b) => a.Description.localeCompare(b.Description));
        // Actually, let's leave sorting to a simple concat or let frontend handle it.
        // But grouping by item id would be better.

        combined.sort((a, b) => {
          if (a.idItem === b.idItem) {
            // Main item first, then variations
            return a.Row_Type === "Main" ? -1 : 1;
          }
          return a.idItem - b.idItem;
        });

        resolve(combined);
      });
    });
  });
};

const fetchStockCard = (from, to, idItem, Branch_idBranch) => {
  let query;
  let params;

  if (idItem == "all") {
    query = `
      SELECT 
        s.*, 
        i.Cost, 
        i.Rate, 
        i.Real_Cost, 
        i.Description AS Parent_Description, 
        COALESCE(IF(iv.description LIKE CONCAT(i.Description, '%'), iv.description, CONCAT(i.Description, ' - ', iv.description)), s.Description, i.Description) AS Description,
        EXISTS(SELECT 1 FROM item_variations WHERE item_id = i.idItem) AS Has_Variations
      FROM item i 
      LEFT JOIN stock_card s ON s.Item_idItem = i.idItem AND s.Branch_idBranch = i.Branch_idBranch AND s.Date BETWEEN ? AND ? 
      LEFT JOIN item_variations iv ON s.Variation_Id = iv.id
      WHERE i.Branch_idBranch = ? AND i.Type IN (1, 'Item')
      ORDER BY s.Date DESC, s.idStock_Card DESC
    `;
    params = [from, to, Branch_idBranch];
  } else {
    query = `
      SELECT 
        s.*, 
        i.Cost, 
        i.Rate, 
        i.Real_Cost, 
        i.Description AS Parent_Description, 
        COALESCE(IF(iv.description LIKE CONCAT(i.Description, '%'), iv.description, CONCAT(i.Description, ' - ', iv.description)), s.Description, i.Description) AS Description,
        EXISTS(SELECT 1 FROM item_variations WHERE item_id = i.idItem) AS Has_Variations
      FROM item i 
      LEFT JOIN stock_card s ON s.Item_idItem = i.idItem AND s.Branch_idBranch = i.Branch_idBranch AND s.Date BETWEEN ? AND ? 
      LEFT JOIN item_variations iv ON s.Variation_Id = iv.id
      WHERE i.Branch_idBranch = ? AND i.idItem = ? AND i.Type IN (1, 'Item')
      ORDER BY s.Date DESC, s.idStock_Card DESC
    `;
    params = [from, to, Branch_idBranch, idItem];
  }

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

// 🧩 Deletes old stock card entries for a given transaction type and ID (GRN in this case)
const deleteStockCardByTransactionId = (
  transactionType,
  transactionId,
  connection,
) => {
  const query = `
    DELETE FROM stock_card 
    WHERE Transaction_Type = ? AND Transaction_ID = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [transactionType, transactionId],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      },
    );
  });
};

module.exports = {
  // ...existing exports
  deleteStockCardByTransactionId,
};

const fetchSerialNumbersByItem = (Item_idItem, Branch_idBranch, limit, offset, search) => {
  let query = `
    SELECT 
        sn.ID, 
        sn.Serial_No, 
        sn.Qty, 
        sn.Expiry_Date, 
        sn.GRN_idGRN,
        g.Date AS Purchase_Date,
        IF(sn.Qty = 0, 
            COALESCE(
                (SELECT i.Date FROM invoice i JOIN invoice_has_item ihi ON i.idInvoice = ihi.Invoice_idInvoice WHERE ihi.Serial_No_Id = sn.ID ORDER BY i.idInvoice DESC LIMIT 1),
                (SELECT p.Date_Time FROM pos p JOIN pos_items pi ON p.idPos = pi.Pos_idPos WHERE pi.Serial_No_Id = sn.ID ORDER BY p.idPos DESC LIMIT 1)
            ), 
            NULL
        ) AS Sold_Date
    FROM item_has_serial_no sn
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE sn.Item_idItem = ? AND sn.Branch_idBranch = ?
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;

  const params = [Item_idItem, Branch_idBranch];

  if (search) {
    query += ` AND sn.Serial_No LIKE ?`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY sn.ID DESC`;

  if (limit !== undefined && offset !== undefined) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
  }

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const countSerialNumbersByItem = (Item_idItem, Branch_idBranch, search) => {
  let query = `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN sn.Qty = 1 THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN sn.Qty = 0 THEN 1 ELSE 0 END) as sold
    FROM item_has_serial_no sn
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE Item_idItem = ? AND Branch_idBranch = ?
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;
  const params = [Item_idItem, Branch_idBranch];

  if (search) {
    query += ` AND sn.Serial_No LIKE ?`;
    params.push(`%${search}%`);
  }

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results[0]);
    });
  });
};


module.exports = {
  insertStockCard,
  fetchItemsSIN,
  fetchStockCard,
  deleteStockCardByTransactionId,
  fetchSerialNumbersByItem,
  countSerialNumbersByItem,
};
