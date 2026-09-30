const express = require("express");
const router = express.Router();
const documentController = require("../controllers/documentController");
const upload = require("../utils/multerConfig");

// Dashboard Stats
router.get("/stats", documentController.getDashboardStats);

// Folder Management
router.get("/folders", documentController.getFolders);
router.post("/folders", documentController.createFolder);
router.delete("/folders/:id", documentController.deleteFolder);

// Document Management
router.get("/files", documentController.getDocuments);
router.post(
  "/upload",
  upload.single("file"),
  documentController.uploadDocument,
);
router.delete("/files/:id", documentController.deleteDocument);

module.exports = router;
