const express = require('express');
const { addTag, getTag, deleteTag } = require('../controllers/tagControllers');

const router = express.Router();

router.post('/', addTag);
router.get('/:subtask_id', getTag)
router.delete('/:id', deleteTag)


module.exports = router;