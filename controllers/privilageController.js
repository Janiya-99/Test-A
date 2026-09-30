const db = require("../db/db");

const getUserPrivileges = async (req, res) => {
  const { userId } = req.params;

  try {
    const [results] = await db.promise().query(
      `SELECT up.*, u.Role 
       FROM user_privilages up 
       JOIN user u ON u.idUser = up.User_idUser
       WHERE up.User_idUser = ?`,
      [userId]
    );

    if (results.length === 0) {
      return res.status(404).json({ message: "Privileges not found" });
    }

    res.json(results[0]);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching privileges",
      error: error.message,
    });
  }
};



module.exports = { getUserPrivileges };
