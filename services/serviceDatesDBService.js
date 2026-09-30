const db = require("../db/db");

const insertServiceDate = (
  Invoice_idInvoice,
  Customer_idCustomer,
  Item_idItem,
  Serial_No_id,
  Term,
  Date,
  Branch_idBranch
) => {
  console.log(Term);
  const query =
    "INSERT INTO item_has_service_dates (Invoice_idInvoice, Customer_idCustomer, Item_idItem, Serial_No_id, Term, Date, Branch_idBranch) VALUES (?, ?, ?, ?, ?, ?, ?)";
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [
        Invoice_idInvoice,
        Customer_idCustomer,
        Item_idItem,
        Serial_No_id,
        Term,
        Date,
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

const updateServiceDate = (ID, Status, Comments) => {
  const query =
    "UPDATE item_has_service_dates SET Comments = ?, Status = ? WHERE ID = ?";
  return db.query(query, [Comments, Status, ID]);
};

const fetchServices = (fromDate, toDate) => {
  const query =
    "SELECT sd.* , cus.Name AS Customer, it.Description AS Item, inv.Invoice_Number AS Invoice_Number, sr.Serial_No AS Serial_No FROM item_has_service_dates sd LEFT JOIN customer cus ON sd.Customer_idCustomer = cus.idCustomer LEFT JOIN item it ON sd.Item_idItem = it.idItem LEFT JOIN item_has_serial_no sr ON sd.Serial_No_id = sr.ID LEFT JOIN invoice inv ON sd.Invoice_idInvoice = inv.idInvoice WHERE sd.Date BETWEEN (?) AND (?)";
  return new Promise((resolve, reject) => {
    db.query(query, [fromDate, toDate], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  insertServiceDate,
  fetchServices,
  updateServiceDate,
};
