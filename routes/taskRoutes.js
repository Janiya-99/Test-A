const express = require("express");
const router = express.Router();
const taskController = require("../controllers/taskController");
const multer = require("multer");
const { getTaskDetails } = require("../controllers/taskController");

const upload = multer({ dest: "uploads/" });

// Route to fetch tasks by project ID
router.get("/projects/:projectId/tasks", taskController.getTasksByProject);

// Route to add a new task
router.post("/tasks/order", taskController.updateTaskOrder);


router.post("/tasks", taskController.addTask);

router.put("/tasks/:taskId", taskController.updateTaskStatus);

router.delete("/tasks/:taskId", taskController.deleteTask);

router.put("/tasks/:taskId/tags", taskController.updateTaskTags);

router.put("/tasks/:taskId/assignees", taskController.updateTaskAssignees);

router.put("/tasks/:taskId/description", taskController.updateTaskDescription);

router.put('/tasks/:taskId/title', taskController.updateTaskTitle);

router.post("/subtask", taskController.addSubTask);

router.get("/subtasks/:parentTaskId", taskController.getSubTasksByParentTaskId);

router.post("/comments",taskController.addComments);

router.get("/comments/:taskId", taskController.getComments);

router.put('/subtasks/:subtaskId/assignees', taskController.updateSubtaskAssignees);

router.put('/subtasks/:subtaskId/tags', taskController.updateSubtaskTags);

router.put('/subtasks/:subtaskId/description', taskController.updateSubtaskDescription);

router.put('/subtasks/:subtaskId/status', taskController.updateSubtaskStatus);

router.put('/subtasks/:subtaskId/title', taskController.updateSubtaskTitle);

router.post('/subcomments', taskController.addSubComment); 

router.get('/subcomments/:subtaskId', taskController.getSubCommentsBySubtaskId);

router.post("/:taskId/mainattachments", upload.single("file"), taskController.addAttachment);

router.delete("/attachments/:attachmentId", taskController.deleteAttachment);

router.get("/:taskId/mainattachments", taskController.getAttachments);

router.get("/:taskId/history", taskController.getTaskHistory);

router.post("/subtasks/count", taskController.getSubtaskCounts);

router.put("/:subtaskId/status", taskController.updateSubTaskStatus);

router.get("/tasks/:taskId/details", getTaskDetails);

router.get("/tasks/:taskId/status-summary", taskController.getTaskStatusSummary);

router.get("/tasks/:taskId/subtasks", taskController.getSubtasksWithAssignees);

router.post("/tasks/:task_id/field-data", taskController.saveFieldData);

router.post("/tasks/:taskId/task-field-data", taskController.postTaskFieldData);

router.get("/tasks/:taskId/task-field-data", taskController.getTaskFieldData);






module.exports = router;