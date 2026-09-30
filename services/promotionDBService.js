const db = require("../db/db");

const insertPromotionRule = (
  name,
  trigger_product_id,
  min_qty,
  reward_product_id,
  reward_qty,
  is_active,
  Branch_idBranch,
  promo_type,
  discount_value,
  discount_type,
  start_date,
  end_date,
  start_time,
  end_time,
  days_of_week,
  is_whole_store
) => {
  const query = `
    INSERT INTO promotion_rules (
      name, trigger_product_id, min_qty, reward_product_id, reward_qty, 
      is_active, Branch_idBranch, promo_type, discount_value, discount_type,
      start_date, end_date, start_time, end_time, days_of_week, is_whole_store
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        name,
        trigger_product_id,
        min_qty,
        reward_product_id,
        reward_qty,
        is_active,
        Branch_idBranch,
        promo_type,
        discount_value,
        discount_type,
        start_date || null,
        end_date || null,
        start_time || null,
        end_time || null,
        days_of_week || null,
        is_whole_store !== undefined ? is_whole_store : 0,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      }
    );
  });
};

const fetchPromotionRules = (Branch_idBranch) => {
  const query = `
    SELECT pr.*, 
           item_trigger.Description as trigger_product_name,
           item_trigger.Item_Code as trigger_product_code,
           item_trigger.Type as trigger_product_type,
           item_reward.Description as reward_product_name,
           item_reward.Item_Code as reward_product_code,
           item_reward.Type as reward_product_type
    FROM promotion_rules pr
    LEFT JOIN item item_trigger ON pr.trigger_product_id = item_trigger.idItem
    LEFT JOIN item item_reward ON pr.reward_product_id = item_reward.idItem
    WHERE pr.Branch_idBranch = ?
    ORDER BY pr.id DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchActivePromotionRules = (Branch_idBranch) => {
  const query = `
    SELECT pr.*, 
           item_trigger.Description as trigger_product_name,
           item_trigger.Item_Code as trigger_product_code,
           item_trigger.Rate as trigger_product_rate,
           item_reward.Description as reward_product_name,
           item_reward.Item_Code as reward_product_code,
           item_reward.Rate as reward_product_rate
    FROM promotion_rules pr
    LEFT JOIN item item_trigger ON pr.trigger_product_id = item_trigger.idItem
    LEFT JOIN item item_reward ON pr.reward_product_id = item_reward.idItem
    WHERE pr.Branch_idBranch = ? AND pr.is_active = 1
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchPromotionRule = (id) => {
  const query = `
    SELECT pr.*, 
           item_trigger.Description as trigger_product_name,
           item_reward.Description as reward_product_name
    FROM promotion_rules pr
    LEFT JOIN item item_trigger ON pr.trigger_product_id = item_trigger.idItem
    LEFT JOIN item item_reward ON pr.reward_product_id = item_reward.idItem
    WHERE pr.id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updatePromotionRule = (
  id,
  name,
  trigger_product_id,
  min_qty,
  reward_product_id,
  reward_qty,
  is_active,
  promo_type,
  discount_value,
  discount_type,
  start_date,
  end_date,
  start_time,
  end_time,
  days_of_week,
  is_whole_store
) => {
  const query = `
    UPDATE promotion_rules
    SET name = ?, trigger_product_id = ?, min_qty = ?, reward_product_id = ?, reward_qty = ?, 
        is_active = ?, promo_type = ?, discount_value = ?, discount_type = ?,
        start_date = ?, end_date = ?, start_time = ?, end_time = ?, days_of_week = ?, is_whole_store = ?
    WHERE id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        name,
        trigger_product_id,
        min_qty,
        reward_product_id,
        reward_qty,
        is_active,
        promo_type,
        discount_value,
        discount_type,
        start_date || null,
        end_date || null,
        start_time || null,
        end_time || null,
        days_of_week || null,
        is_whole_store !== undefined ? is_whole_store : 0,
        id,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      }
    );
  });
};

const deletePromotionRule = (id) => {
  const query = `DELETE FROM promotion_rules WHERE id = ?`;
  return new Promise((resolve, reject) => {
    db.query(query, [id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  insertPromotionRule,
  fetchPromotionRules,
  fetchActivePromotionRules,
  fetchPromotionRule,
  updatePromotionRule,
  deletePromotionRule,
};
