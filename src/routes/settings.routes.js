const router = require("express").Router();
const settingsController = require("../controllers/settings.controller");
const auth = require("../middleware/auth");
const requirePermission = require("../middleware/requirePermission");

router.get("/", auth, settingsController.get);
router.put("/", auth, requirePermission("settings.edit"), settingsController.update);

module.exports = router;
