const express = require('express');
const { assignMember, deleteTask, getAllAssignee, deleteAssigneeById, addStatus} = require('../controllers/asigneeControllers');

const router = express.Router();

router.post('/', assignMember);
router.delete('/:id', deleteTask);
router.get('/:taskId', getAllAssignee);
router.delete('/', deleteAssigneeById);
router.put('/:id', addStatus);

module.exports = router;