const db = require("../db/db");

// Get users from the same branch (excluding the current user)
const getUsersByBranch = (branchId, userId) => {
  const query = `
    SELECT idEmployee AS id, Employee_Name AS name, Contact_No AS phone
    FROM employee 
    WHERE Branch_idBranch = ? AND Status = 1
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branchId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Get chat groups for the branch
const getGroupsByBranch = (branchId) => {
  const query = `
    SELECT g.id, g.name, 
      GROUP_CONCAT(m.user_id) AS members
    FROM chat_groups g
    LEFT JOIN group_members m ON g.id = m.group_id
    WHERE g.branch_id = ?
    GROUP BY g.id
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [branchId], (err, results) => {
      if (err) return reject(err);
      // Parse members as array of numbers
      results.forEach((g) => {
        g.members = g.members ? g.members.split(",").map(Number) : [];
      });
      resolve(results);
    });
  });
};

// Fetch direct messages between two users
const getDirectMessages = (userId, receiverId) => {
  const query = `
    SELECT cm.*, e.Employee_Name AS name
    FROM chat_messages cm
    LEFT JOIN employee e ON e.idEmployee = cm.sender_id
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY cm.created_at ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [userId, receiverId, receiverId, userId],
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      },
    );
  });
};

// Fetch group messages
const getGroupMessages = (groupId) => {
  const query = `
    SELECT cm.*, e.Employee_Name AS name
    FROM chat_messages cm
    LEFT JOIN employee e ON e.idEmployee = cm.sender_id
    WHERE group_id = ?
    ORDER BY cm.created_at ASC
  `;
  return new Promise((resolve, reject) => {
    db.query(query, [groupId], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Save new message
const saveMessage = ({ sender_id, receiver_id, group_id, text, file }) => {
  const query = `
    INSERT INTO chat_messages (sender_id, receiver_id, group_id, message, file)
    VALUES (?, ?, ?, ?, ?)
  `;
  return new Promise((resolve, reject) => {
    db.query(
      query,
      [sender_id, receiver_id, group_id, text, file],
      (err, result) => {
        if (err) return reject(err);
        resolve({ id: result.insertId });
      },
    );
  });
};

const getUnreadCounts = (userId, branchId) => {
  return new Promise((resolve, reject) => {
    // For direct chats
    const userChatsQuery = `
      SELECT sender_id, COUNT(*) as count
      FROM chat_messages
      WHERE receiver_id = ? AND (seen_by IS NULL OR NOT FIND_IN_SET(?, seen_by))
      GROUP BY sender_id
    `;
    // For groups: only groups in this branch where user is a member
    const groupChatsQuery = `
      SELECT cm.group_id, COUNT(*) as count
      FROM chat_messages cm
      INNER JOIN chat_groups g ON cm.group_id = g.id
      INNER JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ? AND g.branch_id = ? AND cm.sender_id != ? AND (cm.seen_by IS NULL OR NOT FIND_IN_SET(?, cm.seen_by))
      GROUP BY cm.group_id
    `;
    db.query(userChatsQuery, [userId, userId], (err, userRows) => {
      if (err) return reject(err);
      db.query(
        groupChatsQuery,
        [userId, branchId, userId, userId],
        (err2, groupRows) => {
          if (err2) return reject(err2);
          const result = {};
          userRows.forEach((r) => {
            result[`user-${r.sender_id}`] = r.count;
          });
          groupRows.forEach((r) => {
            result[`group-${r.group_id}`] = r.count;
          });
          resolve(result);
        },
      );
    });
  });
};

module.exports = {
  getUsersByBranch,
  getGroupsByBranch,
  getDirectMessages,
  getGroupMessages,
  saveMessage,
  getUnreadCounts,
};
