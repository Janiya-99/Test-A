const express = require("express");
const router = express.Router();
const BoardController = require("../controllers/BoardController");

// Create a new board under a project
router.post("/boards", BoardController.createBoard);

// Get all boards for a specific project
router.get("/projects/:projectId/boards", BoardController.getBoardsForProject);

// Delete a board by ID
router.delete("/boards/:boardId", BoardController.deleteBoard);

// Update the title of a board
router.put("/boards/:boardId", BoardController.updateBoardTitle);

// Save or update board order
router.put('/:projectId/board-order', BoardController.saveBoardOrder);

// Get board order for a project
router.get('/:projectId/board-order', BoardController.getBoardOrder);


module.exports = router;
