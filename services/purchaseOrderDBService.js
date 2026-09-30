const db = require("../db/db");

const insertPurchaseOrder = (
  Date,
  Supplier_idSupplier,
  PO_Number,
  Items_Count,
  Total_Amount,
  Bill_Discount,
  Bill_Discount_Type,
  Discount_Amount,
  Net_Total,
  Branch_idBranch,
  Additional_Note,
  Expected_Date,
  Deadline_Date,
  connection
) => {
  const query =
    "INSERT INTO purchase_orders (Date, Supplier_idSupplier, PO_Number, Items_Count, Total_Amount, Bill_Discount, Bill_Discount_Type, Discount_Amount, Net_Total, Status, Branch_idBranch, Additional_Note, Expected_Date, Deadline_Date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Date,
        Supplier_idSupplier,
        PO_Number,
        Items_Count,
        Total_Amount,
        Bill_Discount,
        Bill_Discount_Type,
        Discount_Amount,
        Net_Total,
        0, // Status 0 = Pending
        Branch_idBranch,
        Additional_Note || null,
        Expected_Date || null,
        Deadline_Date || null,
      ],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const insertPurchaseOrderItems = (
  Purchase_Order_idPurchase_Order,
  Item_idItem,
  Item_Description,
  Cost,
  Qty_Type,
  Qty,
  Total,
  Discount,
  Sub_Total,
  Branch_idBranch,
  Variation_Id,
  Additional_Note,
  connection
) => {
  const query =
    "INSERT INTO purchase_order_items (Purchase_Order_idPurchase_Order, Item_idItem, Item_Description, Cost, Qty_Type, Qty, Total, Discount, Sub_Total, Branch_idBranch, Variation_Id, Additional_Note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Purchase_Order_idPurchase_Order,
        Item_idItem,
        Item_Description,
        Cost,
        Qty_Type,
        Qty,
        Total,
        Discount,
        Sub_Total,
        Branch_idBranch,
        Variation_Id || null,
        Additional_Note || null,
      ],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const fetchPurchaseOrders = (Branch_idBranch) => {
  const query =
    "SELECT po.*, s.Company_Name, s.Contact_No, s.Contact_No2, CONCAT_WS(', ', NULLIF(s.Address1, ''), NULLIF(s.Address2, ''), NULLIF(s.Address3, '')) AS Address FROM purchase_orders po INNER JOIN supplier s ON po.Supplier_idSupplier = s.idSupplier WHERE po.Branch_idBranch = ? ORDER BY idPurchase_Order DESC";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchPurchaseOrder = (idPurchase_Order) => {
  const query =
    "SELECT po.*, s.Company_Name, s.Contact_No, s.Contact_No2, CONCAT_WS(', ', NULLIF(s.Address1, ''), NULLIF(s.Address2, ''), NULLIF(s.Address3, '')) AS Address FROM purchase_orders po INNER JOIN supplier s ON po.Supplier_idSupplier = s.idSupplier WHERE po.idPurchase_Order = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idPurchase_Order], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchPurchaseOrderItems = (Purchase_Order_idPurchase_Order) => {
  const query = `
    SELECT 
      poi.*, 
      i.Item_Code,
      i.Description AS Item_Name,
      qt.Description AS Unit_Name,
      qt.Description AS Unit
    FROM purchase_order_items poi
    INNER JOIN item i ON poi.Item_idItem = i.idItem 
    LEFT JOIN quantity_type qt ON qt.idQuantity_Type = COALESCE(poi.Qty_Type, i.Qty_Type)
    WHERE Purchase_Order_idPurchase_Order = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Purchase_Order_idPurchase_Order], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const updatePurchaseOrderStatus = (idPurchase_Order, Status, connection) => {
  const query = "UPDATE purchase_orders SET Status = ? WHERE idPurchase_Order = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Status, idPurchase_Order], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const deletePurchaseOrder = (idPurchase_Order, connection) => {
  const query = "DELETE FROM purchase_orders WHERE idPurchase_Order = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idPurchase_Order], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const deletePurchaseOrderItems = (idPurchase_Order, connection) => {
  const query = "DELETE FROM purchase_order_items WHERE Purchase_Order_idPurchase_Order = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idPurchase_Order], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const updatePurchaseOrder = (
  idPurchase_Order,
  Date,
  Supplier_idSupplier,
  PO_Number,
  Items_Count,
  Total_Amount,
  Bill_Discount,
  Bill_Discount_Type,
  Discount_Amount,
  Net_Total,
  Additional_Note,
  Expected_Date,
  Deadline_Date,
  connection
) => {
  const query =
    "UPDATE purchase_orders SET Date=?, Supplier_idSupplier=?, PO_Number=?, Items_Count=?, Total_Amount=?, Bill_Discount=?, Bill_Discount_Type=?, Discount_Amount=?, Net_Total=?, Additional_Note=?, Expected_Date=?, Deadline_Date=? WHERE idPurchase_Order=?";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Date,
        Supplier_idSupplier,
        PO_Number,
        Items_Count,
        Total_Amount,
        Bill_Discount,
        Bill_Discount_Type,
        Discount_Amount,
        Net_Total,
        Additional_Note || null,
        Expected_Date || null,
        Deadline_Date || null,
        idPurchase_Order,
      ],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const getLastPurchaseOrderNumber = (Branch_idBranch, prefix) => {
  const query =
    "SELECT PO_Number FROM purchase_orders WHERE Branch_idBranch = ? AND PO_Number LIKE ? ORDER BY idPurchase_Order DESC LIMIT 1";
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, `${prefix}%`], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const checkDuplicatePONumber = (PO_Number, Branch_idBranch, excludeId = null) => {
  let query = "SELECT idPurchase_Order FROM purchase_orders WHERE PO_Number = ? AND Branch_idBranch = ?";
  const params = [PO_Number, Branch_idBranch];
  if (excludeId) {
    query += " AND idPurchase_Order != ?";
    params.push(excludeId);
  }
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results.length > 0);
    });
  });
};

module.exports = {
  insertPurchaseOrder,
  insertPurchaseOrderItems,
  fetchPurchaseOrders,
  fetchPurchaseOrder,
  fetchPurchaseOrderItems,
  updatePurchaseOrderStatus,
  deletePurchaseOrder,
  deletePurchaseOrderItems,
  updatePurchaseOrder,
  getLastPurchaseOrderNumber,
  checkDuplicatePONumber,
};
