const dbService = require("../services/employeeDBService");
const userLogDbService = require("../services/userLogDBService");
const { currentDate } = require("../utils/currentData");

const createEmployee = async (req, res) => {
  try {
    const {
      Branch_idBranch,
      Employee_Name,
      Employee_NIC,
      Employee_Number,
      ETF_No,
      Contact_No,
      Type,
    } = req.body;
    await dbService.insertEmployee(
      Employee_Name,
      Employee_NIC,
      Employee_Number,
      ETF_No,
      Contact_No,
      Branch_idBranch,
      Type || "salesman"
    );

    res.json({
      message: "Employee added successfully",
    });
  } catch (err) {
    console.error("Error creating employee:", err);
    res
      .status(500)
      .json({ message: "Error creating employee", error: err.message });
  }
};

const updateEmployeeById = async (req, res) => {
  try {
    const { idEmployee } = req.params;
    const { Employee_Name, Employee_NIC, Employee_Number, ETF_No, Contact_No, Type } =
      req.body;
    await dbService.updateEmployee(
      idEmployee,
      Employee_Name,
      Employee_NIC,
      Employee_Number,
      ETF_No,
      Contact_No,
      Type || "salesman"
    );
    res.json({ message: "Customer updated successfully" });
  } catch (err) {
    console.error("Error updating customer:", err);
    res
      .status(500)
      .json({ message: "Error updating customer", error: err.message });
  }
};

const getEmployees = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;
    const { type } = req.query;

    const employees = await dbService.fetchEmployees(Branch_idBranch, type);
    res.json(employees);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res
      .status(500)
      .json({ message: "Error fetching customer", error: err.message });
  }
};

const updateEmployeeStatus = async (req, res) => {
  try {
    const { idEmployee } = req.params;
    const { Branch_idBranch, User_idUser } = req.body;

    const saleman_invoice = await dbService.checkInvoiceAvailability(
      Branch_idBranch,
      idEmployee
    );
    console.log(saleman_invoice)
    if (saleman_invoice.length > 0) {
      return res.status(201).json({ message: "Saleman has invoices" });
    }

    await dbService.updateStatus(idEmployee);

    await userLogDbService.insertLog(
      User_idUser,
      currentDate(),
      "Employee",
      idEmployee,
      "change status",
      Branch_idBranch
    );
    res.json({ message: "Employee status updated successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating Employee status", error: err.message });
  }
};

module.exports = {
  createEmployee,
  getEmployees,
  updateEmployeeById,
  updateEmployeeStatus,
};
