const JournalEntry = require("../models/journalEntry.model");
const ChartAccount = require("../models/chartAccount.model");
const ApiError = require("../utils/ApiError");
const { nextVoucherNumber } = require("../services/voucher.service");
const { isDateLocked } = require("../services/period.service");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const formatEntry = (e, accountMap) => ({
  id: e._id.toString(),
  voucherNumber: e.voucherNumber || "",
  voucherType: e.voucherType || "JV",
  date: e.date.toISOString(),
  memo: e.memo || "",
  narration: e.narration || "",
  lines: e.lines.map((ln) => ({
    accountId: ln.accountId.toString(),
    accountCode: accountMap?.get(ln.accountId.toString())?.code || "",
    accountName: accountMap?.get(ln.accountId.toString())?.name || "",
    debit: r2(ln.debit),
    credit: r2(ln.credit),
    memo: ln.memo || "",
  })),
  source: {
    kind: e.source?.kind || "manual",
    refId: e.source?.refId ? e.source.refId.toString() : null,
  },
  postedBy: e.postedBy || { id: "", name: "" },
  locked: !!e.locked,
  lockedAt: e.lockedAt ? e.lockedAt.toISOString() : null,
  reversed: !!e.reversed,
  reversedBy: e.reversedBy ? e.reversedBy.toString() : null,
  auditLog: (e.auditLog || []).map((a) => ({
    action: a.action,
    by: a.by || { id: "", name: "" },
    at: a.at ? new Date(a.at).toISOString() : null,
    note: a.note || "",
  })),
  totalDebit: r2(e.lines.reduce((s, l) => s + (l.debit || 0), 0)),
  totalCredit: r2(e.lines.reduce((s, l) => s + (l.credit || 0), 0)),
  createdAt: e.createdAt ? e.createdAt.toISOString() : null,
});

async function buildAccountMap(entries) {
  const ids = new Set();
  for (const e of entries) for (const ln of e.lines) ids.add(ln.accountId.toString());
  if (!ids.size) return new Map();
  const accounts = await ChartAccount.find({ _id: { $in: [...ids] } }).select("code name");
  return new Map(accounts.map((a) => [a._id.toString(), a]));
}

// GET /api/journal-entries?source=sale&from=&to=
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.source) filter["source.kind"] = req.query.source;
    if (req.query.refId) filter["source.refId"] = req.query.refId;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const entries = await JournalEntry.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit);
    const accountMap = await buildAccountMap(entries);
    res.json({
      success: true,
      data: entries.map((e) => formatEntry(e, accountMap)),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/journal-entries/:id
exports.getById = async (req, res, next) => {
  try {
    const e = await JournalEntry.findById(req.params.id);
    if (!e) return next(new ApiError(404, "Journal entry not found"));
    const accountMap = await buildAccountMap([e]);
    res.json({ success: true, data: formatEntry(e, accountMap) });
  } catch (err) {
    next(err);
  }
};

// POST /api/journal-entries  (manual entries only)
exports.create = async (req, res, next) => {
  try {
    const { date, memo, narration, lines } = req.body;
    if (!Array.isArray(lines) || lines.length < 2)
      return next(new ApiError(400, "At least 2 lines are required"));

    const lockReason = await isDateLocked(date || new Date());
    if (lockReason) return next(new ApiError(400, lockReason));

    // Validate referenced accounts exist + active + accept postings
    const accountIds = [...new Set(lines.map((l) => l.accountId).filter(Boolean))];
    if (accountIds.length === 0)
      return next(new ApiError(400, "Lines must reference accounts"));
    const accounts = await ChartAccount.find({ _id: { $in: accountIds } });
    if (accounts.length !== accountIds.length)
      return next(new ApiError(400, "One or more accounts not found"));
    const inactive = accounts.find((a) => a.isActive === false);
    if (inactive)
      return next(new ApiError(400, `Account ${inactive.code} is inactive`));
    const blocked = accounts.find((a) => a.controlAccount || a.allowPosting === false);
    if (blocked)
      return next(
        new ApiError(400, `Account ${blocked.code} does not accept postings`)
      );

    const cleanLines = lines.map((l) => ({
      accountId: l.accountId,
      debit: r2(l.debit || 0),
      credit: r2(l.credit || 0),
      memo: l.memo || "",
    }));

    const voucherNumber = await nextVoucherNumber("manual");
    const entry = await JournalEntry.create({
      voucherNumber,
      voucherType: "JV",
      date: date ? new Date(date) : new Date(),
      memo: memo || "",
      narration: narration || "",
      lines: cleanLines,
      source: { kind: "manual", refId: null },
      postedBy: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
      auditLog: [
        {
          action: "create",
          by: {
            id: req.admin?._id?.toString() || "",
            name: req.admin?.name || "",
          },
          at: new Date(),
          note: "Manual entry",
        },
      ],
    });
    const accountMap = await buildAccountMap([entry]);
    res.status(201).json({ success: true, data: formatEntry(entry, accountMap) });
  } catch (err) {
    if (err.name === "ValidationError")
      return next(new ApiError(400, err.message));
    return next(new ApiError(400, err.message || "Failed"));
  }
};

// POST /api/journal-entries/:id/reverse
exports.reverse = async (req, res, next) => {
  try {
    const original = await JournalEntry.findById(req.params.id);
    if (!original) return next(new ApiError(404, "Journal entry not found"));
    if (original.reversed)
      return next(new ApiError(409, "Entry already reversed"));

    const lockReason = await isDateLocked(original.date);
    if (lockReason)
      return next(new ApiError(400, `Cannot reverse — original entry ${lockReason.toLowerCase()}`));

    const reversedLines = original.lines.map((ln) => ({
      accountId: ln.accountId,
      debit: ln.credit || 0,
      credit: ln.debit || 0,
      memo: `Reversal: ${ln.memo || ""}`.trim(),
    }));

    const voucherNumber = await nextVoucherNumber("manual");
    const reversal = await JournalEntry.create({
      voucherNumber,
      voucherType: "JV",
      date: new Date(),
      memo: `Reversal of ${original.voucherNumber || original._id}`,
      lines: reversedLines,
      source: { kind: "manual", refId: original._id },
      postedBy: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
      auditLog: [
        {
          action: "create",
          by: {
            id: req.admin?._id?.toString() || "",
            name: req.admin?.name || "",
          },
          at: new Date(),
          note: `Reversal of ${original.voucherNumber || original._id}`,
        },
      ],
    });

    original.reversed = true;
    original.reversedBy = reversal._id;
    original.auditLog = original.auditLog || [];
    original.auditLog.push({
      action: "reverse",
      by: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
      at: new Date(),
      note: `Reversed by ${voucherNumber}`,
    });
    await original.save();

    const accountMap = await buildAccountMap([reversal]);
    res
      .status(201)
      .json({ success: true, data: formatEntry(reversal, accountMap) });
  } catch (err) {
    if (err.name === "ValidationError")
      return next(new ApiError(400, err.message));
    return next(new ApiError(400, err.message || "Failed"));
  }
};
