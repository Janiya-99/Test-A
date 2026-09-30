const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  // Check for Bearer token in Authorization header
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      Error: "Unauthorized access - No token provided",
    });
  }

  // Extract token from "Bearer <token>"
  const token = authHeader.substring(7);

  if (!token) {
    return res.status(401).json({
      success: false,
      Error: "Unauthorized access - Invalid token format",
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "HTGWEWDWFSDCFSCW",
    (err, decoded) => {
      if (err) {
        return res.status(401).json({
          success: false,
          Error: "Unauthorized access - Failed to authenticate token",
        });
      }
      req.userId = decoded.userId || decoded.id;
      if (decoded.role !== undefined || decoded.Role !== undefined) {
        req.userRole = decoded.role !== undefined ? decoded.role : decoded.Role;
      }
      if (!req.userId && req.headers["x-user-id"]) {
        req.userId = req.headers["x-user-id"];
      }
      if (!req.userRole && req.headers["x-user-role"]) {
        req.userRole = req.headers["x-user-role"];
      }
      next();
    },
  );
};

module.exports = { verifyToken };
