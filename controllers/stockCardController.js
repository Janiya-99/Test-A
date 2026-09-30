const dbService = require("../services/stockCardDBService");

const getStockCardReport = async (req, res) => {
  try {
    const { Branch_idBranch, category } = req.params;
    const items = await dbService.fetchItemsSIN(Branch_idBranch, category);

    let product_data = [];
    let data = {};
    let total_item_cost = 0;
    let total_item_rate = 0;
    items.forEach((item) => {
      let total_cost = 0;
      let total_rate = 0;

      if (parseFloat(item.Stock_In_Hand) > 0) {
        total_cost =
          parseFloat(item.Real_Cost) * parseFloat(item.Stock_In_Hand);
        total_rate = parseFloat(item.Rate) * parseFloat(item.Stock_In_Hand);
      }

      let item_data = {
        ...item,
        total_cost,
        total_rate,
      };
      // if (!(item.Stock_In_Hand === "0")) {
      product_data.push(item_data);
      // }
      total_item_cost += total_cost;
      total_item_rate += total_rate;
    });
    data = {
      products: product_data,
      total_item_cost,
      total_item_rate,
    };

    res.json(data);
  } catch (err) {
    console.error("Error creating expense:", err);
    res
      .status(500)
      .json({ message: "Error creating expense", error: err.message });
  }
};

const getStockCard = async (req, res) => {
  try {
    const { from, to, idItem, Branch_idBranch } = req.params;
    const stockCard = await dbService.fetchStockCard(
      `${from} 00:00:00`,
      `${to} 23:59:59`,
      idItem,
      Branch_idBranch,
    );

    res.json(stockCard);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching stock card", error: err.message });
  }
};

const getSerialNumbersByItem = async (req, res) => {
  try {
    const { Item_idItem, Branch_idBranch } = req.params;
    const { page = 1, limit = 50, search = "" } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [serialNumbers, counts] = await Promise.all([
      dbService.fetchSerialNumbersByItem(
        Item_idItem,
        Branch_idBranch,
        limit,
        offset,
        search,
      ),
      dbService.countSerialNumbersByItem(Item_idItem, Branch_idBranch, search),
    ]);

    res.json({
      serial_numbers: serialNumbers,
      summary: {
        total: counts.total || 0,
        available: counts.available || 0,
        sold: counts.sold || 0,
      },
      pagination: {
        total: counts.total || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil((counts.total || 0) / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("Error fetching serial numbers:", err);
    res
      .status(500)
      .json({ message: "Error fetching serial numbers", error: err.message });
  }
};


module.exports = {
  getStockCardReport,
  getStockCard,
  getSerialNumbersByItem,
};
