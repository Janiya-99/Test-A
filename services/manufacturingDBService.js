const db = require("../db/db");

const insertManufacturingJob = (
  job_number,
  job_date,
  final_product_id, // kept for backward compatibility (can pass null)
  final_product_variation_id, // kept for backward compatibility (can pass null)
  final_product_qty, // kept for backward compatibility (can pass 0)
  total_material_cost,
  note,
  branch_id,
  user_id,
  profit_margin, // kept for backward compatibility (can pass 0)
  selling_price, // kept for backward compatibility (can pass 0)
  warehouse_id, // added
  manufacturing_card_id, // added for BOM / Recipe card linkage
  connection
) => {
  const query = `
    INSERT INTO manufacturing_jobs 
    (job_number, job_date, final_product_id, final_product_variation_id, final_product_qty, total_material_cost, note, branch_id, user_id, profit_margin, selling_price, warehouse_id, manufacturing_card_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        job_number,
        job_date,
        final_product_id || 0,
        final_product_variation_id || null,
        final_product_qty || 0,
        total_material_cost,
        note,
        branch_id,
        user_id,
        profit_margin || 0,
        selling_price || 0,
        warehouse_id || null,
        manufacturing_card_id || null,
      ],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const insertManufacturingJobItem = (
  job_id,
  item_id,
  variation_id,
  qty,
  cost,
  total_cost,
  connection
) => {
  const query = `
    INSERT INTO manufacturing_job_items 
    (job_id, item_id, variation_id, qty, cost, total_cost)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [job_id, item_id, variation_id, qty, cost, total_cost],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const insertManufacturingJobFinalProduct = (
  job_id,
  item_id,
  variation_id,
  qty,
  profit_margin,
  selling_price,
  connection,
  cost_percentage = 100,
  unit_cost = 0
) => {
  const query = `
    INSERT INTO manufacturing_job_final_products 
    (job_id, item_id, variation_id, qty, cost_percentage, unit_cost, profit_margin, selling_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        job_id,
        item_id,
        variation_id || null,
        qty,
        parseFloat(cost_percentage) || 0,
        parseFloat(unit_cost) || 0,
        profit_margin || 0,
        selling_price || 0,
      ],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const getLastJobByPrefix = (branch_id, prefix) => {
  const query = `
    SELECT job_number 
    FROM manufacturing_jobs 
    WHERE branch_id = ? AND job_number LIKE ? 
    ORDER BY id DESC LIMIT 1
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branch_id, `${prefix}%`], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const fetchManufacturingJobs = (branch_id) => {
  const query = `
    SELECT mj.*, 
           (SELECT GROUP_CONCAT(CONCAT(i.Description, IF(iv.description IS NOT NULL AND iv.description != '', CONCAT(' (', iv.description, ')'), ''), ' (', ROUND(mjfp.qty, 0), ')') SEPARATOR ', ')
            FROM manufacturing_job_final_products mjfp
            JOIN item i ON mjfp.item_id = i.idItem
            LEFT JOIN item_variations iv ON mjfp.variation_id = iv.id
            WHERE mjfp.job_id = mj.id) as final_product_name,
           (SELECT GROUP_CONCAT(i.Item_Code SEPARATOR ', ')
            FROM manufacturing_job_final_products mjfp
            JOIN item i ON mjfp.item_id = i.idItem
            WHERE mjfp.job_id = mj.id) as final_product_code,
           (SELECT SUM(mjfp.qty)
            FROM manufacturing_job_final_products mjfp
            WHERE mjfp.job_id = mj.id) as final_product_qty
    FROM manufacturing_jobs mj
    WHERE mj.branch_id = ?
    ORDER BY mj.id DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branch_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchJobById = (id) => {
  const query = `
    SELECT mj.*
    FROM manufacturing_jobs mj
    WHERE mj.id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchJobItems = (job_id, connection) => {
  const query = `
    SELECT mji.*, i.Description, i.Item_Code, iv.description as variation_name, iv.item_code as variation_code
    FROM manufacturing_job_items mji
    LEFT JOIN item i ON mji.item_id = i.idItem
    LEFT JOIN item_variations iv ON mji.variation_id = iv.id
    WHERE mji.job_id = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [job_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchJobFinalProducts = (job_id, connection) => {
  const query = `
    SELECT mjfp.*, i.Description as final_product_name, i.Item_Code as final_product_code, iv.description as final_product_variation_name
    FROM manufacturing_job_final_products mjfp
    LEFT JOIN item i ON mjfp.item_id = i.idItem
    LEFT JOIN item_variations iv ON mjfp.variation_id = iv.id
    WHERE mjfp.job_id = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [job_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const updateManufacturingJob = (
  id,
  job_date,
  total_material_cost,
  note,
  warehouse_id, // added
  connection
) => {
  const query = `
    UPDATE manufacturing_jobs 
    SET job_date = ?, total_material_cost = ?, note = ?, warehouse_id = ?
    WHERE id = ?
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [job_date, total_material_cost, note, warehouse_id || null, id],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const deleteJobItems = (job_id, connection) => {
  const query = "DELETE FROM manufacturing_job_items WHERE job_id = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [job_id], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const deleteJobFinalProducts = (job_id, connection) => {
  const query = "DELETE FROM manufacturing_job_final_products WHERE job_id = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [job_id], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const insertTemplate = (template_name, note, branch_id, connection) => {
  const query = `
    INSERT INTO manufacturing_templates (template_name, note, branch_id)
    VALUES (?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [template_name, note, branch_id], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const insertTemplateItem = (template_id, item_id, variation_id, qty, connection) => {
  const query = `
    INSERT INTO manufacturing_template_items (template_id, item_id, variation_id, qty)
    VALUES (?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [template_id, item_id, variation_id || null, qty], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const insertTemplateFinalProduct = (template_id, item_id, variation_id, qty, cost_percentage, profit_margin, connection) => {
  const query = `
    INSERT INTO manufacturing_template_final_products (template_id, item_id, variation_id, qty, cost_percentage, profit_margin)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [template_id, item_id, variation_id || null, qty, cost_percentage, profit_margin],
      (err, results) => {
        if (err) reject(err);
        else resolve(results);
      }
    );
  });
};

const fetchTemplates = (branch_id) => {
  const query = `
    SELECT mt.*,
           (SELECT GROUP_CONCAT(i.Description SEPARATOR ', ')
            FROM manufacturing_template_final_products mtfp
            JOIN item i ON mtfp.item_id = i.idItem
            WHERE mtfp.template_id = mt.id) as final_product_names
    FROM manufacturing_templates mt
    WHERE mt.branch_id = ?
    ORDER BY mt.id DESC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branch_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchTemplateById = (id) => {
  const query = `
    SELECT mt.* FROM manufacturing_templates mt WHERE mt.id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchTemplateItems = (template_id) => {
  const query = `
    SELECT mti.*, i.Description, i.Item_Code, i.Cost, i.Qty as current_stock,
           iv.description as variation_name, iv.item_code as variation_code, iv.qty as variation_stock, iv.cost as variation_cost
    FROM manufacturing_template_items mti
    LEFT JOIN item i ON mti.item_id = i.idItem
    LEFT JOIN item_variations iv ON mti.variation_id = iv.id
    WHERE mti.template_id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [template_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const fetchTemplateFinalProducts = (template_id) => {
  const query = `
    SELECT mtfp.*, i.Description as final_product_name, i.Item_Code as final_product_code,
           iv.description as final_product_variation_name
    FROM manufacturing_template_final_products mtfp
    LEFT JOIN item i ON mtfp.item_id = i.idItem
    LEFT JOIN item_variations iv ON mtfp.variation_id = iv.id
    WHERE mtfp.template_id = ?
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [template_id], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

const deleteTemplate = (id, connection) => {
  const query = "DELETE FROM manufacturing_templates WHERE id = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [id], (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

module.exports = {
  insertManufacturingJob,
  insertManufacturingJobItem,
  insertManufacturingJobFinalProduct,
  updateManufacturingJob,
  deleteJobItems,
  deleteJobFinalProducts,
  getLastJobByPrefix,
  fetchManufacturingJobs,
  fetchJobById,
  fetchJobItems,
  fetchJobFinalProducts,
  insertTemplate,
  insertTemplateItem,
  insertTemplateFinalProduct,
  fetchTemplates,
  fetchTemplateById,
  fetchTemplateItems,
  fetchTemplateFinalProducts,
  deleteTemplate,
};
