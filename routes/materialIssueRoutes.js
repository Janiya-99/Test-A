const express = require("express");
const router = express.Router();
const {
  createMaterialIssueNote,
  getMaterialIssueNotes,
  getMaterialIssueNoteById,
  updateMaterialIssueNote,
  deleteMaterialIssueNote,
  getProjectMaterialSummary,
  getUnbilledProjectMaterials,
  getUnbilledItemsByNote,
  generateInvoiceFromIssues,
  getMaterialIssueAutoComplete,
  debugNoteItems,
} = require("../controllers/materialIssueController");

// Item autocomplete (must be before /:id to avoid route conflict)
router.get("/autocomplete", getMaterialIssueAutoComplete);

// Project-specific endpoints
router.get("/project/:projectId/summary", getProjectMaterialSummary);
router.get("/project/:projectId/unbilled", getUnbilledProjectMaterials);

// Unbilled items for a specific issue note
router.get("/note/:noteId/unbilled", getUnbilledItemsByNote);

// Debug: raw DB state (remove after diagnosis)
router.get("/debug/:noteId", debugNoteItems);

// Invoice generation from issues
router.post("/generate-invoice", generateInvoiceFromIssues);

// CRUD
router.post("/", createMaterialIssueNote);
router.get("/", getMaterialIssueNotes);
router.get("/:id", getMaterialIssueNoteById);
router.put("/:id", updateMaterialIssueNote);
router.delete("/:id", deleteMaterialIssueNote);

module.exports = router;
