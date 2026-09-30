
const express = require('express');
const { getLatestTaskLog } = require('../controllers/latestUpdateController');


const router = express.Router();
router.get('/:taskId',getLatestTaskLog);


module.exports = router;