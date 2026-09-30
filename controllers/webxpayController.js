const crypto = require("crypto");
const NodeRSA = require("node-rsa");
const fs = require("fs");
const path = require("path");

exports.generateWebxpayParams = (req, res) => {
  const { orderId, amount } = req.body;
  if (!orderId || !amount) {
    return res.status(400).json({ error: "Missing orderId or amount" });
  }

  const paymentPlaintext = `${orderId}|${amount}`;

  const publicKeyPath = path.join(__dirname, "../keys/webxpay-public.pem");
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");

  const key = new NodeRSA(publicKey, "pkcs8-public");
  const encrypted = key.encrypt(paymentPlaintext);
  const payment = Buffer.from(encrypted).toString("base64");

  const custom_fields = Buffer.from("cus_1|cus_2|cus_3|cus_4").toString(
    "base64"
  );

  res.json({
    payment,
    custom_fields,
    secret_key: "630be963-59e2-447a-8f3b-93b3d7a3bf25",
  });
};
