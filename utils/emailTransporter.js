const nodemailer = require("nodemailer");

// Single shared transporter — reuses TCP connections across the entire app.
// This prevents creating multiple SMTP transport instances per request,
// which was causing unnecessary threads and file descriptors.
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "node403.namehero.net",
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER || "security@asipbook.com",
    pass: process.env.EMAIL_PASS || "Asipiya@123",
  },
  pool: true, // Use pooled connections (reuse TCP sockets)
  maxConnections: 3, // Limit concurrent SMTP connections
  maxMessages: 100, // Messages per connection before reconnect
});

module.exports = transporter;
