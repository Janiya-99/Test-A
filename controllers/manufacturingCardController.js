const cardDbService = require("../services/manufacturingCardDBService");
const db = require("../db/db");

// Helper to generate next Card Code (MC-0001, MC-0002...)
const generateCardCode = async (branch_id, connection) => {
  const lastCode = await cardDbService.getLastCardCode(branch_id, "MC-", connection);
  if (!lastCode) {
    return "MC-0001";
  }
  const match = lastCode.match(/MC-(\d+)/);
  if (match) {
    const nextNum = parseInt(match[1], 10) + 1;
    return `MC-${String(nextNum).padStart(4, "0")}`;
  }
  return `MC-${Date.now()}`;
};

// Create a new Manufacturing Card
const createManufacturingCard = async (req, res) => {
  let connection;
  try {
    const {
      card_name,
      branch_id,
      finished_item_id,
      finished_variation_id,
      base_quantity,
      unit,
      note,
      is_active,
      is_default,
      created_by,
      items,
    } = req.body;

    if (!card_name || !branch_id || !finished_item_id || !base_quantity) {
      return res.status(400).json({
        message: "Missing required fields: card_name, branch_id, finished_item_id, base_quantity",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one raw material item is required for a Manufacturing Card",
      });
    }

    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Auto-generate card_code
    const card_code = await generateCardCode(branch_id, connection);

    // If marked as default, clear default flag from other cards of this finished product
    if (is_default === 1 || is_default === true) {
      await cardDbService.clearDefaultFlags(finished_item_id, branch_id, null, connection);
    }

    // Insert card header
    const cardId = await cardDbService.insertCard(
      card_code,
      card_name,
      branch_id,
      finished_item_id,
      finished_variation_id,
      base_quantity,
      unit,
      note,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      is_default ? 1 : 0,
      created_by || 1,
      connection
    );

    // Insert line items & calculate total material cost
    let totalBatchCost = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const stdQty = parseFloat(item.standard_qty || 0);
      const scrapPct = parseFloat(item.scrap_percentage || 0);
      const costVal = parseFloat(item.cost || 0);
      totalBatchCost += stdQty * (1 + scrapPct / 100) * costVal;

      await cardDbService.insertCardItem(
        cardId,
        item.item_id,
        item.variation_id || null,
        item.standard_qty,
        item.unit || "unit",
        item.scrap_percentage || 0,
        item.cost || 0,
        item.note || null,
        i + 1, // sort order
        connection
      );
    }

    // Synchronize estimated unit cost to finished item master Cost and Real_Cost
    const baseQty = parseFloat(base_quantity || 1);
    const calculatedUnitCost = baseQty > 0 ? (totalBatchCost / baseQty) : 0;

    await cardDbService.updateFinishedItemCost(
      finished_item_id,
      finished_variation_id || null,
      calculatedUnitCost,
      connection
    );

    await new Promise((resolve, reject) => {
      connection.commit((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    connection.release();

    return res.status(201).json({
      message: "Manufacturing Card created successfully",
      card_id: cardId,
      card_code: card_code,
    });
  } catch (error) {
    if (connection) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
      connection.release();
    }
    console.error("Error in createManufacturingCard:", error);
    return res.status(500).json({
      message: "Failed to create Manufacturing Card",
      error: error.message,
    });
  }
};

// Get all Manufacturing Cards for a branch
const getManufacturingCards = async (req, res) => {
  try {
    const { branch_id } = req.params;
    if (!branch_id) {
      return res.status(400).json({ message: "branch_id is required" });
    }

    const cards = await cardDbService.fetchCardsByBranch(branch_id);
    return res.status(200).json(cards);
  } catch (error) {
    console.error("Error in getManufacturingCards:", error);
    return res.status(500).json({
      message: "Failed to fetch Manufacturing Cards",
      error: error.message,
    });
  }
};

// Get single Manufacturing Card by ID (with line items)
const getManufacturingCardById = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await cardDbService.fetchCardById(id);

    if (!card) {
      return res.status(404).json({ message: "Manufacturing Card not found" });
    }

    const items = await cardDbService.fetchCardItems(id);
    return res.status(200).json({ ...card, items });
  } catch (error) {
    console.error("Error in getManufacturingCardById:", error);
    return res.status(500).json({
      message: "Failed to fetch Manufacturing Card",
      error: error.message,
    });
  }
};

// Get active recipe card for a finished item + variation (Auto-scaling engine helper)
const getActiveCardForItem = async (req, res) => {
  try {
    const { item_id } = req.params;
    const { variation_id, branch_id } = req.query;

    if (!item_id || !branch_id) {
      return res.status(400).json({ message: "item_id and branch_id are required" });
    }

    const card = await cardDbService.fetchActiveCardForItem(
      item_id,
      variation_id || null,
      branch_id
    );

    if (!card) {
      return res.status(404).json({ message: "No active Manufacturing Card found for this item" });
    }

    const items = await cardDbService.fetchCardItems(card.id);
    return res.status(200).json({ ...card, items });
  } catch (error) {
    console.error("Error in getActiveCardForItem:", error);
    return res.status(500).json({
      message: "Failed to fetch active Manufacturing Card for item",
      error: error.message,
    });
  }
};

// Update an existing Manufacturing Card
const updateManufacturingCard = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const {
      card_name,
      base_quantity,
      unit,
      note,
      is_active,
      is_default,
      items,
      finished_item_id,
      branch_id,
    } = req.body;

    const existingCard = await cardDbService.fetchCardById(id);
    if (!existingCard) {
      return res.status(404).json({ message: "Manufacturing Card not found" });
    }

    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const targetItemId = finished_item_id || existingCard.finished_item_id;
    const targetBranchId = branch_id || existingCard.branch_id;

    // Clear default flags if set to default
    if (is_default === 1 || is_default === true) {
      await cardDbService.clearDefaultFlags(targetItemId, targetBranchId, id, connection);
    }

    // Update header
    await cardDbService.updateCard(
      id,
      card_name || existingCard.card_name,
      base_quantity || existingCard.base_quantity,
      unit || existingCard.unit,
      note !== undefined ? note : existingCard.note,
      is_active !== undefined ? (is_active ? 1 : 0) : existingCard.is_active,
      is_default ? 1 : 0,
      connection
    );

    // Replace line items & calculate total material cost if items provided
    const targetVariationId = req.body.finished_variation_id !== undefined 
      ? req.body.finished_variation_id 
      : existingCard.finished_variation_id;
    const targetBaseQty = parseFloat(base_quantity || existingCard.base_quantity || 1);

    if (items && Array.isArray(items)) {
      await cardDbService.deleteCardItems(id, connection);
      let totalBatchCost = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const stdQty = parseFloat(item.standard_qty || 0);
        const scrapPct = parseFloat(item.scrap_percentage || 0);
        const costVal = parseFloat(item.cost || 0);
        totalBatchCost += stdQty * (1 + scrapPct / 100) * costVal;

        await cardDbService.insertCardItem(
          id,
          item.item_id,
          item.variation_id || null,
          item.standard_qty,
          item.unit || "unit",
          item.scrap_percentage || 0,
          item.cost || 0,
          item.note || null,
          i + 1,
          connection
        );
      }

      // Synchronize estimated unit cost to finished item master Cost and Real_Cost
      const calculatedUnitCost = targetBaseQty > 0 ? (totalBatchCost / targetBaseQty) : 0;
      await cardDbService.updateFinishedItemCost(
        targetItemId,
        targetVariationId || null,
        calculatedUnitCost,
        connection
      );
    }

    await new Promise((resolve, reject) => {
      connection.commit((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    connection.release();

    return res.status(200).json({
      message: "Manufacturing Card updated successfully",
    });
  } catch (error) {
    if (connection) {
      await new Promise((resolve) => connection.rollback(() => resolve()));
      connection.release();
    }
    console.error("Error in updateManufacturingCard:", error);
    return res.status(500).json({
      message: "Failed to update Manufacturing Card",
      error: error.message,
    });
  }
};

// Delete a Manufacturing Card (or soft-deactivate if referenced by Job Cards)
const deleteManufacturingCard = async (req, res) => {
  try {
    const { id } = req.params;
    const existingCard = await cardDbService.fetchCardById(id);

    if (!existingCard) {
      return res.status(404).json({ message: "Manufacturing Card not found" });
    }

    const isInUse = await cardDbService.checkCardInUse(id);

    if (isInUse) {
      // Soft deactivate to maintain historical traceability
      await cardDbService.updateCard(
        id,
        existingCard.card_name,
        existingCard.base_quantity,
        existingCard.unit,
        existingCard.note,
        0, // is_active = 0
        0, // is_default = 0
      );
      return res.status(200).json({
        message: "Manufacturing Card deactivated (referenced by existing Job Cards)",
        is_deactivated: true,
      });
    }

    // Hard delete
    await cardDbService.deleteCard(id);
    return res.status(200).json({
      message: "Manufacturing Card deleted successfully",
      is_deleted: true,
    });
  } catch (error) {
    console.error("Error in deleteManufacturingCard:", error);
    return res.status(500).json({
      message: "Failed to delete Manufacturing Card",
      error: error.message,
    });
  }
};

module.exports = {
  createManufacturingCard,
  getManufacturingCards,
  getManufacturingCardById,
  getActiveCardForItem,
  updateManufacturingCard,
  deleteManufacturingCard,
};
