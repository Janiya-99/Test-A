const dbService = require("../services/installmentDBService");
const paymentDetailsDBService = require("../services/branchDBService");
const creditLogService = require("../services/customerCreditLogDBService");
const customerDBService = require("../services/customerDBService");

const getInstallmentsByDates = async (req, res) => {
  try {
    const {
      Branch_idBranch,
      from_date,
      to_date,
      customer,
      date_type,
      current_date,
    } = req.params;
    const installments = await dbService.getInstallment(
      date_type,
      from_date,
      to_date,
      Branch_idBranch,
      customer,
    );

    const paymentDetails =
      await paymentDetailsDBService.fetchPaymentDetails(Branch_idBranch);

    let penalty_percentage = paymentDetails[0].Penalty_Percentage;
    let data = [];

    installments.forEach((installment) => {
      let Penalty_Amount = installment.Penalty_Amount;
      let Total_Pending_Amount = installment.Total_Pending_Amount;
      let Balance_Amount = installment.Balance_Amount;
      let Due = 0;

      const installmentDate = new Date(installment.Date)
        .toISOString()
        .split("T")[0];
      if (
        new Date(current_date) > new Date(installmentDate) &&
        installment.Status === 0
      ) {
        Penalty_Amount =
          installment.Balance_Amount * (penalty_percentage / 100);
        Total_Pending_Amount = installment.Balance_Amount + Penalty_Amount;
        Balance_Amount = Total_Pending_Amount;
        Due = 1;
      }
      let updatedInstallment = {
        ...installment,
        Penalty_Amount: Penalty_Amount, // Example value for Penalty_Amount
        Total_Pending_Amount: Total_Pending_Amount, // Example value for Total_Pending_Amount
        Balance_Amount: Balance_Amount, // Example value for Balance_Amount
        Due: Due,
      };
      data.push(updatedInstallment);
    });

    res.json(data);
  } catch (err) {
    console.error("Error fetching installments:", err);
    res
      .status(500)
      .json({ message: "Error fetching installments", error: err.message });
  }
};

const invoiceDBService = require("../services/invoiceDBService");

const processInstallment = async (req, res) => {
  try {
    const { idInstallment_Payment } = req.params;
    const {
      Penalty_Amount,
      Paid_Date,
      Paid_Amount,
      Amount,
      Payment_Method = "Cash",
      Payment_Type = 2,
      Branch_idBranch,
      Cheque_Type = null,
      Cheque_No = null,
      Cheque_Name = null,
      Cheque_Date = null,
    } = req.body;

    // Helper function to round to 2 decimal places
    const roundTo2 = (num) => Math.round(parseFloat(num) * 100) / 100;

    const installmentData = await dbService.fetchInstallment(
      idInstallment_Payment,
    );
    if (installmentData.length === 0) {
      return res.status(404).json({ message: "installment not found" });
    }

    const installment = installmentData[0];
    let Total_Pending_Amount = roundTo2(installment.Total_Pending_Amount);
    let Balance_Amount = 0;
    let Status = 1;

    // Calculate New Paid Amount (Old Paid + New Paid)
    let New_Paid_Amount = roundTo2(
      parseFloat(installment.Paid_Amount) + parseFloat(Paid_Amount),
    );

    // Logic Fix: Check if New Paid Amount < Amount + Penalty (Total Due)
    // Assuming 'installment.Amount' is the original principal due for this term
    let Total_Due = roundTo2(
      parseFloat(installment.Amount) + parseFloat(Penalty_Amount),
    );

    if (New_Paid_Amount < Total_Due) {
      Total_Pending_Amount = Total_Due; // Keep track of what was due
      Balance_Amount = roundTo2(Total_Due - New_Paid_Amount);
      Status = 0; // Still pending
    } else {
      // Fully paid
      Balance_Amount = 0;
      Status = 1;
    }

    // 1. Update Installment
    await dbService.processInstallment(
      idInstallment_Payment,
      roundTo2(Penalty_Amount),
      Total_Pending_Amount,
      Paid_Date,
      New_Paid_Amount,
      Balance_Amount,
      Status,
    );

    // 2. Update Parent Invoice Balance
    const invoiceId = installment.Invoice_idInvoice;
    const invoiceData = await invoiceDBService.fetchInvoice(invoiceId);

    if (invoiceData && invoiceData.length > 0) {
      const invoice = invoiceData[0];

      // Calculate new values with proper rounding
      let newInvoicePaidAmount = roundTo2(
        parseFloat(invoice.Paid_Amount) + parseFloat(Paid_Amount),
      );
      let newInvoiceBalance = roundTo2(
        parseFloat(invoice.Balance_Amount) - parseFloat(Paid_Amount),
      );
      let newCreditBalance = roundTo2(
        parseFloat(invoice.Credit_Balance) - parseFloat(Paid_Amount),
      );

      // Check if ALL installments for this invoice are now paid (with tolerance)
      const TOLERANCE = 1.0; // Tolerance for floating-point precision issues
      const allInstallments =
        await dbService.fetchInstallmentByInvoice(invoiceId);
      const allPaid = allInstallments.every((inst) => {
        // The current installment being processed has Status = 1 (we just set it),
        // but the DB might not reflect it yet, so check by ID
        if (inst.idInstallment_Payment === parseInt(idInstallment_Payment)) {
          return Status === 1 || Balance_Amount < TOLERANCE;
        }
        return (
          inst.Status === 1 || parseFloat(inst.Balance_Amount || 0) < TOLERANCE
        );
      });

      // If all installments are paid, force balance to exactly zero
      // This prevents floating-point precision issues like -0.21
      if (allPaid) {
        newInvoiceBalance = 0;
        newCreditBalance = 0;
      }

      // TOLERANCE CHECK: If remaining balance is very small (less than 1.00),
      // consider it fully paid and force to zero
      const BALANCE_TOLERANCE = 1.0;
      if (newInvoiceBalance > 0 && newInvoiceBalance < BALANCE_TOLERANCE) {
        newInvoiceBalance = 0;
      }
      if (newCreditBalance > 0 && newCreditBalance < BALANCE_TOLERANCE) {
        newCreditBalance = 0;
      }

      // Ensure we don't have negative balances due to rounding
      if (newInvoiceBalance < 0) newInvoiceBalance = 0;
      if (newCreditBalance < 0) newCreditBalance = 0;

      await invoiceDBService.updateInvoiceBalance(
        invoiceId,
        newInvoicePaidAmount,
        newInvoiceBalance,
        newCreditBalance,
      );

      // 3. Create Credit Log Entry
      const customerId = invoice.Customer_idCustomer;

      // Fetch customer's last credit log to get current balance
      const lastLogData = await creditLogService.fetchLastLog(customerId);
      let currentCreditBalance = 0;

      if (lastLogData && lastLogData.length > 0) {
        currentCreditBalance = roundTo2(
          lastLogData[0].Total_Credit_Balance || 0,
        );
      } else {
        // If no previous log, get from customer record
        const customerData =
          await customerDBService.fetchCustomerById(customerId);
        if (customerData && customerData.length > 0) {
          currentCreditBalance = roundTo2(
            customerData[0].Total_Credit_Balance || 0,
          );
        }
      }

      // Calculate new credit balance (decrease by paid amount)
      let newTotalCreditBalance = roundTo2(
        currentCreditBalance - parseFloat(Paid_Amount),
      );

      // Prevent negative credit balance
      if (newTotalCreditBalance < 0) newTotalCreditBalance = 0;

      // Insert credit log entry with payment details
      await creditLogService.insertCustomerCreditLog(
        customerId,
        "PAYMENT",
        invoiceId,
        0, // Credit (no credit added)
        roundTo2(Paid_Amount), // Debit (payment decreases balance)
        newTotalCreditBalance,
        Payment_Type,
        Payment_Method,
        Cheque_Type, // Cheque_Type
        Cheque_No, // Cheque_No
        Cheque_Date, // Cheque_Date
        Cheque_Name, // Cheque_Name
        0, // Cheque_Status
        Branch_idBranch,
        null, // Card_Type
        null, // Card_Number
        null, // Transaction_Id
        null, // Receipt
        null, // Bank_Name
        null, // Bank_No
      );

      await creditLogService.recalculateCustomerCreditLogs(customerId);
    }

    const updatedInstallmentData = await dbService.fetchInstallment(
      idInstallment_Payment,
    );
    if (updatedInstallmentData.length === 0) {
      return res.status(404).json({ message: "installment not found" });
    }
    const updatedInstallment = updatedInstallmentData[0];

    let data = {
      ...updatedInstallment,
      Invoice_Paid_Amount: Paid_Amount,
    };

    res.json({
      message: "Installment has been processed successfully",
      data: data,
    });
  } catch (err) {
    console.error("Error processing installment:", err);
    res.status(500).json({
      message: "Error updating installment status",
      error: err.message,
    });
  }
};

const getInstallmentsByInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const installments = await dbService.fetchInstallmentByInvoice(invoiceId);
    res.json(installments);
  } catch (err) {
    console.error("Error fetching installments by invoice:", err);
    res.status(500).json({
      message: "Error fetching installments by invoice",
      error: err.message,
    });
  }
};

const sendInstallmentReminder = async (req, res) => {
  try {
    const { idInstallment_Payment } = req.params;
    const db = require("../db/db");
    
    const query = `
      SELECT ip.*, c.phoneNumber as customer_phone, c.First_Name, c.lastName, c.displayName,
             i.Invoice_Number
      FROM installment_payment ip
      INNER JOIN customer c ON ip.Customer_idCustomer = c.idCustomer
      INNER JOIN invoice i ON ip.Invoice_idInvoice = i.idInvoice
      WHERE ip.idInstallment_Payment = ?
    `;
    
    db.query(query, [idInstallment_Payment], async (err, results) => {
      if (err) {
        console.error("Error fetching installment details:", err);
        return res.status(500).json({ success: false, message: "Error fetching installment details" });
      }
      
      if (!results || results.length === 0) {
        return res.status(404).json({ success: false, message: "Installment not found" });
      }
      
      const inst = results[0];
      const smsService = require("../services/smsService");
      
      const customerName = `${inst.First_Name || ""} ${inst.lastName || ""}`.trim() || inst.displayName;
      const smsData = {
        name: customerName,
        invoice_no: inst.Invoice_Number,
        term: inst.Term,
        amount: parseFloat(inst.Amount).toFixed(2),
        date: inst.Date ? new Date(inst.Date).toISOString().split("T")[0] : ""
      };
      
      let resolvedUserId = req.body?.User_idUser || req.body?.userId || req.user?.id || req.user?.userId;
      if (!resolvedUserId && req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
        try {
          const jwt = require("jsonwebtoken");
          const token = req.headers.authorization.substring(7);
          const decoded = jwt.decode(token);
          if (decoded && (decoded.userId || decoded.id || decoded.idAsipiya_User)) {
            resolvedUserId = decoded.userId || decoded.id || decoded.idAsipiya_User;
          }
        } catch (jwtErr) {}
      }
      
      const smsResponse = await smsService.triggerSMSNotification(
        inst.Branch_idBranch,
        "installment_reminder",
        inst.customer_phone,
        smsData,
        resolvedUserId || null
      );
      
      res.json({ success: true, message: "Installment reminder sent successfully", data: smsResponse });
    });
  } catch (err) {
    console.error("Error in sendInstallmentReminder:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  getInstallmentsByDates,
  processInstallment,
  getInstallmentsByInvoice,
  sendInstallmentReminder,
};
