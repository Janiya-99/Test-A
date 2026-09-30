const express = require("express");
const router = express.Router();
const {
  createDamageNote,
  getDamageNotes,
  checkReturnSerial,
  getSingleDamageNote,
} = require("../controllers/damageNoteController");

router.get("/:Branch_idBranch", getDamageNotes);
router.post("/", createDamageNote);
router.post("/check-serials", checkReturnSerial);
router.get("/single/:id", getSingleDamageNote);



module.exports = router;
