const express = require("express");
const {
  getAllDeleteProjects,
  restoreProject,
  getInactiveSubtasksByTask,
  restoreSubtask,
  getInactiveTasksByProject,
  restoreTask,
} = require("../controllers/restoreControllers");


const router = express.Router();

router.get("/restore/:branchId", getAllDeleteProjects);
router.put("/restore/:id", restoreProject);
router.get("/restore/subtasks/:taskId/inactive", getInactiveSubtasksByTask);
router.put("/restore/subtasks/:id/restore", restoreSubtask);
router.get("/projects/:projectId/tasks/inactive", getInactiveTasksByProject);
router.put("/tasks/:id/restore", restoreTask);


module.exports = router;
