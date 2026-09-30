// routes/warehouseRoutes.js
const express = require("express");
const router = express.Router();
const {
  createWarehouse,
  listWarehousesByBranch,
  updateWarehouse,
  deleteWarehouse,
  getAllWarehouseLogs,
  getWarehouseLogs,
  getZonesByWarehouse,
  getWarehousesByBranch,
  getRacksByZone,
  getCellsByRack,
  getWarehouseItems,
  transferStock,
  getUnassignedStock,
  assignStock,
  getCompanyStaff,
  adjustWarehouseStock,
} = require("../controllers/warehouseController");

// POST /api/warehouses
router.post("/", createWarehouse);
router.get("/", listWarehousesByBranch);
router.get("/company-staff/:companyId", getCompanyStaff);
router.get("/unassigned/stock", getUnassignedStock);
router.put("/:id", updateWarehouse);
router.delete("/:id", deleteWarehouse);
router.get("/logs", getAllWarehouseLogs); // /api/warehouses/logs?branchId=
router.get("/:id/logs", getWarehouseLogs);
router.get("/warehouses", getWarehousesByBranch);
router.post("/:id/assign-stock", assignStock);
router.post("/:id/adjust-stock", adjustWarehouseStock);

// Zones in a warehouse
router.get("/warehouses/:warehouseId/zones", getZonesByWarehouse);

// Racks in a zone
router.get("/zones/:zoneId/racks", getRacksByZone);

// Cells in a rack
router.get("/racks/:rackId/cells", getCellsByRack);
router.get("/:warehouseId/items", getWarehouseItems);

module.exports = router;
