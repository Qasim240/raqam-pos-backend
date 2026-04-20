const router = require("express").Router();
const categoryController = require("../controllers/category.controller");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

router.get("/", auth, categoryController.getAll);
router.post("/", auth, categoryController.create);
router.put("/:id", auth, categoryController.update);
router.delete("/:id", auth, adminOnly, categoryController.remove);

module.exports = router;
