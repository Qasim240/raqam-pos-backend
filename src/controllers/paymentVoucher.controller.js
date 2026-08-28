const PaymentVoucher = require("../models/paymentVoucher.model");
const ChartAccount = require("../models/chartAccount.model");
const ApiError = require("../utils/ApiError");
const {
  postPaymentVoucherJE,
  reversePaymentVoucherJE,
} = require("../services/posting/paymentposting");
const { isDateLocked } = require("../services/period.service");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const formatVoucher = (v) => ({
  id: v._id.toString(),
  voucherNumber: v.voucherNumber || "",
  date: v.date.toISOString(),
  direction: v.direction,
  partyAccountId: v.partyAccountId ? v.partyAccountId.toString() : null,
  partyName: v.partyName || "",
  partyPhone: v.partyPhone || "",
  method: v.method,
  methodAccountId: v.methodAccountId ? v.methodAccountId.toString() : null,
  bankName: v.bankName || "",
  amount: r2(v.amount),
  notes: v.notes || "",
  allocations: (v.allocations || []).map((a) => ({
    refKind: a.refKind || "sale",
    refId: a.refId ? a.refId.toString() : null,
    amount: r2(a.amount),
    note: a.note || "",
  })),
  postedBy: v.postedBy || { id: "", name: "" },
  journalEntryId: v.journalEntryId ? v.journalEntryId.toString() : null,
  cancelled: !!v.cancelled,
  cancelledAt: v.cancelledAt ? v.cancelledAt.toISOString() : null,
  cancelledBy: v.cancelledBy || { id: "", name: "" },
  reversalEntryId: v.reversalEntryId ? v.reversalEntryId.toString() : null,
  createdAt: v.createdAt ? v.createdAt.toISOString() : null,
});

// GET /api/payment-vouchers
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.direction) filter.direction = req.query.direction;
    if (req.query.partyAccountId) filter.partyAccountId = req.query.partyAccountId;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const vouchers = await PaymentVoucher.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit);
    res.json({ success: true, data: vouchers.map(formatVoucher) });
  } catch (err) {
    next(err);
  }
};

// GET /api/payment-vouchers/:id
exports.getById = async (req, res, next) => {
  try {
    const v = await PaymentVoucher.findById(req.params.id);
    if (!v) return next(new ApiError(404, "Payment voucher not found"));
    res.json({ success: true, data: formatVoucher(v) });
  } catch (err) {
    next(err);
  }
};

// POST /api/payment-vouchers
exports.create = async (req, res, next) => {
  try {
    const {
      date,
      direction,
      partyAccountId,
      method,
      methodAccountId,
      bankName,
      amount,
      notes,
      allocations,
    } = req.body;

    if (!direction || !["received", "paid"].includes(direction))
      return next(new ApiError(400, "direction must be 'received' or 'paid'"));
    if (!method || !["cash", "bank"].includes(method))
      return next(new ApiError(400, "method must be 'cash' or 'bank'"));
    if (!partyAccountId)
      return next(new ApiError(400, "partyAccountId is required"));
    if (!methodAccountId)
      return next(new ApiError(400, "methodAccountId is required"));
    if (!(amount > 0))
      return next(new ApiError(400, "amount must be > 0"));

    const lockReason = await isDateLocked(date || new Date());
    if (lockReason) return next(new ApiError(400, lockReason));

    // Validate parties
    const party = await ChartAccount.findById(partyAccountId);
    if (!party) return next(new ApiError(400, "Party account not found"));
    if (direction === "received" && party.type !== "customer") {
      return next(
        new ApiError(400, `Party for 'received' must be a customer account (got ${party.type})`)
      );
    }
    if (direction === "paid" && party.type !== "supplier") {
      return next(
        new ApiError(400, `Party for 'paid' must be a supplier account (got ${party.type})`)
      );
    }

    const methodAcc = await ChartAccount.findById(methodAccountId);
    if (!methodAcc) return next(new ApiError(400, "Method account not found"));
    const expectedMethodType = method === "cash" ? "cash" : "bank";
    // Allow asset-typed accounts as a fallback for shops that haven't migrated to typed accounts.
    if (methodAcc.type !== expectedMethodType && methodAcc.type !== "asset") {
      return next(
        new ApiError(400, `Method account type '${methodAcc.type}' doesn't match payment method '${method}'`)
      );
    }

    const voucher = await PaymentVoucher.create({
      date: date ? new Date(date) : new Date(),
      direction,
      partyAccountId,
      bankName: method === "bank" ? (bankName || "").trim() : "",
      partyName: party.name,
      partyPhone: party.mobile || "",
      method,
      methodAccountId,
      amount: r2(amount),
      notes: notes || "",
      allocations: Array.isArray(allocations)
        ? allocations.map((a) => ({
            refKind: a.refKind || "sale",
            refId: a.refId || null,
            amount: r2(a.amount),
            note: a.note || "",
          }))
        : [],
      postedBy: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
    });

    // Post the JE. If posting fails we keep the voucher but mark journalEntryId null.
    const result = await postPaymentVoucherJE(voucher);
    if (result.posted) {
      voucher.journalEntryId = result.entryId;
      voucher.voucherNumber = result.voucherNumber;
      await voucher.save();
    } else {
      console.warn(
        `[payments] voucher ${voucher._id} posting failed: ${result.reason}`
      );
    }

    res.status(201).json({
      success: true,
      data: formatVoucher(voucher),
      posting: result,
    });
  } catch (err) {
    if (err.name === "ValidationError")
      return next(new ApiError(400, err.message));
    return next(new ApiError(400, err.message || "Failed to create payment voucher"));
  }
};

// POST /api/payment-vouchers/:id/cancel
exports.cancel = async (req, res, next) => {
  try {
    const v = await PaymentVoucher.findById(req.params.id);
    if (!v) return next(new ApiError(404, "Payment voucher not found"));
    if (v.cancelled) return next(new ApiError(409, "Voucher already cancelled"));

    const lockReason = await isDateLocked(v.date);
    if (lockReason)
      return next(new ApiError(400, `Cannot cancel — voucher ${lockReason.toLowerCase()}`));

    const by = {
      id: req.admin?._id?.toString() || "",
      name: req.admin?.name || "",
    };
    const reversal = await reversePaymentVoucherJE(v, by);
    if (!reversal.posted) {
      return next(
        new ApiError(400, `Cancel failed: ${reversal.reason || "unknown"}`)
      );
    }
    v.cancelled = true;
    v.cancelledAt = new Date();
    v.cancelledBy = by;
    v.reversalEntryId = reversal.entryId;
    await v.save();

    res.json({ success: true, data: formatVoucher(v) });
  } catch (err) {
    next(err);
  }
};
