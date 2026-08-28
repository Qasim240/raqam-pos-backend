const router = require("express").Router();
const ctrl = require("../controllers/purchase.controller");
const auth = require("../middleware/auth");
const requirePermission = require("../middleware/requirePermission");

router.get("/", auth, requirePermission("purchases.view"), ctrl.getAll);
router.get("/:id", auth, requirePermission("purchases.view"), ctrl.getById);
router.post("/", auth, requirePermission("purchases.create"), ctrl.create);
router.post("/:id/cancel", auth, requirePermission("purchases.cancel"), ctrl.cancel);

module.exports = router;
