const express = require("express");
const router = express.Router();
const controller = require("../controllers/productFieldController"); 

router.post("/", controller.createCustomerField);
router.get("/:branchId", controller.getCustomerFieldsByBranch);
router.put('/:id', controller.updateProductField);
router.delete('/:id', controller.deleteProductField);
module.exports = router;
