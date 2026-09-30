const db = require("../db/db");

// Insert master card record
const insertCard = (
  card_code,
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
  connection = db
) => {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO manufacturing_cards (
        card_code, card_name, branch_id, finished_item_id, finished_variation_id,
        base_quantity, unit, note, is_active, is_default, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    connection.query(
      query,
      [
        card_code,
        card_name,
        branch_id,
        finished_item_id,
        finished_variation_id || null,
        base_quantity,
        unit || "unit",
        note || null,
        is_active !== undefined ? is_active : 1,
        is_default !== undefined ? is_default : 0,
        created_by,
      ],
      (err, results) => {
        if (err) return reject(err);
        resolve(results.insertId);
      }
    );
  });
};

// Insert card line item
const insertCardItem = (
  card_id,
  item_id,
  variation_id,
  standard_qty,
  unit,
  scrap_percentage,
  cost,
  note,
  sort_order,
  connection = db
) => {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO manufacturing_card_items (
        card_id, item_id, variation_id, standard_qty, unit, scrap_percentage, cost, note, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    connection.query(
      query,
      [
        card_id,
        item_id,
        variation_id || null,
        standard_qty,
        unit || "unit",
        scrap_percentage || 0.0,
        cost || 0.0,
        note || null,
        sort_order || 0,
      ],
      (err, results) => {
        if (err) return reject(err);
        resolve(results.insertId);
      }
    );
  });
};

// Fetch cards by branch
const fetchCardsByBranch = (branch_id, connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        mc.*,
        i.Description as item_name,
        i.Item_Code as item_code,
        iv.description as variation_name
      FROM manufacturing_cards mc
      LEFT JOIN item i ON mc.finished_item_id = i.idItem
      LEFT JOIN item_variations iv ON mc.finished_variation_id = iv.id
      WHERE mc.branch_id = ?
      ORDER BY mc.id DESC
    `;
    connection.query(query, [branch_id], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Fetch card by ID
const fetchCardById = (id, connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        mc.*,
        i.Description as item_name,
        i.Item_Code as item_code,
        iv.description as variation_name
      FROM manufacturing_cards mc
      LEFT JOIN item i ON mc.finished_item_id = i.idItem
      LEFT JOIN item_variations iv ON mc.finished_variation_id = iv.id
      WHERE mc.id = ?
    `;
    connection.query(query, [id], (err, results) => {
      if (err) return reject(err);
      resolve(results.length > 0 ? results[0] : null);
    });
  });
};

// Fetch card line items with live item cost & stock
const fetchCardItems = (card_id, connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        mci.*,
        i.Description as item_name,
        i.Item_Code as item_code,
        i.Cost as current_cost,
        i.Qty as current_stock,
        iv.description as variation_name,
        iv.cost as variation_cost,
        iv.qty as variation_stock
      FROM manufacturing_card_items mci
      LEFT JOIN item i ON mci.item_id = i.idItem
      LEFT JOIN item_variations iv ON mci.variation_id = iv.id
      WHERE mci.card_id = ?
      ORDER BY mci.sort_order ASC, mci.id ASC
    `;
    connection.query(query, [card_id], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Fetch active card for finished item (for auto-scaling engine)
const fetchActiveCardForItem = (finished_item_id, finished_variation_id, branch_id, connection = db) => {
  return new Promise((resolve, reject) => {
    const params = [finished_item_id];
    let variationCondition = "";
    if (finished_variation_id) {
      variationCondition = "AND mc.finished_variation_id = ?";
      params.push(finished_variation_id);
    } else {
      variationCondition = "AND (mc.finished_variation_id IS NULL OR mc.finished_variation_id = 0)";
    }
    params.push(branch_id);

    const query = `
      SELECT mc.*
      FROM manufacturing_cards mc
      WHERE mc.finished_item_id = ?
      ${variationCondition}
      AND mc.branch_id = ?
      AND mc.is_active = 1
      ORDER BY mc.is_default DESC, mc.updated_at DESC
      LIMIT 1
    `;
    connection.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(results.length > 0 ? results[0] : null);
    });
  });
};

// Update card header
const updateCard = (
  id,
  card_name,
  base_quantity,
  unit,
  note,
  is_active,
  is_default,
  connection = db
) => {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE manufacturing_cards
      SET card_name = ?, base_quantity = ?, unit = ?, note = ?, is_active = ?, is_default = ?
      WHERE id = ?
    `;
    connection.query(
      query,
      [card_name, base_quantity, unit || "unit", note || null, is_active, is_default, id],
      (err, results) => {
        if (err) return reject(err);
        resolve(results.affectedRows);
      }
    );
  });
};

// Delete line items of a card
const deleteCardItems = (card_id, connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `DELETE FROM manufacturing_card_items WHERE card_id = ?`;
    connection.query(query, [card_id], (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

// Delete card record
const deleteCard = (id, connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `DELETE FROM manufacturing_cards WHERE id = ?`;
    connection.query(query, [id], (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

// Clear default flags for other cards of the same finished product in the same branch
const clearDefaultFlags = (finished_item_id, branch_id, exclude_card_id = null, connection = db) => {
  return new Promise((resolve, reject) => {
    let query = `UPDATE manufacturing_cards SET is_default = 0 WHERE finished_item_id = ? AND branch_id = ?`;
    const params = [finished_item_id, branch_id];

    if (exclude_card_id) {
      query += ` AND id != ?`;
      params.push(exclude_card_id);
    }

    connection.query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(results.affectedRows);
    });
  });
};

// Get last card code for code generation
const getLastCardCode = (branch_id, prefix = "MC-", connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT card_code 
      FROM manufacturing_cards 
      WHERE branch_id = ? AND card_code LIKE ? 
      ORDER BY id DESC 
      LIMIT 1
    `;
    connection.query(query, [branch_id, `${prefix}%`], (err, results) => {
      if (err) return reject(err);
      resolve(results.length > 0 ? results[0].card_code : null);
    });
  });
};

// Check if card is referenced in manufacturing_jobs
const checkCardInUse = (card_id, connection = db) => {
  return new Promise((resolve, reject) => {
    const query = `SELECT COUNT(*) as count FROM manufacturing_jobs WHERE manufacturing_card_id = ?`;
    connection.query(query, [card_id], (err, results) => {
      if (err) return reject(err);
      resolve(results[0].count > 0);
    });
  });
};

// Update master Cost and Real_Cost of a finished item (and variation if applicable)
const updateFinishedItemCost = (finished_item_id, finished_variation_id, unitCost, connection = db) => {
  return new Promise((resolve, reject) => {
    const roundedCost = parseFloat(unitCost || 0).toFixed(2);

    const itemQuery = `
      UPDATE item 
      SET Cost = ?, Real_Cost = ? 
      WHERE idItem = ?
    `;

    connection.query(itemQuery, [roundedCost, roundedCost, finished_item_id], (err, results) => {
      if (err) return reject(err);

      if (finished_variation_id) {
        const variationQuery = `
          UPDATE item_variations 
          SET cost = ? 
          WHERE id = ? AND item_id = ?
        `;
        connection.query(variationQuery, [roundedCost, finished_variation_id, finished_item_id], (vErr, vResults) => {
          if (vErr) return reject(vErr);
          resolve((results?.affectedRows || 0) + (vResults?.affectedRows || 0));
        });
      } else {
        resolve(results?.affectedRows || 0);
      }
    });
  });
};

module.exports = {
  insertCard,
  insertCardItem,
  fetchCardsByBranch,
  fetchCardById,
  fetchCardItems,
  fetchActiveCardForItem,
  updateCard,
  deleteCardItems,
  deleteCard,
  clearDefaultFlags,
  getLastCardCode,
  checkCardInUse,
  updateFinishedItemCost,
};
