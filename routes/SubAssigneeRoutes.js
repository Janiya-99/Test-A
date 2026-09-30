const express = require('express');
const { subGetAllAssignee, removeAssignee, assignSubAssignee, getSubTaskDescription } = require('../controllers/SubAssigneeControllers');


const router = express.Router();

// router.post('/', subAssignMember);
router.get('/:subtaskId', subGetAllAssignee);
router.delete('/', removeAssignee);
router.post('/', assignSubAssignee);
router.get('/:id', getSubTaskDescription);


module.exports = router;