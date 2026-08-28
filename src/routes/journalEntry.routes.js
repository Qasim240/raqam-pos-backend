const router = require("express").Router();
const ctrl = require("../controllers/journalEntry.controller");
const auth = require("../middleware/auth");
const requirePermission = require("../middleware/requirePermission");

router.get("/", auth, ctrl.getAll);
router.get("/:id", auth, ctrl.getById);
router.post("/", auth, requirePermission("accounts.manage"), ctrl.create);
router.post("/:id/reverse", auth, requirePermission("accounts.manage"), ctrl.reverse);

module.exports = router;
