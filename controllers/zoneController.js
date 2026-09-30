const dbService = require("../services/zoneDBService");

const createZone = async (req, res) => {
  try {
    const { Description, Branch_idBranch } = req.body;
    await dbService.insertZone(Description, Branch_idBranch);
    res.json({
      message: "Zone added successfully",
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating zone", error: err.message });
  }
};

const getZone = async (req, res) => {
  try {
    const { Branch_idBranch } = req.params;

    const zone = await dbService.fetchZone(Branch_idBranch);
    res.json(zone);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching zone", error: err.message });
  }
};

const updateZone = async (req, res) => {
  try {
    const { idZone } = req.params;
    const { Description } = req.body;
    await dbService.updateZone(Description, idZone);
    res.json({ message: "zone updated successfully" });
  } catch (err) {
    console.error("Error updating zone:", err);
    res
      .status(500)
      .json({ message: "Error updating zone", error: err.message });
  }
};

const deleteZone = async (req, res) => {
  try {
    const idZone = req.params;

    await dbService.deleteZone(idZone);
    res.json({ message: "Zone deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error deleting zone", error: err.message });
  }
};

module.exports = {
  createZone,
  getZone,
  updateZone,
  deleteZone,
};
