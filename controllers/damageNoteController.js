const dbService = require("../services/damageNotesDBService");
const itemDbService = require("../services/productDBService");
const { productHistoryLogHelper } = itemDbService;
const branchDBService = require("../services/branchDBService");
const stockCardDbService = require("../services/stockCardDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");
const { postStockAdjustmentAccounting } = require("../services/inventoryAccountingService");
const db = require("../db/db");
const approvalService = require("../services/approvalService");

const createDamageNote = async (req, res) => {
  try {
    const { Date, Reason, Total_Amount, Branch_idBranch, items, User_idUser } =
      req.body;

    const damage_note = await dbService.insertDamageNote(
      Date,
      Reason,
      Total_Amount,
      items.length,
      Branch_idBranch
    );

    const Damage_Note_idDamage_Note = damage_note.insertId;
    const companyId = await branchDBService.getCompanyIdByBranch(Branch_idBranch) || 1;

    // APPROVAL ENGINE: Check if approval is required
    let approvalRequired = false;
    const reqCompanyId = req.user?.company_id || req.headers["company_id"] || companyId;
    
    try {
      approvalRequired = await approvalService.isApprovalRequired(
        reqCompanyId,
        Branch_idBranch,
        "CREATE_DAMAGE_NOTE"
      );
      
      if (approvalRequired) {
        await new Promise((resolve, reject) => {
          db.query(
            "UPDATE damage_note SET approval_status = 'PENDING_APPROVAL' WHERE idDamage_Note = ?",
            [Damage_Note_idDamage_Note],
            (err) => (err ? reject(err) : resolve())
          );
        });
        console.log(`[DAMAGE] Damage Note ${Damage_Note_idDamage_Note} requires approval (PENDING_APPROVAL)`);
      }
    } catch (err) {
      console.error("Approval check failed for Damage Note, defaulting to ACTIVE", err);
    }

    if (!approvalRequired) {
      await (async () => {
        await Promise.all(
          items.map(async (damageItem) => {
        const item = await itemDbService.fetchItem(damageItem.Item_idItem);

        // const Qty = parseFloat(item[0].Qty) - parseFloat(damageItem.Qty);

        if (damageItem.Item_Description == " " || !damageItem.Item_Description) {
          damageItem.Item_Description = damageItem.Item_Long_Description;
        }

        await dbService.insertItems(
          Damage_Note_idDamage_Note,
          damageItem.Item_idItem,
          damageItem.Item_Description,
          damageItem.Cost,
          damageItem.Qty,
          damageItem.Total,
          Branch_idBranch
        );

        if (damageItem.Item_Has_Serial === 1) {
          damageItem.Serial_No.map(async (serial_number) => {
            serial_no_id = await dbService.updateSerials(serial_number);
            await dbService.insertDamageNoteSerials(
              Damage_Note_idDamage_Note,
              serial_no_id.ID
            );
          });
        }

        let new_qty = 0;
        let in_qty = 0;
        let out_qty = 0;

        out_qty = parseFloat(damageItem.Qty);
        new_qty = parseFloat(item[0].Qty) - parseFloat(damageItem.Qty);

        await itemDbService.itemProcess(
          item[0].Cost,
          item[0].Real_Cost,
          new_qty,
          damageItem.Item_idItem
        );

        // Log history
        await productHistoryLogHelper({
          productId: damageItem.Item_idItem,
          variationId: damageItem.Variation_Id || null,
          quantityChange: -parseFloat(damageItem.Qty),
          oldQty: parseFloat(item[0].Qty),
          newQty: new_qty,
          type: "Damage",
          description: `Stock removed via Damage Note ID: ${Damage_Note_idDamage_Note}`,
          branchId: Branch_idBranch,
          companyId,
          userId: User_idUser,
          referenceId: Damage_Note_idDamage_Note,
        });

        await stockCardDbService.insertStockCard(
          item[0].idItem,
          item[0].Description,
          "DAMAGE",
          Damage_Note_idDamage_Note,
          item[0].Cost,
          item[0].Real_Cost,
          item[0].Rate,
          in_qty,
          out_qty,
          new_qty,
          Branch_idBranch,
          null, // connection is null/not used here
          damageItem.Variation_Id || null
        );

        // Accounting: Post standard double entry for stock reduction due to damage
        const damageQty = parseFloat(damageItem.Qty || 0);
        if (damageQty > 0) {
          const damageUnitCost = parseFloat(damageItem.Cost || item[0].Cost || item[0].Real_Cost || 0);
          await postStockAdjustmentAccounting({
            productId: damageItem.Item_idItem,
            productName: item[0].Description,
            deltaQty: -damageQty,
            unitCost: damageUnitCost,
            branchId: Branch_idBranch,
            companyId,
            userId: User_idUser || req.user?.id || 1,
            reference: `Damage Note #${Damage_Note_idDamage_Note}`,
            notes: Reason ? `Damage Note: ${Reason}` : "Damaged stock write-off",
          });
        }
      })
    );
  })(); // End IIFE
}

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Damage Note",
      Damage_Note_idDamage_Note,
      "create",
      Branch_idBranch
    );

    // Trigger Approval Request if needed
    if (approvalRequired) {
      const createdBy = User_idUser || req.user?.idUser || req.user?.id || 1;
      try {
        await approvalService.triggerApprovalRequest(
          "damage_note",
          Damage_Note_idDamage_Note,
          Branch_idBranch,
          reqCompanyId,
          Total_Amount,
          createdBy
        );
      } catch (err) {
        console.error("[DAMAGE] Error triggering approval webhook:", err);
      }
    }

    res.json({
      message: approvalRequired
        ? "Damage Note submitted for approval. It will take effect once approved."
        : "Damage Note added successfully",
      approval_required: !!approvalRequired,
      approval_status: approvalRequired ? "PENDING_APPROVAL" : "ACTIVE",
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating damage note", error: err.message });
  }
};

const getDamageNotes = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const damage_notes = await dbService.fetchDamageNotes(Branch_idBranch);

    if (damage_notes.length === 0) {
      return res.status(404).json({ message: "Damage Notes not found" });
    }

    await Promise.all(
      damage_notes.map(async (damage_note) => {
        const items = await dbService.fetchItems(damage_note.idDamage_Note);
        damage_note.items = items;
      })
    );

    res.json(damage_notes);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const checkReturnSerial = async (req, res) => {
  try {
    const { serial_numbers } = req.body;

    const checkSerials = await dbService.checkReturnSerial(serial_numbers);

    if (checkSerials.length === 0) {
      res
        .status(200)
        .json({ message: "The item is not found !" });
    } else {
      // If matching serial numbers found, send the list of existing serial numbers
      res.status(200).json({ existing_serial_numbers: checkSerials });
    }
  } catch (err) {
    res.status(500).json({
      message: "Error checking serials",
      error: err.message,
    });
  }
};

// Get single damage note by ID
const getSingleDamageNote = async (req, res) => {
  try {
    const { id } = req.params;
    const [damageNote] = await dbService.fetchSingleDamageNote(id);

    if (!damageNote) {
      return res.status(404).json({ message: "Damage Note not found" });
    }

    const items = await dbService.fetchItems(id);
    damageNote.items = items;

    res.json(damageNote);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching damage note",
      error: err.message,
    });
  }
};


module.exports = {
  createDamageNote,
  getDamageNotes,
  checkReturnSerial,
  getSingleDamageNote,
};
