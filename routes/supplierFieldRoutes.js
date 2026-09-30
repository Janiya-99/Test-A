const express = require("express");
const router = express.Router();
const controller = require("../controllers/suplierFieldController"); 

router.post("/", controller.createCustomerField);
router.get("/:branchId", controller.getCustomerFieldsByBranch);
router.put('/:id', controller.updateSupplierField);
router.delete('/:id', controller.deleteSupplierField);
module.exports = router;
