const dbService = require("../services/serviceDatesDBService");

const getServiceDates = async (req, res) => {
  try {
    const { fromDate } = req.params;
    const { toDate } = req.params;
    const services = await dbService.fetchServices(fromDate, toDate);

    if (services.length === 0) {
      return res.status(404).json({ message: "Services not found" });
    }

    res.json(services);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching items",
      error: err.message,
    });
  }
};

const updateServiceById = async (req, res) => {
  try {
    const { ID } = req.params;
    const { Comments, Status } = req.body;
    await dbService.updateServiceDate(ID, Status, Comments);

    res.json({ message: "Service updated successfully" });
  } catch (err) {
    console.error("Error updating Service:", err);
    res
      .status(500)
      .json({ message: "Error updating Service", error: err.message });
  }
};

module.exports = {
  getServiceDates,
  updateServiceById,
};
