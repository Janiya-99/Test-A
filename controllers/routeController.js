const routeDBService = require("../services/routeDBService");
const branchDBService = require("../services/branchDBService");

const getTodayDateString = () => {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
};

/**
 * Create a new distribution route
 */
const createRoute = async (req, res) => {
  try {
    const { Route_Code, Route_Name, Branch_idBranch } = req.body;
    if (!Route_Code || !Route_Name || !Branch_idBranch) {
      return res.status(400).json({
        success: false,
        message: "Route Code, Route Name, and Branch ID are required.",
      });
    }

    const routeId = await routeDBService.createRoute(req.body);
    return res.status(201).json({
      success: true,
      message: "Route created successfully",
      routeId,
    });
  } catch (err) {
    console.error("Error creating route:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A route with this Route Code already exists.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to create route",
      error: err.message,
    });
  }
};

/**
 * Get all routes for a branch (scoped to user if restricted/salesperson/driver)
 */
const getRoutes = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { search, status } = req.query;
    const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
    const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];

    let scopedUserId = null;
    if (currentUserId) {
      try {
        const userScope = await branchDBService.getUserDataScope(currentUserId, Branch_idBranch, currentUserRole);
        if (userScope.isRestricted) {
          scopedUserId = currentUserId;
        }
      } catch (scopeErr) {
        console.error("Error checking user scope for routes:", scopeErr);
      }
    }

    const routes = await routeDBService.getRoutesByBranch(Branch_idBranch, { search, status, scopedUserId });
    return res.status(200).json({
      success: true,
      data: routes,
    });
  } catch (err) {
    console.error("Error fetching routes:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch routes",
      error: err.message,
    });
  }
};

/**
 * Get route by ID with assigned customers and users
 */
const getRouteById = async (req, res) => {
  try {
    const { idRoute } = req.params;
    const route = await routeDBService.getRouteById(idRoute);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: "Route not found",
      });
    }
    return res.status(200).json({
      success: true,
      data: route,
    });
  } catch (err) {
    console.error("Error fetching route by ID:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch route",
      error: err.message,
    });
  }
};

/**
 * Update route details
 */
const updateRoute = async (req, res) => {
  try {
    const { idRoute } = req.params;
    await routeDBService.updateRoute(idRoute, req.body);
    return res.status(200).json({
      success: true,
      message: "Route updated successfully",
    });
  } catch (err) {
    console.error("Error updating route:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update route",
      error: err.message,
    });
  }
};

/**
 * Delete (soft delete) a route
 */
const deleteRoute = async (req, res) => {
  try {
    const { idRoute } = req.params;
    await routeDBService.deleteRoute(idRoute);
    return res.status(200).json({
      success: true,
      message: "Route deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting route:", err);
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to delete route",
    });
  }
};

/**
 * Assign customers to a route with stop ordering
 */
const assignCustomers = async (req, res) => {
  try {
    const { idRoute } = req.params;
    const { customers } = req.body; // array of { customerId, stopOrder, estimatedVisitTime }

    if (!Array.isArray(customers)) {
      return res.status(400).json({
        success: false,
        message: "Customers must be an array",
      });
    }

    await routeDBService.assignCustomersToRoute(idRoute, customers);
    return res.status(200).json({
      success: true,
      message: "Customers assigned to route successfully",
    });
  } catch (err) {
    console.error("Error assigning customers to route:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to assign customers to route",
      error: err.message,
    });
  }
};

/**
 * Batch assign multiple customers to a route (Reverse assignment)
 */
const batchAssignCustomers = async (req, res) => {
  try {
    const { idRoute } = req.params;
    const { customerIds } = req.body;

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "customerIds array is required and must not be empty",
      });
    }

    await routeDBService.batchAssignCustomersToRoute(idRoute, customerIds);
    return res.status(200).json({
      success: true,
      message: `${customerIds.length} customer(s) assigned to route successfully`,
    });
  } catch (err) {
    console.error("Error batch assigning customers:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to batch assign customers",
      error: err.message,
    });
  }
};

/**
 * Unassign single customer from route
 */
const unassignCustomer = async (req, res) => {
  try {
    const { idRoute, idCustomer } = req.params;
    await routeDBService.unassignCustomerFromRoute(idRoute, idCustomer);
    return res.status(200).json({
      success: true,
      message: "Customer unassigned from route successfully",
    });
  } catch (err) {
    console.error("Error unassigning customer:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to unassign customer",
      error: err.message,
    });
  }
};

/**
 * Get customers available for assignment modal
 */
const getCustomersForAssignment = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { routeId } = req.query;

    const customers = await routeDBService.getCustomersForRouteAssignment(
      Branch_idBranch,
      routeId ? Number(routeId) : null
    );
    return res.status(200).json({
      success: true,
      data: customers,
    });
  } catch (err) {
    console.error("Error fetching customers for assignment:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers for assignment",
      error: err.message,
    });
  }
};

/**
 * Get users for route assignment (salespersons, drivers)
 */
const getBranchUsers = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const users = await routeDBService.getBranchUsersForRoutes(Branch_idBranch);
    return res.status(200).json({
      success: true,
      data: users,
    });
  } catch (err) {
    console.error("Error fetching users for routes:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users for routes",
      error: err.message,
    });
  }
};

/**
 * Create a Daily Route Assignment (Morning Dispatch)
 */
const createDailyAssignment = async (req, res) => {
  try {
    const {
      Assignment_Date,
      Route_idRoute,
      Salesperson_User_Id,
      Branch_idBranch,
    } = req.body;

    if (!Assignment_Date || !Route_idRoute || !Salesperson_User_Id || !Branch_idBranch) {
      return res.status(400).json({
        success: false,
        message: "Assignment Date, Route, Salesperson, and Branch ID are required",
      });
    }

    const payload = {
      ...req.body,
      Created_By: req.body.Created_By || req.userId || null,
    };

    const assignmentId = await routeDBService.createDailyRouteAssignment(payload);
    return res.status(201).json({
      success: true,
      message: "Daily route dispatched successfully",
      assignmentId,
    });
  } catch (err) {
    console.error("Error creating daily route assignment:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to dispatch daily route",
      error: err.message,
    });
  }
};

/**
 * Get daily route assignments for a branch and date
 */
const getDailyAssignments = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const date = req.query.date || getTodayDateString();
    const currentUserId = req.userId || req.query.user_id || req.headers["x-user-id"];
    const currentUserRole = req.userRole || req.query.role || req.headers["x-user-role"];

    let scopedUserId = null;
    if (currentUserId) {
      try {
        const userScope = await branchDBService.getUserDataScope(currentUserId, Branch_idBranch, currentUserRole);
        if (userScope.isRestricted) {
          scopedUserId = currentUserId;
        }
      } catch (scopeErr) {
        console.error("Error checking user scope for daily assignments:", scopeErr);
      }
    }

    const assignments = await routeDBService.getDailyRouteAssignments(Branch_idBranch, date, { scopedUserId });
    return res.status(200).json({
      success: true,
      date,
      data: assignments,
    });
  } catch (err) {
    console.error("Error fetching daily assignments:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch daily route assignments",
      error: err.message,
    });
  }
};

/**
 * Get Today's Assigned Route for logged in field user (Driver or Salesperson)
 * STRICT ROLE ISOLATION:
 * - Only today's assignment
 * - Only assigned to this user
 * - Hides previous/future days and other reps' routes
 */
const getTodayMyRoute = async (req, res) => {
  try {
    const userId = req.userId || req.query.userId || req.user?.id;
    const branchId = req.params.Branch_idBranch || req.query.branchId;

    if (!userId || !branchId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Branch ID are required",
      });
    }

    const todayDate = req.query.date || getTodayDateString();
    const result = await routeDBService.getTodayUserRoute(userId, branchId, todayDate);

    return res.status(200).json({
      success: true,
      todayDate,
      data: result,
    });
  } catch (err) {
    console.error("Error fetching today's route:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch today's route",
      error: err.message,
    });
  }
};

/**
 * Update daily route customer stop (check-in, checkout, invoice, payment, notes)
 */
const updateCustomerVisit = async (req, res) => {
  try {
    const { idDailyRouteCustomer } = req.params;
    await routeDBService.updateDailyCustomerVisit(idDailyRouteCustomer, req.body);
    return res.status(200).json({
      success: true,
      message: "Customer visit status updated successfully",
    });
  } catch (err) {
    console.error("Error updating customer visit:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update customer visit",
      error: err.message,
    });
  }
};

/**
 * Update daily assignment status (Start Route, Complete Route, Notes)
 */
const updateDailyAssignmentStatus = async (req, res) => {
  try {
    const { idDailyAssignment } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    await routeDBService.updateDailyRouteStatus(idDailyAssignment, status, notes);
    return res.status(200).json({
      success: true,
      message: `Daily route status updated to ${status}`,
    });
  } catch (err) {
    console.error("Error updating daily route status:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update daily route status",
      error: err.message,
    });
  }
};

module.exports = {
  createRoute,
  getRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
  assignCustomers,
  batchAssignCustomers,
  unassignCustomer,
  getCustomersForAssignment,
  getBranchUsers,
  createDailyAssignment,
  getDailyAssignments,
  getTodayMyRoute,
  updateCustomerVisit,
  updateDailyAssignmentStatus,
};
