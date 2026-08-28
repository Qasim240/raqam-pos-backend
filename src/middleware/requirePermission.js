const ApiError = require("../utils/ApiError");
const Admin = require("../models/admin.model");

/**
 * Permission-based route guard. Use as: router.post('/x', auth, requirePermission('foo.bar'), handler)
 *
 * Pass-through rules (in order):
 *   1. Admin-model account → always allow (legacy admin auth path).
 *   2. role:'admin' user → always allow (admins get blanket access).
 *   3. user.permissions[perm] === true → allow.
 *   4. Otherwise → 403.
 */
const requirePermission = (perm) => async (req, res, next) => {
  try {
    if (!req.admin) return next(new ApiError(401, "Not authenticated"));

    // Admin-model accounts always pass
    const isAdminModel = await Admin.findById(req.admin._id);
    if (isAdminModel) return next();

    // role:'admin' user always passes
    if (req.admin.role === "admin") return next();

    // Fall through to per-permission check
    const perms = req.admin.permissions || {};
    if (perms[perm] === true) return next();

    return next(new ApiError(403, `Missing permission: ${perm}`));
  } catch {
    return next(new ApiError(403, "Permission check failed"));
  }
};

module.exports = requirePermission;
