const express = require("express");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const db = require("../db/db");

dotenv.config();

const router = express.Router();

/** ---- Helper: build a transporter from env (Gmail OR Custom SMTP) ---- */
function buildTransporterFromEnv() {
  // If a host is provided, prefer raw SMTP (works for custom domains like asipbook.com)
  if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST, // e.g. node403.namehero.net or smtp.gmail.com
      port: Number(process.env.EMAIL_PORT || 587), // 465 (SSL) or 587 (STARTTLS)
      secure: String(process.env.EMAIL_SECURE).toLowerCase() === "true", // true for 465, false for 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        // allow self-signed on dev/shared hosts; remove if your host has a valid cert
        rejectUnauthorized: false,
      },
    });
  }

  // Fallback to Gmail (requires App Password on the account)
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Gmail App Password (16 chars), not your normal password
    },
  });
}

// ✅ Create Nodemailer transporter (used for both single & group invites)
const transporter = buildTransporterFromEnv();

// ✅ Verify SMTP Connection (once on boot)
transporter.verify((error, success) => {
  if (error) {
    const safeErr =
      error && error.message
        ? error.message.replace(process.env.EMAIL_PASS || "", "***")
        : error;
    console.error("🚨 SMTP verify failed:", safeErr);
  } else {
    console.log("✅ SMTP server is ready to send emails.");
  }
});

// ✅ Validate Email
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ✅ Send Single Email Invite
router.post("/invite", async (req, res) => {
  const { email,Branch_idBranch,companyid } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  try {
    const origin = req.get("origin") || "http://localhost:3000";
    const registerUrl = `${origin}/Userpassword/${encodeURIComponent(
                email
              )}/${Branch_idBranch}/${companyid}`;
    // const registerUrl = `https://projectmanagement.asipiya.lk/SigningIn?email=${encodeURIComponent(email)}`;

    const mailOptions = {
      from: `"Asipiya Team" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Invitation to Join Our Team",
      text: `Hello,\n\nYou have been invited to join our team. Click the link below to register:\n\n${registerUrl}\n\nBest Regards,\nTeam Management`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("📧 Invite sent:", info.messageId || info.response);
    return res.status(200).json({ message: "Invitation sent successfully!" });
  } catch (error) {
    const safeErr =
      error && error.message
        ? error.message.replace(process.env.EMAIL_PASS || "", "***")
        : error;
    console.error("Error sending email:", safeErr);
    return res.status(500).json({ error: "Failed to send invitation" });
  }
});

// ✅ Bulk invite (unchanged logic; uses the same transporter)
router.post("/invite/group", async (req, res) => {
  const { emails ,Branch_idBranch,companyid } = req.body;

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: "At least one email is required" });
  }

  try {
    const jobs = emails.filter(isValidEmail).map((email) => {
      const origin = req.get("origin") || "http://localhost:3000";
      const registerUrl = `${origin}/Userpassword/${encodeURIComponent(
                email
              )}/${Branch_idBranch}/${companyid}`;
      // const registerUrl = `https://projectmanagement.asipiya.lk/SigningIn?email=${encodeURIComponent(email)}`;

      const mailOptions = {
        from: `"Asipiya Team" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Invitation to Join Our Team",
        text: `Hello,\n\nYou have been invited to join our team. Click the link below to register:\n\n${registerUrl}\n\nBest Regards,\nTeam Management`,
      };

      return transporter.sendMail(mailOptions);
    });

    await Promise.all(jobs);
    console.log("📧 All invitations sent successfully");
    return res
      .status(200)
      .json({ message: "Group invitations sent successfully!" });
  } catch (error) {
    const safeErr =
      error && error.message
        ? error.message.replace(process.env.EMAIL_PASS || "", "***")
        : error;
    console.error("Error sending group emails:", safeErr);
    return res.status(500).json({ error: "Failed to send group invitations" });
  }
});

// ✅ Send Single Email Invite with Role Selection
router.post("/invite", async (req, res) => {
  const { email, role } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  // Validate the role
  if (!role || !['Admin', 'User'].includes(role)) {
    return res.status(400).json({ error: "Invalid role selected" });
  }

  try {
    const origin = req.get("origin") || "http://localhost:3000";
    const registerUrl = `${origin}/signup?email=${encodeURIComponent(
      email
    )}&role=${encodeURIComponent(role)}`;

    const mailOptions = {
      from: `"Asipiya Team" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Invitation to Join Our Team",
      text: `Hello,\n\nYou have been invited to join our team as a ${role}. Click the link below to register:\n\n${registerUrl}\n\nBest Regards,\nTeam Management`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("📧 Invite sent:", info.messageId || info.response);
    return res.status(200).json({ message: "Invitation sent successfully!" });
  } catch (error) {
    const safeErr =
      error && error.message
        ? error.message.replace(process.env.EMAIL_PASS || "", "***")
        : error;
    console.error("Error sending email:", safeErr);
    return res.status(500).json({ error: "Failed to send invitation" });
  }
});


module.exports = router;
