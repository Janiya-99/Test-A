const db = require("../db/db");

const insertDamageNote = (
  Date,
  Reason,
  Total_Amount,
  Item_Count,
  Branch_idBranch
) => {
  const query =
    "INSERT INTO damage_note (Date, Reason, Total_Amount, Item_Count, Status, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [Date, Reason, Total_Amount, Item_Count, 0, Branch_idBranch],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
};

const insertItems = (
  Damage_Note_idDamage_Note,
  Item_idItem,
  Item_Description,
  Cost,
  Qty,
  Total,
  Branch_idBranch
) => {
  const query =
    "INSERT INTO damage_note_has_item (Damage_Note_idDamage_Note, Item_idItem, Item_Description, Cost, Qty, Total, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Damage_Note_idDamage_Note,
        Item_idItem,
        Item_Description,
        Cost,
        Qty,
        Total,
        Branch_idBranch,
      ],
      (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
};

const fetchDamageNotes = (Branch_idBranch) => {
  const query =
    "SELECT * FROM damage_note WHERE Branch_idBranch = ? ORDER BY idDamage_Note DESC";
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

const fetchItems = (Damage_Note_idDamage_Note) => {
  const query =
    "SELECT * FROM damage_note_has_item WHERE Damage_Note_idDamage_Note = ?";
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

const checkReturnSerial = async (serial_numbers) => {
  try {
    const query = `
      SELECT sn.Serial_No 
      FROM item_has_serial_no sn
      LEFT JOIN grn g ON sn.GRN_idGRN = g.idGRN
      WHERE sn.Serial_No IN (?) 
        AND sn.Qty = 1 
        AND (sn.GRN_idGRN = 0 OR sn.GRN_idGRN IS NULL OR g.Status = 1 OR g.Status = '1')
    `;
    return new Promise((resolve, reject) => {
      db.query(query, [serial_numbers], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(JSON.parse(JSON.stringify(results)));
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const insertDamageNoteSerials = (
  Damage_Note_idDamage_Note,
  Item_Serial_No_id
) => {
  try {
    const query =
      "INSERT INTO damage_has_item_serial_no (Damage_Note_idDamage_Note, Item_Serial_No_id) VALUES (?,?)";
    return new Promise((resolve, reject) => {
      db.query(
        query,
        [Damage_Note_idDamage_Note, Item_Serial_No_id],
        (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        }
      );
    });
  } catch (error) {
    throw error;
  }
};

const updateSerials = (serial_number) => {
  try {
    const updateQuery =
      "UPDATE item_has_serial_no SET Qty = 0 WHERE Serial_No = ?";
    const selectQuery = "SELECT * FROM item_has_serial_no WHERE Serial_No = ?";

    return new Promise((resolve, reject) => {
      db.query(updateQuery, [serial_number], (err, result) => {
        if (err) {
          reject(err);
        } else {
          // After updating, select the updated row
          db.query(selectQuery, [serial_number], (err, updatedResult) => {
            if (err) {
              reject(err);
            } else {
              if (updatedResult.length > 0) {
                resolve(updatedResult[0]); // Return the first item from the array
              } else {
                resolve(null); // No row found with the provided serial number
              }
            }
          });
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const getSerials = async (serial_numbers) => {
  try {
    const selectQuery = "SELECT * FROM item_has_serial_no WHERE Serial_No = ?";
    return new Promise((resolve, reject) => {
      db.query(selectQuery, [serial_numbers], (err, results) => {
        if (err) {
          reject(err);
        } else {
          resolve(results[0]);
        }
      });
    });
  } catch (error) {
    throw error;
  }
};

const fetchSingleDamageNote = (id) => {
  const query = "SELECT * FROM damage_note WHERE idDamage_Note = ?";
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
  insertDamageNote,
  insertItems,
  fetchItems,
  fetchDamageNotes,
  checkReturnSerial,
  insertDamageNoteSerials,
  updateSerials,
  getSerials,
  fetchSingleDamageNote,
};
