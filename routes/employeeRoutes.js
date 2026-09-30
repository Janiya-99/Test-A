const express = require("express");
const router = express.Router();
const {
  createEmployee,
  getEmployees,
  updateEmployeeById,
  updateEmployeeStatus,
} = require("../controllers/employeeController");

router.get("/:Branch_idBranch", getEmployees).post("/", createEmployee);
router.put("/:idEmployee", updateEmployeeById);
router.post("/status/:idEmployee", updateEmployeeStatus);

// Delete a customer
// router.delete("/:idCustomer", deleteCustomer);

module.exports = router;
