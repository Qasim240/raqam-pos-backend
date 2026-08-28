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
router.use("/accounts", require("./account.routes"));
router.use("/journal-entries", require("./journalEntry.routes"));
router.use("/payment-vouchers", require("./paymentVoucher.routes"));
router.use("/purchases", require("./purchase.routes"));
router.use("/period", require("./period.routes"));

module.exports = router;
