const router = require("express").Router();

router.get("/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

router.use("/auth", require("./auth.routes"));
router.use("/categories", require("./category.routes"));
router.use("/products", require("./product.routes"));
router.use("/sales", require("./sale.routes"));
router.use("/users", require("./user.routes"));
router.use("/settings", require("./settings.routes"));
router.use("/returns", require("./return.routes"));
router.use("/reports", require("./report.routes"));

module.exports = router;
