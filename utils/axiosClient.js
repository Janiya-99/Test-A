require("dotenv").config();
const axios = require("axios");

const axiosClient = axios.create({
  baseURL: process.env.ACCOUNT_CENTER_API_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Optional: Add interceptors if needed
axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle errors globally
    return Promise.reject(error);
  }
);

module.exports = axiosClient;
