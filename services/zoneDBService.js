const db = require("../db/db");

const insertZone = (Description, Branch_idBranch, connection) => {
  const query =
    "INSERT INTO zone ( Description, Branch_idBranch) VALUES ( ?, ?)";

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Description, Branch_idBranch],
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

const fetchZone = (Branch_idBranch) => {
  const query = "SELECT * FROM zone WHERE Branch_idBranch = ?";
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

const updateZone = (Description, idZone) => {
  const query = `UPDATE zone SET Description=? WHERE idZone=?`;

  return new Promise((resolve, reject) => {
    db.query(query, [Description, idZone], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteZone = (idZone) => {
  const query = "DELETE FROM zone WHERE idZone=?";

  return new Promise((resolve, reject) => {
    db.query(query, [idZone], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

module.exports = {
  fetchZone,
  insertZone,
  updateZone,
  deleteZone,
};
