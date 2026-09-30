const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const dbService = require("../services/chatDBService");

const {
  initChatData,
  getMessages,
  saveMessage,
  markMessageAsDelivered,
  markMessageAsSeen,
  createGroup,
  renameGroup,
  addGroupMembers,
  removeGroupMember,
  markAllAsSeen,
} = require("../controllers/chatController");

// Use diskStorage to control destination and filename
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: function (req, file, cb) {
    // Optionally, add a timestamp or unique id to avoid collisions
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, base + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB
});

// Fetch initial user/group data for a branch
router.get("/init-data", initChatData);

// Fetch messages between users or from a group
router.get("/messages", getMessages);

// Send a message
router.post("/send", saveMessage);

// Mark message as delivered
router.post("/mark-delivered", async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId)
      return res.status(400).json({ message: "Message ID required" });

    await markMessageAsDelivered(messageId);
    res.json({ success: true });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to mark as delivered", error: err.message });
  }
});

// Mark message as seen
router.post("/mark-seen", async (req, res) => {
  try {
    const { messageId, userId } = req.body;
    if (!messageId || !userId)
      return res
        .status(400)
        .json({ message: "Message ID and User ID required" });

    await markMessageAsSeen(messageId, userId);
    res.json({ success: true });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to mark as seen", error: err.message });
  }
});

// Mark all messages as seen
router.post("/mark-all-seen", markAllAsSeen);

// Create a new group
router.post("/groups", createGroup);

// Rename a group
router.put("/groups/:groupId/rename", renameGroup);

// Add members to group
router.post("/groups/:groupId/members", addGroupMembers);

// Remove member from group
router.delete("/groups/:groupId/members/:userId", removeGroupMember);

// Upload a file
router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  // Return the relative URL for the frontend to access
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, originalname: req.file.originalname });
});

// Get unread message counts for a user in a branch
router.get("/unread-counts", async (req, res) => {
  const { userId, branchId } = req.query;
  // You need to implement getUnreadCounts in your chatDBService
  const counts = await dbService.getUnreadCounts(userId, branchId);
  res.json(counts);
});

module.exports = router;
