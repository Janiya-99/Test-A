const express = require("express");
const router = express.Router();
const controller = require("../controllers/staffFieldController"); 

router.post("/", controller.createCustomerField);
router.get("/:branchId", controller.getCustomerFieldsByBranch);
router.put('/:id', controller.updateStaffField);
router.delete('/:id', controller.deleteStaffField);
module.exports = router;
