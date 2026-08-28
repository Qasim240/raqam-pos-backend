const router = require("express").Router();
const ctrl = require("../controllers/period.controller");
const auth = require("../middleware/auth");
const requirePermission = require("../middleware/requirePermission");

// Status + history are visible to anyone authenticated (so the UI can
// show the locked-through marker). Mutations gated on per-permission flag.
router.get("/status", auth, ctrl.status);
router.get("/history", auth, ctrl.history);
router.post("/close", auth, requirePermission("period.close"), ctrl.close);
router.post("/reopen", auth, requirePermission("period.reopen"), ctrl.reopen);

module.exports = router;
