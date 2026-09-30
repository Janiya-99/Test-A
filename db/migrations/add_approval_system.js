const mysql = require("mysql2/promise");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const host = process.env.DB_HOST || "127.0.0.1";
const user = process.env.DB_USER || "root";
const password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : "root";
const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;
const erpDb = process.env.DB_NAME || "asipbook_db";
const approvalDb = "asipbook_approval_engine";

async function runMigration() {
  console.log("🚀 Starting database migrations for Approval Process Management System...");
  
  // Connection without database to allow creating DB
  const conn = await mysql.createConnection({ host, user, password, port });

  try {
    // 1. Ensure ERP Database exists
    console.log(`Checking ERP Database: ${erpDb}`);
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${erpDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    // 2. Ensure expences table exists
    await conn.query(`USE \`${erpDb}\``);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS expences (
        idexpences INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        date DATE NOT NULL,
        reason VARCHAR(255),
        amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Add approval columns to participating tables
    const participatingTables = [
      "invoice",
      "grn",
      "item",
      "customer",
      "supplier",
      "customer_return",
      "purchase_return",
      "damage_note",
      "purchase_orders",
      "estimates",
      "expences"
    ];

    for (const table of participatingTables) {
      console.log(`Checking table: ${table}`);
      const [tableExists] = await conn.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [erpDb, table]
      );

      if (tableExists.length === 0) {
        console.log(`⚠️ Table ${table} does not exist in ${erpDb}. Skipping column additions.`);
        continue;
      }

      // Check if approval_status column exists
      const [colStatus] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'approval_status'`,
        [erpDb, table]
      );

      if (colStatus.length === 0) {
        console.log(`Adding approval_status to ${table}...`);
        await conn.query(`
          ALTER TABLE \`${table}\`
          ADD COLUMN approval_status ENUM('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED') NOT NULL DEFAULT 'ACTIVE'
        `);
      }

      const [colReqId] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'approval_request_id'`,
        [erpDb, table]
      );

      if (colReqId.length === 0) {
        console.log(`Adding approval_request_id to ${table}...`);
        await conn.query(`
          ALTER TABLE \`${table}\`
          ADD COLUMN approval_request_id VARCHAR(100) NULL
        `);
      }

      const [colApprovedAt] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'approved_at'`,
        [erpDb, table]
      );

      if (colApprovedAt.length === 0) {
        console.log(`Adding approved_at to ${table}...`);
        await conn.query(`
          ALTER TABLE \`${table}\`
          ADD COLUMN approved_at TIMESTAMP NULL
        `);
      }

      const [colApprovedBy] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'approved_by'`,
        [erpDb, table]
      );

      if (colApprovedBy.length === 0) {
        console.log(`Adding approved_by to ${table}...`);
        await conn.query(`
          ALTER TABLE \`${table}\`
          ADD COLUMN approved_by INT NULL
        `);
      }

      console.log(`✅ Table ${table} verified with approval columns.`);
    }

    // 4. Create stock_allocation_tracking table in ERP
    console.log("Creating stock_allocation_tracking table...");
    await conn.query(`
      CREATE TABLE IF NOT EXISTS stock_allocation_tracking (
        id INT PRIMARY KEY AUTO_INCREMENT,
        invoice_id INT NOT NULL,
        salesperson_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        warehouse_released_at TIMESTAMP NULL,
        warehouse_released_by INT NULL,
        salesperson_confirmed_at TIMESTAMP NULL,
        stock_deducted_at TIMESTAMP NULL,
        status ENUM(
          'PENDING_WAREHOUSE',
          'WAREHOUSE_ACCEPTED',
          'PENDING_SALESPERSON',
          'CONFIRMED',
          'DEDUCTED'
        ) DEFAULT 'PENDING_WAREHOUSE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_invoice (invoice_id),
        INDEX idx_salesperson (salesperson_id)
      )
    `);
    console.log("✅ stock_allocation_tracking table verified.");

    // 5. Create approval_system_settings in ERP
    console.log("Creating approval_system_settings table...");
    await conn.query(`
      CREATE TABLE IF NOT EXISTS approval_system_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id INT NOT NULL,
        branch_id INT NOT NULL,
        enable_approval_processes BOOLEAN DEFAULT FALSE,
        min_discount_percentage DECIMAL(5,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_comp_branch (company_id, branch_id)
      )
    `);
    console.log("✅ approval_system_settings table verified.");

    // 6. Create asipbook_approval_engine Database & Tables
    console.log(`Checking Approval Engine Database: ${approvalDb}`);
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${approvalDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${approvalDb}\``);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS process_maps (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id INT NOT NULL,
        branch_id INT NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_map (company_id, branch_id, action_type),
        INDEX idx_comp_branch (company_id, branch_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS process_tiers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        map_id INT NOT NULL,
        tier_level INT NOT NULL,
        approver_id INT NULL,
        approver_role VARCHAR(100) NULL,
        FOREIGN KEY (map_id) REFERENCES process_maps(id) ON DELETE CASCADE,
        INDEX idx_map (map_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id VARCHAR(50) PRIMARY KEY,
        erp_record_id VARCHAR(100) NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        module VARCHAR(100) NOT NULL,
        company_id INT NOT NULL,
        branch_id INT NOT NULL,
        current_tier INT NOT NULL DEFAULT 1,
        status ENUM('PENDING','APPROVED','REJECTED','ESCALATED') DEFAULT 'PENDING',
        payload_summary JSON,
        erp_callback_url VARCHAR(255) NOT NULL,
        initiated_by INT NOT NULL,
        initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        INDEX idx_comp_branch (company_id, branch_id),
        INDEX idx_status (status),
        INDEX idx_erp_record (erp_record_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS approval_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        request_id VARCHAR(50) NOT NULL,
        tier_level INT NOT NULL,
        action ENUM('APPROVED', 'REJECTED', 'ESCALATED') NOT NULL,
        actor_id INT NOT NULL,
        actor_name VARCHAR(255),
        comments TEXT,
        actioned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_req (request_id)
      )
    `);

    console.log("✅ Approval Engine tables created successfully.");
    console.log("🎉 All database migrations completed successfully without errors!");
  } catch (err) {
    console.error("❌ Migration failed with error:", err);
    throw err;
  } finally {
    await conn.end();
  }
}

runMigration().catch(err => {
  process.exit(1);
});
