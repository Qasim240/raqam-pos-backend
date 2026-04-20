const mongoose = require("mongoose");
const config = require("./index");

const connectDB = async () => {
  try {
    await mongoose.connect(config.db.uri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("DB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;