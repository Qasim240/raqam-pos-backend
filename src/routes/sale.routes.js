const router = require("express").Router();
const saleController = require("../controllers/sale.controller");
const auth = require("../middleware/auth");

router.get("/", auth, saleController.getAll);
router.post("/", auth, saleController.create);
router.get("/customer/:phone", auth, saleController.getByCustomerPhone);
router.get("/:id", auth, saleController.getById);

module.exports = router;
