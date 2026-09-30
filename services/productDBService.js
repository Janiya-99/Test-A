const db = require("../db/db");
const db2 = require("../db/db2");

const insertProduct = (
  Type,
  Item_Category_idItem_Category,
  Item_Category_idItem_SubCategory,
  Zone_IdZone,
  Item_Code,
  Description,
  Long_Description,
  Item_Description,
  Brand_Name,
  Alert_Qty,
  Cost,
  Rate,
  Qty_Type,
  Qty,
  Branch_idBranch,
  image,
  productSKU,
  productPLU,
  low_stock_level,
  target_stock,
  Expired_Date,
  product_brand,
  Item_Has_Serial,
  barcode,
  discount_min,
  discount_max,
  discount_type,
  is_visible = 1,
  connection, // Added connection parameter
) => {
  const query = `
    INSERT INTO item
    (Type, Item_Category_idItem_Category, Item_Category_idItem_SubCategory, Zone_IdZone, Item_Code, Description, Long_Description, Item_Description, Brand_Name, Alert_Qty, Cost, Real_Cost, Rate, Qty_Type, Qty, Status, Branch_idBranch, image, productSKU, productPLU, low_stock_level, target_stock, Expired_Date, product_brand, Item_Has_Serial, barcode, discount_min, discount_max, discount_type, is_visible)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Type,
        Item_Category_idItem_Category,
        Item_Category_idItem_SubCategory,
        Zone_IdZone,
        Item_Code,
        Description,
        Long_Description,
        Item_Description,
        Brand_Name,
        Alert_Qty,
        Cost,
        Cost, // Real_Cost = same as Cost
        Rate,
        Qty_Type,
        Qty,
        1, // Status default (active)
        Branch_idBranch,
        image ||
          "https://img.freepik.com/premium-vector/picture-icon-isolated-white-background-vector-illustration_736051-240.jpg?semt=ais_hybrid&w=740&q=80", // Fallback default image
        productSKU,
        productPLU,
        low_stock_level,
        target_stock || 0,
        Expired_Date,
        product_brand,
        Item_Has_Serial,
        barcode, // 👈 Saving barcode
        discount_min || 0,
        discount_max || 0,
        discount_type || 'percentage',
        is_visible !== undefined ? (is_visible ? 1 : 0) : 1,
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

const insertExcelProduct = (
  Type,
  Item_Category_idItem_Category,
  Item_Category_idItem_SubCategory,
  Zone_IdZone,
  Item_Code,
  Description,
  Long_Description,
  Item_Description,
  Brand_Name,
  Alert_Qty,
  Cost,
  Rate,
  Qty_Type,
  Branch_idBranch,
  image,
  productSKU,
  productPLU,
  low_stock_level,
  target_stock,
  Expired_Date,
  product_brand,
  Item_Has_Serial,
  barcode,
  Opening_Qty,
  connection, // Added connection parameter
) => {
  const query = `
    INSERT INTO item
    (Type, Item_Category_idItem_Category, Item_Category_idItem_SubCategory, Zone_IdZone, Item_Code, productSKU, productPLU, low_stock_level, target_stock, Description, Long_Description, Item_Description, Cost, Real_Cost, Rate, Qty_Type, Qty, Status, Alert_Qty, Brand_Name, Branch_idBranch, Expired_Date, product_brand, Item_Has_Serial, image, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Type,
        Item_Category_idItem_Category,
        Item_Category_idItem_SubCategory,
        Zone_IdZone, // may be null
        Item_Code, // varchar(45)
        productSKU, // varchar(100)
        productPLU, // varchar(100)
        low_stock_level, // varchar(100)
        target_stock || 0, // decimal(10,2)
        Description, // text
        Long_Description, // text
        Item_Description, // text
        Cost, // varchar(45)
        Cost, // Real_Cost = same as Cost
        Rate, // varchar(45)
        Qty_Type, // int
        Opening_Qty || "0", // Qty (varchar(45))
        "1", // Status (varchar(45)) default active
        Alert_Qty || 0, // int NOT NULL default 0
        Brand_Name, // varchar(255)
        Branch_idBranch, // int NOT NULL
        Expired_Date, // int(3)
        product_brand, // varchar(10)
        Item_Has_Serial, // int
        image ||
          "https://img.freepik.com/premium-vector/picture-icon-isolated-white-background-vector-illustration_736051-240.jpg?semt=ais_hybrid&w=740&q=80",
        barcode, // varchar(500)
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

const checkProductDescription = (Description, Branch_idBranch) => {
  const query =
    "SELECT * FROM item WHERE Description = ? AND Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Description, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length > 0);
      }
    });
  });
};

const SignupinsertCategory = (
  Description,
  Branch_idBranch,
  Type,
  connection,
) => {
  const query =
    "INSERT INTO item_category (Description, Branch_idBranch, Type) VALUES (?, ?, ?)";

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Description, Branch_idBranch, Type],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve({ insertId: results.insertId }); // ✅ Return only insertId
        }
      },
    );
  });
};

const insertCategory = (Description, Branch_idBranch, Type, connection) => {
  const categoryQuery =
    "INSERT INTO item_category (Description, Branch_idBranch, Type) VALUES (?, ?, ?)";

  const subCategoryQuery =
    "INSERT INTO item_sub_category (Description, Branch_idBranch, Item_Category_idItem_Category) VALUES (?, ?, ?)";

  return new Promise((resolve, reject) => {
    (connection || db).query(
      categoryQuery,
      [Description, Branch_idBranch, Type],
      (err, categoryResult) => {
        if (err) {
          return reject(err);
        }

        const newCategoryId = categoryResult.insertId;

        (connection || db).query(
          subCategoryQuery,
          ["Default", Branch_idBranch, newCategoryId],
          (subErr, subResult) => {
            if (subErr) {
              return reject(subErr);
            }

            resolve({
              category: categoryResult,
              subcategory: subResult,
            });
          },
        );
      },
    );
  });
};

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

const fetchCategory = async (Branch_idBranch) => {
  try {
    const branchIds = await getSiblingBranchIds(Branch_idBranch);
    const query = "SELECT * FROM item_category WHERE Branch_idBranch IN (?)";

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

const getCategoryItems = (idItem_Category, connection) => {
  const query = `
    SELECT * FROM item 
    WHERE Item_Category_idItem_Category = ? 
       OR Item_Category_idItem_SubCategory IN (
         SELECT idItem_SubCategory FROM item_sub_category WHERE Item_Category_idItem_Category = ?
       )
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idItem_Category, idItem_Category], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getCategorySubCategories = (idItem_Category, connection) => {
  const query =
    "SELECT * FROM item_sub_category WHERE Item_Category_idItem_Category = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idItem_Category], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateCategory = (
  idItem_Category,
  Description,
  Type,
  Branch_idBranch,
) => {
  const query = `UPDATE item_category SET Description=?, Type=?, Branch_idBranch=? WHERE idItem_Category=?`;

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [Description, Type, Branch_idBranch, idItem_Category],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      },
    );
  });
};

const deleteCategory = async (idItem_Category, connection) => {
  const deleteSubQuery = "DELETE FROM item_sub_category WHERE Item_Category_idItem_Category = ?";
  const deleteCatQuery = "DELETE FROM item_category WHERE idItem_Category = ?";

  await new Promise((resolve, reject) => {
    (connection || db).query(deleteSubQuery, [idItem_Category], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });

  return new Promise((resolve, reject) => {
    (connection || db).query(deleteCatQuery, [idItem_Category], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * Enriches a list of items with their aggregate warehouse stock, warehouse-by-warehouse breakdown,
 * and performs automatic self-healing if physical warehouse stock exceeds recorded item.Qty.
 */
const enrichItemsWithWarehouseStock = async (items) => {
  if (!items || items.length === 0) return items;
  const itemIds = items.map((i) => i.idItem).filter(Boolean);
  if (itemIds.length === 0) return items;

  return new Promise((resolve) => {
    const warehouseQuery = `
      SELECT 
        ib.item_id,
        ib.variation_id,
        ib.warehouse_id,
        w.name AS warehouse_name,
        w.location AS warehouse_location,
        COALESCE(SUM(ib.qty), 0) AS warehouse_qty
      FROM item_batch ib
      INNER JOIN warehouses w ON w.id = ib.warehouse_id
      LEFT JOIN grn g ON ib.grn_id = g.idGRN
      WHERE ib.item_id IN (?) 
        AND ib.qty > 0 
        AND ib.warehouse_id IS NOT NULL 
        AND ib.warehouse_id > 0
        AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
      GROUP BY ib.item_id, ib.variation_id, ib.warehouse_id, w.name, w.location
    `;

    db.query(warehouseQuery, [itemIds], async (err, rows) => {
      if (err) {
        console.error("enrichItemsWithWarehouseStock error:", err);
        return resolve(items);
      }

      const itemWarehouseMap = {};
      (rows || []).forEach((r) => {
        const iId = r.item_id;
        if (!itemWarehouseMap[iId]) {
          itemWarehouseMap[iId] = {
            total_warehouse_qty: 0,
            breakdown: [],
            variations: {},
          };
        }
        const qtyNum = parseFloat(r.warehouse_qty || 0);
        itemWarehouseMap[iId].total_warehouse_qty += qtyNum;

        let whEntry = itemWarehouseMap[iId].breakdown.find(
          (b) => b.warehouse_id === r.warehouse_id
        );
        if (whEntry) {
          whEntry.qty += qtyNum;
        } else {
          itemWarehouseMap[iId].breakdown.push({
            warehouse_id: r.warehouse_id,
            warehouse_name: r.warehouse_name || `Warehouse ${r.warehouse_id}`,
            warehouse_location: r.warehouse_location || "",
            qty: qtyNum,
          });
        }

        if (r.variation_id) {
          if (!itemWarehouseMap[iId].variations[r.variation_id]) {
            itemWarehouseMap[iId].variations[r.variation_id] = {
              total_warehouse_qty: 0,
              breakdown: [],
            };
          }
          itemWarehouseMap[iId].variations[r.variation_id].total_warehouse_qty += qtyNum;
          itemWarehouseMap[iId].variations[r.variation_id].breakdown.push({
            warehouse_id: r.warehouse_id,
            warehouse_name: r.warehouse_name || `Warehouse ${r.warehouse_id}`,
            warehouse_location: r.warehouse_location || "",
            qty: qtyNum,
          });
        }
      });

      const healingPromises = [];

      const enriched = items.map((item) => {
        const whData = itemWarehouseMap[item.idItem] || {
          total_warehouse_qty: 0,
          breakdown: [],
          variations: {},
        };

        const currentItemQty = parseFloat(item.Qty || 0);
        const whQty = parseFloat(whData.total_warehouse_qty || 0);

        let healedQty = currentItemQty;
        // Automatic Self-Healing: only when physical warehouse stock exists (whQty > 0)
        // AND recorded item.Qty is non-negative and less than warehouse stock.
        // It MUST NOT erase or overwrite negative stock (e.g. -1, -5).
        if (whQty > 0 && currentItemQty >= 0 && whQty > currentItemQty) {
          healedQty = whQty;
          healingPromises.push(
            new Promise((hResolve) => {
              db.query(
                "UPDATE item SET Qty = ? WHERE idItem = ?",
                [whQty, item.idItem],
                (hErr) => {
                  if (hErr) console.error(`Failed to self-heal item ${item.idItem}:`, hErr);
                  else console.log(`[SELF-HEAL] Item ${item.idItem} (${item.Description}): Qty healed from ${currentItemQty} to ${whQty}`);
                  hResolve();
                }
              );
            })
          );
        }

        let unassignedFloorStock = 0;
        let combinedTotal = healedQty;

        if (whQty > 0) {
          if (healedQty >= whQty) {
            unassignedFloorStock = healedQty - whQty;
            combinedTotal = healedQty;
          } else if (healedQty < 0) {
            // Negative counter stock combined with warehouse stock (e.g., -2 floor, 10 wh => net 8)
            unassignedFloorStock = healedQty;
            combinedTotal = whQty + healedQty;
          } else {
            unassignedFloorStock = 0;
            combinedTotal = whQty;
          }
        } else {
          // No warehouse stock: floor stock is exactly the item's recorded stock (including negative stock!)
          unassignedFloorStock = healedQty;
          combinedTotal = healedQty;
        }

        return {
          ...item,
          Qty: healedQty,
          floor_qty: unassignedFloorStock,
          warehouse_stock: whQty,
          total_combined_qty: combinedTotal,
          warehouse_breakdown: whData.breakdown,
          warehouse_variations: whData.variations,
        };
      });

      if (healingPromises.length > 0) {
        await Promise.all(healingPromises);
      }

      resolve(enriched);
    });
  });
};

const fetchItems = async (Branch_idBranch, status = 1) => {
  try {
    // Use strict Branch_idBranch filtering
    const branchIds = [Branch_idBranch];
    return new Promise((resolve, reject) => {
      let itemQuery = `
        SELECT 
          i.*, 
          ic.Description AS Item_Category, 
          isc.Description AS Item_SubCategory,
          qt.Description AS Quantity_Type 
        FROM item i 
        LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN item_sub_category isc ON isc.idItem_SubCategory = i.Item_Category_idItem_SubCategory
        WHERE i.Branch_idBranch IN (?) AND (i.Type IN ('1', '2') OR i.Type IN ('Item', 'Service'))
      `;
      const params = [branchIds];


      if (status !== null && status !== undefined && status !== "all") {
        itemQuery += " AND i.Status = ?";
        params.push(Number(status));
      }

      itemQuery += " ORDER BY i.Description ASC";

      db.query(itemQuery, params, (err, items) => {
        if (err) return reject(err);

        const itemIds = items.map((item) => item.idItem);
        if (itemIds.length === 0) return resolve([]);

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

          // Group fields by item_id
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

          // Append custom fields to each item
          const itemsWithFields = items.map((item) => ({
            ...item,
            customFields: customFieldsMap[item.idItem] || [],
          }));

          enrichItemsWithWarehouseStock(itemsWithFields)
            .then((enriched) => resolve(enriched))
            .catch((enrichErr) => {
              console.error("enrichItemsWithWarehouseStock error in fetchItems:", enrichErr);
              resolve(itemsWithFields);
            });
        });
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
  brandName,
  status = null,
  supplierId = null,
) => {
  try {
    // Use strict Branch_idBranch filtering
    const branchIds = [Branch_idBranch];
    return new Promise((resolve, reject) => {
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM item i 
        LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        WHERE i.Branch_idBranch IN (?) AND i.Type IN (?, 'Item')
      `;

      let itemQuery = `
        SELECT 
          i.*, 
          ic.Description AS Item_Category, 
          isc.Description AS Item_SubCategory,
          qt.Description AS Quantity_Type 
        FROM item i 
        LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type 
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
        LEFT JOIN item_sub_category isc ON isc.idItem_SubCategory = i.Item_Category_idItem_SubCategory
        WHERE i.Branch_idBranch IN (?) AND i.Type IN (?, 'Item')
      `;

      const params = [branchIds, "1"];

      const approvalFilter = "";
      countQuery += approvalFilter;
      itemQuery += approvalFilter;

      if (status !== null && status !== undefined && status !== "all") {
        const statusCondition = ` AND i.Status = ?`;
        countQuery += statusCondition;
        itemQuery += statusCondition;
        params.push(Number(status));
      }

      if (search) {
        const searchCondition = ` AND (i.Description LIKE ? OR i.Item_Code LIKE ? OR i.product_brand LIKE ? OR i.Brand_Name LIKE ?)`;
        countQuery += searchCondition;
        itemQuery += searchCondition;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (categoryId) {
        const categoryCondition = ` AND i.Item_Category_idItem_Category = ?`;
        countQuery += categoryCondition;
        itemQuery += categoryCondition;
        params.push(categoryId);
      }

      if (brandName) {
        const brandCondition = ` AND i.Brand_Name = ?`;
        countQuery += brandCondition;
        itemQuery += brandCondition;
        params.push(brandName);
      }

      if (supplierId) {
        const supplierCondition = ` AND EXISTS (SELECT 1 FROM item_has_supplier ihs WHERE ihs.Item_idItem = i.idItem AND ihs.Supplier_idSupplier = ?)`;
        countQuery += supplierCondition;
        itemQuery += supplierCondition;
        params.push(supplierId);
      }

      itemQuery += ` ORDER BY i.Description ASC LIMIT ? OFFSET ?`;

      // 1. Get total count
      db.query(countQuery, params, (err, countResult) => {
        if (err) return reject(err);
        const total = countResult && countResult.length > 0 && countResult[0].total ? countResult[0].total : 0;

        // 2. Get paginated items
        db.query(itemQuery, [...params, limit, offset], (err, items) => {
          if (err) return reject(err);

          if (items.length === 0) return resolve({ items: [], total });

          const itemIds = items.map((item) => item.idItem);
          if (itemIds.length === 0) return resolve({ items: [], total });

          // 3. Fetch custom fields (same as original fetchItems)
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

            const itemsWithFields = items.map((item) => ({
              ...item,
              customFields: customFieldsMap[item.idItem] || [],
            }));

            enrichItemsWithWarehouseStock(itemsWithFields)
              .then((enriched) => resolve({ items: enriched, total }))
              .catch((enrichErr) => {
                console.error("enrichItemsWithWarehouseStock error in fetchItemsPaginated:", enrichErr);
                resolve({ items: itemsWithFields, total });
              });
          });
        });
      });
    });
  } catch (err) {
    throw err;
  }
};

const fetchProductImages = (itemId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM product_images WHERE item_id = ?";
    db.query(query, [itemId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const fetchProductDocuments = (itemId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM product_documents WHERE item_id = ?";
    db.query(query, [itemId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const fetchProductBarcodes = (itemId) => {
  return new Promise((resolve, reject) => {
    const query = "SELECT * FROM product_barcodes WHERE item_id = ?";
    db.query(query, [itemId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Fetch services related to a branch, filtering by 'Type' = '2' as string
const fetchServices = async (Branch_idBranch, status = 1) => {
  try {
    // Use strict Branch_idBranch filtering
    const branchIds = [Branch_idBranch];
    let query = `
      SELECT 
        i.*, 
        ic.Description AS Item_Category,
        isc.Description AS Item_SubCategory
      FROM item i 
      LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
      LEFT JOIN item_sub_category isc ON isc.idItem_SubCategory = i.Item_Category_idItem_SubCategory
      WHERE i.Branch_idBranch IN (?) AND i.Type IN (?, 'Service')
    `;
    const params = [branchIds, "2"];


    if (status !== null && status !== undefined && status !== "all") {
      query += " AND i.Status = ?";
      params.push(Number(status));
    }

    query += " ORDER BY i.Description ASC";

    return new Promise((resolve, reject) => {
      db.query(query, params, (err, services) => {
        if (err) return reject(err);

        if (services.length === 0) {
          return resolve([]);
        }

        const serviceIds = services.map((service) => service.idItem);

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

        db.query(fieldQuery, [serviceIds], (fieldErr, fieldResults) => {
          if (fieldErr) return reject(fieldErr);

          // Group fields by item_id
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

          // Append custom fields to each service
          const servicesWithFields = services.map((service) => ({
            ...service,
            customFields: customFieldsMap[service.idItem] || [],
          }));

          resolve(JSON.parse(JSON.stringify(servicesWithFields)));
        });
      });
    });
  } catch (err) {
    throw err;
  }
};

const fetchProducts = async (Branch_idBranch, status = 1) => {
  try {
    // Use strict Branch_idBranch filtering
    const branchIds = [Branch_idBranch];
    let query =
      "SELECT i.*, ic.Description AS Item_Category, qt.Description AS Unit_Name, qt.Description AS Unit FROM item i INNER JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category LEFT JOIN quantity_type qt ON qt.idQuantity_Type = i.Qty_Type WHERE i.Branch_idBranch IN (?)";
    const params = [branchIds];


    if (status !== null && status !== undefined && status !== "all") {
      query += " AND i.Status = ?";
      params.push(Number(status));
    }

    query += " ORDER BY i.Description ASC";

    return new Promise((resolve, reject) => {
      db.query(query, params, (err, results) => {
        if (err) {
          return reject(err);
        }

        const items = JSON.parse(JSON.stringify(results));
        if (items.length === 0) return resolve([]);

        // Fetch variations for all items
        const itemIds = items.map((i) => i.idItem);
        const variationsQuery =
          "SELECT * FROM item_variations WHERE item_id IN (?)";

        db.query(variationsQuery, [itemIds], (vErr, vResults) => {
          if (vErr) return reject(vErr);

          const variations = JSON.parse(JSON.stringify(vResults));

          // Map variations to items
          const itemsWithVariations = items.map((item) => {
            item.variations = variations.filter(
              (v) => v.item_id === item.idItem,
            );
            return item;
          });

          resolve(itemsWithVariations);
        });
      });
    });
  } catch (err) {
    throw err;
  }
};

const updateProduct = (
  Item_Category_idItem_Category,
  Item_Category_idItem_SubCategory,
  Zone_IdZone,
  Item_Code,
  Description,
  Long_Description,
  Item_Description,
  Brand_Name,
  Alert_Qty,
  Cost,
  Rate,
  Qty_Type,
  productSKU,
  productPLU,
  low_stock_level,
  target_stock,
  Item_Has_Expire_Date,
  product_brand,
  Item_Has_Serial,
  barcode,
  mainImage, // 🆕
  discount_min,
  discount_max,
  discount_type,
  is_visible = 1,
  idItem,
  connection, // Added connection parameter
) => {
  const query = `
    UPDATE item SET
      Item_Category_idItem_Category = ?,
      Item_Category_idItem_SubCategory = ?,
      Zone_IdZone = ?,
      Item_Code = ?,
      Description = ?,
      Long_Description = ?,
      Item_Description = ?,
      Brand_Name = ?,
      Alert_Qty = ?,
      Cost = ?,
      Rate = ?,
      Qty_Type = ?,
      productSKU = ?,
      productPLU = ?,
      low_stock_level = ?,
      target_stock = ?,
      Expired_Date = ?,
      product_brand = ?, 
      Item_Has_Serial = ?, 
      barcode = ?, 
      image = ?,
      discount_min = ?,
      discount_max = ?,
      discount_type = ?,
      is_visible = ?
    WHERE idItem = ?
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Item_Category_idItem_Category,
        Item_Category_idItem_SubCategory != null ? Item_Category_idItem_SubCategory : 0,
        Zone_IdZone,
        Item_Code,
        Description,
        Long_Description,
        Item_Description,
        Brand_Name,
        Alert_Qty,
        Cost,
        Rate,
        Qty_Type,
        productSKU,
        productPLU,
        low_stock_level,
        target_stock || 0,
        Item_Has_Expire_Date,
        product_brand,
        Item_Has_Serial,
        barcode,
        mainImage,
        discount_min || 0,
        discount_max || 0,
        discount_type || 'percentage',
        is_visible !== undefined ? (is_visible ? 1 : 0) : 1,
        idItem,
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

const updateProductQty = (Qty, idItem, connection) => {
  const query = `UPDATE item 
    SET 
    Qty=? 
    WHERE idItem=?`;

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Qty, idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const adjustProductQty = (Qty, idItem, connection) => {
  const query = `UPDATE item 
    SET 
    Qty=? 
    WHERE idItem=?`;

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [Qty, idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchItem = (idItem, connection) => {
  const query = "SELECt * FROM item WHERE idItem=?";

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const itemProcess = (Cost, Real_Cost, Qty, idItem, connection) => {
  const query = "UPDATE item SET Cost=?, Real_Cost=?, Qty=? WHERE idItem=?";

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Cost, Real_Cost, Qty, idItem],
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

// ✅ Update only the Real_Cost of an item
const updateRealCost = (Real_Cost, idItem) => {
  const query = "UPDATE item SET Real_Cost = ? WHERE idItem = ?";

  return new Promise((resolve, reject) => {
    db.query(query, [Real_Cost, idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const itemQtyUpdates = (Qty, idItem) => {
  const query = "UPDATE item SET Qty=? WHERE idItem=?";

  return new Promise((resolve, reject) => {
    db.query(query, [Qty, idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateStatus = (idEmployee) => {
  const query =
    "UPDATE item SET Status = CASE WHEN Status = 1 THEN 0 ELSE 1 END WHERE idItem  = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idEmployee], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const checkItemInvoiceAvailability = (Branch_idBranch, Item_idItem) => {
  const query = `SELECT * FROM invoice_has_item WHERE Branch_idBranch = ? AND Item_idItem =?`;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, Item_idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};
const checkItemQuotationAvailability = (Branch_idBranch, Item_idItem) => {
  const query = `SELECT * FROM quotation_has_item WHERE Branch_idBranch = ? AND Item_idItem =?`;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, Item_idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};
const checkItemGrnAvailability = (Branch_idBranch, Item_idItem) => {
  const query = `SELECT * FROM grn_has_item WHERE Branch_idBranch = ? AND Item_idItem =?`;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch, Item_idItem], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const checkSubCategoryDescription = (
  Description,
  Item_Category_idItem_Category,
  Branch_idBranch,
  excludeId = null,
) => {
  let query =
    "SELECT * FROM item_sub_category WHERE LOWER(Description) = LOWER(?) AND Item_Category_idItem_Category = ? AND Branch_idBranch = ?";
  let params = [Description, Item_Category_idItem_Category, Branch_idBranch];

  if (excludeId) {
    query += " AND idItem_SubCategory != ?";
    params.push(excludeId);
  }

  return new Promise((resolve, reject) => {
    db.query(query, params, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results.length > 0);
      }
    });
  });
};

const insertSubCategory = (
  Description,
  Branch_idBranch,
  Item_Category_idItem_Category,
  connection,
) => {
  const query =
    "INSERT INTO item_sub_category (Description, Branch_idBranch,Item_Category_idItem_Category) VALUES (?, ?, ?)";

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Description, Branch_idBranch, Item_Category_idItem_Category],
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

const fetchSubCategory = async (Branch_idBranch) => {
  const branchIds = await getSiblingBranchIds(Branch_idBranch);
  const query =
    "SELECT s.*, i.Description AS Item_Category FROM item_sub_category s  INNER JOIN item_category i ON i.idItem_Category = s.Item_Category_idItem_Category WHERE s.Branch_idBranch IN (?) ORDER BY s.idItem_SubCategory ASC";
  return new Promise((resolve, reject) => {
    db.query(query, [branchIds], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateSubCategory = (
  idItem_SubCategory,
  Description,
  Item_Category_idItem_Category,
  Branch_idBranch,
) => {
  const query = `UPDATE item_sub_category SET Description=?, Item_Category_idItem_Category=?, Branch_idBranch=? WHERE idItem_SubCategory=?`;

  return new Promise((resolve, reject) => {
    db.query(
      query,
      [Description, Item_Category_idItem_Category, Branch_idBranch, idItem_SubCategory],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

// ✅ Save gallery images for a product
const insertProductImages = (item_id, imageUrls, connection) => {
  const values = imageUrls.map((url) => [item_id, url, false]); // is_primary = false by default
  const query = `
    INSERT INTO product_images (item_id, image_url, is_primary)
    VALUES ?
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [values], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

// ✅ Save product documents
const insertProductDocuments = (item_id, docs, connection) => {
  const values = docs.map((doc) => [item_id, doc.name, doc.url]);
  const query = `
    INSERT INTO product_documents (item_id, document_name, document_url)
    VALUES ?
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [values], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const insertProductPromotions = async (promotionValues, connection) => {
  const sql = `INSERT INTO product_promotions (item_id, promotion_price, start_date, end_date) VALUES ?`;
  return new Promise((resolve, reject) => {
    (connection || db).query(sql, [promotionValues], (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
};

// dbService.js
const insertProductBarcodes = (item_id, barcodes, connection) => {
  const values = barcodes.map((code) => [item_id, code]);
  const sql = "INSERT INTO product_barcodes (item_id, barcode) VALUES ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(sql, [values], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const deleteBarcode = (req, res) => {
  const { id } = req.params;
  const sql = "DELETE FROM product_barcodes WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting barcode:", err);
      return res.status(500).json({ message: "Failed to delete barcode." });
    }
    res.json({ message: "Barcode deleted successfully." });
  });
};

const insertProductVariations = (itemId, variations, connection) => {
  const query = `
    INSERT INTO item_variations 
    (item_id, description, item_code, cost, rate, qty, attributes, product_sku, product_plu, barcode)
    VALUES ?
  `;

  const values = variations.map((v) => [
    itemId,
    v.Description || v.description,
    v.Item_Code || v.item_code,
    v.Cost || v.cost || 0,
    v.Rate || v.rate || 0,
    v.Qty || v.qty || 0,
    typeof v.attributes === "string"
      ? v.attributes
      : JSON.stringify(v.attributes),
    v.productSKU || v.product_sku,
    v.productPLU || v.product_plu,
    v.barcode || null,
  ]);

  return new Promise((resolve, reject) => {
    (connection || db).query(query, [values], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const fetchProductVariations = (itemId) => {
  const query = `SELECT * FROM item_variations WHERE item_id = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [itemId], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const updateProductVariation = (variation, connection) => {
  const query = `
    UPDATE item_variations SET 
    description=?, item_code=?, cost=?, rate=?, qty=?, attributes=?, product_sku=?, product_plu=?, barcode=?
    WHERE id=?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        variation.Description || variation.description,
        variation.Item_Code || variation.item_code,
        variation.Cost || variation.cost || 0,
        variation.Rate || variation.rate || 0,
        variation.Qty || variation.qty || 0,
        typeof variation.attributes === "string"
          ? variation.attributes
          : JSON.stringify(variation.attributes),
        variation.productSKU || variation.product_sku,
        variation.productPLU || variation.product_plu,
        variation.barcode || null,
        variation.id,
      ],
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
};

const deleteProductVariations = async (ids, connection) => {
  const conn = connection || db;

  // Step 1: Nullify Variation_Id references in invoice_has_item
  // (ON DELETE RESTRICT FK prevents deleting while referenced rows exist)
  await new Promise((resolve, reject) => {
    conn.query(
      `UPDATE invoice_has_item SET Variation_Id = NULL WHERE Variation_Id IN (?)`,
      [ids],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });

  // Step 2: Nullify references in quotation_has_item if the table exists
  await new Promise((resolve) => {
    conn.query(
      `UPDATE quotation_has_item SET Variation_Id = NULL WHERE Variation_Id IN (?)`,
      [ids],
      () => resolve() // Ignore errors (table may not exist or have no such column)
    );
  });

  // Step 3: Delete the variations
  return new Promise((resolve, reject) => {
    conn.query(`DELETE FROM item_variations WHERE id IN (?)`, [ids], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

module.exports = {
  insertProduct,
  insertExcelProduct,
  fetchItems,
  updateProduct,
  updateProductQty,
  SignupinsertCategory,
  insertCategory,
  fetchCategory,
  updateCategory,
  fetchServices,
  fetchItem,
  itemProcess,
  fetchProducts,
  getCategoryItems,
  getCategorySubCategories,
  deleteCategory,
  updateStatus,
  checkItemInvoiceAvailability,
  checkItemGrnAvailability,
  checkItemQuotationAvailability,
  itemQtyUpdates,
  updateRealCost,
  adjustProductQty,
  insertSubCategory,
  fetchSubCategory,
  updateSubCategory,
  checkProductDescription,
  checkSubCategoryDescription,
  insertProductImages,
  insertProductDocuments,
  insertProductBarcodes,
  insertProductPromotions,
  fetchProductImages,
  fetchProductDocuments,
  fetchProductBarcodes,
  deleteBarcode,
  insertProductVariations,
  fetchProductVariations,
  updateProductVariation,
  deleteProductVariations,
  processInvoiceVariation: (variationId, qty, connection) => {
    const query = "UPDATE item_variations SET qty = qty - ? WHERE id = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [qty, variationId], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  },
  // New exports for GRN variations
  updateVariationStock: (variationId, newQty, newCost, newRate, connection) => {
    // Rearrange parameters if 4th parameter is the connection object
    let rateVal = null;
    let connVal = connection;
    if (newRate && typeof newRate !== "object") {
      rateVal = parseFloat(newRate);
    } else if (newRate && typeof newRate === "object") {
      connVal = newRate;
    }

    // 1. Fetch current variation to calculate weighted average cost if needed
    // For now, assuming detailed tracking, but typically dealing with weighted average.
    const query = "SELECT * FROM item_variations WHERE id = ?";
    return new Promise((resolve, reject) => {
      (connVal || db).query(query, [variationId], async (err, results) => {
        if (err) return reject(err);
        if (!results || results.length === 0)
          return reject(new Error("Variation not found"));

        const variation = results[0];
        const currentQty = parseFloat(variation.qty || 0);
        const currentCost = parseFloat(variation.cost || 0);

        const addedQty = parseFloat(newQty);
        const addedCost = parseFloat(newCost);

        const totalQty = currentQty + addedQty;

        // Calculate weighted average cost
        // If totalQty is 0 (shouldn't happen on add, but maybe on revert), handle it.
        let updatedCost = addedCost;
        if (totalQty > 0) {
          updatedCost =
            (currentCost * currentQty + addedCost * addedQty) / totalQty;
        }

        const hasRate = rateVal !== null && !isNaN(rateVal) && rateVal > 0;
        const updateQuery = hasRate
          ? "UPDATE item_variations SET qty = ?, cost = ?, rate = ? WHERE id = ?"
          : "UPDATE item_variations SET qty = ?, cost = ? WHERE id = ?";
        
        const params = hasRate
          ? [totalQty, updatedCost, rateVal, variationId]
          : [totalQty, updatedCost, variationId];

        (connVal || db).query(
          updateQuery,
          params,
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          },
        );
      });
    });
  },

  updateItemRate: (idItem, rate, connection) => {
    const query = "UPDATE item SET Rate = ? WHERE idItem = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [rate, idItem], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  },

  fetchVariation: (variationId, connection) => {
    const query = "SELECT * FROM item_variations WHERE id = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [variationId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  productHistoryLogHelper: async ({
    productId,
    variationId = null,
    quantityChange,
    oldQty,
    newQty,
    type,
    description,
    branchId,
    companyId,
    userId,
    referenceId = null,
    connection,
  }) => {
    try {
      const conn = connection || db;

      // Ensure oldQty and newQty are not null (ER_BAD_NULL_ERROR)
      const safeOldQty = oldQty !== null && oldQty !== undefined ? oldQty : 0;
      const safeNewQty = newQty !== null && newQty !== undefined ? newQty : 0;

      // Ensure Company_idCompany is not null (ER_BAD_NULL_ERROR)
      let finalCompanyId = companyId;
      if (!finalCompanyId && branchId) {
        try {
          const branchDBService = require("./branchDBService");
          finalCompanyId = await branchDBService.getCompanyIdByBranch(branchId);
        } catch (_) {}
      }
      if (!finalCompanyId && branchId) {
        try {
          const [bRows] = await conn.promise().query(
            "SELECT Company_idCompany FROM branch WHERE idBranch = ? LIMIT 1",
            [branchId]
          );
          if (bRows && bRows.length > 0 && bRows[0].Company_idCompany) {
            finalCompanyId = bRows[0].Company_idCompany;
          }
        } catch (_) {}
      }
      if (!finalCompanyId && branchId) {
        try {
          const [phlRows] = await conn.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Branch_idBranch = ? AND Company_idCompany IS NOT NULL LIMIT 1",
            [branchId]
          );
          if (phlRows && phlRows.length > 0 && phlRows[0].Company_idCompany) {
            finalCompanyId = phlRows[0].Company_idCompany;
          }
        } catch (_) {}
      }
      if (!finalCompanyId && userId) {
        try {
          const [uRows] = await conn.promise().query(
            "SELECT Company_idCompany FROM user WHERE idUser = ? LIMIT 1",
            [userId]
          );
          if (uRows && uRows.length > 0 && uRows[0].Company_idCompany) {
            finalCompanyId = uRows[0].Company_idCompany;
          }
        } catch (_) {}
      }
      if (!finalCompanyId) {
        try {
          const [anyRows] = await conn.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Company_idCompany IS NOT NULL ORDER BY idProduct_History_Log DESC LIMIT 1"
          );
          if (anyRows && anyRows.length > 0 && anyRows[0].Company_idCompany) {
            finalCompanyId = anyRows[0].Company_idCompany;
          }
        } catch (_) {}
      }
      if (!finalCompanyId) {
        finalCompanyId = 1;
      }

      await new Promise((resolve, reject) => {
        conn.query(
          `INSERT INTO product_history_log 
          (Product_idProduct, Variation_idVariation, Date_Time, Type, Description, Quantity_Change, Old_Quantity, New_Quantity, User_idUser, Branch_idBranch, Company_idCompany, Reference_ID) 
          VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            productId,
            variationId,
            type,
            description,
            quantityChange,
            safeOldQty,
            safeNewQty,
            userId,
            branchId,
            finalCompanyId,
            referenceId,
          ],
          (err, results) => (err ? reject(err) : resolve(results)),
        );
      });

      return true;
    } catch (error) {
      console.error("Error in productHistoryLogHelper:", error);
      throw error;
    }
  },

  fetchProductHistory: (productId) => {
    const query = `
      SELECT 
        phl.*, 
        u.User_Name as User_Name,
        i.Invoice_Number,
        c.displayName AS Customer_Name,
        em.Employee_Name AS Salesman_Name
      FROM product_history_log phl 
      LEFT JOIN user u ON phl.User_idUser = u.idUser 
      LEFT JOIN invoice i ON (
        (phl.Type LIKE '%Invoice%' OR phl.Type LIKE '%POS Sale%') 
        AND phl.Reference_ID = i.idInvoice
      )
      LEFT JOIN customer c ON i.Customer_idCustomer = c.idCustomer
      LEFT JOIN employee em ON i.Employee_idEmployee = em.idEmployee
      WHERE phl.Product_idProduct = ? 
      ORDER BY phl.Date_Time DESC, phl.idProduct_History_Log DESC
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [productId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },

  deductStockFromBatches: (
    itemId,
    variationId,
    qtyToDeduct,
    selectedBatchId,
    branchId,
    connection,
    warehouseId = null,
  ) => {
    return new Promise(async (resolve, reject) => {
      const activeConn = connection || db;
      try {
        console.log(
          `[BATCH-DEDUCTION] itemId: ${itemId}, variationId: ${variationId}, qty: ${qtyToDeduct}, selectedBatchId: ${selectedBatchId}, branchId: ${branchId}, warehouseId: ${warehouseId}`,
        );
        if (selectedBatchId && selectedBatchId > 0) {
          // Option 1: Direct Deduction (User selected a specific batch)
          const lookupSql = "SELECT batch_id, warehouse_id, qty FROM item_batch WHERE batch_id = ?";
          activeConn.query(lookupSql, [selectedBatchId], (errLook, lookRows) => {
            if (errLook) {
              console.error("[BATCH-DEDUCTION] Error in batch lookup:", errLook);
              return reject(errLook);
            }
            const batchRow = lookRows && lookRows.length > 0 ? lookRows[0] : null;
            const currentQty = batchRow ? parseFloat(batchRow.qty || 0) : 0;
            const actualDeducted = Math.min(currentQty, parseFloat(qtyToDeduct));

            const updateQuery =
              "UPDATE item_batch SET qty = GREATEST(qty - ?, 0) WHERE batch_id = ?";
            activeConn.query(
              updateQuery,
              [qtyToDeduct, selectedBatchId],
              (err, results) => {
                if (err) {
                  console.error(
                    `[BATCH-DEDUCTION] Error in direct deduction:`,
                    err,
                  );
                  reject(err);
                } else {
                  console.log(
                    `[BATCH-DEDUCTION] Direct deduction successful. Rows affected: ${results.affectedRows}`,
                  );
                  const deductions = [];
                  if (actualDeducted > 0 && batchRow) {
                    deductions.push({
                      batchId: selectedBatchId,
                      warehouseId: batchRow.warehouse_id || null,
                      deductedQty: actualDeducted,
                    });
                  }
                  resolve({
                    success: true,
                    remaining: Math.max(0, parseFloat(qtyToDeduct) - actualDeducted),
                    deductions,
                  });
                }
              },
            );
          });
        } else {
          // Option 2: Automatic FIFO Deduction (First In, First Out)
          let selectQuery = `
            SELECT ib.batch_id, ib.qty, ib.expiry_date, ib.warehouse_id
            FROM item_batch ib
            LEFT JOIN grn g ON ib.grn_id = g.idGRN
            LEFT JOIN warehouses w ON ib.warehouse_id = w.id
            WHERE ib.item_id = ?
              AND (ib.variation_id = ? OR (? IS NULL AND ib.variation_id IS NULL))
              AND (g.Branch_idBranch = ? OR w.branch_id = ?)
              AND ib.qty > 0
              AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
          `;
          const queryParams = [itemId, variationId, variationId, branchId, branchId];
          if (warehouseId) {
            selectQuery += " AND ib.warehouse_id = ?";
            queryParams.push(warehouseId);
          }
          selectQuery += " ORDER BY ib.batch_id ASC";

          activeConn.query(
            selectQuery,
            queryParams,
            async (err, batches) => {
              if (err) {
                console.error(
                  `[BATCH-DEDUCTION] Error selecting batches for FIFO:`,
                  err,
                );
                return reject(err);
              }

              console.log(
                `[BATCH-DEDUCTION] Found ${batches.length} batches for FIFO item ${itemId} on branch ${branchId}${warehouseId ? ` in warehouse ${warehouseId}` : ""}`,
              );
              let remainingToDeduct = parseFloat(qtyToDeduct);
              const deductions = [];

              for (const batch of batches) {
                if (remainingToDeduct <= 0) break;
                const batchQty = parseFloat(batch.qty);
                const deducted = Math.min(batchQty, remainingToDeduct);

                await new Promise((resUpdate, rejUpdate) => {
                  const updateQuery =
                    "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?";
                  activeConn.query(
                    updateQuery,
                    [deducted, batch.batch_id],
                    (uErr, uRes) => {
                      if (uErr) rejUpdate(uErr);
                      else resUpdate(uRes);
                    },
                  );
                });

                deductions.push({
                  batchId: batch.batch_id,
                  warehouseId: batch.warehouse_id || null,
                  deductedQty: deducted,
                });

                console.log(
                  `[BATCH-DEDUCTION] Deducted ${deducted} from batch ${batch.batch_id}${batch.warehouse_id ? ` (warehouse ${batch.warehouse_id})` : ""}`,
                );
                remainingToDeduct -= deducted;
              }

              resolve({ success: true, remaining: remainingToDeduct, deductions });
            },
          );
        }
      } catch (error) {
        console.error(`[BATCH-DEDUCTION] Uncaught exception:`, error);
        reject(error);
      }
    });
  },
  fetchItemsPaginated,
  fetchPackages: (Branch_idBranch, status = 1) => {
    let query = `
      SELECT i.*, ic.Description AS Item_Category 
      FROM item i 
      LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category 
      WHERE i.Branch_idBranch = ? AND i.Type = 'Package'
    `;
    const params = [Branch_idBranch];


    if (status !== null && status !== undefined && status !== "all") {
      query += " AND i.Status = ?";
      params.push(Number(status));
    }

    query += " ORDER BY i.Description ASC";

    return new Promise((resolve, reject) => {
      db.query(query, params, (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },
  fetchPackageComponents: (packageId) => {
    const query = `
      SELECT pi.*, 
             i.Description, 
             i.Item_Code, 
             i.Type, 
             i.Qty_Type, 
             i.Qty AS Current_Stock,
             i.Cost AS Standard_Cost,
             i.Rate AS Standard_Rate,
             i.Item_Has_Serial,
             v.description AS variation_description,
             v.qty AS variation_stock
      FROM package_items pi
      INNER JOIN item i ON pi.item_id = i.idItem
      LEFT JOIN item_variations v ON pi.variation_id = v.id
      WHERE pi.package_id = ?
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [packageId], (err, results) => {
        if (err) reject(err);
        else resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },
  insertPackageItem: (packageId, itemId, variationId, qty, rate, connection) => {
    const query = `
      INSERT INTO package_items (package_id, item_id, variation_id, qty, rate)
      VALUES (?, ?, ?, ?, ?)
    `;
    return new Promise((resolve, reject) => {
      (connection || db).query(
        query,
        [packageId, itemId, variationId || null, qty, rate],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });
  },
  saveItemSuppliers: (itemId, supplierIds, branchId, connection) => {
    return new Promise((resolve, reject) => {
      const conn = connection || db;
      conn.query("DELETE FROM item_has_supplier WHERE Item_idItem = ?", [itemId], (err) => {
        if (err) return reject(err);
        if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
          return resolve({ success: true, count: 0 });
        }
        const values = supplierIds.map((sId) => [itemId, sId, branchId]);
        conn.query(
          "INSERT INTO item_has_supplier (Item_idItem, Supplier_idSupplier, Branch_idBranch) VALUES ?",
          [values],
          (insertErr, results) => {
            if (insertErr) return reject(insertErr);
            resolve(results);
          }
        );
      });
    });
  },
  getItemSuppliers: (itemId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT ihs.Supplier_idSupplier, s.Company_Name, s.Agent_Name 
        FROM item_has_supplier ihs 
        LEFT JOIN supplier s ON ihs.Supplier_idSupplier = s.idSupplier 
        WHERE ihs.Item_idItem = ?
      `;
      db.query(query, [itemId], (err, results) => {
        if (err) return reject(err);
        resolve(JSON.parse(JSON.stringify(results || [])));
      });
    });
  },
  fetchProductsBySupplier: (supplierId, branchId) => {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT DISTINCT i.*, ic.Description AS Item_Category
        FROM item i
        INNER JOIN item_has_supplier ihs ON i.idItem = ihs.Item_idItem
        LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category
        WHERE ihs.Supplier_idSupplier = ? AND i.Branch_idBranch = ? AND i.Status = 1
        ORDER BY i.Description ASC
      `;
      db.query(query, [supplierId, branchId], (err, results) => {
        if (err) return reject(err);
        resolve(JSON.parse(JSON.stringify(results)));
      });
    });
  },
  deletePackageItems: (packageId, connection) => {
    const query = "DELETE FROM package_items WHERE package_id = ?";
    return new Promise((resolve, reject) => {
      (connection || db).query(query, [packageId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  },
  enrichItemsWithWarehouseStock,
};
