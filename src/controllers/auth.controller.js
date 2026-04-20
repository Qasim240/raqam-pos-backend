const jwt = require("jsonwebtoken");
const config = require("../config");
const Admin = require("../models/admin.model");
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");

// Generate JWT token
const generateToken = (id, type) => {
  return jwt.sign({ id, type }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return next(new ApiError(400, "All fields are required"));
    }

    if (password.length < 6) {
      return next(new ApiError(400, "Password must be at least 6 characters"));
    }

    const exists = await Admin.findOne({ email });
    if (exists) {
      return next(new ApiError(409, "Email already registered"));
    }

    const admin = await Admin.create({ name, email, password });

    res.status(201).json({
      success: true,
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        token: generateToken(admin._id, "admin"),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new ApiError(400, "Email and password are required"));
    }

    // Try Admin model first
    const admin = await Admin.findOne({ email });
    if (admin) {
      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
        return next(new ApiError(401, "Invalid email or password"));
      }

      return res.json({
        success: true,
        data: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: "admin",
          token: generateToken(admin._id, "admin"),
        },
      });
    }

    // Try User model
    const user = await User.findOne({ email });
    if (!user) {
      return next(new ApiError(401, "Invalid email or password"));
    }

    if (!user.isActive) {
      return next(new ApiError(403, "Account is deactivated"));
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return next(new ApiError(401, "Invalid email or password"));
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        token: generateToken(user._id, "user"),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me  (protected)
exports.getMe = async (req, res) => {
  res.json({
    success: true,
    data: req.admin,
  });
};
