const express = require('express');
const {
  createProject,
  deleteProject,
  getAllProjects,
  updateProject,
  getProjectSummary,
  addMemberToProject,
  getMembersInProject,
  deleteMemberFromProject,
  linkCustomerToProject,
  getProjectWithDetails,
} = require('../controllers/projectController');

const router = express.Router();
router.get("/:branchId", getAllProjects);
router.post('/', createProject);
router.delete('/:id', deleteProject);
router.put('/:id', updateProject);
router.put('/:id/customer', linkCustomerToProject);
router.get("/:id/details", getProjectWithDetails);
router.get("/:projectId/summary", getProjectSummary);
router.post('/add-member-to-project', addMemberToProject);
router.get("/project-membership/:project_id", getMembersInProject);
router.delete("/delete/:id", deleteMemberFromProject);

module.exports = router;