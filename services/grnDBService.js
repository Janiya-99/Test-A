const db = require("../db/db");

const checkSerial = async (serial_numbers) => {
  try {
    // Convert the array of serial numbers into a comma-separated string for the SQL query
    const serialNumbersString = serial_numbers
      .map((serial) => `'${serial}'`)
      .join(",");

    const query =
      "SELECT Serial_No FROM item_has_serial_no WHERE Serial_No IN (?)";
    return new Promise((resolve, reject) => {
      const placeholders = serial_numbers.map(() => "?").join(",");
      const fixedQuery = `SELECT Serial_No FROM item_has_serial_no WHERE Serial_No IN (${placeholders})`;
      db.query(fixedQuery, serial_numbers, (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  } catch (error) {
    throw error;
  }
};

const insertGrn = (
  Date,
  Supplier_idSupplier,
  Bill_no,
  Items_Count,
  Total_Amount,
  Bill_Discount,
  Bill_Discount_Type, // added
  Discount_Amount,
  Net_Total,
  Paid_Amount,
  Credit_Balance_Amount,
  Grn_File,
  Branch_idBranch,
  Purchase_Order_id,
  Vat_Amount = 0,
  Extra_Charge = 0,
  Extra_Charge_Label = "Delivery Charge",
  update_product_cost = 1,
  connection,
  grn_no = null,
  Applied_Return_Amount = 0,
) => {
  const query =
    "INSERT INTO grn (Date, Supplier_idSupplier, Bill_no, Items_Count, Total_Amount, Bill_Discount, Bill_Discount_Type, Discount_Amount, Net_Total, Paid_Amount, Credit_Balance_Amount, Status, Grn_File, Branch_idBranch, Purchase_Order_id, Vat_Amount, Extra_Charge, Extra_Charge_Label, update_product_cost, grn_no, Applied_Return_Amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Date,
        Supplier_idSupplier,
        Bill_no,
        Items_Count,
        Total_Amount,
        Bill_Discount,
        Bill_Discount_Type,
        Discount_Amount,
        Net_Total,
        Paid_Amount,
        Credit_Balance_Amount,
        0, // Status
        Grn_File,
        Branch_idBranch,
        Purchase_Order_id || null,
        Vat_Amount,
        parseFloat(Extra_Charge) || 0,
        Extra_Charge_Label || "Delivery Charge",
        update_product_cost,
        grn_no,
        parseFloat(Applied_Return_Amount) || 0,
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

const updateGrn = (
  Date,
  Bill_no,
  Items_Count,
  Total_Amount,
  Bill_Discount,
  Bill_Discount_Type, // added
  Discount_Amount,
  Net_Total,
  Grn_File,
  idGRN,
  Vat_Amount = 0,
  Extra_Charge = 0,
  Extra_Charge_Label = "Delivery Charge",
  update_product_cost = 1,
  connection,
  grn_no = null,
) => {
  const query =
    "UPDATE grn SET Date=?, Bill_no=?, Items_Count=?, Total_Amount=?, Bill_Discount=?, Bill_Discount_Type=?, Discount_Amount=?, Net_Total=?, Credit_Balance_Amount=?, Grn_File=?, Vat_Amount=?, Extra_Charge=?, Extra_Charge_Label=?, update_product_cost=?, grn_no=? WHERE idGRN=?";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Date,
        Bill_no,
        Items_Count,
        Total_Amount,
        Bill_Discount,
        Bill_Discount_Type,
        Discount_Amount,
        Net_Total,
        Net_Total,
        Grn_File,
        Vat_Amount,
        parseFloat(Extra_Charge) || 0,
        Extra_Charge_Label || "Delivery Charge",
        update_product_cost,
        grn_no,
        idGRN,
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

const insertItems = (
  GRN_idGRN,
  Item_idItem,
  Item_Description,
  Cost,
  Qty_Type,
  Qty,
  Total,
  Discount,
  Discount_Type,
  Sub_Total,
  Branch_idBranch,
  Variation_Id, // added
  Bonus_Qty, // added
  connection,
) => {
  const query =
    "INSERT INTO grn_has_item (GRN_idGRN, Item_idItem, Item_Description, Cost, Qty_Type, Qty, Total, Discount, Sub_Total, Branch_idBranch, Variation_Id, Bonus_Qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        GRN_idGRN,
        Item_idItem,
        Item_Description,
        Cost,
        Qty_Type,
        Qty,
        Total,
        Discount,
        Sub_Total,
        Branch_idBranch,
        Variation_Id || null, // added
        Bonus_Qty || 0, // added
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

// ✅ Allows saving if either Serial_No OR Expiry_Date is present
const insertSerialNumbers = (
  GRN_idGRN,
  Item_idItem,
  Qty,
  SerialArray,
  Branch_idBranch,
  connection,
  variationId = null,
) => {
  if (!Array.isArray(SerialArray) || SerialArray.length === 0) {
    return Promise.resolve(); // No serials to insert
  }

  // ✅ Only allow rows where at least one of Serial_No or Expiry_Date is present
  const validSerials = SerialArray.filter(
    (s) =>
      (s.Serial_No && s.Serial_No.trim() !== "") ||
      (s.Expiry_Date && s.Expiry_Date.trim() !== ""),
  );

  if (validSerials.length === 0) {
    return Promise.resolve(); // Nothing valid to insert
  }

  const values = validSerials.map((serialObj) => [
    GRN_idGRN,
    Item_idItem,
    1,
    serialObj.Serial_No && serialObj.Serial_No.trim() !== ""
      ? serialObj.Serial_No.trim()
      : null,
    serialObj.Expiry_Date && serialObj.Expiry_Date.trim() !== ""
      ? serialObj.Expiry_Date.trim()
      : null,
    Branch_idBranch,
    variationId,
  ]);

  const query = `
    INSERT INTO item_has_serial_no 
    (GRN_idGRN, Item_idItem, Qty, Serial_No, Expiry_Date, Branch_idBranch, variation_id) 
    VALUES ?
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [values], (err, results) => {
      if (err) {
        console.error("❌ Serial insert failed:", err);
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchGrns = (Branch_idBranch, scopedUserId = null) => {
  let query =
    "SELECT g.*, s.Company_Name FROM grn g INNER JOIN supplier s ON g.Supplier_idSupplier = s.idSupplier WHERE g.Branch_idBranch = ?";
  const params = [Branch_idBranch];

  if (scopedUserId) {
    query += ` AND (
      g.idGRN IN (
        SELECT Task_ID FROM user_log 
        WHERE Task_Type = 'GRN' AND User_idUser = ? AND Task_Category = 'create'
      )
    )`;
    params.push(scopedUserId);
  }

  query += " ORDER BY idGRN DESC";
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchGrn = (idGRN) => {
  const query =
    "SELECT g.*, s.Company_Name, s.Contact_No, s.Address1, s.Address2, s.Address3, CONCAT_WS(', ', NULLIF(s.Address1, ''), NULLIF(s.Address2, ''), NULLIF(s.Address3, '')) AS Address, s.Email, s.Agent_Name FROM grn g INNER JOIN supplier s ON g.Supplier_idSupplier = s.idSupplier WHERE g.idGRN = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idGRN], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchItems = (GRN_idGRN, connection) => {
  const query = `
    SELECT 
      ghi.*, 
      i.Rate AS Rate,
      i.Item_Has_Serial,
      i.Expired_Date,
      i.barcode AS barcode
    FROM grn_has_item ghi
    INNER JOIN item i ON ghi.Item_idItem = i.idItem 
    WHERE GRN_idGRN = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [GRN_idGRN], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchSerialNoForItem = (Item_idItem, GRN_idGRN) => {
  const query = `
    SELECT Serial_No, Expiry_Date 
    FROM item_has_serial_no 
    WHERE Item_idItem = ? AND GRN_idGRN = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Item_idItem, GRN_idGRN], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const deleteItems = (idGRN, connection) => {
  const query = "DELETE FROM grn_has_item WHERE GRN_idGRN = ?";
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

const deleteSerialNumbers = (idGRN, connection) => {
  const query = "DELETE FROM item_has_serial_no WHERE GRN_idGRN = ?";
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

// new: delete item_batch rows for this grn
const deleteItemBatch = (grn_id, connection) => {
  const query = "DELETE FROM item_batch WHERE grn_id = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [grn_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

// new: delete grn record
const deleteGrn = (idGRN, connection) => {
  const query = "DELETE FROM grn WHERE idGRN = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idGRN], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const processGrn = (Paid_Amount, Credit_Balance_Amount, idGRN, connection) => {
  const query =
    "UPDATE grn SET Paid_Amount=?, Credit_Balance_Amount=?, Status=? WHERE idGRN=?";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Paid_Amount, Credit_Balance_Amount, 1, idGRN],
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

const insertItemBatch = (
  grn_id,
  item_id,
  warehouse_id, // nullable
  warehouse_zone, // nullable
  warehouse_rack_id, // nullable
  warehouse_rack_cell, // nullable
  qty,
  cost,
  rate,
  total_cost,
  updated_user_id,
  batch_code, // new param
  variation_id, // added
  expiry_date, // added
  connection,
) => {
  const sql = `
    INSERT INTO item_batch
    (grn_id, item_id, warehouse_id, warehouse_zone, warehouse_rack_id, warehouse_rack_cell, qty, cost, rate, total_cost, updated_user_id, batch_code, variation_id, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      sql,
      [
        grn_id,
        item_id,
        warehouse_id ?? null,
        warehouse_zone ?? null,
        warehouse_rack_id ?? null,
        warehouse_rack_cell ?? null,
        qty ?? 0,
        cost ?? 0,
        rate ?? 0,
        total_cost ?? 0,
        updated_user_id ?? null,
        batch_code ?? null,
        variation_id || null, // added
        expiry_date || null, // added
      ],
      (err, results) => (err ? reject(err) : resolve(results)),
    );
  });
};

const checkDuplicateGrnNo = (grn_no, Branch_idBranch, excludeId = null, connection = null) => {
  let query = "SELECT idGRN FROM grn WHERE grn_no = ? AND Branch_idBranch = ?";
  const params = [grn_no, Branch_idBranch];
  if (excludeId) {
    query += " AND idGRN != ?";
    params.push(excludeId);
  }
  return new Promise((resolve, reject) => {
    (connection || db).query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results && results.length > 0);
    });
  });
};

module.exports = {
  checkDuplicateGrnNo,
  insertGrn,
  insertItems,
  insertSerialNumbers,
  fetchGrns,
  fetchItems,
  fetchSerialNoForItem,
  fetchGrn,
  updateGrn,
  deleteItems,
  deleteSerialNumbers,
  processGrn,
  checkSerial,
  insertItemBatch,
  fetchBatches: (userId, branchId) => {
    const query = `
      SELECT ib.batch_code
      FROM item_batch ib
      JOIN grn g ON ib.grn_id = g.idGRN
      WHERE ib.updated_user_id = ? 
        AND g.Branch_idBranch = ?
        AND ib.batch_code IS NOT NULL
        AND ib.batch_code != ''
      GROUP BY ib.batch_code
      ORDER BY MAX(ib.grn_id) DESC
      LIMIT 50
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [userId, branchId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  fetchBatchDetails: (userId, branchId) => {
    const query = `
      SELECT 
        ib.*,
        i.Item_Code,
        i.Description as Item_Name,
        ghi.Item_Description,
        g.Bill_no as GRN_Bill_No,
        g.Date as GRN_Date,
        s.Company_Name as Supplier_Name,
        COALESCE(iv_direct.description, iv_legacy.description) as Variation_Name,
        COALESCE(ib.variation_id, iv_legacy.id) as Variation_Id
      FROM item_batch ib
      JOIN item i ON ib.item_id = i.idItem
      JOIN grn g ON ib.grn_id = g.idGRN
      LEFT JOIN supplier s ON g.Supplier_idSupplier = s.idSupplier
      LEFT JOIN grn_has_item ghi ON ib.grn_id = ghi.GRN_idGRN AND ib.item_id = ghi.Item_idItem AND (ib.variation_id <=> ghi.Variation_Id)
      -- Check direct variation link first
      LEFT JOIN item_variations iv_direct ON ib.variation_id = iv_direct.id
      -- Fallback to legacy check (if using grn_item_variations)
      LEFT JOIN grn_item_variations giv ON ib.grn_id = giv.grn_id AND ib.item_id = giv.item_id
      LEFT JOIN item_variations iv_legacy ON giv.variation_id = iv_legacy.id
      WHERE ib.updated_user_id = ?
        AND g.Branch_idBranch = ?
      ORDER BY ib.grn_id DESC
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [userId, branchId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  deleteItemBatch, // <-- export
  deleteGrn, // <-- export

  // Variation Support
  insertGrnItemVariations: (grnId, itemId, variations, connection) => {
    if (!variations || variations.length === 0) return Promise.resolve();

    const values = variations.map((v) => [
      grnId,
      itemId,
      v.id, // variation_id
      v.qty,
      v.cost,
    ]);

    const query =
      "INSERT INTO grn_item_variations (grn_id, item_id, variation_id, qty, cost) VALUES ?";

    return new Promise((resolve, reject) => {
      (connection || db).query(query, [values], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  fetchGrnItemVariations: (grnId, itemId) => {
    const query = `
        SELECT giv.*, iv.description as variation_name, iv.product_sku 
        FROM grn_item_variations giv 
        JOIN item_variations iv ON giv.variation_id = iv.id
        WHERE giv.grn_id = ? AND giv.item_id = ?
      `;
    return new Promise((resolve, reject) => {
      db.query(query, [grnId, itemId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  deleteGrnItemVariations: (grnId, connection) => {
    const query = "DELETE FROM grn_item_variations WHERE grn_id = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [grnId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  getLastBatchCode: (itemId) => {
    const query = `
      SELECT batch_code 
      FROM item_batch 
      WHERE item_id = ?
        AND batch_code LIKE 'BATCH-%' 
        AND batch_code REGEXP '^BATCH-[0-9]+$'
      ORDER BY LENGTH(batch_code) DESC, batch_code DESC 
      LIMIT 1
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [itemId], (err, results) => {
        if (err) reject(err);
        else resolve(results.length > 0 ? results[0].batch_code : null);
      });
    });
  },

  // ✅ New: Batch Return Functionality
  getBatchById: (batch_id) => {
    const query = "SELECT * FROM item_batch WHERE batch_id = ?";
    return new Promise((resolve, reject) => {
      db.query(query, [batch_id], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  updateBatchQty: (batch_id, newQty, connection) => {
    const query = "UPDATE item_batch SET qty = ? WHERE batch_id = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [newQty, batch_id], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  // Inserts a record into purchase_return for tracking purposes
  createBatchReturnRecord: (
    Date,
    Supplier_idSupplier,
    Total_Amount,
    Items_Count,
    Branch_idBranch,
    Reason,
    Batch_Id, // Optional tracking
    connection,
  ) => {
    // Note: We are mocking a Purchase Return here.
    // If you need a strict link to Batch, you might need a new column or table.
    // For now, adhering to existing table structure + inserting as 'Processed' (1).
    const query =
      "INSERT INTO purchase_return (Date, Supplier_idSupplier, Reason, Item_Count, Total_Amount, Status, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, ?)";
    return new Promise((resolve, reject) => {
      (connection || db).query(
        query,
        [
          Date,
          Supplier_idSupplier,
          Reason,
          Items_Count,
          Total_Amount,
          1, // Status = 1 (Processed)
          Branch_idBranch,
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  },

  insertBatchReturnItem: (
    idPurchase_Return,
    Item_idItem,
    Item_Description,
    Cost,
    Qty,
    Total,
    Branch_idBranch,
    Variation_Id, // added
    connection,
  ) => {
    const query =
      "INSERT INTO purchase_return_has_item (Purchase_Return_idPurchase_Return, Item_idItem, Item_Description, Cost, Qty_Type, Qty, Total, Branch_idBranch, Variation_Id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    return new Promise((resolve, reject) => {
      (connection || db).query(
        query,
        [
          idPurchase_Return,
          Item_idItem,
          Item_Description,
          Cost,
          "", // Qty_Type
          Qty,
          Total,
          Branch_idBranch,
          Variation_Id || null, // added
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  },

  updateVariationQty: (variationId, qtyChange, connection) => {
    // Assuming 'qty' is the column name and 'id' is the primary key in item_variations
    const query = "UPDATE item_variations SET qty = qty - ? WHERE id = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(
        query,
        [qtyChange, variationId],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  },

  fetchPurchaseReturns: (branchId) => {
    const query = `
      SELECT pr.*, s.Company_Name, g.Bill_no as Resolved_GRN_Bill_No, g.grn_no as Resolved_GRN_No 
      FROM purchase_return pr
      LEFT JOIN supplier s ON pr.Supplier_idSupplier = s.idSupplier
      LEFT JOIN grn g ON pr.Resolved_GRN_Id = g.idGRN
      WHERE pr.Branch_idBranch = ?
      ORDER BY pr.idPurchase_Return DESC
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [branchId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  fetchPurchaseReturnItems: (returnId) => {
    const query = `
      SELECT 
        prhi.*, 
        i.Item_Code, 
        i.Description as Item_Name,
        COALESCE(iv.description, '') as Variation_Name
      FROM purchase_return_has_item prhi
      JOIN item i ON prhi.Item_idItem = i.idItem
      LEFT JOIN item_variations iv ON prhi.Variation_Id = iv.id
      WHERE prhi.Purchase_Return_idPurchase_Return = ?
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [returnId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  // ✅ Batch fetch items for multiple GRNs
  fetchItemsForGrnList: (grnIds) => {
    if (!grnIds || grnIds.length === 0) return Promise.resolve([]);
    const query = `
      SELECT 
        ghi.*, 
        i.Rate AS Rate,
        i.Item_Has_Serial,
        i.Expired_Date
      FROM grn_has_item ghi
      INNER JOIN item i ON ghi.Item_idItem = i.idItem 
      WHERE ghi.GRN_idGRN IN (?)
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [grnIds], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  // ✅ Batch fetch serial numbers for a GRN
  fetchSerialNoForGrn: (GRN_idGRN) => {
    const query = `
      SELECT Item_idItem, Serial_No, Expiry_Date 
      FROM item_has_serial_no 
      WHERE GRN_idGRN = ?
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [GRN_idGRN], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  // ✅ Batch fetch variations for a GRN
  fetchGrnItemVariationsForGrn: (grnId) => {
    const query = `
        SELECT giv.*, iv.description as variation_name, iv.product_sku, iv.barcode, iv.rate AS rate
        FROM grn_item_variations giv 
        JOIN item_variations iv ON giv.variation_id = iv.id
        WHERE giv.grn_id = ?
      `;
    return new Promise((resolve, reject) => {
      db.query(query, [grnId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  fetchPendingGrns: (supplierId) => {
    const query =
      "SELECT * FROM grn WHERE Supplier_idSupplier = ? AND Credit_Balance_Amount > 0 AND (approval_status IS NULL OR approval_status NOT IN ('PENDING_APPROVAL', 'REJECTED')) ORDER BY idGRN ASC";
    return new Promise((resolve, reject) => {
      db.query(query, [supplierId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  fetchPendingBalanceGrns: (supplierId, branchId) => {
    const query = `
      SELECT idGRN, grn_no, Bill_no, Date, Total_Amount, Net_Total, Paid_Amount, Credit_Balance_Amount
      FROM grn
      WHERE Supplier_idSupplier = ? AND Branch_idBranch = ? AND CAST(COALESCE(Credit_Balance_Amount, 0) AS DECIMAL(15,2)) > 0
      ORDER BY idGRN DESC
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [supplierId, branchId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },

  updateGrnCreditBalance: (idGRN, Credit_Balance_Amount, connection) => {
    const query = "UPDATE grn SET Credit_Balance_Amount=? WHERE idGRN=?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [Credit_Balance_Amount, idGRN], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  insertAppliedReturn: (grnId, returnId, appliedAmount, connection) => {
    const query =
      "INSERT INTO grn_has_applied_return (GRN_idGRN, Purchase_Return_idPurchase_Return, Applied_Amount) VALUES (?, ?, ?)";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [grnId, returnId, appliedAmount], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  fetchAppliedReturnsByGrn: (grnId, connection) => {
    const query = `
      SELECT ar.*, pr.Date as Return_Date, pr.Total_Amount as Return_Total, pr.Reason as Return_Reason
      FROM grn_has_applied_return ar
      INNER JOIN purchase_return pr ON ar.Purchase_Return_idPurchase_Return = pr.idPurchase_Return
      WHERE ar.GRN_idGRN = ?
    `;
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [grnId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },
};
