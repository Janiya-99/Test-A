const express = require("express");
const router = express.Router();
const subtaskController = require("../controllers/subtaskController");
const multer = require("multer");

const upload = multer({ dest: "uploads/" });


router.post("/:subtaskId/attachments", upload.single("file"), subtaskController.addAttachment);

router.get("/:subtaskId/attachments", subtaskController.getAttachments);

router.get("/:subtaskId/history", subtaskController.getSubtaskHistory);

router.delete("/:attachmentId", subtaskController.deleteAttachment);


module.exports = router;
