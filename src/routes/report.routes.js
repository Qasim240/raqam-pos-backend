const router = require("express").Router();
const reportController = require("../controllers/report.controller");
const auth = require("../middleware/auth");

router.get("/daily", auth, reportController.getDailyReport);
router.get("/monthly", auth, reportController.getMonthlyReport);

module.exports = router;
