const express = require("express");
const router = express.Router();
const { getUserPrivileges } = require("../controllers/privilageController");



router.get('/user-privileges/:userId',getUserPrivileges);



module.exports = router;