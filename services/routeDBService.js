const db = require("../db/db");

// Helper for promise-based queries
const queryAsync = (query, params = [], conn = null) => {
  return new Promise((resolve, reject) => {
    (conn || db).query(query, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

/**
 * 1. Create a new distribution route
 */
const createRoute = async (routeData) => {
  const {
    Route_Code,
    Route_Name,
    Description = null,
    Province = null,
    District = null,
    Cities = null,
    Start_Location = null,
    Start_Lat = null,
    Start_Lng = null,
    End_Location = null,
    End_Lat = null,
    End_Lng = null,
    Waypoints = null,
    Branch_idBranch,
    Default_Salesperson_Id = null,
    Default_Driver_Id = null,
    Vehicle_Number = null,
    Status = 1,
  } = routeData;

  const citiesJson = Cities ? (typeof Cities === "string" ? Cities : JSON.stringify(Cities)) : null;
  const waypointsJson = Waypoints ? (typeof Waypoints === "string" ? Waypoints : JSON.stringify(Waypoints)) : null;

  const insertSql = `
    INSERT INTO distribution_route (
      Route_Code, Route_Name, Description, Province, District, Cities,
      Start_Location, Start_Lat, Start_Lng, End_Location, End_Lat, End_Lng,
      Waypoints, Branch_idBranch, Default_Salesperson_Id, Default_Driver_Id,
      Vehicle_Number, Status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const result = await queryAsync(insertSql, [
    Route_Code,
    Route_Name,
    Description,
    Province,
    District,
    citiesJson,
    Start_Location,
    Start_Lat,
    Start_Lng,
    End_Location,
    End_Lat,
    End_Lng,
    waypointsJson,
    Branch_idBranch,
    Default_Salesperson_Id || null,
    Default_Driver_Id || null,
    Vehicle_Number,
    Status,
  ]);

  const newRouteId = result.insertId;

  // Insert default assigned users if provided
  if (Default_Salesperson_Id) {
    await queryAsync(
      `INSERT INTO route_has_user (Route_idRoute, User_idUser, Role_Type) VALUES (?, ?, 'Salesperson')
       ON DUPLICATE KEY UPDATE Role_Type = 'Salesperson'`,
      [newRouteId, Default_Salesperson_Id]
    ).catch(err => console.error("Error setting default salesperson user:", err));
  }

  if (Default_Driver_Id) {
    await queryAsync(
      `INSERT INTO route_has_user (Route_idRoute, User_idUser, Role_Type) VALUES (?, ?, 'Driver')
       ON DUPLICATE KEY UPDATE Role_Type = 'Driver'`,
      [newRouteId, Default_Driver_Id]
    ).catch(err => console.error("Error setting default driver user:", err));
  }

  return newRouteId;
};

/**
 * 2. Get list of distribution routes for a branch
 */
const getRoutesByBranch = async (branchId, options = {}) => {
  const { search = "", status = null } = options;

  let sql = `
    SELECT 
      dr.*,
      COALESCE(sp.First_Name, au_sp.First_Name) AS Salesperson_First_Name,
      COALESCE(sp.Last_Name, au_sp.Last_Name) AS Salesperson_Last_Name,
      COALESCE(drv.First_Name, au_drv.First_Name) AS Driver_First_Name,
      COALESCE(drv.Last_Name, au_drv.Last_Name) AS Driver_Last_Name,
      (SELECT COUNT(*) FROM route_has_customer rhc WHERE rhc.Route_idRoute = dr.idRoute) AS customer_count
    FROM distribution_route dr
    LEFT JOIN user sp ON dr.Default_Salesperson_Id = sp.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_sp ON dr.Default_Salesperson_Id = au_sp.idAsipiya_User
    LEFT JOIN user drv ON dr.Default_Driver_Id = drv.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_drv ON dr.Default_Driver_Id = au_drv.idAsipiya_User
    WHERE dr.Branch_idBranch = ?
  `;

  const params = [branchId];

  if (status !== null && status !== undefined && status !== "") {
    sql += ` AND dr.Status = ?`;
    params.push(status);
  } else {
    // By default, exclude deleted (status = 0)
    sql += ` AND dr.Status != 0`;
  }

  if (search && search.trim() !== "") {
    sql += ` AND (
      dr.Route_Code LIKE ? OR 
      dr.Route_Name LIKE ? OR 
      dr.District LIKE ? OR 
      dr.Province LIKE ?
    )`;
    const searchTerm = `%${search.trim()}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (options.scopedUserId) {
    sql += ` AND (
      dr.Default_Salesperson_Id = ?
      OR dr.Default_Driver_Id = ?
      OR dr.idRoute IN (SELECT Route_idRoute FROM daily_route_assignment WHERE (Salesperson_User_Id = ? OR Driver_User_Id = ?) AND Status != 'Cancelled')
      OR dr.idRoute IN (SELECT Route_idRoute FROM route_has_user WHERE User_idUser = ?)
    )`;
    params.push(
      options.scopedUserId,
      options.scopedUserId,
      options.scopedUserId,
      options.scopedUserId,
      options.scopedUserId
    );
  }

  sql += ` ORDER BY dr.Route_Name ASC`;

  const rows = await queryAsync(sql, params);

  // Parse JSON fields
  return rows.map(r => {
    let cities = [];
    let waypoints = [];
    try {
      cities = r.Cities ? (typeof r.Cities === "string" ? JSON.parse(r.Cities) : r.Cities) : [];
    } catch (e) {}
    try {
      waypoints = r.Waypoints ? (typeof r.Waypoints === "string" ? JSON.parse(r.Waypoints) : r.Waypoints) : [];
    } catch (e) {}
    return {
      ...r,
      Cities: cities,
      Waypoints: waypoints,
    };
  });
};

/**
 * 3. Get single route by ID with full details (customers & assigned users)
 */
const getRouteById = async (routeId) => {
  const routeSql = `
    SELECT 
      dr.*,
      COALESCE(sp.First_Name, au_sp.First_Name) AS Salesperson_First_Name,
      COALESCE(sp.Last_Name, au_sp.Last_Name) AS Salesperson_Last_Name,
      COALESCE(drv.First_Name, au_drv.First_Name) AS Driver_First_Name,
      COALESCE(drv.Last_Name, au_drv.Last_Name) AS Driver_Last_Name
    FROM distribution_route dr
    LEFT JOIN user sp ON dr.Default_Salesperson_Id = sp.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_sp ON dr.Default_Salesperson_Id = au_sp.idAsipiya_User
    LEFT JOIN user drv ON dr.Default_Driver_Id = drv.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_drv ON dr.Default_Driver_Id = au_drv.idAsipiya_User
    WHERE dr.idRoute = ?
  `;

  const routeRows = await queryAsync(routeSql, [routeId]);
  if (!routeRows.length) return null;

  const route = routeRows[0];
  try {
    route.Cities = route.Cities ? (typeof route.Cities === "string" ? JSON.parse(route.Cities) : route.Cities) : [];
  } catch (e) {
    route.Cities = [];
  }
  try {
    route.Waypoints = route.Waypoints ? (typeof route.Waypoints === "string" ? JSON.parse(route.Waypoints) : route.Waypoints) : [];
  } catch (e) {
    route.Waypoints = [];
  }

  // Fetch assigned customers in order
  const customerSql = `
    SELECT 
      rhc.id AS assignment_id,
      rhc.Route_idRoute,
      rhc.Customer_idCustomer,
      rhc.Stop_Order,
      rhc.Estimated_Visit_Time,
      c.displayName,
      c.companyName,
      c.phoneNumber,
      c.mobileNumber,
      c.billingAddress1,
      c.billingCity,
      c.billingProvince,
      c.Latitude,
      c.Longitude,
      c.Status AS customer_status
    FROM route_has_customer rhc
    JOIN customer c ON rhc.Customer_idCustomer = c.idCustomer
    WHERE rhc.Route_idRoute = ?
    ORDER BY rhc.Stop_Order ASC
  `;
  const customers = await queryAsync(customerSql, [routeId]);

  // Fetch assigned users
  const usersSql = `
    SELECT 
      rhu.*,
      u.First_Name,
      u.Last_Name,
      u.User_Name,
      u.Email
    FROM route_has_user rhu
    JOIN user u ON rhu.User_idUser = u.idUser
    WHERE rhu.Route_idRoute = ?
    ORDER BY rhu.Role_Type ASC
  `;
  const users = await queryAsync(usersSql, [routeId]);

  return {
    ...route,
    customers,
    users,
  };
};

/**
 * 4. Update route details
 */
const updateRoute = async (routeId, routeData) => {
  const {
    Route_Code,
    Route_Name,
    Description,
    Province,
    District,
    Cities,
    Start_Location,
    Start_Lat,
    Start_Lng,
    End_Location,
    End_Lat,
    End_Lng,
    Waypoints,
    Default_Salesperson_Id,
    Default_Driver_Id,
    Vehicle_Number,
    Status,
  } = routeData;

  const citiesJson = Cities !== undefined ? (typeof Cities === "string" ? Cities : JSON.stringify(Cities)) : null;
  const waypointsJson = Waypoints !== undefined ? (typeof Waypoints === "string" ? Waypoints : JSON.stringify(Waypoints)) : null;

  const updateSql = `
    UPDATE distribution_route SET
      Route_Code = COALESCE(?, Route_Code),
      Route_Name = COALESCE(?, Route_Name),
      Description = ?,
      Province = ?,
      District = ?,
      Cities = ?,
      Start_Location = ?,
      Start_Lat = ?,
      Start_Lng = ?,
      End_Location = ?,
      End_Lat = ?,
      End_Lng = ?,
      Waypoints = ?,
      Default_Salesperson_Id = ?,
      Default_Driver_Id = ?,
      Vehicle_Number = ?,
      Status = COALESCE(?, Status)
    WHERE idRoute = ?
  `;

  await queryAsync(updateSql, [
    Route_Code,
    Route_Name,
    Description !== undefined ? Description : null,
    Province !== undefined ? Province : null,
    District !== undefined ? District : null,
    citiesJson,
    Start_Location !== undefined ? Start_Location : null,
    Start_Lat !== undefined ? Start_Lat : null,
    Start_Lng !== undefined ? Start_Lng : null,
    End_Location !== undefined ? End_Location : null,
    End_Lat !== undefined ? End_Lat : null,
    End_Lng !== undefined ? End_Lng : null,
    waypointsJson,
    Default_Salesperson_Id || null,
    Default_Driver_Id || null,
    Vehicle_Number !== undefined ? Vehicle_Number : null,
    Status !== undefined ? Status : 1,
    routeId,
  ]);

  // Sync users
  if (Default_Salesperson_Id) {
    await queryAsync(
      `INSERT INTO route_has_user (Route_idRoute, User_idUser, Role_Type) VALUES (?, ?, 'Salesperson')
       ON DUPLICATE KEY UPDATE Role_Type = 'Salesperson'`,
      [routeId, Default_Salesperson_Id]
    ).catch(e => console.error(e));
  }

  if (Default_Driver_Id) {
    await queryAsync(
      `INSERT INTO route_has_user (Route_idRoute, User_idUser, Role_Type) VALUES (?, ?, 'Driver')
       ON DUPLICATE KEY UPDATE Role_Type = 'Driver'`,
      [routeId, Default_Driver_Id]
    ).catch(e => console.error(e));
  }

  return true;
};

/**
 * 5. Delete route (soft delete Status = 0)
 */
const deleteRoute = async (routeId) => {
  // Check if there are active daily assignments
  const checkAssignment = await queryAsync(
    "SELECT COUNT(*) as count FROM daily_route_assignment WHERE Route_idRoute = ? AND Status IN ('Scheduled', 'In-Progress')",
    [routeId]
  );
  if (checkAssignment[0]?.count > 0) {
    throw new Error("Cannot delete route with active or scheduled daily dispatches. Please complete or cancel them first.");
  }

  // Soft delete route
  await queryAsync("UPDATE distribution_route SET Status = 0 WHERE idRoute = ?", [routeId]);

  // Unlink customers from this route
  await queryAsync("DELETE FROM route_has_customer WHERE Route_idRoute = ?", [routeId]);
  await queryAsync("UPDATE customer SET Route_idRoute = NULL WHERE Route_idRoute = ?", [routeId]);

  return true;
};

/**
 * 6. Assign customers to a route (Route-first assignment with sequencing)
 */
const assignCustomersToRoute = async (routeId, customerList = []) => {
  // customerList: [{ customerId: 1, stopOrder: 1, estimatedVisitTime: '09:00' }, ...]
  return new Promise((resolve, reject) => {
    db.getConnection(async (err, connection) => {
      if (err) return reject(err);

      try {
        await new Promise((res, rej) => connection.beginTransaction(e => e ? rej(e) : res()));

        // Delete existing customer assignments for this route
        await queryAsync("DELETE FROM route_has_customer WHERE Route_idRoute = ?", [routeId], connection);

        if (customerList.length > 0) {
          const insertValues = customerList.map((item, index) => [
            routeId,
            item.customerId || item.Customer_idCustomer || item.idCustomer,
            item.stopOrder || item.Stop_Order || (index + 1),
            item.estimatedVisitTime || item.Estimated_Visit_Time || null,
          ]);

          const insertSql = `
            INSERT INTO route_has_customer (Route_idRoute, Customer_idCustomer, Stop_Order, Estimated_Visit_Time)
            VALUES ?
          `;
          await queryAsync(insertSql, [insertValues], connection);

          const customerIds = insertValues.map(v => v[1]);
          // Update customer table Route_idRoute
          await queryAsync(
            `UPDATE customer SET Route_idRoute = ? WHERE idCustomer IN (?)`,
            [routeId, customerIds],
            connection
          );

          // Clear Route_idRoute for any customer previously linked to this route who was removed
          await queryAsync(
            `UPDATE customer SET Route_idRoute = NULL WHERE Route_idRoute = ? AND idCustomer NOT IN (?)`,
            [routeId, customerIds],
            connection
          );
        } else {
          // If empty list, clear all customers previously assigned to this route
          await queryAsync(
            `UPDATE customer SET Route_idRoute = NULL WHERE Route_idRoute = ?`,
            [routeId],
            connection
          );
        }

        await new Promise((res, rej) => connection.commit(e => e ? rej(e) : res()));
        connection.release();
        resolve(true);
      } catch (txnError) {
        await new Promise(res => connection.rollback(() => res()));
        connection.release();
        reject(txnError);
      }
    });
  });
};

/**
 * 7. Reverse batch assign customers to route (from Customer List table multi-select)
 */
const batchAssignCustomersToRoute = async (routeId, customerIds = []) => {
  if (!customerIds.length) return true;

  // Get highest stop order currently on this route
  const maxOrderRows = await queryAsync(
    "SELECT MAX(Stop_Order) AS max_order FROM route_has_customer WHERE Route_idRoute = ?",
    [routeId]
  );
  let currentOrder = (maxOrderRows[0]?.max_order || 0);

  return new Promise((resolve, reject) => {
    db.getConnection(async (err, connection) => {
      if (err) return reject(err);

      try {
        await new Promise((res, rej) => connection.beginTransaction(e => e ? rej(e) : res()));

        for (const cid of customerIds) {
          currentOrder += 1;
          await queryAsync(
            `INSERT INTO route_has_customer (Route_idRoute, Customer_idCustomer, Stop_Order)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE Stop_Order = ?`,
            [routeId, cid, currentOrder, currentOrder],
            connection
          );
        }

        // Update customer records
        await queryAsync(
          "UPDATE customer SET Route_idRoute = ? WHERE idCustomer IN (?)",
          [routeId, customerIds],
          connection
        );

        await new Promise((res, rej) => connection.commit(e => e ? rej(e) : res()));
        connection.release();
        resolve(true);
      } catch (txnError) {
        await new Promise(res => connection.rollback(() => res()));
        connection.release();
        reject(txnError);
      }
    });
  });
};

/**
 * 8. Unassign single customer from route
 */
const unassignCustomerFromRoute = async (routeId, customerId) => {
  await queryAsync(
    "DELETE FROM route_has_customer WHERE Route_idRoute = ? AND Customer_idCustomer = ?",
    [routeId, customerId]
  );
  await queryAsync(
    "UPDATE customer SET Route_idRoute = NULL WHERE idCustomer = ? AND Route_idRoute = ?",
    [customerId, routeId]
  );
  return true;
};

/**
 * 9. Fetch all customers for route assignment modal (with current route info)
 */
const getCustomersForRouteAssignment = async (branchId, routeId = null) => {
  const sql = `
    SELECT 
      c.idCustomer,
      c.displayName,
      c.companyName,
      c.phoneNumber,
      c.mobileNumber,
      c.billingAddress1,
      c.billingCity,
      c.billingProvince,
      c.Latitude,
      c.Longitude,
      c.Route_idRoute,
      r.Route_Name AS current_route_name,
      r.Route_Code AS current_route_code,
      rhc.Stop_Order,
      rhc.Estimated_Visit_Time,
      CASE 
        WHEN ? IS NOT NULL AND rhc.Route_idRoute = ? THEN 1
        ELSE 0
      END AS is_assigned_to_this_route
    FROM customer c
    LEFT JOIN distribution_route r ON c.Route_idRoute = r.idRoute
    LEFT JOIN route_has_customer rhc ON rhc.Customer_idCustomer = c.idCustomer AND (? IS NULL OR rhc.Route_idRoute = ?)
    WHERE c.Branch_idBranch = ? AND c.Status = 1
    ORDER BY is_assigned_to_this_route DESC, rhc.Stop_Order ASC, c.displayName ASC
  `;

  return await queryAsync(sql, [routeId, routeId, routeId, routeId, branchId]);
};

/**
 * 10. Fetch users available for route assignment (salespersons, drivers)
 */
const getBranchUsersForRoutes = async (branchId) => {
  const sql = `
    SELECT DISTINCT
      u.idUser,
      u.First_Name,
      u.Last_Name,
      u.User_Name,
      u.Email,
      u.Role,
      COALESCE(up.Route_Management, 0) AS Route_Management,
      COALESCE(up.Daily_Route_View, 0) AS Daily_Route_View,
      COALESCE(up.Show_Only_User_Data, 0) AS Show_Only_User_Data
    FROM (
      -- 1. Local branch & company users
      SELECT 
        u.idUser,
        u.First_Name,
        u.Last_Name,
        u.User_Name,
        u.Email,
        u.Role
      FROM user u
      WHERE (
        u.Branch_idBranch = ?
        OR u.Branch_idBranch IN (
          SELECT b2.idBranch FROM branch b1
          JOIN branch b2 ON b1.Company_idCompany = b2.Company_idCompany
          WHERE b1.idBranch = ?
        )
      )
      AND u.Status = 1

      UNION

      -- 2. Staff from account center for this company
      SELECT 
        au.idAsipiya_User AS idUser,
        au.First_Name,
        au.Last_Name,
        au.Email AS User_Name,
        au.Email,
        chau.Role
      FROM asipbook_account_center.asipiya_user au
      JOIN asipbook_account_center.company_has_asipiya_user chau 
        ON au.idAsipiya_User = chau.Asipiya_User_idAsipiya_User
      JOIN branch b ON chau.Company_idCompany = b.Company_idCompany
      WHERE b.idBranch = ?
        AND au.Status = 1
        AND chau.Status = 1
    ) AS u
    LEFT JOIN user_privilages up ON u.idUser = up.User_idUser AND up.Branch_idBranch = ?
    ORDER BY u.First_Name ASC
  `;
  return await queryAsync(sql, [branchId, branchId, branchId, branchId]);
};

/**
 * 11. Create a Daily Route Assignment (Morning Dispatch)
 */
const createDailyRouteAssignment = async (dispatchData) => {
  const {
    Assignment_Date,
    Route_idRoute,
    Salesperson_User_Id,
    Driver_User_Id = null,
    Vehicle_Number = null,
    Notes = null,
    Branch_idBranch,
    Created_By = null,
    customerStops = [], // Optional custom list of customer IDs / sequence
  } = dispatchData;

  return new Promise((resolve, reject) => {
    db.getConnection(async (err, connection) => {
      if (err) return reject(err);

      try {
        await new Promise((res, rej) => connection.beginTransaction(e => e ? rej(e) : res()));

        // Insert master daily assignment
        const insertAssignmentSql = `
          INSERT INTO daily_route_assignment (
            Assignment_Date, Route_idRoute, Salesperson_User_Id, Driver_User_Id,
            Vehicle_Number, Status, Notes, Branch_idBranch, Created_By
          ) VALUES (?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?)
        `;

        const result = await queryAsync(insertAssignmentSql, [
          Assignment_Date,
          Route_idRoute,
          Salesperson_User_Id,
          Driver_User_Id || null,
          Vehicle_Number,
          Notes,
          Branch_idBranch,
          Created_By,
        ], connection);

        const dailyAssignmentId = result.insertId;

        // Fetch stops: either from custom customerStops passed or from base route_has_customer
        let stops = customerStops;
        if (!stops || stops.length === 0) {
          const defaultStops = await queryAsync(
            `SELECT Customer_idCustomer, Stop_Order FROM route_has_customer 
             WHERE Route_idRoute = ? ORDER BY Stop_Order ASC`,
            [Route_idRoute],
            connection
          );
          stops = defaultStops.map(s => ({
            customerId: s.Customer_idCustomer,
            visitOrder: s.Stop_Order,
          }));
        }

        if (stops.length > 0) {
          const insertStopsValues = stops.map((s, idx) => [
            dailyAssignmentId,
            s.customerId || s.Customer_idCustomer,
            s.visitOrder || s.Stop_Order || (idx + 1),
            "Pending",
          ]);

          const insertStopsSql = `
            INSERT INTO daily_route_customer (
              Daily_Assignment_id, Customer_idCustomer, Visit_Order, Visit_Status
            ) VALUES ?
          `;
          await queryAsync(insertStopsSql, [insertStopsValues], connection);
        }

        await new Promise((res, rej) => connection.commit(e => e ? rej(e) : res()));
        connection.release();
        resolve(dailyAssignmentId);
      } catch (txnError) {
        await new Promise(res => connection.rollback(() => res()));
        connection.release();
        reject(txnError);
      }
    });
  });
};

/**
 * 12. Get daily route assignments for a branch and date
 */
const getDailyRouteAssignments = async (branchId, date, options = {}) => {
  let sql = `
    SELECT 
      dra.*,
      dr.Route_Code,
      dr.Route_Name,
      COALESCE(sp.First_Name, au_sp.First_Name) AS Salesperson_First_Name,
      COALESCE(sp.Last_Name, au_sp.Last_Name) AS Salesperson_Last_Name,
      COALESCE(drv.First_Name, au_drv.First_Name) AS Driver_First_Name,
      COALESCE(drv.Last_Name, au_drv.Last_Name) AS Driver_Last_Name,
      COUNT(drc.idDaily_Route_Customer) AS total_stops,
      SUM(CASE WHEN drc.Visit_Status IN ('Visited', 'Invoiced', 'Payment_Collected') THEN 1 ELSE 0 END) AS completed_stops,
      SUM(CASE WHEN drc.Visit_Status = 'Skipped' THEN 1 ELSE 0 END) AS skipped_stops,
      SUM(CASE WHEN drc.Visit_Status = 'Pending' THEN 1 ELSE 0 END) AS pending_stops,
      COALESCE(SUM(drc.Payment_Collected), 0.00) AS total_collected
    FROM daily_route_assignment dra
    JOIN distribution_route dr ON dra.Route_idRoute = dr.idRoute
    LEFT JOIN user sp ON dra.Salesperson_User_Id = sp.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_sp ON dra.Salesperson_User_Id = au_sp.idAsipiya_User
    LEFT JOIN user drv ON dra.Driver_User_Id = drv.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_drv ON dra.Driver_User_Id = au_drv.idAsipiya_User
    LEFT JOIN daily_route_customer drc ON dra.idDaily_Assignment = drc.Daily_Assignment_id
    WHERE dra.Branch_idBranch = ? AND dra.Assignment_Date = ?
  `;
  const params = [branchId, date];

  if (options.scopedUserId) {
    sql += ` AND (dra.Salesperson_User_Id = ? OR dra.Driver_User_Id = ?)`;
    params.push(options.scopedUserId, options.scopedUserId);
  }

  sql += `
    GROUP BY dra.idDaily_Assignment
    ORDER BY dra.Created_At DESC
  `;

  return await queryAsync(sql, params);
};

/**
 * 13. Get Today's Assigned Route for a Field User (Driver or Salesperson)
 * STRICT PRIVILEGE & SCOPING:
 * - Only returns TODAY's assignment for this user.
 * - Previous days and future days are NOT returned.
 * - Other users' routes are NOT returned.
 */
const getTodayUserRoute = async (userId, branchId, todayDate) => {
  const assignmentSql = `
    SELECT 
      dra.*,
      dr.Route_Code,
      dr.Route_Name,
      dr.Description,
      dr.Province,
      dr.District,
      dr.Cities,
      dr.Start_Location,
      dr.Start_Lat,
      dr.Start_Lng,
      dr.End_Location,
      dr.End_Lat,
      dr.End_Lng,
      dr.Waypoints,
      COALESCE(sp.First_Name, au_sp.First_Name) AS Salesperson_First_Name,
      COALESCE(sp.Last_Name, au_sp.Last_Name) AS Salesperson_Last_Name,
      COALESCE(drv.First_Name, au_drv.First_Name) AS Driver_First_Name,
      COALESCE(drv.Last_Name, au_drv.Last_Name) AS Driver_Last_Name
    FROM daily_route_assignment dra
    JOIN distribution_route dr ON dra.Route_idRoute = dr.idRoute
    LEFT JOIN user sp ON dra.Salesperson_User_Id = sp.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_sp ON dra.Salesperson_User_Id = au_sp.idAsipiya_User
    LEFT JOIN user drv ON dra.Driver_User_Id = drv.idUser
    LEFT JOIN asipbook_account_center.asipiya_user au_drv ON dra.Driver_User_Id = au_drv.idAsipiya_User
    WHERE 
      (dra.Salesperson_User_Id = ? OR dra.Driver_User_Id = ?)
      AND dra.Assignment_Date = ?
      AND dra.Branch_idBranch = ?
      AND dra.Status != 'Cancelled'
    ORDER BY dra.idDaily_Assignment DESC
    LIMIT 1
  `;

  const rows = await queryAsync(assignmentSql, [userId, userId, todayDate, branchId]);
  if (!rows.length) {
    return { assignment: null, stops: [] };
  }

  const assignment = rows[0];
  try {
    assignment.Cities = assignment.Cities ? (typeof assignment.Cities === "string" ? JSON.parse(assignment.Cities) : assignment.Cities) : [];
  } catch (e) {
    assignment.Cities = [];
  }
  try {
    assignment.Waypoints = assignment.Waypoints ? (typeof assignment.Waypoints === "string" ? JSON.parse(assignment.Waypoints) : assignment.Waypoints) : [];
  } catch (e) {
    assignment.Waypoints = [];
  }

  // Fetch stops with customer contact & location details
  const stopsSql = `
    SELECT 
      drc.idDaily_Route_Customer,
      drc.Daily_Assignment_id,
      drc.Customer_idCustomer,
      drc.Visit_Order,
      drc.Visit_Status,
      drc.Check_In_Time,
      drc.Check_Out_Time,
      drc.Invoice_idInvoice,
      drc.Payment_Collected,
      drc.Payment_Method,
      drc.Feedback_Notes,
      c.displayName,
      c.companyName,
      c.phoneNumber,
      c.mobileNumber,
      c.billingAddress1,
      c.billingAddress2,
      c.billingCity,
      c.billingProvince,
      c.Latitude,
      c.Longitude
    FROM daily_route_customer drc
    JOIN customer c ON drc.Customer_idCustomer = c.idCustomer
    WHERE drc.Daily_Assignment_id = ?
    ORDER BY drc.Visit_Order ASC
  `;

  const stops = await queryAsync(stopsSql, [assignment.idDaily_Assignment]);

  return {
    assignment,
    stops,
  };
};

/**
 * 14. Update customer visit stop status (Check-in, checkout, payment collected, invoice, notes)
 */
const updateDailyCustomerVisit = async (stopId, updateData) => {
  const {
    Visit_Status,
    Check_In_Time,
    Check_Out_Time,
    Invoice_idInvoice,
    Payment_Collected,
    Payment_Method,
    Feedback_Notes,
  } = updateData;

  const sql = `
    UPDATE daily_route_customer SET
      Visit_Status = COALESCE(?, Visit_Status),
      Check_In_Time = COALESCE(?, Check_In_Time),
      Check_Out_Time = COALESCE(?, Check_Out_Time),
      Invoice_idInvoice = COALESCE(?, Invoice_idInvoice),
      Payment_Collected = COALESCE(?, Payment_Collected),
      Payment_Method = COALESCE(?, Payment_Method),
      Feedback_Notes = COALESCE(?, Feedback_Notes)
    WHERE idDaily_Route_Customer = ?
  `;

  await queryAsync(sql, [
    Visit_Status !== undefined ? Visit_Status : null,
    Check_In_Time !== undefined ? Check_In_Time : null,
    Check_Out_Time !== undefined ? Check_Out_Time : null,
    Invoice_idInvoice !== undefined ? Invoice_idInvoice : null,
    Payment_Collected !== undefined ? Payment_Collected : null,
    Payment_Method !== undefined ? Payment_Method : null,
    Feedback_Notes !== undefined ? Feedback_Notes : null,
    stopId,
  ]);

  return true;
};

/**
 * 15. Update daily route assignment status (Start route, Complete route, etc.)
 */
const updateDailyRouteStatus = async (dailyAssignmentId, status, notes = null) => {
  let sql = `UPDATE daily_route_assignment SET Status = ?`;
  const params = [status];

  if (status === "In-Progress") {
    sql += `, Start_Time = COALESCE(Start_Time, NOW())`;
  } else if (status === "Completed") {
    sql += `, End_Time = NOW()`;
  }

  if (notes !== null) {
    sql += `, Notes = ?`;
    params.push(notes);
  }

  sql += ` WHERE idDaily_Assignment = ?`;
  params.push(dailyAssignmentId);

  await queryAsync(sql, params);
  return true;
};

/**
 * 16. Get customer IDs assigned to a user for today (Used for strict invoice and customer scoping)
 */
const getAssignedCustomerIdsForUserToday = async (userId, branchId, todayDate) => {
  const sql = `
    SELECT drc.Customer_idCustomer
    FROM daily_route_assignment dra
    JOIN daily_route_customer drc ON dra.idDaily_Assignment = drc.Daily_Assignment_id
    WHERE 
      (dra.Salesperson_User_Id = ? OR dra.Driver_User_Id = ?)
      AND dra.Assignment_Date = ?
      AND dra.Branch_idBranch = ?
      AND dra.Status != 'Cancelled'
  `;
  const rows = await queryAsync(sql, [userId, userId, todayDate, branchId]);
  return rows.map(r => Number(r.Customer_idCustomer));
};

/**
 * 17. Get all customer IDs related to a user (assigned to their master routes, assigned in daily dispatch, or created by them)
 */
const getAllCustomerIdsForUser = async (userId, branchId) => {
  if (!userId || !branchId) return [];
  const sql = `
    SELECT DISTINCT Customer_idCustomer FROM (
      -- 1. Customers mapped to user master routes via route_has_customer
      SELECT rhc.Customer_idCustomer
      FROM route_has_customer rhc
      JOIN distribution_route dr ON rhc.Route_idRoute = dr.idRoute
      WHERE (
        dr.Default_Salesperson_Id = ? 
        OR dr.Default_Driver_Id = ?
        OR dr.idRoute IN (SELECT Route_idRoute FROM route_has_user WHERE User_idUser = ?)
        OR dr.idRoute IN (SELECT Route_idRoute FROM daily_route_assignment WHERE (Salesperson_User_Id = ? OR Driver_User_Id = ?) AND Status != 'Cancelled')
      )
        AND dr.Branch_idBranch = ?
        AND dr.Status != 0

      UNION

      -- 2. Customers mapped directly on customer table via Route_idRoute
      SELECT c.idCustomer AS Customer_idCustomer
      FROM customer c
      JOIN distribution_route dr ON c.Route_idRoute = dr.idRoute
      WHERE (
        dr.Default_Salesperson_Id = ? 
        OR dr.Default_Driver_Id = ?
        OR dr.idRoute IN (SELECT Route_idRoute FROM route_has_user WHERE User_idUser = ?)
        OR dr.idRoute IN (SELECT Route_idRoute FROM daily_route_assignment WHERE (Salesperson_User_Id = ? OR Driver_User_Id = ?) AND Status != 'Cancelled')
      )
        AND c.Branch_idBranch = ?

      UNION

      -- 3. Customers from daily route assignments
      SELECT drc.Customer_idCustomer
      FROM daily_route_assignment dra
      JOIN daily_route_customer drc ON dra.idDaily_Assignment = drc.Daily_Assignment_id
      WHERE (dra.Salesperson_User_Id = ? OR dra.Driver_User_Id = ?)
        AND dra.Branch_idBranch = ?
        AND dra.Status != 'Cancelled'

      UNION

      -- 4. Customers created by this user in user_log
      SELECT CAST(Task_ID AS UNSIGNED) AS Customer_idCustomer
      FROM user_log
      WHERE Task_Type = 'Customer'
        AND User_idUser = ?
        AND Task_Category = 'create'
        AND Branch_idBranch = ?

      UNION

      -- 5. Customers directly assigned as agent
      SELECT c.idCustomer AS Customer_idCustomer
      FROM customer c
      WHERE c.Agent_idEmployee = ?
        AND c.Branch_idBranch = ?
    ) AS user_customers
  `;
  const rows = await queryAsync(sql, [
    userId, userId, userId, userId, userId, branchId,
    userId, userId, userId, userId, userId, branchId,
    userId, userId, branchId,
    userId, branchId,
    userId, branchId
  ]);
  return rows.map(r => Number(r.Customer_idCustomer));
};

module.exports = {
  createRoute,
  getRoutesByBranch,
  getRouteById,
  updateRoute,
  deleteRoute,
  assignCustomersToRoute,
  batchAssignCustomersToRoute,
  unassignCustomerFromRoute,
  getCustomersForRouteAssignment,
  getBranchUsersForRoutes,
  createDailyRouteAssignment,
  getDailyRouteAssignments,
  getTodayUserRoute,
  updateDailyCustomerVisit,
  updateDailyRouteStatus,
  getAssignedCustomerIdsForUserToday,
  getAllCustomerIdsForUser,
};
