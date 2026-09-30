const express = require("express");
const router = express.Router();
const controller = require("../controllers/customerFieldController");

router.post("/", controller.createCustomerField);
router.get("/:branchId", controller.getCustomerFieldsByBranch);

router.put('/:id', controller.updateCustomerField);
router.delete('/:id', controller.deleteCustomerField);


module.exports = router;