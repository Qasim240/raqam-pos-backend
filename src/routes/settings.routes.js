const router = require("express").Router();
const settingsController = require("../controllers/settings.controller");
const auth = require("../middleware/auth");

router.get("/", auth, settingsController.get);
router.put("/", auth, settingsController.update);

module.exports = router;
