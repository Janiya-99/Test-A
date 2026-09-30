const dbService = require("../services/quantityTypeDBService");

const getQuantityTypes = async (req, res) => {
  try {
    const types = await dbService.fetchQuantityType();
    res.json(types);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching quantity types",
      error: err.message,
    });
  }
};

module.exports = {
  getQuantityTypes,
};
