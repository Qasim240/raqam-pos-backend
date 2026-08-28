const router = require("express").Router();
const ctrl = require("../controllers/paymentVoucher.controller");
const auth = require("../middleware/auth");
const requirePermission = require("../middleware/requirePermission");

router.get("/", auth, ctrl.getAll);
router.get("/:id", auth, ctrl.getById);
router.post("/", auth, requirePermission("payments.create"), ctrl.create);
router.post("/:id/cancel", auth, requirePermission("payments.cancel"), ctrl.cancel);

module.exports = router;
