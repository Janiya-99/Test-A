const db = require("../db/db");

const fetchQuantityType = (item_id) => {
  const query = "SELECT MIN(idQuantity_Type) as idQuantity_Type, Description FROM quantity_type GROUP BY Description ORDER BY idQuantity_Type ASC";
  return new Promise((resolve, reject) => {
    db.query(query, [item_id], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  fetchQuantityType,
};
