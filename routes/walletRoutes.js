const express = require("express");
const router = express.Router();

const upload = require("./../utils/multerConfig");

const {
  createCategory,
  createWallet,
  getCategory,
  getWallet,
  updateCategory,
  updateWallet,
  walletDelete,
  getEarning,
  getExpenses,
  createSubCategory,
  getSubCategory,
  updateSubCategoryById,
  deleteSubCategoryById
} = require("../controllers/walletController");

router.post("/", upload.single("Wallet_File"), createWallet);
router.get("/:Branch_idBranch", getWallet);
router.put("/:idWallet", upload.single("Wallet_File"),  updateWallet);
router.put("/delete/:idWallet", walletDelete);
router.get("/earning/:fromDate/:toDate/:Branch_idBranch", getEarning);
router.get("/expenses/:fromDate/:toDate/:Branch_idBranch", getExpenses);

router.post("/category", createCategory);
router.get("/category/:Branch_idBranch", getCategory);
router.put("/category/:idWallet_Category", updateCategory);

router.post("/sub-category", createSubCategory);
router.get("/sub-category/:Branch_idBranch", getSubCategory);
router.put("/sub-category/:idWallet_SubCategory", updateSubCategoryById);
router.delete("/sub-category/:idWallet_SubCategory", deleteSubCategoryById);

module.exports = router;
