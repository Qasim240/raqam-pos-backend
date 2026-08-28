const Settings = require("../models/settings.model");
const ApiError = require("../utils/ApiError");
const periodService = require("../services/period.service");

const formatLog = (l) => ({
  id: l._id.toString(),
  action: l.action,
  throughDate: l.throughDate ? l.throughDate.toISOString() : null,
  by: l.by || { id: "", name: "" },
  note: l.note || "",
  at: l.createdAt ? l.createdAt.toISOString() : null,
});

// GET /api/period/status
exports.status = async (req, res, next) => {
  try {
    const settings = await Settings.findOne();
    res.json({
      success: true,
      data: {
        closedThroughDate: settings?.accountingClosedThroughDate
          ? settings.accountingClosedThroughDate.toISOString()
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/period/history
exports.history = async (req, res, next) => {
  try {
    const items = await periodService.getHistory(parseInt(req.query.limit) || 100);
    res.json({ success: true, data: items.map(formatLog) });
  } catch (err) {
    next(err);
  }
};

// POST /api/period/close   { date, note }
exports.close = async (req, res, next) => {
  try {
    const { date, note } = req.body;
    if (!date) return next(new ApiError(400, "date is required"));
    const through = await periodService.closeThroughDate({
      date,
      by: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
      note,
    });
    res.json({
      success: true,
      data: { closedThroughDate: through.toISOString() },
    });
  } catch (err) {
    return next(new ApiError(400, err.message || "Close failed"));
  }
};

// POST /api/period/reopen  { date | null, note }
exports.reopen = async (req, res, next) => {
  try {
    const { date, note } = req.body;
    const newBoundary = await periodService.reopenToDate({
      date: date || null,
      by: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
      note,
    });
    res.json({
      success: true,
      data: {
        closedThroughDate: newBoundary ? newBoundary.toISOString() : null,
      },
    });
  } catch (err) {
    return next(new ApiError(400, err.message || "Reopen failed"));
  }
};
