const express = require("express");
const router = express.Router();
const approvalMiddleware = require("../middlewares/approvalMiddleware");
const upload = require("../utils/multerConfig");
const {
  createCategory,
  createExcelProduct,
  createProduct,
  getCategory,
  getItems,
  getServices,
  updateCategoryById,
  updateProduct,
  getProducts,
  deleteCategoryById,
  updateProductStatus,
  updateProductQty,
  adjustProductQty,
  createSubCategory,
  getSubCategory,
  updateSubCategoryById,
  addBrand,
  getBrandsByBranch,
  updateBrand,
  deleteCategory,
  deleteSubCategory,
  deleteBrand,
  deleteItem,
  deleteProductImage,
  deleteProductDocument,
  getProductHistory,
  getPackagesByBranch,
  getPackageById,
  createPackage,
  updatePackage,
  deletePackage,
  getNextBarcode,
  getItemSuppliers,
} = require("../controllers/productController");
const { deleteBarcode } = require("../services/productDBService");

router.get("/next-barcode/:branchId", getNextBarcode);
router.get("/:idItem/suppliers", getItemSuppliers);

router.post(
  "/",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
    { name: "documents", maxCount: 10 },
  ]),
  createProduct
);

router.post(
  "/excel",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 10 },
    { name: "documents", maxCount: 10 },
  ]),
    createExcelProduct

);


router.get("/items/:Branch_idBranch", getItems);
router.delete("/items/:id", approvalMiddleware.preventModificationIfPending("product", "req.params.id"), deleteItem);
router.delete("/product/category/:id",deleteCategory);
router.get("/services/:Branch_idBranch", getServices);
router.post("/status/:idItem", updateProductStatus);
router.get("/:idItem/history", getProductHistory);
router.get("/:Branch_idBranch", getProducts);

router.put("/:idItem", upload.fields([
  { name: "mainImage", maxCount: 1 },
  { name: "galleryImages", maxCount: 10 },
  { name: "documents", maxCount: 10 },
]), approvalMiddleware.preventModificationIfPending("product", "req.params.idItem"), updateProduct);

router.put("/add-qty/:idItem", approvalMiddleware.preventModificationIfPending("product", "req.params.idItem"), updateProductQty);
router.put("/adjust-qty/:idItem", approvalMiddleware.preventModificationIfPending("product", "req.params.idItem"), adjustProductQty);

router.post("/category", createCategory);
router.delete("/category/:idItem_Category", deleteCategoryById);
router.get("/category/:Branch_idBranch", getCategory);
router.put("/category/:idItem_Category", updateCategoryById);

router.post("/sub-category", createSubCategory);
router.delete('/sub-category/:id', deleteSubCategory);
router.get("/sub-category/:Branch_idBranch", getSubCategory);
router.put("/sub-category/:idItem_SubCategory", updateSubCategoryById);

router.post("/brand", addBrand);
router.delete("/brand/:id", deleteBrand);
router.get('/brand/:branchId', getBrandsByBranch);
router.put('/brand/:id', updateBrand);

router.delete("/image/:id", deleteProductImage);
router.delete("/document/:id", deleteProductDocument);
router.delete('/barcode/:id', deleteBarcode);

// Package Routes
router.get("/packages/branch/:Branch_idBranch", getPackagesByBranch);
router.get("/packages/:idItem", getPackageById);
router.post("/packages", createPackage);
router.put("/packages/:idItem", updatePackage);
router.delete("/packages/:idItem", deletePackage);

module.exports = router;
