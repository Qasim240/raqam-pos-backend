const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const { DEFAULT_ROLE_PERMISSIONS } = require("../config/permissions");

// Helper to format user response (exclude password)
const formatUser = (u) => ({
  id: u._id,
  name: u.name,
  nameAr: u.nameAr,
  email: u.email,
  role: u.role,
  permissions: u.permissions,
  createdAt: u.createdAt,
  lastLogin: u.lastLogin,
  isActive: u.isActive,
});

// GET /api/users
exports.getAll = async (req, res, next) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json({ success: true, data: users.map(formatUser) });
  } catch (err) {
    next(err);
  }
};

// POST /api/users
exports.create = async (req, res, next) => {
  try {
    const { name, nameAr, email, password, role, permissions, isActive } = req.body;

    if (!name || !email || !password) {
      return next(new ApiError(400, "Name, email, and password are required"));
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return next(new ApiError(409, "Email already registered"));
    }

    const finalRole = role || "staff";
    const finalPermissions =
      permissions && Object.keys(permissions).length > 0
        ? permissions
        : DEFAULT_ROLE_PERMISSIONS[finalRole] || {};

    const user = await User.create({
      name,
      nameAr,
      email,
      password,
      role: finalRole,
      permissions: finalPermissions,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json({ success: true, data: formatUser(user) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/:id
exports.update = async (req, res, next) => {
  try {
    const updates = { ...req.body };

    // If password is being updated, hash it manually
    if (updates.password) {
      const bcrypt = require("bcryptjs");
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return next(new ApiError(404, "User not found"));
    }

    res.json({ success: true, data: formatUser(user) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/users/:id
exports.remove = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return next(new ApiError(404, "User not found"));
    }

    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/:id/role
exports.updateRole = async (req, res, next) => {
  try {
    const { role, permissions } = req.body;

    if (!role) {
      return next(new ApiError(400, "Role is required"));
    }

    const finalPermissions =
      permissions && Object.keys(permissions).length > 0
        ? permissions
        : DEFAULT_ROLE_PERMISSIONS[role] || {};

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role, permissions: finalPermissions },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return next(new ApiError(404, "User not found"));
    }

    res.json({ success: true, data: formatUser(user) });
  } catch (err) {
    next(err);
  }
};

// PUT /api/users/:id/permissions
exports.updatePermissions = async (req, res, next) => {
  try {
    const { permissions } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { permissions },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return next(new ApiError(404, "User not found"));
    }

    res.json({ success: true, data: formatUser(user) });
  } catch (err) {
    next(err);
  }
};
