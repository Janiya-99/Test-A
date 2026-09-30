const db = require("../db/db");
const db2 = require("../db/db2");

const fetchInvoices = (from, to, Branch_idBranch, routeId = null) => {
  let query = `SELECT 
      i.*, 
      c.Title, 
      c.displayName,
      COALESCE(c.displayName, 'Walk-in Customer') AS Name
      FROM invoice i 
      LEFT JOIN customer c 
      ON i.Customer_idCustomer = c.idCustomer 
      WHERE DATE(i.Date) BETWEEN ? AND ?
      AND i.Branch_idBranch = ?`;
  const params = [from, to, Branch_idBranch];
  if (routeId) {
    query += ` AND i.Route_idRoute = ?`;
    params.push(routeId);
  }
  query += ` ORDER BY idInvoice DESC`;
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

const fetchInvoiceItems = (idInvoice) => {
  const query = `SELECT 
      ihi.*, 
      COALESCE(i.Description, ihi.Description) as Item_Name,
      i.Cost as item_cost,
      i.Real_Cost as item_real_cost,
      ihimd.supplier_name AS manual_supplier_name,
      ihimd.cost AS manual_cost
      FROM invoice_has_item ihi 
      LEFT JOIN item i ON ihi.Item_idItem = i.idItem 
      LEFT JOIN invoice_has_item_manual_details ihimd ON ihi.ID = ihimd.invoice_has_item_id AND ihi.Branch_idBranch = ihimd.Branch_idBranch
      WHERE ihi.Invoice_idInvoice = ?`;
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

const getitemCostByid = (idItem) => {
  const query = `SELECT 
        Cost, Real_Cost
        FROM item 
        WHERE idItem = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchDamages = (from, to, Branch_idBranch) => {
  const query = `SELECT 
     * 
     FROM damage_note
     WHERE DATE(Date) BETWEEN ? AND ?
     AND Branch_idBranch = ? 
     AND (Reason NOT LIKE 'Supplier Return%' OR Reason IS NULL)
     ORDER BY idDamage_Note DESC`;
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchPurchaseReturns = (from, to, Branch_idBranch) => {
  const query = `SELECT 
     p.*, s.Company_Name 
     FROM purchase_return p 
     INNER JOIN supplier s ON p.Supplier_idSupplier = s.idSupplier 
     WHERE DATE(p.Date) BETWEEN ? AND ? 
     AND p.Branch_idBranch = ? 
     AND p.Status = 1 
     ORDER BY p.idPurchase_Return DESC`;
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchPurchaseReturnTotal = (from, to, Branch_idBranch) => {
  const query = `SELECT 
     COALESCE(SUM(CAST(Total_Amount AS DECIMAL(15,2))), 0) AS Total 
     FROM purchase_return 
     WHERE DATE(Date) BETWEEN ? AND ? 
     AND Branch_idBranch = ? 
     AND Status = 1`;
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchDamageItems = (Damage_Note_idDamage_Note) => {
  const query = `SELECT 
      * 
      FROM damage_note_has_item 
      WHERE Damage_Note_idDamage_Note = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [Damage_Note_idDamage_Note], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchExpenses = (from, to, Branch_idBranch) => {
  const query = `SELECT 
      w.*, 
      wc.Description 
      FROM wallet w 
      INNER JOIN wallet_category wc 
      ON w.Wallet_Category_idWallet_Category = wc.idWallet_Category 
      WHERE DATE(w.Date) BETWEEN ? AND ?
      AND w.Type = ? 
      AND w.Branch_idBranch = ? 
      ORDER BY w.idWallet DESC`;
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, 2, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchExpenseTotal = (from, to, Branch_idBranch) => {
  const query = `SELECT 
      SUM(Amount) AS Total 
      FROM wallet 
      WHERE DATE(Date) BETWEEN ? AND ?
      AND Type = ? 
      AND Branch_idBranch = ?
      AND Status = 1`;
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, 2, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getMonthlySalesSummary = (year, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      MONTH(Date) AS month,
      COUNT(*) AS invoice_count,
      SUM(Discount_Amount + COALESCE((
        SELECT SUM((Rate * Qty) - Total_Amount)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = invoice.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
      ), 0)) AS total_discount,
      SUM(Net_Amount) AS total_net,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = invoice.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND is_bonus_line = 0 
          AND Total_Amount > 0
      ), 0)) AS sold_qty,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = invoice.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND (is_bonus_line = 1 OR Total_Amount = 0)
      ), 0)) AS free_qty
    FROM invoice
    WHERE YEAR(Date) = ? AND Branch_idBranch = ?
  `;
  const params = [year, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += `
    GROUP BY MONTH(Date)
    ORDER BY MONTH(Date)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getDailySalesSummary = (year, month, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      DAY(Date) AS day,
      COUNT(*) AS invoice_count,
      SUM(Discount_Amount + COALESCE((
        SELECT SUM((Rate * Qty) - Total_Amount)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = invoice.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
      ), 0)) AS total_discount,
      SUM(Net_Amount) AS total_net,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = invoice.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND is_bonus_line = 0 
          AND Total_Amount > 0
      ), 0)) AS sold_qty,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = invoice.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND (is_bonus_line = 1 OR Total_Amount = 0)
      ), 0)) AS free_qty
    FROM invoice
    WHERE YEAR(Date) = ? AND MONTH(Date) = ? AND Branch_idBranch = ?
  `;
  const params = [year, month, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += `
    GROUP BY DAY(Date)
    ORDER BY DAY(Date)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchSerialNumbersReport = (branchId, limit, offset, search, status) => {
  let query = `
    SELECT 
      sn.ID, 
      sn.Serial_No, 
      sn.Qty, 
      sn.Expiry_Date,
      i.Description AS Item_Name,
      i.Item_Code,
      iv.description AS Variation_Name
    FROM item_has_serial_no sn
    INNER JOIN item i ON sn.Item_idItem = i.idItem
    LEFT JOIN item_variations iv ON sn.Variation_Id = iv.id
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE sn.Branch_idBranch = ?
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;
  const params = [branchId];

  if (search) {
    query += ` AND (sn.Serial_No LIKE ? OR i.Description LIKE ? OR i.Item_Code LIKE ? OR iv.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (status === "available") {
    query += ` AND sn.Qty = 1`;
  } else if (status === "sold") {
    query += ` AND sn.Qty = 0`;
  } else if (status === "returned") {
    query += ` AND sn.Qty = 2`;
  }

  query += ` ORDER BY sn.ID DESC`;

  if (limit !== undefined && offset !== undefined) {
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
  }

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const countSerialNumbersReport = (branchId, search, status) => {
  let query = `
    SELECT COUNT(*) AS total
    FROM item_has_serial_no sn
    INNER JOIN item i ON sn.Item_idItem = i.idItem
    LEFT JOIN item_variations iv ON sn.Variation_Id = iv.id
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE sn.Branch_idBranch = ?
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;
  const params = [branchId];

  if (search) {
    query += ` AND (sn.Serial_No LIKE ? OR i.Description LIKE ? OR i.Item_Code LIKE ? OR iv.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (status === "available") {
    query += ` AND sn.Qty = 1`;
  } else if (status === "sold") {
    query += ` AND sn.Qty = 0`;
  } else if (status === "returned") {
    query += ` AND sn.Qty = 2`;
  }

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(results[0].total);
    });
  });
};

const getSerialNumberDetails = async (serialId, branchId) => {
  // 1. Fetch main serial and product/variation info
  const serialQuery = `
    SELECT 
      sn.ID, 
      sn.Serial_No, 
      sn.Qty, 
      sn.Expiry_Date,
      sn.GRN_idGRN,
      i.idItem,
      i.Description AS Item_Name,
      i.Item_Code,
      iv.id AS Variation_Id,
      iv.description AS Variation_Name
    FROM item_has_serial_no sn
    INNER JOIN item i ON sn.Item_idItem = i.idItem
    LEFT JOIN item_variations iv ON sn.Variation_Id = iv.id
    LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
    WHERE sn.ID = ? AND sn.Branch_idBranch = ?
      AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
  `;
  const serials = await new Promise((resolve, reject) => {
    db.query(serialQuery, [serialId, branchId], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });

  if (serials.length === 0) return null;
  const serial = serials[0];

  // 2. Fetch GRN & Supplier details if GRN_idGRN exists
  let grnDetails = null;
  if (serial.GRN_idGRN) {
    const grnQuery = `
      SELECT 
        g.idGRN,
        g.Bill_no AS GRN_Number,
        g.Date AS GRN_Date,
        s.idSupplier,
        s.Company_Name AS Supplier_Name,
        s.Contact_No AS Supplier_Contact
      FROM grn g
      LEFT JOIN supplier s ON g.Supplier_idSupplier = s.idSupplier
      WHERE g.idGRN = ?
    `;
    const grns = await new Promise((resolve, reject) => {
      db.query(grnQuery, [serial.GRN_idGRN], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
    if (grns.length > 0) {
      grnDetails = grns[0];
    }
  }

  // 3. Fetch Sale (Invoice/POS) and Customer details if sold (Qty = 0)
  let saleDetails = null;
  if (serial.Qty === 0) {
    // Try Invoice first
    const invoiceQuery = `
      SELECT 
        inv.idInvoice,
        inv.Invoice_Number,
        inv.Date AS Sale_Date,
        inv.Net_Amount,
        cus.idCustomer,
        cus.Title AS Customer_Title,
        cus.displayName AS Customer_Name,
        cus.phoneNumber AS Customer_Contact
      FROM invoice_has_item ihi
      INNER JOIN invoice inv ON ihi.Invoice_idInvoice = inv.idInvoice
      LEFT JOIN customer cus ON inv.Customer_idCustomer = cus.idCustomer
      WHERE ihi.Serial_No_Id = ?
      ORDER BY inv.idInvoice DESC
      LIMIT 1
    `;
    const invoices = await new Promise((resolve, reject) => {
      db.query(invoiceQuery, [serialId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    if (invoices.length > 0) {
      saleDetails = {
        type: "Invoice",
        id: invoices[0].idInvoice,
        number: invoices[0].Invoice_Number,
        date: invoices[0].Sale_Date,
        netAmount: invoices[0].Net_Amount,
        customerId: invoices[0].idCustomer,
        customerTitle: invoices[0].Customer_Title,
        customerName: invoices[0].Customer_Name,
        customerContact: invoices[0].Customer_Contact
      };
    } else {
      // Try POS if not found in Invoice
      const posQuery = `
        SELECT 
          p.idPos,
          p.Date_Time AS Sale_Date,
          p.Net_Amount,
          cus.idCustomer,
          cus.Title AS Customer_Title,
          cus.displayName AS Customer_Name,
          cus.phoneNumber AS Customer_Contact
        FROM pos_items pi
        INNER JOIN pos p ON pi.Pos_idPos = p.idPos
        LEFT JOIN customer cus ON p.Customer_idCustomer = cus.idCustomer
        WHERE pi.Serial_No_Id = ?
        ORDER BY p.idPos DESC
        LIMIT 1
      `;
      const posSales = await new Promise((resolve, reject) => {
        db.query(posQuery, [serialId], (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      if (posSales[0]) {
        saleDetails = {
          type: "POS",
          id: posSales[0].idPos,
          number: `POS-${posSales[0].idPos}`,
          date: posSales[0].Sale_Date,
          netAmount: posSales[0].Net_Amount,
          customerId: posSales[0].idCustomer,
          customerTitle: posSales[0].Customer_Title,
          customerName: posSales[0].Customer_Name,
          customerContact: posSales[0].Customer_Contact
        };
      }
    }
  }

  let returnDetails = null;
  if (serial.Qty === 2) {
    const returnQuery = `
      SELECT 
        pr.idPurchase_Return,
        pr.Date AS Return_Date,
        pr.Reason,
        s.idSupplier,
        s.Company_Name AS Supplier_Name,
        s.Contact_No AS Supplier_Contact
      FROM purchase_return_has_item_serial_no prs
      INNER JOIN purchase_return pr ON prs.Purchase_Return_idPurchase_Return = pr.idPurchase_Return
      LEFT JOIN supplier s ON pr.Supplier_idSupplier = s.idSupplier
      WHERE prs.Item_Serial_No_id = ?
      ORDER BY pr.idPurchase_Return DESC
      LIMIT 1
    `;
    const returns = await new Promise((resolve, reject) => {
      db.query(returnQuery, [serialId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
    if (returns.length > 0) {
      returnDetails = {
        id: returns[0].idPurchase_Return,
        number: `PR-${returns[0].idPurchase_Return}`,
        date: returns[0].Return_Date,
        reason: returns[0].Reason,
        supplierId: returns[0].idSupplier,
        supplierName: returns[0].Supplier_Name,
        supplierContact: returns[0].Supplier_Contact
      };
    }
  }

  return {
    serial,
    grnDetails,
    saleDetails,
    returnDetails
  };
};

const fetchWarehouseStockReport = (branchId, warehouseId, categoryId, search, warehouseType, responsibleUserId) => {
  let query = `
    SELECT
      ib.batch_id AS id,
      ib.batch_code AS batch_code,
      ib.qty AS quantity,
      ib.cost AS cost,
      ib.rate AS rate,
      ib.total_cost AS total_cost,
      ib.expiry_date AS expiry_date,
      ib.grn_id AS grn_id,
      i.idItem AS itemId,
      i.Item_Code AS item_code,
      IF(ib.variation_id IS NOT NULL AND iv.description IS NOT NULL,
         CONCAT(i.Description, ' - ', iv.description),
         i.Description) AS item_description,
      ic.Description AS item_category,
      ic.idItem_Category AS item_category_id,
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.warehouse_type AS warehouse_type,
      w.vehicle_number AS vehicle_number,
      w.responsible_user_id AS responsible_user_id,
      NULLIF(TRIM(CONCAT(COALESCE(ru.First_Name,''), ' ', COALESCE(ru.Last_Name,''))), '') AS responsible_person_name,
      ru.Contact_No_01 AS responsible_phone,
      z.name AS zone_name,
      r.name AS rack_name,
      c.name AS cell_name,
      qt.Description AS quantity_type
    FROM item_batch ib
    INNER JOIN item i ON ib.item_id = i.idItem
    LEFT JOIN item_category ic ON i.Item_Category_idItem_Category = ic.idItem_Category
    LEFT JOIN warehouses w ON ib.warehouse_id = w.id
    LEFT JOIN asipbook_account_center.asipiya_user ru ON w.responsible_user_id = ru.idAsipiya_User
    LEFT JOIN zones z ON ib.warehouse_zone = z.id
    LEFT JOIN racks r ON ib.warehouse_rack_id = r.id
    LEFT JOIN cells c ON ib.warehouse_rack_cell = c.id
    LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type
    LEFT JOIN item_variations iv ON ib.variation_id = iv.id
    LEFT JOIN grn g ON ib.grn_id = g.idGRN
    WHERE w.branch_id = ?
      AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
  `;

  const params = [branchId];

  if (warehouseId && warehouseId !== "all") {
    query += ` AND ib.warehouse_id = ?`;
    params.push(parseInt(warehouseId));
  }

  if (categoryId && categoryId !== "all") {
    query += ` AND i.Item_Category_idItem_Category = ?`;
    params.push(parseInt(categoryId));
  }

  if (search) {
    query += ` AND (i.Description LIKE ? OR i.Item_Code LIKE ? OR ib.batch_code LIKE ? OR iv.description LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (warehouseType && warehouseType !== "all") {
    query += ` AND w.warehouse_type = ?`;
    params.push(warehouseType);
  }

  if (responsibleUserId && responsibleUserId !== "all") {
    query += ` AND w.responsible_user_id = ?`;
    params.push(parseInt(responsibleUserId));
  }

  query += ` ORDER BY w.name ASC, i.Description ASC, ib.batch_id DESC`;

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchPayments = (from, to, Branch_idBranch) => {
  const query = `SELECT 
      ccl.*, 
      c.Title, 
      c.displayName,
      COALESCE(c.displayName, 'Walk-in Customer') AS Name
      FROM customer_credit_log ccl 
      LEFT JOIN customer c 
      ON ccl.Customer_idCustomer = c.idCustomer 
      WHERE DATE(ccl.Date_Time) BETWEEN ? AND ?
      AND ccl.Branch_idBranch = ? 
      AND ccl.Type = 'PAYMENT'
      ORDER BY ccl.idCustomer_Credit_Log DESC`;
  return new Promise((resolve, reject) => {
    db.query(query, [from, to, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchInvoiceById = (idInvoice) => {
  const query = `SELECT 
      i.*, 
      c.Title, 
      c.displayName,
      COALESCE(c.displayName, 'Walk-in Customer') AS Name
      FROM invoice i 
      LEFT JOIN customer c 
      ON i.Customer_idCustomer = c.idCustomer 
      WHERE i.idInvoice = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [idInvoice], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length ? JSON.parse(JSON.stringify(results[0])) : null);
      }
    });
  });
};

const getDailySalesSummaryCashBasis = (year, month, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      DAY(ccl.Date_Time) AS day,
      COUNT(DISTINCT ccl.Type_Id) AS invoice_count,
      SUM(COALESCE(
        IF(COALESCE(i.Net_Amount, 0) > 0, ccl.Debit / i.Net_Amount, 0) * (
          i.Discount_Amount + COALESCE((
            SELECT SUM((Rate * Qty) - Total_Amount)
            FROM invoice_has_item
            WHERE Invoice_idInvoice = i.idInvoice 
              AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          ), 0)
        ), 
        0
      )) AS total_discount,
      SUM(ccl.Debit) AS total_net,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = i.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND is_bonus_line = 0 
          AND Total_Amount > 0
      ), 0)) AS sold_qty,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = i.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND (is_bonus_line = 1 OR Total_Amount = 0)
      ), 0)) AS free_qty
    FROM customer_credit_log ccl
    LEFT JOIN invoice i ON ccl.Type_Id = i.idInvoice
    WHERE YEAR(ccl.Date_Time) = ? AND MONTH(ccl.Date_Time) = ? AND ccl.Branch_idBranch = ? AND ccl.Type = 'PAYMENT'
  `;
  const params = [year, month, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND i.Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += `
    GROUP BY DAY(ccl.Date_Time)
    ORDER BY DAY(ccl.Date_Time)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getMonthlySalesSummaryCashBasis = (year, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      MONTH(ccl.Date_Time) AS month,
      COUNT(DISTINCT ccl.Type_Id) AS invoice_count,
      SUM(COALESCE(
        IF(COALESCE(i.Net_Amount, 0) > 0, ccl.Debit / i.Net_Amount, 0) * (
          i.Discount_Amount + COALESCE((
            SELECT SUM((Rate * Qty) - Total_Amount)
            FROM invoice_has_item
            WHERE Invoice_idInvoice = i.idInvoice 
              AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          ), 0)
        ), 
        0
      )) AS total_discount,
      SUM(ccl.Debit) AS total_net,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = i.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND is_bonus_line = 0 
          AND Total_Amount > 0
      ), 0)) AS sold_qty,
      SUM(COALESCE((
        SELECT SUM(Qty)
        FROM invoice_has_item
        WHERE Invoice_idInvoice = i.idInvoice 
          AND (Discount_Type IS NULL OR Discount_Type != 'RTN')
          AND (is_bonus_line = 1 OR Total_Amount = 0)
      ), 0)) AS free_qty
    FROM customer_credit_log ccl
    LEFT JOIN invoice i ON ccl.Type_Id = i.idInvoice
    WHERE YEAR(ccl.Date_Time) = ? AND ccl.Branch_idBranch = ? AND ccl.Type = 'PAYMENT'
  `;
  const params = [year, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND i.Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += `
    GROUP BY MONTH(ccl.Date_Time)
    ORDER BY MONTH(ccl.Date_Time)
  `;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getDateRangeSalesSummary = (from, to, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      i.idInvoice,
      i.Invoice_Number,
      i.Date,
      COALESCE(c.displayName, 'Walk-in Customer') AS customerName,
      i.Discount_Amount,
      i.Net_Amount,
      emp.Employee_Name AS salesmanName
    FROM invoice i
    LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
    LEFT JOIN employee emp ON i.Employee_idEmployee = emp.idEmployee
    WHERE DATE(i.Date) BETWEEN ? AND ? AND i.Branch_idBranch = ?
  `;
  const params = [from, to, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND i.Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += " ORDER BY i.Date DESC, i.idInvoice DESC";
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getDateRangeReturnsSummary = (from, to, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      cr.idCustomer_Return,
      cr.Return_Receipt_No,
      cr.Date,
      COALESCE(c.displayName, 'Walk-in Customer') AS customerName,
      cr.Total_Amount,
      emp.Employee_Name AS salesmanName
    FROM customer_return cr
    LEFT JOIN customer c ON cr.Customer_idCustomer = c.idCustomer
    LEFT JOIN employee emp ON cr.Employee_idEmployee = emp.idEmployee
    WHERE DATE(cr.Date) BETWEEN ? AND ? AND cr.Branch_idBranch = ? AND cr.Status = 1
  `;
  const params = [from, to, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND cr.Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += " ORDER BY cr.Date DESC, cr.idCustomer_Return DESC";
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getVariationCostById = (idVariation) => {
  const query = `SELECT 
        cost AS Cost, cost AS Real_Cost
        FROM item_variations 
        WHERE id = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [idVariation], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getManufacturingReportData = async (from, to, branchId) => {
  const jobsQuery = `
    SELECT mj.*
    FROM manufacturing_jobs mj
    WHERE DATE(mj.job_date) BETWEEN ? AND ? AND mj.branch_id = ?
    ORDER BY mj.job_date DESC, mj.id DESC
  `;
  const itemsQuery = `
    SELECT mji.*, i.Description, i.Item_Code, iv.description as variation_name, ic.Description as category_name
    FROM manufacturing_job_items mji
    LEFT JOIN item i ON mji.item_id = i.idItem
    LEFT JOIN item_variations iv ON mji.variation_id = iv.id
    LEFT JOIN item_category ic ON i.Item_Category_idItem_Category = ic.idItem_Category
    WHERE mji.job_id IN (
      SELECT id FROM manufacturing_jobs 
      WHERE DATE(job_date) BETWEEN ? AND ? AND branch_id = ?
    )
  `;
  const finalProductsQuery = `
    SELECT mjfp.*, i.Description, i.Item_Code, iv.description as variation_name, ic.Description as category_name
    FROM manufacturing_job_final_products mjfp
    LEFT JOIN item i ON mjfp.item_id = i.idItem
    LEFT JOIN item_variations iv ON mjfp.variation_id = iv.id
    LEFT JOIN item_category ic ON i.Item_Category_idItem_Category = ic.idItem_Category
    WHERE mjfp.job_id IN (
      SELECT id FROM manufacturing_jobs 
      WHERE DATE(job_date) BETWEEN ? AND ? AND branch_id = ?
    )
  `;

  const params = [from, to, branchId];

  try {
    const [jobs, items, finalProducts] = await Promise.all([
      new Promise((resolve, reject) => {
        db.query(jobsQuery, params, (err, res) => (err ? reject(err) : resolve(JSON.parse(JSON.stringify(res)))));
      }),
      new Promise((resolve, reject) => {
        db.query(itemsQuery, params, (err, res) => (err ? reject(err) : resolve(JSON.parse(JSON.stringify(res)))));
      }),
      new Promise((resolve, reject) => {
        db.query(finalProductsQuery, params, (err, res) => (err ? reject(err) : resolve(JSON.parse(JSON.stringify(res)))));
      })
    ]);

    // Map items and final products to their respective jobs
    return jobs.map(job => {
      const jobItems = items.filter(item => item.job_id === job.id);
      const jobFinalProducts = finalProducts.filter(fp => fp.job_id === job.id);
      return {
        ...job,
        raw_materials: jobItems,
        final_products: jobFinalProducts
      };
    });
  } catch (error) {
    throw error;
  }
};

const getDailySalesBreakdown = (year, month, day, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      COALESCE(Payment_Method, 'Unspecified') AS payment_method,
      COUNT(*) AS invoice_count,
      SUM(Net_Amount) AS total_net,
      SUM(Paid_Amount) AS total_paid
    FROM invoice
    WHERE YEAR(Date) = ? AND MONTH(Date) = ? AND DAY(Date) = ? AND Branch_idBranch = ?
  `;
  const params = [year, month, day, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += `
    GROUP BY Payment_Method
    ORDER BY Payment_Method
  `;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getDailySalesBreakdownCashBasis = (year, month, day, branchId, salesmanId = null) => {
  let query = `
    SELECT 
      COALESCE(i.Payment_Method, 'Unspecified') AS payment_method,
      COUNT(DISTINCT ccl.Type_Id) AS invoice_count,
      SUM(ccl.Debit) AS total_net,
      SUM(ccl.Debit) AS total_paid
    FROM customer_credit_log ccl
    LEFT JOIN invoice i ON ccl.Type_Id = i.idInvoice
    WHERE YEAR(ccl.Date_Time) = ? AND MONTH(ccl.Date_Time) = ? AND DAY(ccl.Date_Time) = ?
      AND ccl.Branch_idBranch = ? AND ccl.Type = 'PAYMENT'
  `;
  const params = [year, month, day, branchId];
  if (salesmanId && salesmanId !== "all") {
    query += ` AND i.Employee_idEmployee = ?`;
    params.push(Number(salesmanId));
  }
  query += `
    GROUP BY i.Payment_Method
    ORDER BY i.Payment_Method
  `;
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchGrnReportData = (from, to, Branch_idBranch) => {
  const query = `
    SELECT 
      g.idGRN,
      g.Date,
      g.Bill_no,
      g.grn_no,
      g.Status,
      s.idSupplier,
      s.Company_Name,
      s.Agent_Name,
      s.Contact_No,
      ghi.Item_idItem,
      ghi.Item_Description,
      ghi.Cost,
      ghi.Qty,
      ghi.Total,
      ghi.Discount,
      ghi.Sub_Total,
      ghi.Bonus_Qty,
      i.Item_Code,
      i.Description as Catalog_Item_Name,
      (SELECT GROUP_CONCAT(sn.Serial_No SEPARATOR ', ') 
       FROM item_has_serial_no sn 
       WHERE sn.GRN_idGRN = g.idGRN AND sn.Item_idItem = ghi.Item_idItem) as Serial_Numbers
    FROM grn g
    INNER JOIN supplier s ON g.Supplier_idSupplier = s.idSupplier
    INNER JOIN grn_has_item ghi ON g.idGRN = ghi.GRN_idGRN
    LEFT JOIN item i ON ghi.Item_idItem = i.idItem
    WHERE g.Branch_idBranch = ? AND g.Date BETWEEN ? AND ?
    ORDER BY g.Date DESC, g.idGRN DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, from, to], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchPurchaseOrderReportData = (from, to, Branch_idBranch, Supplier_idSupplier = null) => {
  let query = `
    SELECT 
      po.idPurchase_Order,
      po.Date,
      po.PO_Number,
      po.Items_Count,
      po.Total_Amount,
      po.Bill_Discount,
      po.Bill_Discount_Type,
      po.Discount_Amount,
      po.Net_Total,
      po.Status,
      po.Additional_Note,
      po.Expected_Date,
      po.Deadline_Date,
      s.idSupplier,
      s.Company_Name,
      s.Agent_Name,
      s.Contact_No
    FROM purchase_orders po
    INNER JOIN supplier s ON po.Supplier_idSupplier = s.idSupplier
    WHERE po.Branch_idBranch = ? AND po.Date BETWEEN ? AND ?
  `;
  const params = [Branch_idBranch, from, to];
  if (Supplier_idSupplier && Supplier_idSupplier !== "all" && Supplier_idSupplier !== "null") {
    query += ` AND po.Supplier_idSupplier = ?`;
    params.push(Number(Supplier_idSupplier));
  }
  query += ` ORDER BY po.Date DESC, po.idPurchase_Order DESC`;

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchBrandWiseSalesReportData = (from, to, Branch_idBranch) => {
  const query = `
    SELECT 
      COALESCE(NULLIF(i.Brand_Name, ''), NULLIF(i.product_brand, ''), 'No Brand') AS Brand,
      SUM(CAST(ihi.Qty AS DECIMAL(15,2))) AS Selling_Qty,
      SUM(CAST(ihi.Total_Amount AS DECIMAL(15,2))) AS Total_Selling_Amount,
      SUM(CAST(ihi.Qty AS DECIMAL(15,2)) * CAST(COALESCE(i.Cost, 0) AS DECIMAL(15,2))) AS Total_Cost_Amount
    FROM invoice_has_item ihi
    INNER JOIN item i ON ihi.Item_idItem = i.idItem
    INNER JOIN invoice inv ON ihi.Invoice_idInvoice = inv.idInvoice
    WHERE inv.Branch_idBranch = ? AND inv.Date BETWEEN ? AND ?
    GROUP BY Brand
    ORDER BY Total_Selling_Amount DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, from, to], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getDailyItemWiseSalesReportData = (date, branchId, salesmanId = null, categoryId = null) => {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT 
        ihi.Item_idItem,
        COALESCE(item.Item_Code, 'N/A') AS item_code,
        COALESCE(item.barcode, '') AS barcode,
        COALESCE(item.Description, ihi.Description) AS item_name,
        COALESCE(cat.Description, 'Uncategorized') AS category_name,
        COALESCE(item.Brand_Name, '') AS brand_name,
        SUM(CASE WHEN ihi.Discount_Type = 'RTN' THEN -CAST(ihi.Qty AS DECIMAL(10,2)) ELSE CAST(ihi.Qty AS DECIMAL(10,2)) END) AS total_qty_sold,
        SUM(CAST(COALESCE(ihi.Discount, 0) AS DECIMAL(15,2))) AS total_discount,
        SUM(CASE WHEN ihi.Discount_Type = 'RTN' THEN -CAST(ihi.Total_Amount AS DECIMAL(15,2)) ELSE CAST(ihi.Total_Amount AS DECIMAL(15,2)) END) AS total_sales_amount,
        COUNT(DISTINCT i.idInvoice) AS invoice_count
      FROM invoice_has_item ihi
      JOIN invoice i ON ihi.Invoice_idInvoice = i.idInvoice
      LEFT JOIN item ON ihi.Item_idItem = item.idItem
      LEFT JOIN item_category cat ON item.Item_Category_idItem_Category = cat.idItem_Category
      WHERE DATE(i.Date) = ? AND i.Branch_idBranch = ?
    `;

    const params = [date, branchId];

    if (salesmanId && salesmanId !== "all") {
      query += ` AND i.Employee_idEmployee = ?`;
      params.push(Number(salesmanId));
    }

    if (categoryId && categoryId !== "all") {
      query += ` AND item.Item_Category_idItem_Category = ?`;
      params.push(Number(categoryId));
    }

    query += `
      GROUP BY ihi.Item_idItem, item_name, item_code, barcode, category_name, brand_name
      ORDER BY total_qty_sold DESC
    `;

    db.query(query, params, (err, results) => {
      if (err) return reject(err);

      const items = (results || []).map((row) => {
        const qty = parseFloat(row.total_qty_sold || 0);
        const sales = parseFloat(row.total_sales_amount || 0);
        const discount = parseFloat(row.total_discount || 0);
        const avgRate = qty > 0 ? Math.round((sales / qty) * 100) / 100 : 0;

        return {
          ...row,
          total_qty_sold: qty,
          total_discount: discount,
          total_sales_amount: sales,
          invoice_count: parseInt(row.invoice_count || 0),
          avg_rate: avgRate,
        };
      });

      let total_items = items.length;
      let total_qty = 0;
      let total_revenue = 0;
      let top_item = null;

      items.forEach((item) => {
        total_qty += item.total_qty_sold;
        total_revenue += item.total_sales_amount;

        if (!top_item || item.total_qty_sold > top_item.total_qty_sold) {
          top_item = item;
        }
      });

      resolve({
        date,
        items,
        summary: {
          total_items,
          total_qty,
          total_revenue,
          top_item: top_item
            ? { name: top_item.item_name, qty: top_item.total_qty_sold, revenue: top_item.total_sales_amount }
            : null,
        },
      });
    });
  });
};

const getCashierSalesSummary = (from, to, branchId, cashierId = null) => {
  let query = `
    SELECT
      i.Employee_idEmployee AS cashierRefId,
      COUNT(*) AS invoiceCount,
      SUM(CASE WHEN i.Payment_Method = 'cash' THEN i.Paid_Amount WHEN i.Payment_Method = 'split' THEN COALESCE(sp.cash_amt, 0) WHEN i.Payment_Method = 'mixed' THEN COALESCE(p.Cash_Payment, 0) ELSE 0 END) AS cashTotal,
      SUM(CASE WHEN i.Payment_Method = 'card' THEN i.Paid_Amount WHEN i.Payment_Method = 'split' THEN COALESCE(sp.card_amt, 0) WHEN i.Payment_Method = 'mixed' THEN COALESCE(p.Card_Payment, 0) ELSE 0 END) AS cardTotal,
      SUM(CASE WHEN i.Payment_Method = 'cheque' THEN i.Paid_Amount WHEN i.Payment_Method = 'split' THEN COALESCE(sp.cheque_amt, 0) ELSE 0 END) AS chequeTotal,
      SUM(CASE WHEN i.Payment_Method IN ('bank','online') THEN i.Paid_Amount WHEN i.Payment_Method = 'split' THEN COALESCE(sp.bank_amt, 0) ELSE 0 END) AS bankTotal,
      SUM(CASE WHEN i.Payment_Method IN ('cod','koko','mintpay') THEN i.Paid_Amount WHEN i.Payment_Method = 'split' THEN COALESCE(sp.other_amt, 0) ELSE 0 END) AS otherTotal,
      SUM(i.Balance_Amount) AS creditBalanceTotal
    FROM invoice i
    LEFT JOIN (
      SELECT Type_Id,
        SUM(CASE WHEN Payment_Method = 'cash' THEN Debit ELSE 0 END) AS cash_amt,
        SUM(CASE WHEN Payment_Method = 'card' THEN Debit ELSE 0 END) AS card_amt,
        SUM(CASE WHEN Payment_Method = 'cheque' THEN Debit ELSE 0 END) AS cheque_amt,
        SUM(CASE WHEN Payment_Method IN ('bank','online') THEN Debit ELSE 0 END) AS bank_amt,
        SUM(CASE WHEN Payment_Method IN ('cod','koko','mintpay') THEN Debit ELSE 0 END) AS other_amt
      FROM customer_credit_log
      WHERE Type = 'PAYMENT'
      GROUP BY Type_Id
    ) sp ON sp.Type_Id = CAST(i.idInvoice AS CHAR)
    LEFT JOIN pos p ON p.Invoice_Number = i.Invoice_Number AND p.Branch_idBranch = i.Branch_idBranch
    WHERE DATE(i.Date) BETWEEN ? AND ? AND i.Branch_idBranch = ?
  `;
  const params = [from, to, branchId];
  if (cashierId && cashierId !== "all") {
    query += ` AND i.Employee_idEmployee = ?`;
    params.push(Number(cashierId));
  }
  query += " GROUP BY i.Employee_idEmployee ORDER BY i.Employee_idEmployee";
  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getCashierIdentities = (cashierIds) => {
  if (!cashierIds || cashierIds.length === 0) return Promise.resolve([]);
  const query = `
    SELECT idAsipiya_User, Email, First_Name, Last_Name
    FROM asipiya_user
    WHERE idAsipiya_User IN (?)
  `;
  return new Promise((resolve, reject) => {
    db2.query(query, [cashierIds], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const getBranchCashiers = (branchId) => {
  const query = `
    SELECT au.idAsipiya_User, au.Email, au.First_Name, au.Last_Name
    FROM asipiya_user au
    JOIN user_has_branch uhb ON au.idAsipiya_User = uhb.User_idUser
    WHERE uhb.Branch_idBranch = ? AND au.Status = '1'
    ORDER BY au.First_Name, au.Last_Name
  `;
  return new Promise((resolve, reject) => {
    db2.query(query, [branchId], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

module.exports = {
  fetchPayments,
  fetchInvoiceById,
  fetchInvoices,
  fetchInvoiceItems,
  getitemCostByid,
  getVariationCostById,
  fetchDamages,
  fetchDamageItems,
  fetchExpenses,
  fetchExpenseTotal,
  getMonthlySalesSummary,
  getDailySalesSummary,
  getDailySalesSummaryCashBasis,
  getMonthlySalesSummaryCashBasis,
  fetchSerialNumbersReport,
  countSerialNumbersReport,
  getSerialNumberDetails,
  fetchWarehouseStockReport,
  getDateRangeSalesSummary,
  getDateRangeReturnsSummary,
  getManufacturingReportData,
  getDailySalesBreakdown,
  getDailySalesBreakdownCashBasis,
  fetchGrnReportData,
  fetchPurchaseOrderReportData,
  fetchBrandWiseSalesReportData,
  getDailyItemWiseSalesReportData,
  fetchPurchaseReturns,
  fetchPurchaseReturnTotal,
  getCashierSalesSummary,
  getCashierIdentities,
  getBranchCashiers,
};



