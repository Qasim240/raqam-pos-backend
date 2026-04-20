const router = require("express").Router();
const userController = require("../controllers/user.controller");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

router.get("/", auth, userController.getAll);
router.post("/", auth, adminOnly, userController.create);
router.put("/:id", auth, userController.update);
router.delete("/:id", auth, adminOnly, userController.remove);
router.put("/:id/role", auth, adminOnly, userController.updateRole);
router.put("/:id/permissions", auth, adminOnly, userController.updatePermissions);

module.exports = router;
