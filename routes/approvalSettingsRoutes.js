const express = require('express');
const router = express.Router();
const approvalSettingsController = require('../controllers/approvalSettingsController');

router.get('/', approvalSettingsController.getSettings);
router.post('/toggle', approvalSettingsController.updateToggle);
router.get('/roles', approvalSettingsController.getCompanyRoles);
router.get('/roles/:company_id', approvalSettingsController.getCompanyRoles);
router.get('/modules', approvalSettingsController.getModules);
router.get('/map/:branch_id/:action_type', approvalSettingsController.getProcessMap);
router.post('/map', approvalSettingsController.saveProcessMap);
router.put('/map/:id/status', approvalSettingsController.toggleMapStatus);

module.exports = router;
