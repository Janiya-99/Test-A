const express = require("express");
const {
  addMember,
  getMembers,
  getMemberById,
  updateMember,
  deleteMember,
  getUserDetails,
} = require("../controllers/memberContollers");

const router = express.Router();


router.post("/", addMember); // Create a new member
router.get("/", getMembers); // Get all active members
router.get("/:id/details", getUserDetails); //  Route to get group memberships of a user
router.get("/:id", getMemberById); // Get a specific active member
router.put("/:id", updateMember); // Update a member
router.patch("/:id/soft-delete", deleteMember); // Soft delete a member (update active = 0)

module.exports = router;
