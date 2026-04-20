const jwt = require("jsonwebtoken");
const config = require("../config");
const Admin = require("../models/admin.model");
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return next(new ApiError(401, "No token provided"));
    }

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    // Try Admin model first, then User model
    let account = await Admin.findById(decoded.id).select("-password");

    if (!account) {
      account = await User.findById(decoded.id).select("-password");
    }

    if (!account) {
      return next(new ApiError(401, "Account not found"));
    }

    req.admin = account;
    next();
  } catch (err) {
    next(new ApiError(401, "Invalid token"));
  }
};

module.exports = auth;
