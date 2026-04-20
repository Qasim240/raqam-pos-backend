require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/user.model");

const MONGO_URI = process.env.DB_URI;

const adminUser = {
  name: "Admin",
  email: "admin@pos.com",
  password: "admin123",
  role: "admin",
  isActive: true,
};

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const existing = await User.findOne({ email: adminUser.email });
    if (existing) {
      console.log(`User already exists: ${adminUser.email}`);
      process.exit(0);
    }

    const user = await User.create(adminUser);
    console.log("Admin user created successfully:");
    console.log(`  Email   : ${user.email}`);
    console.log(`  Password: admin123`);
    console.log(`  Role    : ${user.role}`);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
