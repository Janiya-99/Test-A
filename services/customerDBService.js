const db = require("../db/db");

const insertCustomer = (
  title,
  firstName,
  middleName,
  lastName,
  displayName,
  companyName,
  companyEmail,
  phoneNumber,
  mobileNumber,
  fax,
  other,
  website,
  gstNo,
  vatNo,
  billingAddress1,
  billingAddress2,
  billingAddress3,
  billingCity,
  billingProvince,
  billingCountry,
  shippingAddress1,
  shippingAddress2,
  shippingAddress3,
  shippingCity,
  shippingProvince,
  shippingPostalCode,
  shippingCountry,
  branchId,
  agentId,
  creditLimit,
  connection,
) => {
  const query = `
    INSERT INTO customer (
      Title, First_Name, middleName, lastName, displayName, companyName,
      companyEmail, phoneNumber, mobileNumber, fax, other, website, gstNo, vatNo,
      billingAddress1, billingAddress2, billingAddress3, billingCity, billingProvince, billingCountry,
      shippingAddress1, shippingAddress2, shippingAddress3, shippingCity, shippingProvince, shippingPostalCode, shippingCountry,
      Branch_idBranch, Agent_idEmployee, credit_limit
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        title,
        firstName,
        middleName,
        lastName,
        displayName,
        companyName,
        companyEmail,
        phoneNumber,
        mobileNumber,
        fax,
        other,
        website,
        gstNo,
        vatNo,
        billingAddress1,
        billingAddress2,
        billingAddress3,
        billingCity,
        billingProvince,
        billingCountry,
        shippingAddress1,
        shippingAddress2,
        shippingAddress3,
        shippingCity,
        shippingProvince,
        shippingPostalCode,
        shippingCountry,
        branchId,
        agentId,
        creditLimit,
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

const insertCustomerBranch = (
  Customer_idCustomer,
  Branch_Name,
  Branch_Address,
  Branch_Contact,
  connection,
) => {
  const query = `INSERT INTO customer_has_branch
    (Customer_idCustomer, Branch_Name, Branch_Address, Branch_Contact) 
    VALUES (?, ?, ?, ?)`;
  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [Customer_idCustomer, Branch_Name, Branch_Address, Branch_Contact],
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

const updateCustomerBranch = (
  idCustomer_Branch,
  Customer_idCustomer,
  Branch_Name,
  Branch_Address,
  Branch_Contact,
  connection,
) => {
  const query = `
    UPDATE customer_has_branch 
    SET 
    Customer_idCustomer=?,
    Branch_Name=?,
    Branch_Address=?,
    Branch_Contact=?  
    WHERE 
    idCustomer_Branch=?
  `;

  return new Promise((resolve, reject) => {
    (connection || db).query(
      query,
      [
        Customer_idCustomer,
        Branch_Name,
        Branch_Address,
        Branch_Contact,
        idCustomer_Branch,
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

const fetchCustomer = (
  Branch_idBranch,
  page = 1,
  limit = 10,
  search = "",
  status = "",
  agentId = null,
  companyName = null,
  customFieldId = null,
  customFieldValue = null,
  routeId = null,
  customerIds = null,
) => {
  const offset = (page - 1) * limit;
  let whereClause = "c.Branch_idBranch = ?";
  const queryParams = [Branch_idBranch];
  const countParams = [Branch_idBranch];

  if (search) {
    whereClause +=
      " AND (c.Title LIKE ? OR c.displayName LIKE ? OR c.phoneNumber LIKE ? OR c.companyEmail LIKE ? OR c.First_Name LIKE ? OR c.middleName LIKE ? OR c.lastName LIKE ?)";
    const searchParam = `%${search}%`;
    queryParams.push(
      searchParam,
      searchParam,
      searchParam,
      searchParam,
      searchParam,
      searchParam,
      searchParam,
    );
    countParams.push(
      searchParam,
      searchParam,
      searchParam,
      searchParam,
      searchParam,
      searchParam,
      searchParam,
    );
  }

  if (status !== "" && status !== null && status !== "null") {
    whereClause += " AND c.Status = ?";
    queryParams.push(status);
    countParams.push(status);
  }

  if (agentId !== "" && agentId !== null && agentId !== "null") {
    whereClause += " AND c.Agent_idEmployee = ?";
    queryParams.push(agentId);
    countParams.push(agentId);
  }

  if (companyName !== "" && companyName !== null && companyName !== "null") {
    whereClause += " AND c.companyName = ?";
    queryParams.push(companyName);
    countParams.push(companyName);
  }

  if (routeId !== "" && routeId !== null && routeId !== "null") {
    whereClause += " AND c.Route_idRoute = ?";
    queryParams.push(routeId);
    countParams.push(routeId);
  }

  if (Array.isArray(customerIds)) {
    if (customerIds.length === 0) {
      whereClause += " AND 1=0";
    } else {
      whereClause += ` AND c.idCustomer IN (${customerIds.map(() => "?").join(",")})`;
      queryParams.push(...customerIds);
      countParams.push(...customerIds);
    }
  }

  if (customFieldId && customFieldValue) {
    whereClause += ` AND EXISTS (
      SELECT 1 FROM customer_field_data cfd 
      WHERE cfd.customer_id = c.idCustomer 
      AND cfd.field_id = ? 
      AND cfd.value LIKE ?
    )`;
    const valueParam = `%${customFieldValue}%`;
    queryParams.push(customFieldId, valueParam);
    countParams.push(customFieldId, valueParam);
  }

  const query = `
    SELECT 
      c.*, 
      c.phoneNumber AS Tp, 
      c.companyEmail AS Email,
      c.Status,
      e.Employee_Name AS AgentName,
      r.Route_Name,
      r.Route_Code,
      COALESCE(SUM(i.Net_Amount), 0) AS Total_Invoice, 
      COUNT(i.idInvoice) AS Invoice_Count,
      COALESCE(SUM(CAST(i.Paid_Amount AS DECIMAL(10,2))), 0) AS Paid_Amount,
      COALESCE(SUM(GREATEST(0, CAST(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2)))), 0)
      + GREATEST(
        0,
        COALESCE(
          (SELECT SUM(CAST(COALESCE(ccl.Credit, 0) AS DECIMAL(10,2)) - CAST(COALESCE(ccl.Debit, 0) AS DECIMAL(10,2)))
           FROM customer_credit_log ccl 
           WHERE ccl.Customer_idCustomer = c.idCustomer 
             AND ccl.Type = 'MANUAL_CREDIT'),
          0
        )
        -
        COALESCE(
          (SELECT SUM(CAST(p.Debit AS DECIMAL(10,2)))
           FROM customer_credit_log p
           WHERE p.Customer_idCustomer = c.idCustomer
             AND p.Type = 'PAYMENT'
             AND (
               p.Type_Id = 0 
               OR p.Payment_Type = 0 
               OR p.Note LIKE '%Manual Credit%'
               OR p.Type_Id NOT IN (SELECT inv.idInvoice FROM invoice inv WHERE inv.Customer_idCustomer = c.idCustomer)
             )),
          0
        )
      )
      - COALESCE(MAX(c.overpayment), 0) AS Total_Credit_Balance
    FROM customer c 
    LEFT JOIN invoice i ON c.idCustomer = i.Customer_idCustomer 
    LEFT JOIN employee e ON c.Agent_idEmployee = e.idEmployee
    LEFT JOIN distribution_route r ON c.Route_idRoute = r.idRoute
    WHERE ${whereClause}
    GROUP BY c.idCustomer 
    ORDER BY c.displayName ASC
    LIMIT ? OFFSET ?
  `;

  // Add limit and offset to queryParams
  queryParams.push(parseInt(limit), parseInt(offset));

  const countQuery = `
    SELECT COUNT(*) as total 
    FROM customer c 
    WHERE ${whereClause}
  `;

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
          });
        }
      });
    });
  });
};

const fetchActiveCustomer = (
  Branch_idBranch,
  customFieldId = null,
  customFieldValue = null,
  routeId = null,
  customerIds = null,
) => {
  let whereClause = "c.Branch_idBranch = ? AND c.Status = 1";
  const queryParams = [Branch_idBranch];

  if (routeId !== "" && routeId !== null && routeId !== "null") {
    whereClause += " AND c.Route_idRoute = ?";
    queryParams.push(routeId);
  }

  if (Array.isArray(customerIds)) {
    if (customerIds.length === 0) {
      whereClause += " AND 1=0";
    } else {
      whereClause += ` AND c.idCustomer IN (${customerIds.map(() => "?").join(",")})`;
      queryParams.push(...customerIds);
    }
  }

  if (customFieldId && customFieldValue) {
    whereClause += ` AND EXISTS (
      SELECT 1 FROM customer_field_data cfd 
      WHERE cfd.customer_id = c.idCustomer 
      AND cfd.field_id = ? 
      AND cfd.value LIKE ?
    )`;
    queryParams.push(customFieldId, `%${customFieldValue}%`);
  }
  const query = `
    SELECT 
      c.*, 
      c.phoneNumber AS Tp, 
      c.companyEmail AS Email,
      c.Status,
      e.Employee_Name AS AgentName,
      r.Route_Name,
      r.Route_Code,
      COALESCE(SUM(i.Net_Amount), 0) AS Total_Invoice, 
      COUNT(i.idInvoice) AS Invoice_Count,
      COALESCE(SUM(CAST(i.Paid_Amount AS DECIMAL(10,2))), 0) AS Paid_Amount,
      COALESCE(SUM(GREATEST(0, CAST(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2)))), 0)
      + GREATEST(
        0,
        COALESCE(
          (SELECT SUM(CAST(COALESCE(ccl.Credit, 0) AS DECIMAL(10,2)) - CAST(COALESCE(ccl.Debit, 0) AS DECIMAL(10,2)))
           FROM customer_credit_log ccl 
           WHERE ccl.Customer_idCustomer = c.idCustomer 
             AND ccl.Type = 'MANUAL_CREDIT'),
          0
        )
        -
        COALESCE(
          (SELECT SUM(CAST(p.Debit AS DECIMAL(10,2)))
           FROM customer_credit_log p
           WHERE p.Customer_idCustomer = c.idCustomer
             AND p.Type = 'PAYMENT'
             AND (
               p.Type_Id = 0 
               OR p.Payment_Type = 0 
               OR p.Note LIKE '%Manual Credit%'
               OR p.Type_Id NOT IN (SELECT inv.idInvoice FROM invoice inv WHERE inv.Customer_idCustomer = c.idCustomer)
             )),
          0
        )
      )
      - COALESCE(MAX(c.overpayment), 0) AS Total_Credit_Balance
    FROM customer c 
    LEFT JOIN invoice i ON c.idCustomer = i.Customer_idCustomer 
    LEFT JOIN employee e ON c.Agent_idEmployee = e.idEmployee
    LEFT JOIN distribution_route r ON c.Route_idRoute = r.idRoute
    WHERE ${whereClause}
    GROUP BY c.idCustomer 
    ORDER BY c.displayName ASC
  `;

  return new Promise((resolve, reject) => {
    db.query(query, queryParams, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const fetchCustomerById = (idCustomer) => {
  const query = `
    SELECT 
      c.*, 
      c.phoneNumber AS Tp, 
      c.companyEmail AS Email,
      c.Status,
      e.Employee_Name AS AgentName,
      COALESCE(SUM(i.Net_Amount), 0) AS Total_Invoice, 
      COUNT(i.idInvoice) AS Invoice_Count,
      COALESCE(SUM(CAST(i.Paid_Amount AS DECIMAL(10,2))), 0) AS Paid_Amount,
      COALESCE(SUM(GREATEST(0, CAST(COALESCE(i.Net_Amount, 0) + COALESCE(i.Interest_Amount, 0) - COALESCE(i.Paid_Amount, 0) AS DECIMAL(10,2)))), 0)
      + GREATEST(
        0,
        COALESCE(
          (SELECT SUM(CAST(COALESCE(ccl.Credit, 0) AS DECIMAL(10,2)) - CAST(COALESCE(ccl.Debit, 0) AS DECIMAL(10,2)))
           FROM customer_credit_log ccl 
           WHERE ccl.Customer_idCustomer = c.idCustomer 
             AND ccl.Type = 'MANUAL_CREDIT'),
          0
        )
        -
        COALESCE(
          (SELECT SUM(CAST(p.Debit AS DECIMAL(10,2)))
           FROM customer_credit_log p
           WHERE p.Customer_idCustomer = c.idCustomer
             AND p.Type = 'PAYMENT'
             AND (
               p.Type_Id = 0 
               OR p.Payment_Type = 0 
               OR p.Note LIKE '%Manual Credit%'
               OR p.Type_Id NOT IN (SELECT inv.idInvoice FROM invoice inv WHERE inv.Customer_idCustomer = c.idCustomer)
             )),
          0
        )
      )
      - COALESCE(MAX(c.overpayment), 0) AS Total_Credit_Balance
    FROM customer c 
    LEFT JOIN invoice i ON c.idCustomer = i.Customer_idCustomer 
    LEFT JOIN employee e ON c.Agent_idEmployee = e.idEmployee 
    WHERE c.idCustomer = ?
    GROUP BY c.idCustomer
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const getCustomerbranches = (idCustomer) => {
  const query =
    "SELECT * FROM customer_has_branch WHERE Customer_idCustomer = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const updateCustomer = (
  idCustomer,
  Title,
  First_Name,
  middleName,
  lastName,
  displayName,
  Branch_idBranch,
  companyName,
  companyEmail,
  phoneNumber,
  mobileNumber,
  fax,
  other,
  website,
  gstNo,
  vatNo,
  billingAddress1,
  billingAddress2,
  billingAddress3,
  billingCity,
  billingProvince,
  billingCountry,
  shippingAddress1,
  shippingAddress2,
  shippingAddress3,
  shippingCity,
  shippingProvince,
  shippingPostalCode,
  shippingCountry,
  officialPhone,
  officialEmail,
  agentId,
  creditLimit,
  creditPeriod,
  imageName,
  connection,
) => {
  let query = `
    UPDATE customer SET 
      Title=?, First_Name=?, middleName=?, lastName=?, displayName=?,
      Branch_idBranch=?, companyName=?, companyEmail=?, phoneNumber=?, mobileNumber=?,
      fax=?, other=?, website=?, gstNo=?, vatNo=?,
      billingAddress1=?, billingAddress2=?, billingAddress3=?,
      billingCity=?, billingProvince=?, billingCountry=?,
      shippingAddress1=?, shippingAddress2=?, shippingAddress3=?,
      shippingCity=?, shippingProvince=?, shippingPostalCode=?, shippingCountry=?,
      officialPhone=?, officialEmail=?, Agent_idEmployee=?, credit_limit=?, credit_period=?`;

  const values = [
    Title,
    First_Name,
    middleName,
    lastName,
    displayName,
    Branch_idBranch,
    companyName,
    companyEmail,
    phoneNumber,
    mobileNumber,
    fax,
    other,
    website,
    gstNo,
    vatNo,
    billingAddress1,
    billingAddress2,
    billingAddress3,
    billingCity,
    billingProvince,
    billingCountry,
    shippingAddress1,
    shippingAddress2,
    shippingAddress3,
    shippingCity,
    shippingProvince,
    shippingPostalCode,
    shippingCountry,
    officialPhone,
    officialEmail,
    agentId,
    creditLimit,
    creditPeriod,
  ];

  if (imageName) {
    query += `, profileImage=?`;
    values.push(imageName);
  }

  query += ` WHERE idCustomer=?`;
  values.push(idCustomer);

  return new Promise((resolve, reject) => {
    (connection || db).query(query, values, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const checkCustomerExist = (Tp, Branch_idBranch) => {
  const query = "SELECT * FROM customer WHERE phoneNumber = ? AND Branch_idBranch = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [Tp, Branch_idBranch], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

const deleteCustomer = (idCustomer, connection) => {
  const query =
    "UPDATE customer SET 	Is_deleted = CASE WHEN Is_deleted = 1 THEN 0 ELSE 1 END WHERE idCustomer = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const updateStatus = (idCustomer, connection) => {
  const query =
    "UPDATE customer SET Status = CASE WHEN Status = 1 THEN 0 ELSE 1 END WHERE idCustomer = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const updateCustomerOther = (idCustomer, other, connection) => {
  const query = "UPDATE customer SET other = ? WHERE idCustomer = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [other, idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const updateCustomerAgentAndOther = (idCustomer, agentId, other, connection) => {
  const query = "UPDATE customer SET Agent_idEmployee = ?, other = ? WHERE idCustomer = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [agentId, other, idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const updateCustomerOverpayment = (idCustomer, amount, connection) => {
  const query = "UPDATE customer SET overpayment = overpayment + ? WHERE idCustomer = ?";
  return new Promise((resolve, reject) => {
    (connection || db).query(query, [amount, idCustomer], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });
};

const fetchCustomerImages = (customerId) => {
  const query = "SELECT * FROM customer_images WHERE customer_id = ?";
  return new Promise((resolve, reject) => {
    db.query(query, [customerId], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(results)));
      }
    });
  });
};

module.exports = {
  insertCustomer,
  fetchCustomer,
  fetchActiveCustomer,
  fetchCustomerById,
  fetchCustomerImages,
  updateCustomer,
  updateCustomerOther,
  updateCustomerAgentAndOther,
  updateCustomerOverpayment,
  deleteCustomer,
  checkCustomerExist,
  updateStatus,
  insertCustomerBranch,
  getCustomerbranches,
  updateCustomerBranch,
};
