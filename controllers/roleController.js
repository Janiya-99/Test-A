const db = require('../db/db'); // Your DB connection

// Create a new user role
exports.createRole = (req, res) => {
  const { Company_idCompany, User_Role_Name } = req.body;
  if (!Company_idCompany || !User_Role_Name) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }
  db.query(
    'INSERT INTO user_roles (Company_idCompany, User_Role_Name) VALUES (?, ?)',
    [Company_idCompany, User_Role_Name],
    (err, result) => {
      if (err) {
        // Duplicate entry error code in MySQL is ER_DUP_ENTRY (1062)
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Role already exists for this company.' });
        }
        return res.status(500).json({ message: 'Database error.', error: err.message });
      }
      res.status(200).json({ id: result.insertId, Company_idCompany, User_Role_Name });
    }
  );
};

// Get all roles for a company
exports.getRoles = (req, res) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ message: 'Missing companyId' });
  db.query(
    'SELECT User_Role_id as id, User_Role_Name as name FROM user_roles WHERE Company_idCompany = ?',
    [companyId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Database error.', error: err.message });
      }
      res.json(rows);
    }
  );
};