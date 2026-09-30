const express = require("express");
const router = express.Router();
const routeController = require("../controllers/routeController");

// Route Master CRUD
router.post("/create", routeController.createRoute);
router.get("/list/:Branch_idBranch", routeController.getRoutes);
router.get("/details/:idRoute", routeController.getRouteById);
router.put("/update/:idRoute", routeController.updateRoute);
router.delete("/delete/:idRoute", routeController.deleteRoute);

// Customer Assignment
router.post("/assign-customers/:idRoute", routeController.assignCustomers);
router.post("/batch-assign-customers/:idRoute", routeController.batchAssignCustomers);
router.delete("/unassign-customer/:idRoute/:idCustomer", routeController.unassignCustomer);
router.get("/customers-for-assignment/:Branch_idBranch", routeController.getCustomersForAssignment);
router.get("/branch-users/:Branch_idBranch", routeController.getBranchUsers);

// Daily Route Management (Morning Dispatch & Field Views)
router.post("/daily-assignment/create", routeController.createDailyAssignment);
router.get("/daily-assignments/:Branch_idBranch", routeController.getDailyAssignments);
router.get("/today-my-route/:Branch_idBranch", routeController.getTodayMyRoute);
router.put("/daily-customer-visit/:idDailyRouteCustomer", routeController.updateCustomerVisit);
router.put("/daily-assignment/status/:idDailyAssignment", routeController.updateDailyAssignmentStatus);

module.exports = router;
