// ✅ Asipiya_Invoice - Backend/controllers/chatController.js
const db = require("../db/db");
const dbService = require("../services/chatDBService");

const initChatData = async (req, res) => {
  try {
    const { branchId, userId } = req.query;
    const users = await dbService.getUsersByBranch(branchId, userId);
    const groups = await dbService.getGroupsByBranch(branchId);
    const filteredUsers = users.filter((u) => u.id !== parseInt(userId));

    res.json({ users: filteredUsers, groups });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching chat data", error: err.message });
  }
};

const getMessages = async (req, res) => {
  try {
    const { type, id, userId } = req.query;
    if (!type || !id || !userId)
      return res.status(400).json({ message: "Missing parameters" });

    let messages = [];
    if (type === "user") {
      messages = await dbService.getDirectMessages(userId, id);
    } else if (type === "group") {
      messages = await dbService.getGroupMessages(id);
    } else {
      return res.status(400).json({ message: "Invalid chat type" });
    }

    res.json(
      messages.map((msg) => ({
        id: msg.id,
        sender_id: msg.sender_id,
        receiver_id: msg.receiver_id,
        group_id: msg.group_id,
        text: msg.message,
        file: msg.file, // <-- Add this line
        created_at: msg.created_at,
        status: msg.status,
        seen_by: msg.seen_by,
        user: {
          name: msg.name,
          Pro_Pic: msg.Pro_Pic || null,
        },
      }))
    );
  } catch (error) {
    console.error("getMessages error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const saveMessage = async (req, res) => {
  try {
    const { sender_id, receiver_id, group_id, text, file } = req.body;
    const saved = await dbService.saveMessage({
      sender_id,
      receiver_id,
      group_id,
      text,
      file, // Pass file URL
    });
    res.json({ message: "Message sent successfully", saved });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error sending message", error: err.message });
  }
};

const markMessageAsDelivered = (msgId) => {
  return new Promise((resolve, reject) => {
    db.query(
      "UPDATE chat_messages SET status = 'delivered' WHERE id = ?",
      [msgId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
};

const markMessageAsSeen = (msgId, userId) => {
  return new Promise((resolve, reject) => {
    db.query(
      "UPDATE chat_messages SET status = 'seen', seen_by = ? WHERE id = ?",
      [String(userId), msgId],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
};

const markAllAsSeen = async (req, res) => {
  const { type, chatId, userId } = req.body;
  if (!type || !chatId || !userId)
    return res.status(400).json({ message: "Missing data" });

  let query = "";
  let params = [];
  if (type === "user") {
    query = `
      UPDATE chat_messages
      SET seen_by = IF(
        seen_by IS NULL OR seen_by = '',
        ?,
        CONCAT(seen_by, ',', ?)
      )
      WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        AND (seen_by IS NULL OR NOT FIND_IN_SET(?, seen_by))
    `;
    params = [userId, userId, chatId, userId, userId, chatId, userId];
  } else if (type === "group") {
    query = `
      UPDATE chat_messages
      SET seen_by = IF(
        seen_by IS NULL OR seen_by = '',
        ?,
        CONCAT(seen_by, ',', ?)
      )
      WHERE group_id = ? AND (seen_by IS NULL OR NOT FIND_IN_SET(?, seen_by))
    `;
    params = [userId, userId, chatId, userId];
  } else {
    return res.status(400).json({ message: "Invalid chat type" });
  }

  db.query(query, params, (err) => {
    if (err) return res.status(500).json({ message: "DB error", err });
    res.json({ success: true });
  });
};

// Create group
const createGroup = async (req, res) => {
  const { name, branch_id, memberIds } = req.body;
  const creatorId = req.user?.id || req.body.creatorId; // Pass creatorId if needed
  if (!name || !branch_id || !Array.isArray(memberIds))
    return res.status(400).json({ message: "Missing data" });

  // Always add creator to members
  const allMembers = Array.from(
    new Set([...(memberIds || []), creatorId])
  ).filter(Boolean);

  db.query(
    "INSERT INTO chat_groups (name, branch_id) VALUES (?, ?)",
    [name, branch_id],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error", err });
      const groupId = result.insertId;
      if (allMembers.length === 0) return res.json({ groupId });
      const values = allMembers.map((uid) => [groupId, uid]);
      db.query(
        "INSERT INTO group_members (group_id, user_id) VALUES ?",
        [values],
        (err2) => {
          if (err2) return res.status(500).json({ message: "DB error", err2 });
          res.json({ groupId });
        }
      );
    }
  );
};

// Rename group
const renameGroup = (req, res) => {
  const { groupId } = req.params;
  const { name } = req.body;
  db.query(
    "UPDATE chat_groups SET name = ? WHERE id = ?",
    [name, groupId],
    (err) => {
      if (err) return res.status(500).json({ message: "DB error", err });
      res.json({ success: true });
    }
  );
};

// Add members
const addGroupMembers = (req, res) => {
  const { groupId } = req.params;
  const { memberIds } = req.body;
  if (!Array.isArray(memberIds) || memberIds.length === 0)
    return res.json({ success: true });
  const values = memberIds.map((uid) => [groupId, uid]);
  db.query(
    "INSERT IGNORE INTO group_members (group_id, user_id) VALUES ?",
    [values],
    (err) => {
      if (err) return res.status(500).json({ message: "DB error", err });
      res.json({ success: true });
    }
  );
};

// Remove member
const removeGroupMember = (req, res) => {
  const { groupId, userId } = req.params;
  db.query(
    "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
    [groupId, userId],
    (err) => {
      if (err) return res.status(500).json({ message: "DB error", err });
      res.json({ success: true });
    }
  );
};

module.exports = {
  initChatData,
  getMessages,
  saveMessage,
  markMessageAsDelivered,
  markMessageAsSeen,
  markAllAsSeen,
  createGroup,
  renameGroup,
  addGroupMembers,
  removeGroupMember,
};
