require("dotenv").config();
const mysql = require("mysql2");

const connection = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : "root",
  database: process.env.DB_NAME || "asipbook_db",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  charset: "utf8mb4",
  timezone: "+05:30",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  idleTimeout: 60000,
});

// Test the pool connection
connection.getConnection((err, conn) => {
  if (err) {
    console.error("Error connecting to database:", err);
    return;
  }
  console.log(`Connected to database (${process.env.DB_NAME || "asipbook_db"})`);
  conn.release(); // Release connection back to pool
});

module.exports = connection;
