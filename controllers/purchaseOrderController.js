const dbService = require("../services/purchaseOrderDBService");
const db = require("../db/db");
const userLogDbService = require("../services/userLogDBService");
const rulesDbService = require("../services/rulesDBService");
const approvalService = require("../services/approvalService"); // 🆕 Added approvalService

const getNextPurchaseOrderNumber = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const rules = await rulesDbService.getPurchaseOrderNumberDetails(Branch_idBranch);
    
    let prefix = "PO-";
    let startFrom = 1;

    if (rules && rules.length > 0) {
      prefix = rules[0].PO_No_Start_With || "PO-";
      startFrom = rules[0].PO_No_Start_From || 1;
    }

    const lastPO = await dbService.getLastPurchaseOrderNumber(Branch_idBranch, prefix);
    
    let nextNumber = `${prefix}${startFrom}`;

    if (lastPO && lastPO.length > 0) {
      const lastPONumber = lastPO[0].PO_Number;
      const match = lastPONumber.match(/\d+$/);
      if (match) {
        const lastNumericPart = parseInt(match[0]);
        const nextNumericPart = lastNumericPart + 1;
        nextNumber = lastPONumber.replace(/\d+$/, nextNumericPart);
      } else {
        // Fallback if no numeric part found at end
        nextNumber = `${lastPONumber}${startFrom}`;
      }
    }

    res.json({ nextNumber });
  } catch (err) {
    res.status(500).json({ message: "Error generating next PO number", error: err.message });
  }
};

const createPurchaseOrder = async (req, res) => {
  const {
    Date: PODate,
    Supplier_idSupplier,
    PO_Number,
    Total_Amount,
    Bill_Discount,
    Bill_Discount_Type,
    Discount_Amount,
    Net_Total,
    Branch_idBranch,
    items = [],
    User_idUser,
    Additional_Note,
    Expected_Date,
    Deadline_Date,
  } = req.body;

  // Check for duplicate PO Number
  const isDuplicate = await dbService.checkDuplicatePONumber(PO_Number, Branch_idBranch);
  if (isDuplicate) {
    return res.status(400).json({ message: "Duplicate Purchase Order Number for this branch." });
  }

  db.getConnection((connErr, connection) => {
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
        // APPROVAL ENGINE: Check if approval is required for CREATE_PO
        const companyId = req.user?.company_id || req.headers["company_id"] || 1;
        const createdBy = req.user?.idUser || req.user?.id || User_idUser || 1;

        let approvalRequired = false;
        try {
          approvalRequired = await approvalService.isApprovalRequired(
            companyId,
            Branch_idBranch,
            "CREATE_PO"
          );
        } catch (appErr) {
          console.error("Approval check failed for CREATE_PO:", appErr);
        }

        if (approvalRequired) {
          const pendingUpdates = req.body;
          connection.release(); // release connection early

          try {
            await approvalService.triggerApprovalRequest({
              action_type: "CREATE_PO",
              module_name: "Purchase Order",
              erp_record_id: null,
              company_id: companyId,
              branch_id: Branch_idBranch,
              initiated_by: createdBy,
              payload_summary: {
                po_number: PO_Number,
                action: "CREATE_PO",
                pending_updates: pendingUpdates,
              },
            });
            console.log(`[PO] Triggered approval request for creating PO ${PO_Number}`);
          } catch (approvalErr) {
            console.error("[PO] Error triggering approval webhook for CREATE_PO:", approvalErr);
          }

          return res.status(200).json({
            success: true,
            message: "Purchase Order creation submitted for approval. It will be created once approved.",
            approval_required: true,
            approval_status: "PENDING_APPROVAL",
          });
        }

        const po = await dbService.insertPurchaseOrder(
          PODate,
          Supplier_idSupplier,
          PO_Number,
          items.length,
          Total_Amount,
          Bill_Discount,
          Bill_Discount_Type,
          Discount_Amount,
          Net_Total,
          Branch_idBranch,
          Additional_Note,
          Expected_Date || null,
          Deadline_Date || null,
          connection
        );
        const PO_id = po.insertId;

        await Promise.all(
          items.map(async (item) => {
            await dbService.insertPurchaseOrderItems(
              PO_id,
              item.Item_idItem,
              item.Item_Description || item.Item_Name,
              item.Cost,
              item.Qty_Type,
              item.Qty,
              item.Total,
              item.Discount,
              item.Sub_Total,
              Branch_idBranch,
              item.Variation_Id,
              item.Additional_Note,
              connection
            );
          })
        );

        await userLogDbService.insertLog(
          User_idUser,
          new Date().toISOString().slice(0, 19).replace("T", " "),
          "Purchase Order",
          PO_id,
          "create",
          Branch_idBranch,
          connection
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Purchase Order added successfully", poId: PO_id });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ message: "Error creating Purchase Order", error: err.message });
        });
      }
    });
  });
};

const getPurchaseOrders = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const pos = await dbService.fetchPurchaseOrders(Branch_idBranch);
    res.json(pos);
  } catch (err) {
    res.status(500).json({ message: "Error fetching Purchase Orders", error: err.message });
  }
};

const getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const po = await dbService.fetchPurchaseOrder(id);
    if (!po || po.length === 0) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }
    const items = await dbService.fetchPurchaseOrderItems(id);
    po[0].items = items;
    res.json(po[0]);
  } catch (err) {
    res.status(500).json({ message: "Error fetching Purchase Order", error: err.message });
  }
};

const updatePurchaseOrder = async (req, res) => {
  const { id } = req.params;
  const {
    Date: PODate,
    Supplier_idSupplier,
    PO_Number,
    Total_Amount,
    Bill_Discount,
    Bill_Discount_Type,
    Discount_Amount,
    Net_Total,
    Branch_idBranch,
    items = [],
    User_idUser,
    Additional_Note,
    Expected_Date,
    Deadline_Date,
  } = req.body;

  // Check for duplicate PO Number excluding current ID
  const isDuplicate = await dbService.checkDuplicatePONumber(PO_Number, Branch_idBranch, id);
  if (isDuplicate) {
    return res.status(400).json({ message: "Duplicate Purchase Order Number for this branch." });
  }

  db.getConnection((connErr, connection) => {
    if (connErr) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        await dbService.updatePurchaseOrder(
          id,
          PODate,
          Supplier_idSupplier,
          PO_Number,
          items.length,
          Total_Amount,
          Bill_Discount,
          Bill_Discount_Type,
          Discount_Amount,
          Net_Total,
          Additional_Note,
          Expected_Date || null,
          Deadline_Date || null,
          connection
        );

        await dbService.deletePurchaseOrderItems(id, connection);

        await Promise.all(
          items.map(async (item) => {
            await dbService.insertPurchaseOrderItems(
              id,
              item.Item_idItem,
              item.Item_Description || item.Item_Name,
              item.Cost,
              item.Qty_Type,
              item.Qty,
              item.Total,
              item.Discount,
              item.Sub_Total,
              Branch_idBranch,
              item.Variation_Id,
              item.Additional_Note,
              connection
            );
          })
        );

        await userLogDbService.insertLog(
          User_idUser,
          new Date().toISOString().slice(0, 19).replace("T", " "),
          "Purchase Order",
          id,
          "update",
          Branch_idBranch,
          connection
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Purchase Order updated successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ message: "Error updating Purchase Order", error: err.message });
        });
      }
    });
  });
};

const deletePurchaseOrder = async (req, res) => {
  const { id } = req.params;
  const { User_idUser, Branch_idBranch } = req.body;

  db.getConnection((connErr, connection) => {
    if (connErr) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ error: "Failed to start transaction" });
      }

      try {
        await dbService.deletePurchaseOrderItems(id, connection);
        await dbService.deletePurchaseOrder(id, connection);

        await userLogDbService.insertLog(
          User_idUser,
          new Date().toISOString().slice(0, 19).replace("T", " "),
          "Purchase Order",
          id,
          "delete",
          Branch_idBranch,
          connection
        );

        connection.commit((commitErr) => {
          if (commitErr) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: "Failed to commit transaction" });
            });
          }
          connection.release();
          res.json({ message: "Purchase Order deleted successfully" });
        });
      } catch (err) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ message: "Error deleting Purchase Order", error: err.message });
        });
      }
    });
  });
};

const getPurchaseOrderRules = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const query = `SELECT PO_No_Start_With, PO_No_Start_From FROM rules WHERE Branch_idBranch = ?`;
    
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Error fetching PO rules", error: err.message });
      }
      if (results.length === 0) {
        return res.json({ PO_No_Start_With: "PO-", PO_No_Start_From: 1 });
      }
      res.json(results[0]);
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching PO rules", error: err.message });
  }
};

const updatePurchaseOrderRules = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { PO_No_Start_With, PO_No_Start_From } = req.body;

    const query = `UPDATE rules SET PO_No_Start_With = ?, PO_No_Start_From = ? WHERE Branch_idBranch = ?`;
    
    db.query(query, [PO_No_Start_With, PO_No_Start_From, Branch_idBranch], (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Error updating PO rules", error: err.message });
      }
      res.json({ message: "PO rules updated successfully" });
    });
  } catch (err) {
    res.status(500).json({ message: "Error updating PO rules", error: err.message });
  }
};

const getPOSettings = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const query = `SELECT * FROM po_settings WHERE Branch_idBranch = ?`;
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Error fetching PO settings", error: err.message });
      }
      if (results.length === 0) {
        // Return defaults if no settings exist yet
        return res.json({
          header_color: "#1e293b",
          accent_color: "#6366f1",
          terms_and_conditions:
            "Payment is due within 30 days of the purchase order date. All prices are subject to change without prior notice. Goods remain the property of the seller until full payment is received.",
          footer_note: "This is a computer-generated document. No signature required.",
          show_logo: 1,
          show_terms: 1,
          show_footer_note: 1,
          show_vendor_address: 1,
          show_expected_date: 1,
          show_deadline_date: 1,
          show_item_code: 1,
          show_item_note: 1,
          show_subtotal: 1,
          show_discount: 1,
          show_prices: 1,
          show_email: 1,
          show_phone: 1,
          show_website: 1,
          show_address: 1,
        });
      }
      res.json(results[0]);
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching PO settings", error: err.message });
  }
};

const updatePOSettings = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const {
      header_color,
      accent_color,
      terms_and_conditions,
      footer_note,
      show_logo,
      show_terms,
      show_footer_note,
      show_vendor_address,
      show_expected_date,
      show_deadline_date,
      show_item_code,
      show_item_note,
      show_subtotal,
      show_discount,
      show_prices,
      show_email,
      show_phone,
      show_website,
      show_address,
    } = req.body;

    const query = `
      INSERT INTO po_settings (
        Branch_idBranch, header_color, accent_color, terms_and_conditions, footer_note,
        show_logo, show_terms, show_footer_note, show_vendor_address,
        show_expected_date, show_deadline_date, show_item_code, show_item_note,
        show_subtotal, show_discount, show_prices, show_email, show_phone, show_website, show_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        header_color = VALUES(header_color),
        accent_color = VALUES(accent_color),
        terms_and_conditions = VALUES(terms_and_conditions),
        footer_note = VALUES(footer_note),
        show_logo = VALUES(show_logo),
        show_terms = VALUES(show_terms),
        show_footer_note = VALUES(show_footer_note),
        show_vendor_address = VALUES(show_vendor_address),
        show_expected_date = VALUES(show_expected_date),
        show_deadline_date = VALUES(show_deadline_date),
        show_item_code = VALUES(show_item_code),
        show_item_note = VALUES(show_item_note),
        show_subtotal = VALUES(show_subtotal),
        show_discount = VALUES(show_discount),
        show_prices = VALUES(show_prices),
        show_email = VALUES(show_email),
        show_phone = VALUES(show_phone),
        show_website = VALUES(show_website),
        show_address = VALUES(show_address)
    `;

    db.query(
      query,
      [
        Branch_idBranch,
        header_color || "#1e293b",
        accent_color || "#6366f1",
        terms_and_conditions || "",
        footer_note || "",
        show_logo ?? 1,
        show_terms ?? 1,
        show_footer_note ?? 1,
        show_vendor_address ?? 1,
        show_expected_date ?? 1,
        show_deadline_date ?? 1,
        show_item_code ?? 1,
        show_item_note ?? 1,
        show_subtotal ?? 1,
        show_discount ?? 1,
        show_prices ?? 1,
        show_email ?? 1,
        show_phone ?? 1,
        show_website ?? 1,
        show_address ?? 1,
      ],
      (err) => {
        if (err) {
          console.error("Error updating PO settings DB:", err);
          return res.status(500).json({ message: "Error updating PO settings", error: err.message });
        }
        res.json({ message: "PO settings updated successfully" });
      }
    );
  } catch (err) {
    res.status(500).json({ message: "Error updating PO settings", error: err.message });
  }
};

const applyPendingPurchaseOrderCreate = async (pendingUpdates) => {
  if (!pendingUpdates) {
    console.warn(`[PO] No pending updates found for PO creation`);
    return;
  }

  const {
    Date: PODate,
    Supplier_idSupplier,
    PO_Number,
    Total_Amount,
    Bill_Discount,
    Bill_Discount_Type,
    Discount_Amount,
    Net_Total,
    Branch_idBranch,
    items = [],
    User_idUser,
    Additional_Note,
    Expected_Date,
    Deadline_Date,
  } = pendingUpdates;

  return new Promise((resolve, reject) => {
    db.getConnection(async (connErr, connection) => {
      if (connErr) return reject(connErr);

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) {
          connection.release();
          return reject(beginErr);
        }

        try {
          const po = await dbService.insertPurchaseOrder(
            PODate,
            Supplier_idSupplier,
            PO_Number,
            items.length,
            Total_Amount,
            Bill_Discount,
            Bill_Discount_Type,
            Discount_Amount,
            Net_Total,
            Branch_idBranch,
            Additional_Note,
            Expected_Date || null,
            Deadline_Date || null,
            connection
          );
          const PO_id = po.insertId;

          await Promise.all(
            items.map(async (item) => {
              await dbService.insertPurchaseOrderItems(
                PO_id,
                item.Item_idItem,
                item.Item_Description || item.Item_Name,
                item.Cost,
                item.Qty_Type,
                item.Qty,
                item.Total,
                item.Discount,
                item.Sub_Total,
                Branch_idBranch,
                item.Variation_Id,
                item.Additional_Note,
                connection
              );
            })
          );

          await userLogDbService.insertLog(
            User_idUser,
            new Date().toISOString().slice(0, 19).replace("T", " "),
            "Purchase Order",
            PO_id,
            "create",
            Branch_idBranch,
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
            resolve(PO_id);
          });
        } catch (err) {
          connection.rollback(() => {
            connection.release();
            reject(err);
          });
        }
      });
    });
  });
};

module.exports = {
  createPurchaseOrder,
  getPurchaseOrders,
  getPurchaseOrderById,
  updatePurchaseOrder,
  deletePurchaseOrder,
  getNextPurchaseOrderNumber,
  getPurchaseOrderRules,
  updatePurchaseOrderRules,
  getPOSettings,
  updatePOSettings,
  applyPendingPurchaseOrderCreate,
};
