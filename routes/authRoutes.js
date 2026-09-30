const express = require("express");
const router = express.Router();

// Controllers and middleware
const controllers = require("../controllers/authController");
const middleware = require("../middlewares/authMiddleware");

// Multer config to handle profile picture upload
const upload = require("../utils/multerConfig");

// Register route with profile picture upload middleware
router.post(
  "/register",
  upload.single("Profile_Picture"),
  controllers.registerUser,
);

router.post("/setup-company-defaults", controllers.setupCompanyDefaults);

// Google Login
router.post("/login/request/google", controllers.googleLogin);

// Facebook Login
router.post("/login/request/facebook", controllers.facebookLogin);
router.post("/login/request/microsoft", controllers.microsoftLogin);

// OTP verification routes
router.post("/verify", controllers.verifyOTP);
router.post("/resend-otp", controllers.resendOTP);

// Register a user under a specific branch with profile picture upload
router.post(
  "/branch-register",
  upload.single("Profile_Picture"),
  controllers.registerBranchUser,
);

// Password reset
router.post("/reset-password", controllers.updateUserPassword);

// Traditional login
router.post("/login", controllers.loginUser);

// Protected route (token check)
router.get("/protected", middleware.verifyToken, controllers.checkToken);

router.get("/get-user/:branchId/:email", controllers.getUserById);
router.put(
  "/update/:id",
  upload.single("image"),
  controllers.updateUserProfile,
);

router.delete("/:userId/:branchId", controllers.deleteBranchUser);

// Add or update password for a user by email and branch
router.post("/set-or-update-password", controllers.setOrUpdatePassword);

// Forgot Password Flow
router.post("/forgot-password/send-otp", controllers.sendForgotPasswordOTP);
router.post("/forgot-password/verify-otp", controllers.verifyForgotPasswordOTP);
router.post("/forgot-password/reset", controllers.resetForgottenPassword);

// NEW: switch company (no file upload)
router.post("/switch-company", controllers.switchCompany);

router.get("/otp-status", controllers.otpStatus);

// Manager PIN validation for POS & Invoice approval challenges
router.post("/validate-manager-pin", controllers.validateManagerPin);

router.post("/user-designation", controllers.saveUserDesignation);

router.get(
  "/user-designation/:companyid",
  controllers.getUserDesignationsByCompany,
);

router.delete("/:roleId", controllers.deleteUserDesignation);

// Token refresh (requires valid token)
router.post("/refresh-token", middleware.verifyToken, controllers.refreshToken);

// Cross-auth token for SSO to Account Center (requires valid token)
router.post(
  "/generate-cross-auth-token",
  middleware.verifyToken,
  controllers.generateCrossAuthToken,
);

// Loyalty & XP System REST API routes
router.get("/loyalty", middleware.verifyToken, async (req, res, next) => {
  try {
    const loyaltyService = require("../services/loyaltyService");
    const userId = req.userId; // set securely by verifyToken middleware
    const { planName } = req.query;
    console.log(`[Loyalty GET] Querying status for user ID: ${userId}, planName (query): ${planName}`);
    const status = await loyaltyService.getUserLoyaltyStatus(userId, planName);
    console.log(`[Loyalty GET] Successfully fetched status:`, JSON.stringify(status));
    res.status(200).json({ success: true, loyalty: status });
  } catch (error) {
    console.error(`[Loyalty GET] Error:`, error);
    next(error);
  }
});

router.post("/loyalty/award", middleware.verifyToken, async (req, res, next) => {
  try {
    const loyaltyService = require("../services/loyaltyService");
    const userId = req.userId; // set securely by verifyToken middleware
    const { triggerType } = req.body;
    console.log(`[Loyalty AWARD] Awarding XP type "${triggerType}" to user ID: ${userId}`);
    const status = await loyaltyService.awardUserXp(userId, triggerType);
    console.log(`[Loyalty AWARD] Successfully updated status:`, JSON.stringify(status));
    res.status(200).json({ success: true, loyalty: status });
  } catch (error) {
    console.error(`[Loyalty AWARD] Error:`, error);
    next(error);
  }
});

router.post("/loyalty/simulate-plan", middleware.verifyToken, async (req, res, next) => {
  try {
    const db = require("../db/db");
    const userId = req.userId;
    const { planName } = req.body;

    // Deactivate any existing active subscriptions for this user
    await new Promise((resolve, reject) => {
      db.query("UPDATE subscription_status SET status = 'expired' WHERE user_id = ?", [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    // Insert the new active subscription plan
    await new Promise((resolve, reject) => {
      db.query(
        "INSERT INTO subscription_status (user_id, plan_name, status) VALUES (?, ?, 'active')",
        [userId, planName],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    // Fetch updated loyalty status
    const loyaltyService = require("../services/loyaltyService");
    const status = await loyaltyService.getUserLoyaltyStatus(userId);
    res.status(200).json({ success: true, loyalty: status });
  } catch (error) {
    next(error);
  }
});

router.post("/loyalty/reset", middleware.verifyToken, async (req, res, next) => {
  try {
    const db = require("../db/db");
    const userId = req.userId;

    // Clear user's XP logs, loyalty entry, and simulated subscription status
    await new Promise((resolve, reject) => {
      db.query("DELETE FROM xp_logs WHERE user_id = ?", [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    await new Promise((resolve, reject) => {
      db.query("DELETE FROM user_loyalty WHERE user_id = ?", [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    await new Promise((resolve, reject) => {
      db.query("DELETE FROM subscription_status WHERE user_id = ?", [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    // Fetch reset loyalty status
    const loyaltyService = require("../services/loyaltyService");
    const status = await loyaltyService.getUserLoyaltyStatus(userId);
    res.status(200).json({ success: true, loyalty: status });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

