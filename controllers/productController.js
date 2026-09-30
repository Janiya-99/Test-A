const dbService = require("../services/productDBService");
const userLogDbService = require("../services/userLogDBService");
const approvalService = require("../services/approvalService");
const { currentDate } = require("../utils/currentData");
const stockCardDbService = require("../services/stockCardDBService");
const db = require("../db/db");
const branchDBService = require("../services/branchDBService");

const {
  insertProductImages,
  insertProductDocuments,
  insertProductPromotions,
  insertProductBarcodes,
  insertProductVariations,
  fetchProductVariations,
  updateProductVariation,
  deleteProductVariations,
  productHistoryLogHelper,
} = require("../services/productDBService");
const {
  postOpeningStockAccounting,
  postStockAdjustmentAccounting,
} = require("../services/inventoryAccountingService");

const createProduct = async (req, res) => {
  // APPROVAL ENGINE: PRE-EXECUTION CHECK FOR CREATE
  if (!req.is_approved_webhook && req.body.productData) {
    try {
      const approvalService = require("../services/approvalService");
      const productData = JSON.parse(req.body.productData);
      const Branch_idBranch = productData.Branch_idBranch;
      
      let companyId = req.user?.company_id || req.headers["company_id"] || req.body?.company_id;
      if ((!companyId || parseInt(companyId, 10) === 1) && Branch_idBranch && Branch_idBranch !== 1) {
        const [bRows] = await db.promise().query(
          "SELECT Company_idCompany FROM asipbook_account_center.branch WHERE idBranch = ? UNION SELECT Company_idCompany FROM asipbook_db.branch WHERE idBranch = ? LIMIT 1",
          [Branch_idBranch, Branch_idBranch]
        );
        if (bRows && bRows.length > 0 && bRows[0].Company_idCompany) {
          companyId = bRows[0].Company_idCompany;
        }
      }
      companyId = parseInt(companyId, 10) || 1;

      const approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        Branch_idBranch,
        "ADD_PRODUCT"
      );
      
      if (approvalRequired) {
        await approvalService.triggerApprovalRequest({
          action_type: "ADD_PRODUCT",
          module_name: "Product Management",
          erp_record_id: null,
          company_id: companyId,
          branch_id: Branch_idBranch,
          initiated_by: req.user?.idUser || req.user?.id || req.headers["actor_id"] || 1,
          payload_summary: {
            productName: productData.Item_Code,
            pending_updates: {
               req_body: req.body,
               req_params: req.params,
               req_user: req.user,
               req_files: req.files
            }
          }
        });
        return res.status(202).json({
          message: "Product creation submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Product Creation"
        });
      }
    } catch (err) {
      console.error("Approval Check Error:", err);
      return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
    }
  }
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const productData = JSON.parse(req.body.productData);

        const {
          Type,
          Item_Category_idItem_Category,
          Item_Category_idItem_SubCategory,
          Zone_IdZone,
          Item_Code,
          Description,
          Long_Description,
          Item_Description,
          Cost,
          Rate,
          Qty_Type,
          Qty,
          Brand_Name,
          Alert_Qty,
          User_idUser,
          Branch_idBranch,
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
          is_visible,
          promotions = [],
          customFields = [], // ✅ Extract custom fields
          is_variation,
          variations = [],
          supplier_ids = [],
          supplier_id,
        } = productData;

        const descriptionExists = await dbService.checkProductDescription(
          Description,
          Branch_idBranch,
        );
        if (descriptionExists) {
          return connection.rollback(() => {
            connection.release();
            res
              .status(409)
              .json({ message: "Product description already exists" });
          });
        }

        const mainImage = req.files?.mainImage?.[0]?.filename || null;

        const product = await dbService.insertProduct(
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
          mainImage,
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
          is_visible !== undefined ? (is_visible ? 1 : 0) : 1,
          connection, // 🆕
        );

        const idItem = product.insertId;

        const finalSupplierIds = Array.isArray(supplier_ids)
          ? supplier_ids
          : supplier_id
            ? [supplier_id]
            : [];
        if (finalSupplierIds.length > 0) {
          await dbService.saveItemSuppliers(idItem, finalSupplierIds, Branch_idBranch, connection);
        }

        // APPROVAL ENGINE: Check if approval is required
        let approvalRequired = false;
        let companyId = req.user?.company_id || req.headers["company_id"] || req.body?.company_id;
        try {
          if ((!companyId || parseInt(companyId, 10) === 1) && Branch_idBranch && Branch_idBranch !== 1) {
            const bRows = await new Promise((resolve) => {
              connection.query(
                "SELECT Company_idCompany FROM asipbook_account_center.branch WHERE idBranch = ? UNION SELECT Company_idCompany FROM asipbook_db.branch WHERE idBranch = ? LIMIT 1",
                [Branch_idBranch, Branch_idBranch],
                (err, rows) => resolve(rows || [])
              );
            });
            if (bRows && bRows.length > 0 && bRows[0].Company_idCompany) {
              companyId = bRows[0].Company_idCompany;
            }
          }
          companyId = parseInt(companyId, 10) || 1;

          if (!req.is_approved_webhook) {
            approvalRequired = await approvalService.isApprovalRequired(
              companyId,
              Branch_idBranch,
              "ADD_PRODUCT"
            );
            
            if (approvalRequired) {
              await new Promise((resolve, reject) => {
                connection.query(
                  "UPDATE item SET approval_status = 'PENDING_APPROVAL', Status = '0' WHERE idItem = ?",
                  [idItem],
                  (err) => (err ? reject(err) : resolve())
                );
              });
              console.log(`[PRODUCT] Product ${idItem} requires approval (PENDING_APPROVAL, Status=0) for company ${companyId}, branch ${Branch_idBranch}`);
            }
          } else {
            await new Promise((resolve, reject) => {
              connection.query(
                "UPDATE item SET approval_status = 'ACTIVE', Status = '1' WHERE idItem = ?",
                [idItem],
                (err) => (err ? reject(err) : resolve())
              );
            });
          }
        } catch (err) {
          console.error("Approval check failed for Product, defaulting to ACTIVE", err);
        }

        // ✅ Insert custom field data
        if (Array.isArray(customFields) && customFields.length > 0) {
          for (const field of customFields) {
            if (field.field_id && field.value != null) {
              await connection // 🆕 Use connection
                .promise()
                .query(
                  "INSERT INTO product_field_data (item_id, field_id, value) VALUES (?, ?, ?)",
                  [idItem, field.field_id, field.value],
                );
            }
          }
        }

        // ✅ Insert barcodes
        if (
          Array.isArray(productData.barcodes) &&
          productData.barcodes.length > 0
        ) {
          await insertProductBarcodes(
            idItem,
            productData.barcodes,
            connection, // 🆕
          );
        }

        // ✅ Insert promotions
        if (Array.isArray(promotions) && promotions.length > 0) {
          const formattedPromotions = promotions.map((promo) => [
            idItem,
            parseFloat(promo.price),
            promo.start,
            promo.end,
          ]);
          await insertProductPromotions(formattedPromotions, connection); // 🆕
        }

        // ✅ Save gallery images
        const galleryFiles = req.files?.galleryImages || [];
        const galleryImageFilenames = galleryFiles.map((file) => file.filename);
        if (galleryImageFilenames.length > 0) {
          await insertProductImages(
            idItem,
            galleryImageFilenames,
            connection, // 🆕
          );
        }

        // ✅ Save documents
        const documentFiles = req.files?.documents || [];
        const documentData = documentFiles.map((file) => ({
          name: file.originalname,
          url: file.filename,
        }));
        if (documentData.length > 0) {
          await insertProductDocuments(idItem, documentData, connection); // 🆕
        }

        // ✅ Insert variations
        if (
          is_variation &&
          Array.isArray(variations) &&
          variations.length > 0
        ) {
          await insertProductVariations(idItem, variations, connection); // 🆕
        }

        if (!companyId || companyId === 1) {
          let resolvedCompId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
        if (!companyId) {
          const [bRows] = await connection.promise().query(
            "SELECT companyId FROM accounting_accounts WHERE Branch_idBranch = ? AND companyId IS NOT NULL AND companyId > 0 LIMIT 1",
            [Branch_idBranch]
          );
          companyId = bRows[0]?.companyId;
        }
        if (!companyId) {
          const [phRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Branch_idBranch = ? AND Company_idCompany IS NOT NULL AND Company_idCompany > 0 ORDER BY idProduct_History_Log DESC LIMIT 1",
            [Branch_idBranch]
          );
          companyId = phRows[0]?.Company_idCompany;
        }
          if (resolvedCompId) companyId = resolvedCompId;
        }

        await productHistoryLogHelper({
          productId: idItem,
          variationId: null,
          quantityChange: parseFloat(Qty || 0),
          oldQty: 0,
          newQty: parseFloat(Qty || 0),
          type: "Item Created",
          description: `New item created with opening quantity ${Qty || 0}`,
          branchId: Branch_idBranch,
          companyId,
          userId: User_idUser || req.user?.id || 1,
          referenceId: idItem,
          connection,
        });

        // Accounting: Post opening stock double entry if opening quantity > 0
        if (is_variation && Array.isArray(variations) && variations.length > 0) {
          for (const v of variations) {
            const vQty = parseFloat(v.Qty || v.qty || v.Opening_Qty || v.opening_qty || 0);
            const vCost = parseFloat(v.Cost || v.cost || Cost || productData.Real_Cost || 0);
            if (vQty > 0) {
              await postOpeningStockAccounting({
                productId: idItem,
                productName: `${Description} - ${v.Description || v.description || "Variation"}`,
                quantity: vQty,
                unitCost: vCost,
                branchId: Branch_idBranch,
                companyId,
                userId: User_idUser || req.user?.id || 1,
                connection,
              });
            }
          }
        } else {
          const initQty = parseFloat(Qty || productData.Opening_Qty || productData.opening_qty || productData.openingQty || 0);
          const initCost = parseFloat(Cost || productData.Real_Cost || productData.real_cost || 0);
          if (initQty > 0) {
            await postOpeningStockAccounting({
              productId: idItem,
              productName: Description,
              quantity: initQty,
              unitCost: initCost,
              branchId: Branch_idBranch,
              companyId,
              userId: User_idUser || req.user?.id || 1,
              connection,
            });
          }
        }

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Item",
          idItem,
          "create",
          Branch_idBranch,
          connection, // 🆕
        );

        connection.commit(async (commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          
          // Trigger Approval Request if needed
          if (approvalRequired) {
            try {
              const createdBy = req.user?.idUser || req.user?.userId || User_idUser || 1;
              
              await approvalService.triggerApprovalRequest({
                action_type: "ADD_PRODUCT",
                module_name: "Product Management",
                erp_record_id: idItem,
                company_id: companyId,
                branch_id: Branch_idBranch,
                initiated_by: createdBy,
                payload_summary: {
                  item_name: Description,
                  item_code: Item_Code,
                  rate: Rate,
                  cost: Cost,
                  qty: Qty
                }
              });
              console.log(`[PRODUCT] Triggered approval request for product ${idItem} under company ${companyId}`);
            } catch (approvalErr) {
              console.error("[PRODUCT] Error triggering approval webhook:", approvalErr);
              return res.status(500).json({ error: "Failed to submit approval request." });
            }

            return res.status(202).json({
              message: "Product creation submitted for approval. It will take effect once approved.",
              requires_approval: true,
              approval_required: true,
              approval_status: "PENDING_APPROVAL",
              erp_record_id: idItem,
              approval_name: "Add New Product",
              idItem
            });
          }

          res.json({ message: "Product added successfully", idItem });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error creating item:", err);
          res
            .status(500)
            .json({ message: "Error creating item", error: err.message });
        });
      }
    });
  });
};

const DEFAULT_CATEGORY_NAME = "Default";
const DEFAULT_SUBCATEGORY_NAME = "Default";

const createExcelProduct = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    let productData;
    try {
      productData = JSON.parse(req.body.productData);
    } catch (parseErr) {
      console.error("Error parsing productData JSON:", parseErr);
      connection.release();
      return res.status(400).json({ error: "Invalid product data format" });
    }

    const {
      Type,
      Item_Category_idItem_Category,
      CategoryName,
      Item_Category_idItem_SubCategory,
      SubCategoryName,
      Zone_IdZone,
      Item_Code,
      Description,
      Long_Description,
      Item_Description,
      Cost,
      Rate,
      Qty_Type,
      Brand_Name,
      Alert_Qty,
      User_idUser,
      Branch_idBranch,
      productSKU,
      productPLU,
      low_stock_level,
      Expired_Date,
      product_brand,
      Item_Has_Serial,
      barcode,
      Opening_Qty,
      promotions = [],
      customFields = [],
      barcodes = [],
    } = productData;

    console.log(`[Excel Import] Starting import for product: ${Item_Code || "N/A"} - ${Description || "N/A"}`);

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        console.error("Failed to start transaction:", beginErr);
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        // ---------- helpers ----------
        const limitStr = (v, n) =>
          v === undefined || v === null ? null : String(v).slice(0, n);
        const optStr = (v) =>
          v === undefined || v === null ? null : String(v);
        const ynTo01 = (v, def = 0) => {
          if (
            v === 1 ||
            v === "1" ||
            (typeof v === "string" && v.toLowerCase() === "yes") ||
            v === true
          )
            return 1;
          if (
            v === 0 ||
            v === "0" ||
            (typeof v === "string" && v.toLowerCase() === "no") ||
            v === false
          )
            return 0;
          return def;
        };

        let normType = String(Type ?? "").trim();
        if (normType.toLowerCase() === "item") normType = "1";
        if (normType.toLowerCase() === "service") normType = "2";

        const normCost = optStr(Cost);
        const normRate = optStr(Rate);
        const normLowStock = limitStr(low_stock_level ?? "", 100);
        const normItemHasSerial = ynTo01(Item_Has_Serial, 0);
        const normExpired = ynTo01(Expired_Date, 0);

        const safeItemCode = limitStr(Item_Code ?? "", 45);
        const safeSKU = limitStr(productSKU ?? "", 100);
        const safePLU = limitStr(productPLU ?? "", 100);
        const safeBrandName = limitStr(Brand_Name ?? "", 255);
        const safeProductBrand = limitStr(product_brand ?? "", 10);
        const safeBarcode = limitStr(barcode ?? "", 500);

        // Duplicate check removed here; handled below to update existing records instead of throwing 409 error.


        // ---------- Qty_Type: resolve to id ----------
        const resolveQtyTypeId = async (qtyValue, branchId, typeVal, conn) => {
          if (String(typeVal) !== "1") return 0;
          const raw = (qtyValue ?? "").toString().trim();
          if (!raw) return 0;
          if (/^\d+$/.test(raw)) return parseInt(raw, 10);

          const name = raw.slice(0, 50);
          const selectSql = "SELECT idQuantity_Type FROM quantity_type WHERE Branch_idBranch = ? AND LOWER(Description) = LOWER(?) LIMIT 1";
          const [rows] = await conn.promise().query(selectSql, [branchId, name]);
          if (rows && rows.length > 0) return rows[0].idQuantity_Type;

          const insertSql = "INSERT INTO quantity_type (Description, Branch_idBranch) VALUES (?, ?)";
          const [result] = await conn.promise().query(insertSql, [name, branchId]);
          return result.insertId;
        };

        // ---------- Category: resolve to id ----------
        const resolveCategoryId = async (maybeId, maybeName, branchId, typeVal, conn) => {
          if (maybeId && /^\d+$/.test(String(maybeId))) return parseInt(maybeId, 10);
          const rawName = (maybeName ?? DEFAULT_CATEGORY_NAME).toString().trim();
          const name = rawName ? rawName.slice(0, 45) : DEFAULT_CATEGORY_NAME;

          const selectSql = "SELECT idItem_Category FROM item_category WHERE Branch_idBranch = ? AND Type = ? AND LOWER(Description) = LOWER(?) LIMIT 1";
          const [rows] = await conn.promise().query(selectSql, [branchId, String(typeVal), name]);
          if (rows && rows.length > 0) return rows[0].idItem_Category;

          const insertSql = "INSERT INTO item_category (Description, Type, Branch_idBranch) VALUES (?, ?, ?)";
          const [result] = await conn.promise().query(insertSql, [name, String(typeVal), branchId]);
          return result.insertId;
        };

        // ---------- Sub-Category: resolve to id ----------
        const resolveSubCategoryId = async (maybeId, maybeName, branchId, parentCategoryId, conn) => {
          if (maybeId && /^\d+$/.test(String(maybeId))) return parseInt(maybeId, 10);
          const rawName = (maybeName ?? DEFAULT_SUBCATEGORY_NAME).toString().trim();
          const name = rawName ? rawName.slice(0, 255) : DEFAULT_SUBCATEGORY_NAME;

          const selectSql = "SELECT idItem_SubCategory FROM item_sub_category WHERE Branch_idBranch = ? AND Item_Category_idItem_Category = ? AND LOWER(Description) = LOWER(?) LIMIT 1";
          const [rows] = await conn.promise().query(selectSql, [branchId, parentCategoryId, name]);
          if (rows && rows.length > 0) return rows[0].idItem_SubCategory;

          const insertSql = "INSERT INTO item_sub_category (Description, Item_Category_idItem_Category, Branch_idBranch) VALUES (?, ?, ?)";
          const [result] = await conn.promise().query(insertSql, [name, parentCategoryId, branchId]);
          return result.insertId;
        };

        const resolveBrandId = async (maybeId, maybeName, branchId, conn) => {
          if (maybeId && /^\d+$/.test(String(maybeId))) {
            return { id: parseInt(maybeId, 10), name: maybeName };
          }
          let name = (maybeName ?? "").toString().trim();
          if (!name && maybeId && !/^\d+$/.test(String(maybeId))) name = String(maybeId).trim();
          if (!name || name.toLowerCase() === "default brand") return { id: null, name: name || "Default Brand" };

          const selectSql = "SELECT idBrand, BrandName FROM brand WHERE Branch_idBranch = ? AND LOWER(BrandName) = LOWER(?) LIMIT 1";
          const [rows] = await conn.promise().query(selectSql, [branchId, name]);
          if (rows && rows.length > 0) return { id: rows[0].idBrand, name: rows[0].BrandName };

          const insertSql = "INSERT INTO brand (BrandName, Branch_idBranch, CreatedTime) VALUES (?, ?, NOW())";
          const [result] = await conn.promise().query(insertSql, [name, branchId]);
          return { id: result.insertId, name: name };
        };

        const qtyTypeId = await resolveQtyTypeId(Qty_Type, Branch_idBranch, normType, connection);
        const categoryId = await resolveCategoryId(Item_Category_idItem_Category, CategoryName, Branch_idBranch, normType, connection);
        const subCategoryId = await resolveSubCategoryId(Item_Category_idItem_SubCategory, SubCategoryName, Branch_idBranch, categoryId, connection);
        const brandResult = await resolveBrandId(product_brand, Brand_Name, Branch_idBranch, connection);
        const brandId = brandResult.id;
        const resolvedBrandName = brandResult.name;

        const mainImage = req.files?.mainImage?.[0]?.filename || null;

        let idItem;
        let isUpdate = false;

        const [existingRows] = await connection.promise().query(
          "SELECT idItem FROM item WHERE Description = ? AND Branch_idBranch = ? LIMIT 1",
          [Description, Branch_idBranch]
        );

        if (existingRows && existingRows.length > 0) {
          isUpdate = true;
          idItem = existingRows[0].idItem;

          // Update existing item columns (except opening qty, description and branch_id)
          const updateSql = `
            UPDATE item SET
              Type = ?,
              Item_Category_idItem_Category = ?,
              Item_Category_idItem_SubCategory = ?,
              Zone_IdZone = ?,
              Item_Code = ?,
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
              Expired_Date = ?,
              product_brand = ?,
              Item_Has_Serial = ?,
              barcode = ?
            WHERE idItem = ?
          `;
          const updateValues = [
            normType,
            categoryId,
            subCategoryId,
            Zone_IdZone || null,
            safeItemCode,
            Long_Description,
            Item_Description,
            resolvedBrandName || safeBrandName,
            Alert_Qty || 0,
            normCost,
            normRate,
            qtyTypeId,
            safeSKU,
            safePLU,
            normLowStock,
            normExpired,
            brandId,
            normItemHasSerial,
            safeBarcode,
            idItem
          ];

          await connection.promise().query(updateSql, updateValues);
          console.log(`[Excel Import Update] Updated existing product ID: ${idItem}`);
        } else {
          const product = await dbService.insertExcelProduct(
            normType,
            categoryId,
            subCategoryId,
            Zone_IdZone || null,
            safeItemCode,
            Description,
            Long_Description,
            Item_Description,
            resolvedBrandName || safeBrandName,
            Alert_Qty || 0,
            normCost,
            normRate,
            qtyTypeId,
            Branch_idBranch,
            mainImage,
            safeSKU,
            safePLU,
            normLowStock,
            0, // target_stock: not present in the Excel import template, defaults to 0
            normExpired,
            brandId,
            normItemHasSerial,
            safeBarcode,
            parseFloat(Opening_Qty || 0),
            connection,
          );
          idItem = product.insertId;
        }

        // ✅ custom fields
        if (Array.isArray(customFields) && customFields.length > 0) {
          for (const field of customFields) {
            if (field.field_id && field.value != null) {
              await connection.promise().query(
                "INSERT INTO product_field_data (item_id, field_id, value) VALUES (?, ?, ?)",
                [idItem, field.field_id, field.value],
              );
            }
          }
        }

        // ✅ barcodes
        if (Array.isArray(barcodes) && barcodes.length > 0) {
          await insertProductBarcodes(idItem, barcodes, connection);
        }

        // ✅ promotions
        if (Array.isArray(promotions) && promotions.length > 0) {
          const formattedPromotions = promotions.map((p) => [
            idItem,
            parseFloat(p.price),
            p.start,
            p.end,
          ]);
          await insertProductPromotions(formattedPromotions, connection);
        }

        // ✅ gallery images
        const galleryFiles = req.files?.galleryImages || [];
        const galleryImageFilenames = galleryFiles.map((f) => f.filename);
        if (galleryImageFilenames.length > 0) {
          await insertProductImages(idItem, galleryImageFilenames, connection);
        }

        // ✅ documents
        const documentFiles = req.files?.documents || [];
        const documentData = documentFiles.map((f) => ({
          name: f.originalname,
          url: f.filename,
        }));
        if (documentData.length > 0) {
          await insertProductDocuments(idItem, documentData, connection);
        }

        let companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
        if (!companyId) {
          const [bRows] = await connection.promise().query(
            "SELECT companyId FROM accounting_accounts WHERE Branch_idBranch = ? AND companyId IS NOT NULL AND companyId > 0 LIMIT 1",
            [Branch_idBranch]
          );
          companyId = bRows[0]?.companyId;
        }
        if (!companyId) {
          const [phRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Branch_idBranch = ? AND Company_idCompany IS NOT NULL AND Company_idCompany > 0 ORDER BY idProduct_History_Log DESC LIMIT 1",
            [Branch_idBranch]
          );
          companyId = phRows[0]?.Company_idCompany;
        }

        if (!isUpdate) {
          await productHistoryLogHelper({
            productId: idItem,
            variationId: null,
            quantityChange: parseFloat(Opening_Qty || 0),
            oldQty: 0,
            newQty: parseFloat(Opening_Qty || 0),
            type: "Item Created (Excel)",
            description: `New item created via Excel import with opening quantity ${Opening_Qty || 0}`,
            branchId: Branch_idBranch,
            companyId,
            userId: User_idUser || req.user?.id || 1,
            referenceId: idItem,
            connection,
          });

          // Accounting: Post opening stock double entry for Excel imported new products
          const initQty = parseFloat(Opening_Qty || item.Qty || item.qty || 0);
          const initCost = parseFloat(Cost || item.Real_Cost || item.real_cost || 0);
          if (initQty > 0) {
            await postOpeningStockAccounting({
              productId: idItem,
              productName: Description,
              quantity: initQty,
              unitCost: initCost,
              branchId: Branch_idBranch,
              companyId,
              userId: User_idUser || req.user?.id || 1,
              connection,
            });
          }

          await userLogDbService.insertLog(
            User_idUser,
            currentDate(),
            "Item",
            idItem,
            "create",
            Branch_idBranch,
            connection,
          );
        } else {
          await userLogDbService.insertLog(
            User_idUser,
            currentDate(),
            "Item",
            idItem,
            "update",
            Branch_idBranch,
            connection,
          );
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error(`[Excel Import Error] Commit failed for ${Item_Code || Description}:`, commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          console.log(`[Excel Import Success] Product imported: ${Item_Code || Description}`);
          res.status(201).json({ message: "Item added successfully" });
        });
      } catch (err) {
        console.error(`[Excel Import Error] Failed to import product ${Item_Code || Description}:`, err);
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            message: "Error creating item",
            error: err.message,
            failedProduct: { Item_Code, Description },
          });
        });
      }
    });
  });
};

const deleteItem = async (req, res) => {
  const id = req.params.id;

  try {
    // 1. Fetch item to get Branch_idBranch and item details
    const [rows] = await db.promise().query(
      "SELECT idItem, Description, Item_Code, Branch_idBranch, approval_status FROM item WHERE idItem = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    const item = rows[0];

    // Check if approval is required for DELETE_PRODUCT
    let companyId = req.user?.company_id || req.headers["company_id"];
    if (!companyId || companyId === 1) {
      const [bRows] = await db.promise().query(
        "SELECT Company_idCompany FROM branch WHERE idBranch = ?",
        [item.Branch_idBranch]
      );
      if (bRows.length > 0 && bRows[0].Company_idCompany) {
        companyId = bRows[0].Company_idCompany;
      }
    }
    companyId = parseInt(companyId, 10) || 1;

    let approvalRequired = false;
    try {
      approvalRequired = await approvalService.isApprovalRequired(
        companyId,
        item.Branch_idBranch,
        "DELETE_PRODUCT"
      );
    } catch (appErr) {
      console.error("[PRODUCT] Error checking DELETE_PRODUCT approval:", appErr);
    }

    if (approvalRequired) {
      // DO NOT delete from DB upfront! Mark as PENDING_APPROVAL and trigger approval
      await db.promise().query(
        "UPDATE item SET approval_status = 'PENDING_APPROVAL' WHERE idItem = ?",
        [id]
      );

      const createdBy = req.user?.idUser || req.user?.userId || 1;
      await approvalService.triggerApprovalRequest({
        action_type: "DELETE_PRODUCT",
        module_name: "Product Management",
        erp_record_id: id,
        company_id: companyId,
        branch_id: item.Branch_idBranch,
        initiated_by: createdBy,
        payload_summary: {
          item_name: item.Description,
          item_code: item.Item_Code,
          action: "DELETE_PRODUCT"
        }
      });

      console.log(`[PRODUCT] Product ${id} deletion submitted for approval (company: ${companyId}, branch: ${item.Branch_idBranch})`);
      return res.json({
        message: "Product deletion submitted for approval. Record will be deleted once approved.",
        approval_required: true,
        approval_status: "PENDING_APPROVAL"
      });
    }

    // Direct deletion if no approval required
    const [result] = await db.promise().query("DELETE FROM item WHERE idItem = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item not found" });
    }
    res.json({ message: "Item deleted successfully" });
  } catch (err) {
    console.error("Error deleting item:", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
};

const createCategory = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }
    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }
      try {
        const { Description, Branch_idBranch, Type } = req.body;
        await dbService.insertCategory(
          Description,
          Branch_idBranch,
          Type,
          connection,
        );
        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({
            message: "Category added successfully",
          });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res
            .status(500)
            .json({ message: "Error creating item", error: err.message });
        });
      }
    });
  });
};

const deleteCategory = (req, res) => {
  return deleteCategoryById(req, res);
};

// Function to get category by branch ID
const getCategory = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const category = await dbService.fetchCategory(Branch_idBranch);
    res.json(category);
  } catch (err) {
    console.error("Error fetching category:", err);
    res
      .status(500)
      .json({ message: "Error fetching category", error: err.message });
  }
};

// Function to update a category by ID
const updateCategoryById = async (req, res) => {
  try {
    const { idItem_Category } = req.params;
    const { Description, Type, Branch_idBranch } = req.body;
    await dbService.updateCategory(
      idItem_Category,
      Description,
      Type,
      Branch_idBranch,
    );

    res.json({ message: "Category updated successfully" });
  } catch (err) {
    console.error("Error updating Category:", err);
    res
      .status(500)
      .json({ message: "Error updating Category", error: err.message });
  }
};

const deleteCategoryById = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }
    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }
      try {
        const idItem_Category = req.params.idItem_Category || req.params.id;

        const checkItemsInCategory = await dbService.getCategoryItems(
          idItem_Category,
          connection,
        );

        if (checkItemsInCategory.length > 0) {
          return connection.rollback(() => {
            connection.release();
            res
              .status(409)
              .json({ message: "Category has associated Items. Cannot delete." });
          });
        }

        const checkSubCategories = await dbService.getCategorySubCategories(
          idItem_Category,
          connection,
        );

        // Filter out the system-generated "Default" sub-category created automatically during category creation
        const userSubCategories = checkSubCategories.filter(
          (sub) =>
            sub.Description &&
            sub.Description.trim().toLowerCase() !== "default",
        );

        if (userSubCategories.length > 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(409).json({
              message: "Category has associated Sub-Categories. Cannot delete.",
            });
          });
        }

        await dbService.deleteCategory(idItem_Category, connection);

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Category deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error deleting Category:", err);
          res
            .status(500)
            .json({ message: "Error deleting Category", error: err.message });
        });
      }
    });
  });
};

const getItems = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { page, limit, search, category, brand, status, supplier } = req.query;

    if (page && limit) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      const { items, total } = await dbService.fetchItemsPaginated(
        Branch_idBranch,
        limitNum,
        offset,
        search,
        category,
        brand,
        status,
        supplier,
      );

      const enrichedItems = await Promise.all(
        items.map(async (item) => {
          const images = await dbService.fetchProductImages(item.idItem);
          const documents = await dbService.fetchProductDocuments(item.idItem);
          const barcodes = await dbService.fetchProductBarcodes(item.idItem);
          const rawVariations = await fetchProductVariations(item.idItem);
          const variations = (rawVariations || []).map((v) => {
            const vWhData = item.warehouse_variations?.[v.id];
            const vWhQty = vWhData ? parseFloat(vWhData.total_warehouse_qty || 0) : 0;
            const vCurrentQty = parseFloat(v.qty || 0);
            let vFloorQty = vCurrentQty;
            let vCombined = vCurrentQty;
            if (vWhQty > 0) {
              if (vCurrentQty >= vWhQty) {
                vFloorQty = vCurrentQty - vWhQty;
                vCombined = vCurrentQty;
              } else if (vCurrentQty < 0) {
                vFloorQty = vCurrentQty;
                vCombined = vWhQty + vCurrentQty;
              } else {
                vFloorQty = 0;
                vCombined = vWhQty;
              }
            }
            return {
              ...v,
              floor_qty: vFloorQty,
              warehouse_stock: vWhQty,
              total_combined_qty: vCombined,
              warehouse_breakdown: vWhData ? vWhData.breakdown : [],
            };
          });
          const suppliers = await dbService.getItemSuppliers(item.idItem).catch((err) => {
            console.error(`Error fetching suppliers for item ${item.idItem}:`, err);
            return [];
          });
          const supplier_ids = (suppliers || []).map((s) => s.Supplier_idSupplier);
          return { ...item, images, documents, barcodes, variations, suppliers, supplier_ids };
        }),
      );

      return res.json({
        data: enrichedItems,
        total,
        page: pageNum,
        limit: limitNum,
      });
    }

    // Default behavior (fetch all active items unless status is specified)
    const itemStatus = status !== undefined ? status : 1;
    const items = await dbService.fetchItems(Branch_idBranch, itemStatus);

    if (items.length === 0) {
      return res.status(404).json({ message: "Items not found" });
    }

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const images = await dbService.fetchProductImages(item.idItem);
        const documents = await dbService.fetchProductDocuments(item.idItem);
        const barcodes = await dbService.fetchProductBarcodes(item.idItem);
        const rawVariations = await fetchProductVariations(item.idItem);
        const variations = (rawVariations || []).map((v) => {
          const vWhData = item.warehouse_variations?.[v.id];
          const vWhQty = vWhData ? parseFloat(vWhData.total_warehouse_qty || 0) : 0;
          const vCurrentQty = parseFloat(v.qty || 0);
          let vFloorQty = vCurrentQty;
          let vCombined = vCurrentQty;
          if (vWhQty > 0) {
            if (vCurrentQty >= vWhQty) {
              vFloorQty = vCurrentQty - vWhQty;
              vCombined = vCurrentQty;
            } else if (vCurrentQty < 0) {
              vFloorQty = vCurrentQty;
              vCombined = vWhQty + vCurrentQty;
            } else {
              vFloorQty = 0;
              vCombined = vWhQty;
            }
          }
          return {
            ...v,
            floor_qty: vFloorQty,
            warehouse_stock: vWhQty,
            total_combined_qty: vCombined,
            warehouse_breakdown: vWhData ? vWhData.breakdown : [],
          };
        });
        return { ...item, images, documents, barcodes, variations };
      }),
    );

    res.json(enrichedItems);
  } catch (err) {
    console.error("Error fetching items in getItems:", err);
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

// ✅ Get all service items and enrich with images, documents, and barcodes
const getServices = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const status = req.query.status !== undefined ? req.query.status : 1;
    const items = await dbService.fetchServices(Branch_idBranch, status);

    // if (items.length === 0) {
    //   return res.status(404).json({ message: "Services not found" });
    // }

    const enrichedServices = await Promise.all(
      items.map(async (item) => {
        const images = await dbService.fetchProductImages(item.idItem);
        const documents = await dbService.fetchProductDocuments(item.idItem);
        const barcodes = await dbService.fetchProductBarcodes(item.idItem);
        const variations = await fetchProductVariations(item.idItem); // ✅ Fetch variations
        return { ...item, images, documents, barcodes, variations };
      }),
    );

    res.json(enrichedServices);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching services",
      error: err.message,
    });
  }
};

const getProducts = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const status = req.query.status !== undefined ? req.query.status : 1;
    const products = await dbService.fetchProducts(Branch_idBranch, status);
    if (products.length === 0) {
      return res.status(404).json({ message: "Products not found" });
    }
    res.json(products);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching products",
      error: err.message,
    });
  }
};

const applyPendingProductUpdate = async (idItem, pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[PRODUCT] No pending updates found for product #${idItem}`);
    return;
  }

  const {
    productData = {},
    deleted_variations = [],
    customFields = [],
    variations = [],
    barcodes = [],
    mainImage = null,
    galleryImageFilenames = [],
    documentData = [],
    User_idUser = 1,
    Branch_idBranch = 1,
  } = pendingUpdates;

  const {
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
    discount_min,
    discount_max,
    discount_type,
  } = productData;

  return new Promise((resolve, reject) => {
    db.getConnection(async (connErr, connection) => {
      if (connErr) return reject(connErr);

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          return reject(beginErr);
        }

        try {
          // 1. Update core product data
          await dbService.updateProduct(
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
            target_stock,
            Item_Has_Expire_Date,
            product_brand,
            Item_Has_Serial,
            barcode,
            mainImage,
            discount_min,
            discount_max,
            discount_type,
            idItem,
            connection
          );

          // 2. Update custom field values only
          if (Array.isArray(customFields) && customFields.length > 0) {
            for (const field of customFields) {
              const value = Array.isArray(field.value)
                ? field.value.join(",")
                : field.value;
              const fieldId = field.field_id || field.fieldId;
              if (fieldId) {
                const updateSql = `
                  UPDATE product_field_data
                  SET value = ?
                  WHERE item_id = ? AND field_id = ?
                `;
                await new Promise((resQ, rejQ) => {
                  connection.query(updateSql, [value, idItem, fieldId], (err) => err ? rejQ(err) : resQ());
                });
              }
            }
          }

          // 3. Save gallery images
          if (Array.isArray(galleryImageFilenames) && galleryImageFilenames.length > 0) {
            await insertProductImages(idItem, galleryImageFilenames, connection);
          }

          // 4. Save documents
          if (Array.isArray(documentData) && documentData.length > 0) {
            await insertProductDocuments(idItem, documentData, connection);
          }

          // 5. Handle Variations Update
          if (Array.isArray(deleted_variations) && deleted_variations.length > 0) {
            await deleteProductVariations(deleted_variations, connection);
          }

          if (Array.isArray(variations) && variations.length > 0) {
            const newVariations = [];
            for (const v of variations) {
              if (v.id) {
                await updateProductVariation(v, connection);
              } else {
                newVariations.push(v);
              }
            }
            if (newVariations.length > 0) {
              await insertProductVariations(idItem, newVariations, connection);
            }
          }

          // 6. Update barcodes
          if (Array.isArray(barcodes) && barcodes.length > 0) {
            await insertProductBarcodes(idItem, barcodes, connection);
          }

          // 7. Activate item status
          await new Promise((resQ, rejQ) => {
            connection.query(
              "UPDATE item SET approval_status = 'ACTIVE', Status = '1' WHERE idItem = ?",
              [idItem],
              (err) => err ? rejQ(err) : resQ()
            );
          });

          // 8. Log the update
          await userLogDbService.insertLog(
            User_idUser || 1,
            currentDate(),
            "Item",
            idItem,
            "edit (approval applied)",
            Branch_idBranch || 1,
            connection
          );

          connection.commit((commitErr) => {
            if (commitErr) {
              return connection.rollback(() => {
                connection.release();
                reject(commitErr);
              });
            }
            connection.release();
            console.log(`[PRODUCT] Pending updates applied successfully for product #${idItem}`);
            resolve();
          });
        } catch (err) {
          connection.rollback(() => {
            connection.release();
            console.error(`[PRODUCT] Error applying pending updates for product #${idItem}:`, err);
            reject(err);
          });
        }
      });
    });
  });
};

const updateProduct = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const { idItem } = req.params;

        let productData;
        try {
          productData = JSON.parse(req.body.productData);
        } catch (err) {
          connection.release();
          return res.status(400).json({
            message: "Invalid product data format",
            error: err.message,
          });
        }

        const {
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
          User_idUser,
          Branch_idBranch,
          productSKU,
          productPLU,
          low_stock_level,
          target_stock,
          Item_Has_Expire_Date,
          product_brand,
          Item_Has_Serial,
          barcode,
          discount_min,
          discount_max,
          discount_type,
          is_visible,
          barcodes = [],
          customFields = [], // ✅ Extract custom fields
          variations = [],
          supplier_ids = [],
          supplier_id,
        } = productData;

        let deleted_variations = [];
        try {
          let rawDeleted = req.body.deleted_variations || productData.deleted_variations;
          if (Array.isArray(rawDeleted)) {
            rawDeleted = rawDeleted[0];
          }
          while (typeof rawDeleted === 'string') {
            rawDeleted = JSON.parse(rawDeleted);
          }
          if (Array.isArray(rawDeleted)) {
            deleted_variations = rawDeleted.map(id => Number(id)).filter(id => !isNaN(id));
          }
          console.log("[INFO] deleted_variations:", deleted_variations);
        } catch (e) {
          console.error("Error parsing deleted_variations:", e);
        }

        const mainImage = req.files?.mainImage?.[0]?.filename || null;
        const galleryFiles = req.files?.galleryImages || [];
        const galleryImageFilenames = galleryFiles.map((file) => file.filename);
        const documentFiles = req.files?.documents || [];
        const documentData = documentFiles.map((file) => ({
          name: file.originalname,
          url: file.filename,
        }));

        // Resolve companyId
        let companyId = req.user?.company_id || req.headers["company_id"];
        if (!companyId || companyId === 1) {
          const [bRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM branch WHERE idBranch = ?",
            [Branch_idBranch]
          );
          if (bRows.length > 0 && bRows[0].Company_idCompany) {
            companyId = bRows[0].Company_idCompany;
          }
        }
        companyId = parseInt(companyId, 10) || 1;

        // Check if approval required for EDIT_PRODUCT
        let approvalRequired = false;
        try {
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            Branch_idBranch,
            "EDIT_PRODUCT"
          );
        } catch (appErr) {
          console.error("[PRODUCT] Error checking EDIT_PRODUCT approval:", appErr);
        }

        if (approvalRequired) {
          await new Promise((resolve, reject) => {
            connection.query(
              "UPDATE item SET approval_status = 'PENDING_APPROVAL' WHERE idItem = ?",
              [idItem],
              (err) => (err ? reject(err) : resolve())
            );
          });

          const oldDataList = await new Promise((resolve, reject) => {
            connection.query("SELECT * FROM item WHERE idItem = ?", [idItem], (err, res) => {
              if (err) reject(err); else resolve(res);
            });
          });
          const oldData = oldDataList && oldDataList.length > 0 ? oldDataList[0] : null;

          await new Promise((resolve, reject) => {
            connection.commit((err) => (err ? reject(err) : resolve()));
          });
          connection.release();

          const createdBy = req.user?.idUser || req.user?.userId || User_idUser || 1;
          const pendingUpdates = {
            productData,
            deleted_variations,
            customFields,
            variations,
            barcodes,
            mainImage,
            galleryImageFilenames,
            documentData,
            User_idUser,
            Branch_idBranch,
            companyId,
          };

          const changed_fields = {};
          if (oldData) {
             Object.keys(productData).forEach(key => {
               const newVal = productData[key];
               const o = (oldData[key] === null || oldData[key] === undefined) ? '' : String(oldData[key]).trim();
               const n = (newVal === null || newVal === undefined) ? '' : String(newVal).trim();
               if (o !== n) {
                 changed_fields[key] = { old: oldData[key] || '-', new: newVal || '-' };
               }
             });
          }

          try {
            await approvalService.triggerApprovalRequest({
              action_type: "EDIT_PRODUCT",
              module_name: "Product Management",
              erp_record_id: idItem,
              company_id: companyId,
              branch_id: Branch_idBranch,
              initiated_by: createdBy,
              payload_summary: {
                item_name: Description || Item_Description,
                item_code: Item_Code,
                rate: Rate,
                cost: Cost,
                action: "EDIT_PRODUCT",
                changed_fields,
                pending_updates: pendingUpdates,
              },
            });
            console.log(`[PRODUCT] Triggered approval request for editing product ${idItem} under company ${companyId}`);
          } catch (approvalErr) {
            console.error("[PRODUCT] Error triggering approval webhook for EDIT_PRODUCT:", approvalErr);
            return res.status(500).json({ error: "Failed to submit approval request." });
          }

          return res.json({
            success: true,
            message: "Product edit submitted for approval. Changes will take effect once approved.",
            approval_required: true,
            approval_status: "PENDING_APPROVAL",
          });
        }

        // ✅ Update core product data (when no approval is required)
        await dbService.updateProduct(
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
          mainImage,
          discount_min,
          discount_max,
          discount_type,
          is_visible !== undefined ? (is_visible ? 1 : 0) : 1,
          idItem,
          connection, // 🆕
        );

        if (supplier_ids !== undefined || supplier_id !== undefined) {
          const finalSupplierIds = Array.isArray(supplier_ids)
            ? supplier_ids
            : supplier_id
              ? [supplier_id]
              : [];
          await dbService.saveItemSuppliers(idItem, finalSupplierIds, Branch_idBranch, connection);
        }

        // ✅ Update custom field values only (no insert)
        if (Array.isArray(customFields) && customFields.length > 0) {
          for (const field of customFields) {
            const value = Array.isArray(field.value)
              ? field.value.join(",")
              : field.value;

            const fieldId = field.field_id || field.fieldId; // ✅ Supports both camelCase and snake_case

            const updateSql = `
          UPDATE product_field_data
          SET value = ?
          WHERE item_id = ? AND field_id = ?
        `;

            await connection // 🆕 use connection
              .promise()
              .query(updateSql, [value, idItem, fieldId]);
          }
        }

        // ✅ Save gallery images
        if (galleryImageFilenames.length > 0) {
          await insertProductImages(idItem, galleryImageFilenames, connection); // 🆕
        }

        // ✅ Save documents
        if (documentData.length > 0) {
          await insertProductDocuments(idItem, documentData, connection); // 🆕
        }

        // ✅ Handle Variations Update
        if (
          Array.isArray(deleted_variations) &&
          deleted_variations.length > 0
        ) {
          await deleteProductVariations(deleted_variations, connection); // 🆕
        }

        if (Array.isArray(variations) && variations.length > 0) {
          const newVariations = [];
          for (const v of variations) {
            if (v.id) {
              await updateProductVariation(v, connection); // 🆕
            } else {
              newVariations.push(v);
            }
          }
          if (newVariations.length > 0) {
            await insertProductVariations(idItem, newVariations, connection); // 🆕
          }
        }

        // ✅ Update barcodes
        if (Array.isArray(barcodes) && barcodes.length > 0) {
          await insertProductBarcodes(idItem, barcodes, connection); // 🆕
        }

        // ✅ Log the update
        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Item",
          idItem,
          "edit",
          Branch_idBranch,
          connection, // 🆕
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Item updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating Item:", err);
          res.status(500).json({
            message: "Error updating Item",
            error: err.message,
          });
        });
      }
    });
  });
};

const updateProductQty = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const { idItem } = req.params;
        const { Qty, Type, User_idUser, Branch_idBranch, variationId } = req.body;

        const item = await dbService.fetchItem(idItem, connection); // 🆕
        let in_qty = 0;
        let out_qty = 0;
        let oldQty = 0;
        let description = `Stock updated manually from [old] to ${Qty}`;
        let varRows = null;

        if (variationId) {
          varRows = await dbService.fetchVariation(variationId, connection);
          if (!varRows || varRows.length === 0) {
            connection.release();
            return res.status(404).json({ error: "Variation not found" });
          }
          oldQty = parseFloat(varRows[0].qty || 0);
          if (oldQty > parseFloat(Qty)) {
            out_qty = oldQty - parseFloat(Qty);
          } else if (oldQty < parseFloat(Qty)) {
            in_qty = parseFloat(Qty) - oldQty;
          }
          description = `Variation [${varRows[0].description}] stock updated manually from ${oldQty} to ${Qty}`;

          const updateVarSql = `UPDATE item_variations SET qty = ? WHERE id = ?`;
          await connection.promise().query(updateVarSql, [Qty, variationId]);

          // Sync product total qty
          const [varSum] = await connection.promise().query(
            `SELECT SUM(qty) AS total FROM item_variations WHERE item_id = ?`,
            [idItem]
          );
          const totalNewQty = parseFloat(varSum[0].total || 0);
          await dbService.updateProductQty(totalNewQty, idItem, connection);
        } else {
          oldQty = parseFloat(item[0].Qty || 0);
          if (oldQty > parseFloat(Qty)) {
            out_qty = oldQty - parseFloat(Qty);
          } else if (oldQty < parseFloat(Qty)) {
            in_qty = parseFloat(Qty) - oldQty;
          }
          description = `Stock updated manually from ${oldQty} to ${Qty}`;
          await dbService.updateProductQty(Qty, idItem, connection); // 🆕
        }

        let companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
        if (!companyId) {
          const [bRows] = await connection.promise().query(
            "SELECT companyId FROM accounting_accounts WHERE Branch_idBranch = ? AND companyId IS NOT NULL AND companyId > 0 LIMIT 1",
            [Branch_idBranch]
          );
          companyId = bRows[0]?.companyId;
        }
        if (!companyId) {
          const [phRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Branch_idBranch = ? AND Company_idCompany IS NOT NULL AND Company_idCompany > 0 ORDER BY idProduct_History_Log DESC LIMIT 1",
            [Branch_idBranch]
          );
          companyId = phRows[0]?.Company_idCompany;
        }

        await productHistoryLogHelper({
          productId: idItem,
          variationId: variationId || null,
          quantityChange: in_qty > 0 ? in_qty : -out_qty,
          oldQty: oldQty,
          newQty: parseFloat(Qty),
          type: Type == 0 ? "Quantity Update (Add)" : "Quantity Update (Adjust)",
          description: description,
          branchId: Branch_idBranch,
          companyId,
          userId: User_idUser,
          referenceId: idItem,
          connection,
        });

        // Accounting: Post stock adjustment double entry
        const updateDelta = in_qty > 0 ? in_qty : -out_qty;
        const updateUnitCost = variationId && varRows?.[0]
          ? parseFloat(varRows[0].cost || varRows[0].real_cost || item[0].Cost || item[0].Real_Cost || 0)
          : parseFloat(item[0].Cost || item[0].Real_Cost || 0);

        if (updateDelta !== 0) {
          await postStockAdjustmentAccounting({
            productId: idItem,
            productName: item[0].Description,
            deltaQty: updateDelta,
            unitCost: updateUnitCost,
            branchId: Branch_idBranch,
            companyId,
            userId: User_idUser,
            reference: Type == 0 ? "Add Quantity" : "Adjust Quantity",
            notes: description,
            connection,
          });
        }

        if (Type == 0) {
          await userLogDbService.insertLog(
            User_idUser,
            currentDate(),
            "Item",
            idItem,
            "addQty",
            Branch_idBranch,
            connection, // 🆕
          );
        } else if (Type == 1) {
          await userLogDbService.insertLog(
            User_idUser,
            currentDate(),
            "Item",
            idItem,
            "adjustQty",
            Branch_idBranch,
            connection, // 🆕
          );
        }

        await stockCardDbService.insertStockCard(
          item[0].idItem,
          item[0].Description,
          "addQty",
          idItem,
          item[0].Cost,
          item[0].Real_Cost,
          item[0].Rate,
          in_qty,
          out_qty,
          variationId ? (await connection.promise().query(`SELECT Qty FROM item WHERE idItem = ?`, [idItem]))[0][0].Qty : Qty,
          Branch_idBranch,
          connection, // 🆕
          variationId || null,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Item qty updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating Item qty:", err);
          res
            .status(500)
            .json({ message: "Error updating Item qty", error: err.message });
        });
      }
    });
  });
};

const adjustProductQty = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        const { idItem } = req.params;
        const { Qty, User_idUser, Branch_idBranch, variationId, warehouseId } = req.body;
        const item = await dbService.fetchItem(idItem, connection); // 🆕

        let in_qty = 0;
        let out_qty = 0;
        let oldQty = 0;
        let description = `Stock adjusted manually from [old] to ${Qty}`;
        let varRows = null;

        if (variationId) {
          varRows = await dbService.fetchVariation(variationId, connection);
          if (!varRows || varRows.length === 0) {
            connection.release();
            return res.status(404).json({ error: "Variation not found" });
          }
          oldQty = parseFloat(varRows[0].qty || 0);
          if (oldQty > parseFloat(Qty)) {
            out_qty = oldQty - parseFloat(Qty);
          } else if (oldQty < parseFloat(Qty)) {
            in_qty = parseFloat(Qty) - oldQty;
          }
          description = `Variation [${varRows[0].description}] stock adjusted manually from ${oldQty} to ${Qty}`;

          const updateVarSql = `UPDATE item_variations SET qty = ? WHERE id = ?`;
          await connection.promise().query(updateVarSql, [Qty, variationId]);

          // Sync product total qty
          const [varSum] = await connection.promise().query(
            `SELECT SUM(qty) AS total FROM item_variations WHERE item_id = ?`,
            [idItem]
          );
          const totalNewQty = parseFloat(varSum[0].total || 0);
          await dbService.adjustProductQty(totalNewQty, idItem, connection);
        } else {
          oldQty = parseFloat(item[0].Qty || 0);
          if (oldQty > parseFloat(Qty)) {
            out_qty = oldQty - parseFloat(Qty);
          } else if (oldQty < parseFloat(Qty)) {
            in_qty = parseFloat(Qty) - oldQty;
          }
          description = `Stock adjusted manually from ${oldQty} to ${Qty}`;
          await dbService.adjustProductQty(Qty, idItem, connection); // 🆕
        }

        // Sync with warehouse if warehouseId is specified
        if (warehouseId) {
          const delta = in_qty > 0 ? in_qty : -out_qty;
          if (delta < 0) {
            const [wBatches] = await connection.promise().query(
              `SELECT * FROM item_batch WHERE item_id = ? AND (variation_id <=> ?) AND warehouse_id = ? AND qty > 0 ORDER BY batch_id ASC FOR UPDATE`,
              [idItem, variationId || null, Number(warehouseId)]
            );
            const totalWhQty = wBatches.reduce((sum, b) => sum + (parseFloat(b.qty) || 0), 0);
            if (totalWhQty < Math.abs(delta)) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({ error: `Cannot deduct ${Math.abs(delta)}. Only ${totalWhQty} available in selected warehouse.` });
              });
            }
            let toDeduct = Math.abs(delta);
            for (const b of wBatches) {
              if (toDeduct <= 0) break;
              const bQty = parseFloat(b.qty) || 0;
              const take = Math.min(toDeduct, bQty);
              await connection.promise().query("UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?", [take, b.batch_id]);
              toDeduct -= take;
            }
          } else if (delta > 0) {
            const [wBatches] = await connection.promise().query(
              `SELECT * FROM item_batch WHERE item_id = ? AND (variation_id <=> ?) AND warehouse_id = ? ORDER BY batch_id DESC LIMIT 1 FOR UPDATE`,
              [idItem, variationId || null, Number(warehouseId)]
            );
            if (wBatches.length > 0) {
              await connection.promise().query("UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?", [delta, wBatches[0].batch_id]);
            } else {
              const uCost = variationId && varRows?.[0] ? Number(varRows[0].cost || item[0].Cost) : Number(item[0].Cost || 0);
              await connection.promise().query(
                `INSERT INTO item_batch (item_id, variation_id, warehouse_id, qty, cost, total_cost, date, status, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, CURDATE(), 1, ?)`,
                [idItem, variationId || null, Number(warehouseId), delta, uCost, uCost * delta, Branch_idBranch]
              );
            }
          }

          // Sync warehouse counters
          await connection.promise().query(
            `UPDATE warehouses w
             SET 
               stock_count = COALESCE((SELECT SUM(ib.qty) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0),
               item_count = COALESCE((SELECT COUNT(DISTINCT ib.item_id) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0)
             WHERE w.id = ?`,
            [Number(warehouseId)]
          );

          // Audit log for warehouse
          const [whNameRows] = await connection.promise().query("SELECT name FROM warehouses WHERE id = ?", [Number(warehouseId)]);
          const whName = whNameRows[0]?.name || `Warehouse #${warehouseId}`;
          const auditDetails = {
            type: "STOCK_ADJUSTMENT",
            reference: `Product Adjustment`,
            warehouseName: whName,
            items: [{ id: idItem, delta, newQty: Qty }]
          };
          const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
          const ua = req.headers["user-agent"] || null;
          await connection.promise().query(
            `INSERT INTO warehouse_audit_logs (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent) VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)`,
            [Number(warehouseId), Branch_idBranch, User_idUser, JSON.stringify(auditDetails), ip, ua]
          );
        }

        let companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch);
        if (!companyId) {
          const [bRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM branch WHERE idBranch = ? LIMIT 1",
            [Branch_idBranch]
          );
          companyId = bRows[0]?.Company_idCompany;
        }
        if (!companyId) {
          const [anyRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Company_idCompany IS NOT NULL ORDER BY idProduct_History_Log DESC LIMIT 1"
          );
          companyId = anyRows[0]?.Company_idCompany || 1;
        }

        await productHistoryLogHelper({
          productId: idItem,
          variationId: variationId || null,
          quantityChange: in_qty > 0 ? in_qty : -out_qty,
          oldQty: oldQty,
          newQty: parseFloat(Qty),
          type: "Stock Adjustment",
          description: description,
          branchId: Branch_idBranch,
          companyId,
          userId: User_idUser,
          referenceId: idItem,
          connection,
        });

        // Accounting: Post stock adjustment double entry
        const adjustDelta = in_qty > 0 ? in_qty : -out_qty;
        const adjustUnitCost =
          variationId && varRows?.[0]
            ? parseFloat(varRows[0].cost || varRows[0].real_cost || item[0].Cost || item[0].Real_Cost || 0)
            : parseFloat(item[0].Cost || item[0].Real_Cost || 0);

        if (adjustDelta !== 0) {
          await postStockAdjustmentAccounting({
            productId: idItem,
            productName: item[0].Description,
            deltaQty: adjustDelta,
            unitCost: adjustUnitCost,
            branchId: Branch_idBranch,
            companyId,
            userId: User_idUser,
            reference: "Manual Stock Adjustment",
            notes: description,
            connection,
          });
        }

        await userLogDbService.insertLog(
          User_idUser,
          currentDate(),
          "Item",
          idItem,
          "adjustQty",
          Branch_idBranch,
          connection, // 🆕
        );

        await stockCardDbService.insertStockCard(
          item[0].idItem,
          item[0].Description,
          "adjustQty",
          idItem,
          item[0].Cost,
          item[0].Real_Cost,
          item[0].Rate,
          in_qty,
          out_qty,
          variationId ? (await connection.promise().query(`SELECT Qty FROM item WHERE idItem = ?`, [idItem]))[0][0].Qty : Qty,
          Branch_idBranch,
          connection, // 🆕
          variationId || null,
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Item qty adjust successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error adjusting Item qty:", err);
          res.status(500).json({
            message: "Error adjusting Item qty",
            error: err.message,
          });
        });
      }
    });
  });
};

const updateProductStatus = async (req, res) => {
  try {
    const { idItem } = req.params;
    const { Branch_idBranch, User_idUser } = req.body;

    await dbService.updateStatus(idItem);

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Item",
      idItem,
      "change status",
      Branch_idBranch,
    );
    res.json({ message: "Item status updated successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating Item status", error: err.message });
  }
};

//create sub category
const createSubCategory = async (req, res) => {
  try {
    const { Description, Branch_idBranch, Item_Category_idItem_Category } =
      req.body;

    const exists = await dbService.checkSubCategoryDescription(
      Description,
      Item_Category_idItem_Category,
      Branch_idBranch,
    );
    if (exists) {
      return res
        .status(409)
        .json({ message: "Sub-category already exists for this category." });
    }

    await dbService.insertSubCategory(
      Description,
      Branch_idBranch,
      Item_Category_idItem_Category,
    );
    res.json({
      message: "Sub Category added successfully",
    });
  } catch (err) {
    res.status(500).json({
      message: "Error creating sub item category",
      error: err.message,
    });
  }
};

const deleteSubCategory = (req, res) => {
  const id = req.params.id;

  db.query(
    "SELECT idItem FROM item WHERE Item_Category_idItem_SubCategory = ? LIMIT 1",
    [id],
    (checkErr, items) => {
      if (checkErr) {
        console.error("Error checking sub-category items:", checkErr);
        return res.status(500).json({ error: "Internal server error" });
      }
      if (items && items.length > 0) {
        return res
          .status(409)
          .json({ message: "Sub-category has associated Items. Cannot delete." });
      }

      const sql = "DELETE FROM item_sub_category WHERE idItem_SubCategory = ?";
      db.query(sql, [id], (err, result) => {
        if (err) {
          console.error("Error deleting sub-category:", err);
          return res.status(500).json({ error: "Internal server error" });
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: "Sub-category not found" });
        }
        res.json({ message: "Sub-category deleted successfully" });
      });
    },
  );
};


// Function to get csub category
const getSubCategory = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const category = await dbService.fetchSubCategory(Branch_idBranch);
    res.json(category);
  } catch (err) {
    console.error("Error fetching category:", err);
    res
      .status(500)
      .json({ message: "Error fetching category", error: err.message });
  }
};

//update sub category details
const updateSubCategoryById = async (req, res) => {
  try {
    const { idItem_SubCategory } = req.params;
    const { Description, Item_Category_idItem_Category, Branch_idBranch } =
      req.body;

    const exists = await dbService.checkSubCategoryDescription(
      Description,
      Item_Category_idItem_Category,
      Branch_idBranch,
      idItem_SubCategory,
    );
    if (exists) {
      return res
        .status(409)
        .json({ message: "Sub-category already exists for this category." });
    }

    await dbService.updateSubCategory(
      idItem_SubCategory,
      Description,
      Item_Category_idItem_Category,
      Branch_idBranch,
    );

    res.json({ message: "Sub Category updated successfully" });
  } catch (err) {
    console.error("Error updating Sub Category:", err);
    res
      .status(500)
      .json({ message: "Error updating Sub Category", error: err.message });
  }
};

const addBrand = (req, res) => {
  const { name, description, Branch_idBranch } = req.body;

  if (!name || !Branch_idBranch) {
    return res
      .status(400)
      .json({ error: "Brand name and branch ID are required" });
  }

  const sql =
    "INSERT INTO brand (BrandName, Description, Branch_idBranch, CreatedTime) VALUES (?, ?, ?, NOW())";
  db.query(sql, [name, description, Branch_idBranch], (err, result) => {
    if (err) {
      console.error("Error adding brand:", err);
      return res.status(500).json({ error: "Failed to add brand" });
    }
    res
      .status(201)
      .json({ message: "Brand added successfully", id: result.insertId });
  });
};

// Delete a brand
const deleteBrand = (req, res) => {
  const brandId = req.params.id;
  const sql = "DELETE FROM brand WHERE idBrand = ?";

  db.query(sql, [brandId], (err, result) => {
    if (err) {
      console.error("Error deleting brand:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Brand not found" });
    }
    res.json({ message: "Brand deleted successfully" });
  });
};

const getBrandsByBranch = (req, res) => {
  const branchId = req.params.branchId;

  const sql = `
    SELECT 
  idBrand AS id, 
  BrandName AS name, 
  Description AS description, 
  Branch_idBranch
FROM brand
WHERE Branch_idBranch = ?

  `;

  db.query(sql, [branchId], (err, results) => {
    if (err) {
      console.error("Error fetching brands:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    res.json(results);
  });
};

const updateBrand = (req, res) => {
  const { name, description, Branch_idBranch } = req.body;
  const brandId = req.params.id;

  if (!name || !Branch_idBranch) {
    return res
      .status(400)
      .json({ error: "Brand name and branch ID are required" });
  }

  const sql = `
    UPDATE brand
    SET BrandName = ?, Description = ?, Branch_idBranch = ?, UpdatedTime = NOW()
    WHERE idBrand = ?
  `;

  db.query(
    sql,
    [name, description, Branch_idBranch, brandId],
    (err, result) => {
      if (err) {
        console.error("Error updating brand:", err);
        return res.status(500).json({ error: "Failed to update brand" });
      }
      res.json({ message: "Brand updated successfully" });
    },
  );
};

const deleteProductImage = (req, res) => {
  const imageId = req.params.id;
  const sql = "DELETE FROM product_images WHERE id = ?";

  db.query(sql, [imageId], (err, result) => {
    if (err) {
      console.error("Error deleting product image:", err);
      return res.status(500).json({ message: "Failed to delete image." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Image not found." });
    }

    res.status(200).json({ message: "Image deleted successfully." });
  });
};

const deleteProductDocument = (req, res) => {
  const { id } = req.params;
  const query = "DELETE FROM product_documents WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting document:", err);
      return res.status(500).json({ message: "Failed to delete document." });
    }
    res.json({ message: "Document deleted successfully." });
  });
};

const getProductHistory = async (req, res) => {
  try {
    const { idItem } = req.params;
    const history = await dbService.fetchProductHistory(idItem);
    res.json(history);
  } catch (err) {
    console.error("Error fetching product history:", err);
    res.status(500).json({ message: "Error fetching product history", error: err.message });
  }
};

const getOrCreatePackagesCategory = async (Branch_idBranch, connection) => {
  const checkQuery = "SELECT idItem_Category FROM item_category WHERE Description = ? AND Branch_idBranch = ? LIMIT 1";
  const [categories] = await connection.promise().query(checkQuery, ["Packages", Branch_idBranch]);

  if (categories && categories.length > 0) {
    const categoryId = categories[0].idItem_Category;
    // Get subcategory ID
    const subQuery = "SELECT idItem_SubCategory FROM item_sub_category WHERE Item_Category_idItem_Category = ? LIMIT 1";
    const [subcategories] = await connection.promise().query(subQuery, [categoryId]);
    let subcategoryId = subcategories && subcategories.length > 0 ? subcategories[0].idItem_SubCategory : null;
    if (!subcategoryId) {
      // Create default subcategory
      const insertSub = "INSERT INTO item_sub_category (Description, Branch_idBranch, Item_Category_idItem_Category) VALUES (?, ?, ?)";
      const [subResult] = await connection.promise().query(insertSub, ["Default", Branch_idBranch, categoryId]);
      subcategoryId = subResult.insertId;
    }
    return { categoryId, subcategoryId };
  } else {
    // Create category
    const insertCat = "INSERT INTO item_category (Description, Branch_idBranch, Type) VALUES (?, ?, ?)";
    const [catResult] = await connection.promise().query(insertCat, ["Packages", Branch_idBranch, "Package"]);
    const categoryId = catResult.insertId;

    // Create default subcategory
    const insertSub = "INSERT INTO item_sub_category (Description, Branch_idBranch, Item_Category_idItem_Category) VALUES (?, ?, ?)";
    const [subResult] = await connection.promise().query(insertSub, ["Default", Branch_idBranch, categoryId]);
    const subcategoryId = subResult.insertId;

    return { categoryId, subcategoryId };
  }
};

const getPackagesByBranch = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const status = req.query.status !== undefined ? req.query.status : 1;
    const packages = await dbService.fetchPackages(Branch_idBranch, status);
    res.json({ success: true, data: packages });
  } catch (err) {
    console.error("Error fetching packages:", err);
    res.status(500).json({ success: false, message: "Error fetching packages", error: err.message });
  }
};

const getPackageById = async (req, res) => {
  try {
    const { idItem } = req.params;
    const packageItems = await dbService.fetchItem(idItem);
    if (!packageItems || packageItems.length === 0) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }
    const packageHeader = packageItems[0];
    const components = await dbService.fetchPackageComponents(idItem);
    res.json({
      success: true,
      data: {
        ...packageHeader,
        components
      }
    });
  } catch (err) {
    console.error("Error fetching package details:", err);
    res.status(500).json({ success: false, message: "Error fetching package details", error: err.message });
  }
};

const createPackage = async (req, res) => {
  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ success: false, error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ success: false, error: "Failed to start transaction" });
      }

      try {
        const {
          Description,
          Item_Code,
          Rate,
          Cost,
          Branch_idBranch,
          components = []
        } = req.body;

        if (!Description) {
          return connection.rollback(() => {
            connection.release();
            res.status(400).json({ success: false, message: "Package description is required" });
          });
        }

        // Get or create category
        const { categoryId, subcategoryId } = await getOrCreatePackagesCategory(Branch_idBranch, connection);

        // Insert package into item table
        const insertQuery = `
          INSERT INTO item 
          (Type, Item_Category_idItem_Category, Item_Category_idItem_SubCategory, Description, Item_Code, Cost, Real_Cost, Rate, Qty, Status, Branch_idBranch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [insertResult] = await connection.promise().query(insertQuery, [
          "Package",
          categoryId,
          subcategoryId,
          Description,
          Item_Code || null,
          Cost || 0,
          Cost || 0, // Real_Cost
          Rate || 0,
          0, // Qty
          1, // Status (active)
          Branch_idBranch
        ]);

        const packageId = insertResult.insertId;

        // Insert components
        for (const comp of components) {
          await dbService.insertPackageItem(
            packageId,
            comp.item_id,
            comp.variation_id || null,
            comp.qty || 1,
            comp.rate || 0,
            connection
          );
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ success: false, error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.status(201).json({ success: true, message: "Package created successfully", packageId });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error creating package:", err);
          res.status(500).json({ success: false, message: "Error creating package", error: err.message });
        });
      }
    });
  });
};

const updatePackage = async (req, res) => {
  const { idItem } = req.params;

  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ success: false, error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ success: false, error: "Failed to start transaction" });
      }

      try {
        const {
          Description,
          Item_Code,
          Rate,
          Cost,
          components = []
        } = req.body;

        // Update package item details
        const updateQuery = `
          UPDATE item SET 
            Description = ?,
            Item_Code = ?,
            Cost = ?,
            Real_Cost = ?,
            Rate = ?
          WHERE idItem = ? AND Type = 'Package'
        `;
        await connection.promise().query(updateQuery, [
          Description,
          Item_Code || null,
          Cost || 0,
          Cost || 0,
          Rate || 0,
          idItem
        ]);

        // Delete existing components
        await dbService.deletePackageItems(idItem, connection);

        // Insert updated components
        for (const comp of components) {
          await dbService.insertPackageItem(
            idItem,
            comp.item_id,
            comp.variation_id || null,
            comp.qty || 1,
            comp.rate || 0,
            connection
          );
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ success: false, error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ success: true, message: "Package updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error updating package:", err);
          res.status(500).json({ success: false, message: "Error updating package", error: err.message });
        });
      }
    });
  });
};

const deletePackage = async (req, res) => {
  const { idItem } = req.params;

  db.getConnection(async (connErr, connection) => {
    if (connErr) {
      console.error("Failed to get connection:", connErr);
      return res.status(500).json({ success: false, error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ success: false, error: "Failed to start transaction" });
      }

      try {
        // Delete components first
        await dbService.deletePackageItems(idItem, connection);

        // Delete package item
        const deleteQuery = "DELETE FROM item WHERE idItem = ? AND Type = 'Package'";
        const [result] = await connection.promise().query(deleteQuery, [idItem]);

        if (result.affectedRows === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ success: false, message: "Package not found" });
          });
        }

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              console.error("Commit failed:", commitErr);
              res.status(500).json({ success: false, error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ success: true, message: "Package deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          console.error("Error deleting package:", err);
          res.status(500).json({ success: false, message: "Error deleting package", error: err.message });
        });
      }
    });
  });
};

const getNextBarcode = async (req, res) => {
  try {
    const { branchId } = req.params;

    // Query the latest barcodes from both item and item_variations tables
    const query = `
      SELECT barcode FROM (
        SELECT barcode, idItem AS sort_id FROM item 
        WHERE Branch_idBranch = ? AND barcode IS NOT NULL AND barcode != ''
        ORDER BY idItem DESC LIMIT 100
      ) t1
      UNION
      SELECT barcode FROM (
        SELECT iv.barcode, iv.id AS sort_id FROM item_variations iv
        INNER JOIN item i ON iv.item_id = i.idItem
        WHERE i.Branch_idBranch = ? AND iv.barcode IS NOT NULL AND iv.barcode != ''
        ORDER BY iv.id DESC LIMIT 100
      ) t2
    `;

    db.query(query, [branchId, branchId], (err, results) => {
      if (err) {
        console.error("Error fetching latest barcodes:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      let maxNum = 0;
      let detectedPrefix = "BAR";
      let numStrLength = 5; // default padding length BAR00001

      // Parse all barcodes to find the maximum numeric suffix value
      for (const row of results) {
        const match = row.barcode.match(/^([A-Za-z]+)(\d+)$/);
        if (match) {
          const prefix = match[1];
          const numStr = match[2];
          const num = parseInt(numStr, 10);
          if (num > maxNum) {
            maxNum = num;
            detectedPrefix = prefix;
            numStrLength = numStr.length;
          }
        }
      }

      let nextBarcode;
      if (maxNum > 0) {
        const nextNum = maxNum + 1;
        const paddedNum = String(nextNum).padStart(numStrLength, '0');
        nextBarcode = `${detectedPrefix}${paddedNum}`;
      } else {
        nextBarcode = "BAR00001";
      }

      res.json({ nextBarcode });
    });
  } catch (error) {
    console.error("Error in getNextBarcode:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getItemSuppliers = async (req, res) => {
  try {
    const { idItem } = req.params;
    const suppliers = await dbService.getItemSuppliers(idItem);
    res.json(suppliers);
  } catch (error) {
    console.error("Error fetching item suppliers:", error);
    res.status(500).json({ error: "Failed to fetch item suppliers" });
  }
};

module.exports = {
  createProduct,
  createExcelProduct,
  getProducts,
  updateProductStatus,
  deleteProductImage,
  deleteProductDocument,
  getProductHistory,
  getPackagesByBranch,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
  getNextBarcode,
  deleteItem,
  deleteCategory,
  getItems,
  updateProduct,
  createCategory,
  getCategory,
  updateCategoryById,
  getServices,
  deleteCategoryById,
  updateProductQty,
  adjustProductQty,
  createSubCategory,
  deleteSubCategory,
  updateSubCategoryById,
  getSubCategory,
  addBrand,
  deleteBrand,
  getBrandsByBranch,
  updateBrand,
  getItemSuppliers,
  applyPendingProductUpdate,
};

const applyPendingProductCreate = async (pending_updates) => {
  const req = {
    body: pending_updates.req_body,
    params: pending_updates.req_params,
    user: pending_updates.req_user,
    files: pending_updates.req_files,
    is_approved_webhook: true 
  };
  
  const res = {
    status: function() { return this; },
    json: function(data) { console.log("[WEBHOOK] applyPendingProductCreate result:", data); return data; },
    send: function(data) { console.log("[WEBHOOK] applyPendingProductCreate result:", data); return data; }
  };

  return await createProduct(req, res);
};

module.exports.applyPendingProductCreate = applyPendingProductCreate;


