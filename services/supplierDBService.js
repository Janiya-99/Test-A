const db = require("../db/db");

// Function to insert a new supplier into the database
const insertSupplier = (
  Company_Name,
  Agent_Name,
  Contact_No,
  Contact_No2,
  Email,
  Address1,
  Address2,
  Address3,
  Branch_idBranch,
  isDeleted, // unused, logic handled in query values
  connection, // 🆕
) => {
  const query =
    "INSERT INTO supplier (Company_Name, Agent_Name, Contact_No,Contact_No2, Email, Address1, Address2, Address3, Status, Branch_idBranch,isDeleted) VALUES (?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Company_Name,
        Agent_Name,
        Contact_No,
        Contact_No2,
        Email,
        Address1,
        Address2,
        Address3,
        1,
        Branch_idBranch,
        0,
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

// Function to fetch all suppliers associated with a specific branch ID from the database
// Function to fetch all suppliers associated with a specific branch ID from the database
const fetchSupplier = (
  Branch_idBranch,
  page = 1,
  limit = 10,
  search = "",
  status = "",
) => {
  const offset = (page - 1) * limit;
  let whereClause = "Branch_idBranch = ? AND isDeleted = 0";
  const queryParams = [Branch_idBranch];
  const countParams = [Branch_idBranch];

  if (search) {
    whereClause +=
      " AND (Company_Name LIKE ? OR Agent_Name LIKE ? OR Contact_No LIKE ? OR Email LIKE ?)";
    const searchParam = `%${search}%`;
    queryParams.push(searchParam, searchParam, searchParam, searchParam);
    countParams.push(searchParam, searchParam, searchParam, searchParam);
  }

  if (status !== "" && status !== null && status !== "null") {
    whereClause += " AND Status = ?";
    queryParams.push(status);
    countParams.push(status);
  }

  const query = `
    SELECT *,
      COALESCE(
        (SELECT Total_Credit_Balance 
         FROM supplier_log 
         WHERE Supplier_idSupplier = supplier.idSupplier 
         ORDER BY idSupplier_Log DESC LIMIT 1
        ), 0
      ) AS Total_Credit_Balance
    FROM supplier 
    WHERE ${whereClause} 
    LIMIT ? OFFSET ?
  `;

  // Add limit and offset to queryParams
  queryParams.push(parseInt(limit), parseInt(offset));

  const countQuery = `SELECT COUNT(*) as total FROM supplier WHERE ${whereClause}`;

  return new Promise((resolve, reject) => {
    // First get the total count
    db.query(countQuery, countParams, (err, countResults) => {
      if (err) {
        return reject(err);
      }
      const total = countResults[0].total;

      // Then get the paginated data
      db.query(query, queryParams, (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            data: JSON.parse(JSON.stringify(results)),
            total: total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit),
            pagination: true,
          });
        }
      });
    });
  });
};

const fetchActiveSupplier = (Branch_idBranch) => {
  const query = `
    SELECT *,
      COALESCE(
        (SELECT Total_Credit_Balance 
         FROM supplier_log 
         WHERE Supplier_idSupplier = supplier.idSupplier 
         ORDER BY idSupplier_Log DESC LIMIT 1
        ), 0
      ) AS Total_Credit_Balance
    FROM supplier 
    WHERE Branch_idBranch = ? AND isDeleted = 0 AND Status = 1
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

// Function to fetch a specific supplier from the database based on its ID
const fetchSupplierById = (idSupplier) => {
  const query = "SELECT * FROM supplier WHERE idSupplier = ? AND isDeleted = 0";
  return new Promise((resolve, reject) => {
    db.query(query, [idSupplier], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

// Function to update details of a specific supplier in the database based on its ID
const updateSupplier = (
  idSupplier,
  Company_Name,
  Agent_Name,
  Contact_No,
  Contact_No2,
  Email,
  Address1,
  Address2,
  Address3,
  connection, // 🆕
) => {
  const query =
    "UPDATE supplier SET Company_Name=?, Agent_Name=?, Contact_No=?,Contact_No2=?, Email=?, Address1=?, Address2=?, Address3=? WHERE idSupplier=?";

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Company_Name,
        Agent_Name,
        Contact_No,
        Contact_No2,
        Email,
        Address1,
        Address2,
        Address3,
        idSupplier,
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

// Function to mark a specific supplier as deleted in the database based on its ID
const deleteSupplier = (idSupplier, connection) => {
  const query = "UPDATE supplier SET isDeleted = 1 WHERE idSupplier = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idSupplier], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const updateStatus = (idSupplier, connection) => {
  const query =
    "UPDATE supplier SET Status = CASE WHEN Status = 1 THEN 0 ELSE 1 END WHERE idSupplier = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idSupplier], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const insertSupplierFieldData = (supplierId, customFields, connection) => {
  if (!customFields || customFields.length === 0) return Promise.resolve();

  const fieldSql = `
    INSERT INTO supplier_field_data (supplier_id, field_id, value)
    VALUES ?
  `;
  const fieldValues = customFields.map((field) => [
    supplierId,
    field.fieldId,
    Array.isArray(field.value) ? field.value.join(",") : field.value,
  ]);

  return new Promise((resolve, reject) => {
    (connection || db).query(fieldSql, [fieldValues], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const updateSupplierFieldData = async (
  supplierId,
  customFields,
  connection,
) => {
  if (!customFields || customFields.length === 0) return Promise.resolve();

  // Process updates sequentially as they are individual update statements
  for (const field of customFields) {
    const value = Array.isArray(field.value)
      ? field.value.join(",")
      : field.value;

    const updateSql = `
      UPDATE supplier_field_data
      SET value = ?
      WHERE supplier_id = ? AND field_id = ?
    `;

    await new Promise((resolve, reject) => {
      (connection || db).query(
        updateSql,
        [value, supplierId, field.field_id],
        async (err, result) => {
          if (err) return reject(err);

          // If no row was updated, it means the field didn't exist for this supplier yet.
          // In this case, we insert the new record.
          if (result.affectedRows === 0) {
            const insertSql = `
              INSERT INTO supplier_field_data (supplier_id, field_id, value)
              VALUES (?, ?, ?)
            `;
            (connection || db).query(
              insertSql,
              [supplierId, field.field_id, value],
              (insertErr, insertResult) => {
                if (insertErr) return reject(insertErr);
                resolve(insertResult);
              }
            );
          } else {
            resolve(result);
          }
        },
      );
    });
  }
};

const insertSupplierContactNumbers = (supplierId, contactNumbers, connection) => {
  if (!contactNumbers || contactNumbers.length === 0) return Promise.resolve();

  const fieldSql = `
    INSERT INTO supplier_contact_numbers (Supplier_idSupplier, Contact_Name, Contact_Number)
    VALUES ?
  `;
  const fieldValues = contactNumbers.map((contact) => [
    supplierId,
    contact.name || contact.Contact_Name || "",
    contact.number || contact.Contact_Number || "",
  ]);

  return new Promise((resolve, reject) => {
    (connection || db).query(fieldSql, [fieldValues], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const deleteSupplierContactNumbers = (supplierId, connection) => {
  const query = "DELETE FROM supplier_contact_numbers WHERE Supplier_idSupplier = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [supplierId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchSupplierContactNumbers = (supplierId) => {
  const query = "SELECT * FROM supplier_contact_numbers WHERE Supplier_idSupplier = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [supplierId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchSupplierProducts = (idSupplier, Branch_idBranch) => {
  const query = `
    SELECT DISTINCT i.*, ic.Description AS Item_Category
    FROM item i
    INNER JOIN item_has_supplier ihs ON i.idItem = ihs.Item_idItem
    LEFT JOIN item_category ic ON ic.idItem_Category = i.Item_Category_idItem_Category
    WHERE ihs.Supplier_idSupplier = ? AND i.Branch_idBranch = ? AND i.Status = 1
    ORDER BY i.Description ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [idSupplier, Branch_idBranch], (err, results) => {
      if (err) reject(err);
      else resolve(JSON.parse(JSON.stringify(results)));
    });
  });
};

module.exports = {
  fetchSupplierProducts,
  insertSupplier,
  fetchSupplier,
  fetchActiveSupplier,
  fetchSupplierById,
  updateSupplier,
  deleteSupplier,
  updateStatus,
  insertSupplierFieldData,
  updateSupplierFieldData,
  insertSupplierContactNumbers,
  deleteSupplierContactNumbers,
  fetchSupplierContactNumbers,
};
