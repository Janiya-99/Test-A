const advanceReportDBService = require("../services/advanceReportDBService");

const getColumns = async (req, res) => {
  try {
    const { sources } = req.query;
    if (!sources) {
      return res.status(400).json({ message: "Sources are required" });
    }
    const sourceArray = Array.isArray(sources) ? sources : [sources];
    const columns = advanceReportDBService.getAvailableColumns(sourceArray);
    res.json(columns);
  } catch (error) {
    console.error("Error fetching columns:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const generateAdvancedReport = async (req, res) => {
  try {
    const {
      sources,
      groupingColumns,
      displayColumns,
      filters,
      branchId,
      showOutstandingOnly,
      includeInvoices,
      includeReturns,
      includeOverpayments,
      startDate,
      endDate,
    } = req.body;
    
    console.log("ADVANCE REPORT REQ USER:", JSON.stringify(req.user));
    const fs = require('fs');
    fs.appendFileSync('advance_report_debug.log', `\nUSER: ${JSON.stringify(req.user)}\nBODY_BRANCH: ${branchId}\n`);

    // Validate branchId (prefer session/auth user branch if available)
    const effectiveBranchId = branchId || req.user?.Branch_idBranch;
    
    if (!effectiveBranchId) {
      return res.status(400).json({ message: "Branch ID is required" });
    }

    const data = await advanceReportDBService.generateAdvancedReport({
      sources,
      groupingColumns,
      displayColumns,
      filters,
      branchId: effectiveBranchId,
      showOutstandingOnly,
      includeInvoices,
      includeReturns,
      includeOverpayments,
      startDate,
      endDate,
    });

    res.json(data);
  } catch (error) {
    console.error("Error generating report:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const saveConfiguration = async (req, res) => {
  try {
    const { name, branchId, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ message: "Name and config are required" });
    }

    const effectiveBranchId = branchId || req.user?.Branch_idBranch;
    if (!effectiveBranchId) {
      return res.status(400).json({ message: "Branch ID is required" });
    }

    const configJson = typeof config === "string" ? config : JSON.stringify(config);

    const savedConfig = await advanceReportDBService.saveReportConfiguration({
      name,
      branchId: effectiveBranchId,
      configJson,
    });

    res.status(201).json(savedConfig);
  } catch (error) {
    console.error("Error saving configuration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const getSavedConfigurations = async (req, res) => {
  try {
    const { branchId } = req.query;
    const effectiveBranchId = branchId || req.user?.Branch_idBranch;
    if (!effectiveBranchId) {
      return res.status(400).json({ message: "Branch ID is required" });
    }

    const configs = await advanceReportDBService.getSavedReportConfigurations(effectiveBranchId);

    // Parse the config_json back to object for frontend convenience
    const parsedConfigs = configs.map(item => {
      try {
        return {
          ...item,
          config: JSON.parse(item.config_json)
        };
      } catch (e) {
        return {
          ...item,
          config: null
        };
      }
    });

    res.json(parsedConfigs);
  } catch (error) {
    console.error("Error fetching configurations:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const deleteConfiguration = async (req, res) => {
  try {
    const { id } = req.params;
    const { branchId } = req.query;
    const effectiveBranchId = branchId || req.user?.Branch_idBranch;

    if (!id) {
      return res.status(400).json({ message: "ID is required" });
    }
    if (!effectiveBranchId) {
      return res.status(400).json({ message: "Branch ID is required" });
    }

    const deleted = await advanceReportDBService.deleteSavedReportConfiguration(id, effectiveBranchId);
    if (!deleted) {
      return res.status(404).json({ message: "Configuration not found or unauthorized" });
    }

    res.json({ message: "Configuration deleted successfully" });
  } catch (error) {
    console.error("Error deleting configuration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  getColumns,
  generateAdvancedReport,
  saveConfiguration,
  getSavedConfigurations,
  deleteConfiguration,
};
