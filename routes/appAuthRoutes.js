const express = require("express");
const router = express.Router();
const {
  appLoginUser,
  appGoogleLogin,
  appFacebookLogin,
  appSync,
  appCheckEmail,
  appGetCompanyCategories,
  appRegisterCompany,
  appCreateOrder,
  appGetLoyalty,
  appGetWorkspaceData,
} = require("../controllers/appAuthController");
const { verifyOTP, resendOTP } = require("../controllers/authController");
const { verifyAppApiKey } = require("../middlewares/appApiKeyMiddleware");
const { verifyToken } = require("../middlewares/authMiddleware");

// App Login endpoint (protected with API key)
router.post("/login", verifyAppApiKey, appLoginUser);

// App Google Login endpoint (protected with API key)
router.post("/login/google", verifyAppApiKey, appGoogleLogin);

// App Facebook Login endpoint (protected with API key)
router.post("/login/facebook", verifyAppApiKey, appFacebookLogin);

// App Sync endpoint (protected with API key and Bearer token)
router.post("/sync", verifyAppApiKey, verifyToken, appSync);

// App Loyalty endpoint (protected with API key and Bearer token)
router.get("/loyalty", verifyAppApiKey, verifyToken, appGetLoyalty);

// App Workspace Data endpoint (protected with API key and Bearer token)
router.get("/workspace-data", verifyAppApiKey, verifyToken, appGetWorkspaceData);

// App Check Email endpoint (protected with API key)
router.get("/check-email", verifyAppApiKey, appCheckEmail);

// App Company Categories endpoint (protected with API key)
router.get("/company-categories", verifyAppApiKey, appGetCompanyCategories);

// App Register Company & User endpoint (protected with API key)
router.post("/register", verifyAppApiKey, appRegisterCompany);

// App OTP Verification endpoint (protected with API key)
router.post("/verify-otp", verifyAppApiKey, verifyOTP);

// App OTP Resend endpoint (protected with API key)
router.post("/resend-otp", verifyAppApiKey, resendOTP);

// App Create Order/Plan Activation endpoint (protected with API key)
router.post("/create-order", verifyAppApiKey, appCreateOrder);

module.exports = router;

