require("dotenv").config();

const config = {
  port: process.env.PORT || 5000,
  env: process.env.NODE_ENV || "development",
  db: {
    uri: process.env.DB_URI || "",
  },
  jwt: {
    secret: process.env.JWT_SECRET || "fallback-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
};

module.exports = config;
