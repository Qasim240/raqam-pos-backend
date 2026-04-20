const ApiError = require("../utils/ApiError");
const Admin = require("../models/admin.model");

const adminOnly = async (req, res, next) => {
  try {
    // req.admin is set by the auth middleware
    if (!req.admin) {
      return next(new ApiError(401, "Not authenticated"));
    }

    // Check if the user is from the Admin model (admins registered via /auth/register)
    const isAdmin = await Admin.findById(req.admin._id);
    if (isAdmin) {
      return next(); // Admin model users are always admins
    }

    // If from User model, check the role field
    if (req.admin.role === "admin") {
      return next();
    }

    return next(new ApiError(403, "Only admins can perform this action"));
  } catch (err) {
    next(new ApiError(403, "Only admins can perform this action"));
  }
};

module.exports = adminOnly;
