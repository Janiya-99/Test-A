# Production Server Deployment & .env Management Guide

This guide provides step-by-step instructions for managing the `.env` file on your production/staging server when pulling updates where `.env` is removed from Git tracking.

---

## 1. Before Running `git pull` on the Server

Git will remove the tracked `.env` file when pulling a commit that deletes it from the repository. You **must** create a backup first.

### Step 1.1: Navigate to the Backend Directory
```bash
cd /path/to/your/backend/Asipiya_Asipbook_Backend
```

### Step 1.2: Backup the Current Production `.env`
```bash
cp .env .env.production.backup
```
*(Also keep a secure copy outside the repository directory, for example in your home directory or secure password manager).*
```bash
cp .env ~/asipbook_production_env.backup
```

---

## 2. Pulling the Latest Code

Once your backup is verified, fetch and pull the updated branch:

```bash
git fetch origin
git pull origin main   # or staging depending on server environment
```

> **Note:** During the pull, Git may delete the tracked `.env` file. This is expected because `.env` is now untracked in Git.

---

## 3. Restore and Secure the `.env` File

### Step 3.1: Restore the `.env` File
```bash
cp .env.production.backup .env
```

### Step 3.2: Verify Git Ignores the File
Run:
```bash
git status
```
**Expected output:**
Git should report `nothing to commit, working tree clean`. The `.env` file must **NOT** appear in `git status` because it is listed in `.gitignore`.

### Step 3.3: Set Secure File Permissions
Restrict read/write permissions so only the application user can read the environment file:
```bash
chmod 600 .env
```

---

## 4. Restart the Application

Restart your backend process to load the environment variables:

```bash
# If using PM2:
pm2 restart all
# or
pm2 restart server --update-env

# To inspect logs and ensure database/server connected properly:
pm2 logs --lines 50
```

---

## 5. Reference: Production Environment Variables Template

In case `.env` is lost, here are the required production keys:

```dotenv
# Server Configuration
PORT=8000
SERVER_ROOT_URI=https://asipbookbackend.asipbook.com
FRONTEND_URL=https://asipbook.com

# Database Configuration (MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_secure_db_password
DB_NAME=asipbook_db
DB2_NAME=asipbook_account_center

# Authentication & Security
JWT_SECRET=your_jwt_secret_key
APP_API_KEY=your_app_api_key

# OAuth Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# SMTP Email Configuration
EMAIL_HOST=node403.namehero.net
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=security@asipbook.com
EMAIL_PASS=your_email_password

# External APIs
ACCOUNT_CENTER_API_URL=https://asipiyaaccountcenter.asipbook.com/api
ACCOUNT_CENTER_URL=https://asipiyaaccountcenter.asipbook.com

# AI / Gemini API
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash
```

---

## 6. Security Checklist: Credential Rotation

Because secrets were previously pushed to Git history, please complete the following:

- [ ] **Rotate SMTP Password**: Update password for `security@asipbook.com` in email hosting panel (NameHero) and in server `.env`.
- [ ] **Rotate Gemini API Key**: Generate a new key in Google AI Studio / Cloud Console and update server `.env`.
- [ ] **Rotate JWT Secret**: Update `JWT_SECRET` with a new random string (users will need to re-login once).
- [ ] **Rotate Google OAuth Secret**: Regenerate client secret in Google Cloud Console.
- [ ] **Verify .gitignore**: Ensure `.env` and `.env.*` remain inside `.gitignore`.
