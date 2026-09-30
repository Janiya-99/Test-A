const express = require("express");
const router = express.Router();

const {
  createZone,
  getZone,
  updateZone,
  deleteZone,
} = require("../controllers/zoneController");

router.post("/", createZone);
router.get("/:Branch_idBranch", getZone);
router.put("/:idZone", updateZone);
router.delete("/:idZone", deleteZone);

module.exports = router;
