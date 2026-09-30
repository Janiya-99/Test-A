/**
 * Middleware to validate the x-api-key header for app endpoints.
 * The expected key is defined in the .env file as APP_API_KEY.
 */
const verifyAppApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res
      .status(401)
      .json({ message: "Access denied. No API key provided." });
  }

  if (apiKey !== process.env.APP_API_KEY) {
    return res.status(403).json({ message: "Access denied. Invalid API key." });
  }

  next();
};

module.exports = { verifyAppApiKey };
