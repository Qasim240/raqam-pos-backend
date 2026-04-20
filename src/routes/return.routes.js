const router = require("express").Router();
const returnController = require("../controllers/return.controller");
const auth = require("../middleware/auth");

router.get("/", auth, returnController.getAll);
router.post("/", auth, returnController.create);
router.get("/:id", auth, returnController.getById);

module.exports = router;
