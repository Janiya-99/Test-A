const express = require("express");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const path = require("path");
const compression = require("compression");

dotenv.config();
const app = express();
const port = process.env.PORT || 8000; // Passenger injects PORT; fallback for local dev

app.use(morgan("dev"));

// Socket.IO setup — NO standalone http.createServer (Passenger manages the server)
const { Server } = require("socket.io");
const {
  getSubscriptionNotifications,
} = require("./controllers/notificationController");
const { getExpiringBatches } = require("./services/dashboardDBService");

// Socket.IO instance — will be attached to the server after app.listen()
const io = new Server({
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"], // Allow both WebSocket and Polling
  pingTimeout: 60000,
  pingInterval: 25000,
});
app.set("io", io);

// Socket.IO connection logic
io.on("connection", (socket) => {
  // Join user-specific room
  socket.on("join", async (userId) => {
    if (userId) socket.join(userId.toString());
  });

  // Join branch / company rooms
  socket.on("joinBranch", async ({ companyId, branchId }) => {
    if (companyId) socket.join(`company_${companyId}`);
    if (branchId) socket.join(`branch_${branchId}`);
  });

  let lastCheckTime = 0;
  let lastMessages = [];

  socket.on("checkNotifications", async ({ companyId, branchId }) => {
    if (!companyId) return;

    // Auto-join company and branch rooms for scoped broadcasts
    socket.join(`company_${companyId}`);
    if (branchId) socket.join(`branch_${branchId}`);

    const now = Date.now();
    // Throttle per socket to at most once every 10 seconds
    if (now - lastCheckTime < 10000 && lastMessages.length > 0) {
      socket.emit("notificationCount", { count: lastMessages.length });
      socket.emit("notifications", lastMessages);
      return;
    }
    lastCheckTime = now;

    let messages = await getSubscriptionNotifications(companyId);

    if (branchId) {
      try {
        const expiring = await getExpiringBatches(branchId);

        expiring.forEach((batch) => {
          const expDate = new Date(batch.expiry_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const diffTime = expDate - today;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          let msg = "";
          let severity = "info";
          if (diffDays < 0) {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' has expired!`;
            severity = "error";
          } else if (diffDays === 0) {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' expires today!`;
            severity = "error";
          } else if (diffDays === 1) {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' expires tomorrow!`;
            severity = "warning";
          } else {
            msg = `Batch ${batch.batch_code} of '${batch.Item_Name}' is expiring in ${diffDays} days!`;
            severity = diffDays <= 15 ? "warning" : "info";
          }

          messages.push({
            id: `expiry-${batch.id}`,
            message: msg,
            type: "expiry",
            severity: severity,
            route: "/batches",
            batch_code: batch.batch_code,
            item_id: batch.item_id,
            expiry_date: batch.expiry_date,
            item_name: batch.Item_Name
          });
        });
      } catch (err) {
        console.error("Error getting expiring batches inside socket connection:", err);
      }
    }

    lastMessages = messages;
    socket.emit("notificationCount", { count: messages.length });
    socket.emit("notifications", messages);
  });

  // Handle message sending
  socket.on("sendMessage", (msg) => {
    if (msg.receiver_id) {
      // Direct message
      io.to(msg.receiver_id.toString()).emit("receiveMessage", msg);
    }

    if (msg.group_id) {
      // Group message: emit to all except sender
      // You need to fetch group members from DB and emit to each
      // For demo, emit to all except sender:
      socket.broadcast.emit("receiveMessage", msg);
    }
  });

  // ✅ Handle delivery status
  socket.on("messageDelivered", ({ messageId, receiverId }) => {
    io.to(receiverId.toString()).emit("deliveredStatus", { messageId });
  });

  // ✅ Handle seen status
  socket.on("messageSeen", ({ messageId, receiverId }) => {
    io.to(receiverId.toString()).emit("seenStatus", { messageId });
  });

  socket.on("disconnect", () => { });
});

// Import authentication middleware
const { verifyToken } = require("./middlewares/authMiddleware");

// Middleware setup
app.use(compression());
app.use(cors({ origin: "*" }));
//app.use(bodyParser.json());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Static files with explicit CORS headers
app.use(
  "/uploads",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  },
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
    },
  })
);

// Public routes (no authentication required) - must be before verifyToken middleware
// Auth routes handle their own public/protected endpoints internally
app.use("/api/user", require("./routes/authRoutes"));
app.use("/api/app-user", require("./routes/appAuthRoutes"));
app.use("/api/user-password", require("./routes/userPasswordRoutes"));
app.use("/api/public-appointment", require("./routes/publicAppointmentRoutes"));
app.use("/api/public/invoice", require("./routes/publicInvoiceRoutes"));
app.use("/api/public/purchase-order", require("./routes/publicPurchaseOrderRoutes"));
app.use("/api/public/quotation", require("./routes/publicQuotationRoutes"));
app.use("/api/webhooks", require("./routes/approvalWebhookRoutes"));

// Apply authentication middleware to all subsequent routes
app.use("/api", verifyToken);

// Protected API routes (all require authentication)
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/customer", require("./routes/customerRoute"));
app.use("/api/customer-loyalty", require("./routes/customerLoyaltyRoutes"));
app.use("/api/gift-vouchers", require("./routes/giftVoucherRoutes"));
app.use("/api/expense", require("./routes/expenseRoutes"));
app.use("/api/product", require("./routes/productRoutes"));
app.use("/api/promotions", require("./routes/promotionRoutes"));
app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/quotation", require("./routes/quotationRoutes"));
app.use("/api/invoice", require("./routes/invoiceRoutes"));
app.use("/api/branch", require("./routes/branchRoutes"));
app.use("/api/supplier", require("./routes/supplierRoute"));
app.use("/api/quantity-types", require("./routes/quantityTypeRoutes"));
app.use("/api/grn", require("./routes/grnRoutes"));
app.use("/api/manufacturing", require("./routes/manufacturingRoutes"));
app.use(
  "/api/manufacturing-cards",
  require("./routes/manufacturingCardRoutes")
);
app.use("/api/purchase-return", require("./routes/purchaseReturnRoutes"));
app.use("/api/customer-return", require("./routes/customerReturnRoutes"));
app.use("/api/purchase-order", require("./routes/purchaseOrderRoutes"));
app.use("/api/service-dates", require("./routes/serviceDateRoutes"));
app.use(
  "/api/customer-credit-log",
  require("./routes/customerCreditLogRoutes"),
);
app.use(
  "/api/supplier-credit-log",
  require("./routes/supplierCreditLogRoutes"),
);
app.use("/api/stock-card", require("./routes/stockCardRoutes"));
app.use("/api/user-logs", require("./routes/userLogRoutes"));
app.use("/api/damage-note", require("./routes/damageNoteRoutes"));
app.use("/api/pl-report", require("./routes/pLReportRoutes"));
app.use("/api/employee", require("./routes/employeeRoutes"));
app.use("/api/installments", require("./routes/installmentRoutes"));
app.use("/api/zones", require("./routes/zoneRoutes"));
app.use("/api/route", require("./routes/routeRoutes"));
app.use("/api/report", require("./routes/reportRoutes"));
app.use("/api/approval-settings", require("./routes/approvalSettingsRoutes"));
app.use("/api/approvals", require("./routes/approvalRoutes"));
app.use("/api/pos", require("./routes/posRoutes"));
app.use("/api/accounting", require("./routes/accountingRoutes"));
app.use("/api", require("./controllers/Emailsend"));
app.use("/api", require("./routes/Invoicesettings"));
app.use("/api/quotation-settings", require("./routes/quotationsettings"));
app.use("/api", require("./routes/creditRoutes"));
app.use("/api/quantity", require("./routes/quantityRoutes"));
app.use("/api/privilage", require("./routes/userPrivilageRoutes"));
app.use("/api/pro", require("./routes/projectRoutes"));
app.use("/api", require("./routes/restoreRoutes"));
app.use("/api", require("./routes/boardRoutes"));
app.use("/api", require("./routes/taskRoutes"));
app.use("/api/subtasks", require("./routes/subtaskRoutes"));
app.use("/api/teams", require("./routes/teamRoutes"));
app.use("/api", require("./routes/privilageRoutes"));
app.use("/api/assign", require("./routes/asigneeRoutes"));
app.use("/api/task-field-data", require("./routes/taskFieldDataRoutes"));
app.use("/api/configure", require("./routes/configureRoutes"));
app.use("/api/update", require("./routes/latestUpdateRoutes"));
app.use("/api/subAssign", require("./routes/SubAssigneeRoutes"));
app.use("/api/tags", require("./routes/tagRoutes"));
app.use("/api", require("./routes/inviteRoutes"));
app.use("/api/members", require("./routes/memberRoutes"));
app.use("/api/cheques", require("./routes/chequeRoutes"));
app.use("/api/delivery", require("./routes/delivaryRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/customer-fields", require("./routes/customerFieldRoutes"));
app.use("/api/staff-fields", require("./routes/staffFieldRoutes"));
app.use("/api/supplier-fields", require("./routes/supplierFieldRoutes"));
app.use("/api/product-fields", require("./routes/productFieldRoute"));
app.use("/api/webxpay", require("./routes/webxpayRoutes"));
app.use("/api/warehouses", require("./routes/warehouseRoutes"));
app.use("/api/banks", require("./routes/banksRoutes"));
app.use("/api/bank-accounts", require("./routes/bankAccountsRoutes"));
app.use("/api/stock-transfers", require("./routes/stockTransferRoutes"));
app.use("/api/stock-adjustments", require("./routes/stockAdjustmentRoutes"));
app.use("/api/appointments", require("./routes/appointmentRoutes"));
app.use(
  "/api/appointment-notify-people",
  require("./routes/appointmentNotifyPersonRoutes"),
);
app.use("/api/appointment-settings", require("./routes/appointmentSettingsRoutes"));
app.use("/api/service-jobs", require("./routes/serviceJobRoutes"));
app.use("/api/estimates", require("./routes/estimateRoutes"));
app.use("/api/material-issues", require("./routes/materialIssueRoutes"));
app.use("/api/spare-part-requests", require("./routes/sparePartRequestRoutes"));

app.use("/api/advance-reports", require("./routes/advanceReportRoutes"));
app.use("/api/grn-settings", require("./routes/grnSettingsRoutes"));



app.use("/api/roles", require("./routes/rolesRoutes"));
app.use("/api/support", require("./routes/supportRoutes"));
app.use("/api/documents", require("./routes/documentRoutes"));
app.use("/api", require("./routes/rolePrivilageRoutes"));
app.use("/api/ai", require("./routes/aiRoute")); // AI Routes

// ==================== ERROR HANDLING ====================

// 404 Handler - Must be after all routes
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler - Must be last middleware
app.use((err, req, res, next) => {
  console.error("❌ Error occurred:");
  console.error("Path:", req.method, req.originalUrl);
  console.error("Error:", err);
  console.error("Stack:", err.stack);

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    message: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Process-level error handlers
process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err.message);
  // Don't exit — let Passenger manage process lifecycle
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 UNHANDLED REJECTION:", reason);
  // Don't exit — let Passenger manage process lifecycle
});

// Start server — Passenger provides PORT via env
const server = app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

// Attach Socket.IO to the Express-managed server
io.attach(server);

// Graceful shutdown for Passenger SIGTERM
process.on("SIGTERM", () => {
  console.log("👋 SIGTERM received. Shutting down gracefully...");
  io.close();
  server.close(() => {
    const db = require("./db/db");
    const db2 = require("./db/db2");
    db.end();
    db2.end();
    process.exit(0);
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => process.exit(1), 10000);
});
