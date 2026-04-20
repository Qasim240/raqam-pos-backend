const router = require("express").Router();
const productController = require("../controllers/product.controller");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

router.get("/", auth, productController.getAll);
router.post("/", auth, productController.create);
router.put("/:id", auth, productController.update);
router.delete("/:id", auth, adminOnly, productController.remove);

module.exports = router;
