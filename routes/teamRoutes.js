const express = require("express");
const {
  addTeam,
  deleteTeam,
  dreactivateTeam,
  getAllDreactivatTeams,
  reactivateTeam,
  updateTeam,
  addUserToTeam,
  getActiveUsers,
  getAllTeamsByBranch,

 
} = require("../controllers/teamControllers");

const router = express.Router();

router.post("/", addTeam);
router.get("/:branchId",getAllTeamsByBranch );
router.delete("/:id", deleteTeam);
router.put("/:teamId",dreactivateTeam);
router.get("/dre/:branchId", getAllDreactivatTeams);
router.put("/:teamId/re",reactivateTeam);
router.put("/",updateTeam);
router.post("/:teamId/addMember", addUserToTeam);
router.get('/users/:branchId', getActiveUsers);

module.exports = router;
