const express = require("express");
const router = express.Router();
const approvalMiddleware = require("../middlewares/approvalMiddleware");
const {
  createCustomer,
  getCustomer,
  getActiveCustomer,
  getCustomerById,
  updateCustomerById,
  Customerdelete,
  updateCustomerStatus,
  getCustomersByBranch,
  deleteCustomer,
  importExcelCustomers,
  getDistinctBranchCompanies,
} = require("../controllers/customerController");

const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "documents", maxCount: 10 },
    { name: "galleryImages", maxCount: 6 },
  ]),
  createCustomer,
);
router.get("/active/:Branch_idBranch", getActiveCustomer);
router.get("/single/:idCustomer", getCustomerById);
router.put("/delete/:idCustomer", approvalMiddleware.preventModificationIfPending("customer", "req.params.idCustomer"), Customerdelete);
router.post("/status/:idCustomer", updateCustomerStatus);
router.put("/:idCustomer", approvalMiddleware.preventModificationIfPending("customer", "req.params.idCustomer"), updateCustomerById);
router.delete("/:id", approvalMiddleware.preventModificationIfPending("customer", "req.params.id"), deleteCustomer);
router.post("/import-excel", importExcelCustomers);
router.get("/companies/:Branch_idBranch", getDistinctBranchCompanies);
router.get("/:Branch_idBranch", getCustomer);

module.exports = router;
