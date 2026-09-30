const express = require("express");
const router = express.Router();
const sparePartRequestController = require("../controllers/sparePartRequestController");
const { verifyToken } = require("../middlewares/authMiddleware");

// All routes are protected by JWT verification
router.use(verifyToken);

// Create request
router.post("/", sparePartRequestController.createRequest);

// List requests (with query parameter filters like branchId, serviceJobId, status)
router.get("/", sparePartRequestController.getRequests);

// Supervisor approval
router.put("/:id/approve-supervisor", sparePartRequestController.approveSupervisor);

// Storekeeper approval & MIN issuing
router.put("/:id/approve-store", sparePartRequestController.approveStore);

// Request rejection (storekeeper or supervisor)
router.put("/:id/reject", sparePartRequestController.rejectRequest);

// Return unused items back to stock
router.post("/:id/return", sparePartRequestController.returnUnusedItem);

module.exports = router;
