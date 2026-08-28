const Return = require("../models/return.model");
const Product = require("../models/product.model");
const Sale = require("../models/sale.model");
const ApiError = require("../utils/ApiError");
const { postReturnJE } = require("../services/posting.service");
const { isDateLocked } = require("../services/period.service");

const formatReturn = (r) => ({
  id: r._id,
  saleId: r.saleId,
  date: r.date.toISOString(),
  items: r.items,
  subtotal: r.subtotal,
  refundAmount: r.refundAmount,
  reason: r.reason,
  notes: r.notes,
  processedBy: r.processedBy,
  processedByName: r.processedByName,
  status: r.status,
  type: r.type || "return",
  exchangeItems: r.exchangeItems || [],
  exchangeTotal: r.exchangeTotal || 0,
  balanceDue: r.balanceDue || 0,
});

// GET /api/returns
exports.getAll = async (req, res, next) => {
  try {
    const returns = await Return.find().sort({ date: -1 });
    res.json({ success: true, data: returns.map(formatReturn) });
  } catch (err) {
    next(err);
  }
};

// POST /api/returns
exports.create = async (req, res, next) => {
  try {
    const {
      saleId,
      items,
      subtotal,
      refundAmount,
      reason,
      notes,
      processedBy,
      processedByName,
      type,
      exchangeItems,
      exchangeTotal,
      balanceDue,
    } = req.body;

    if (!saleId) {
      return next(new ApiError(400, "Sale ID is required"));
    }

    if (!items || items.length === 0) {
      return next(new ApiError(400, "Return must have at least one item"));
    }

    if (refundAmount == null) {
      return next(new ApiError(400, "Refund amount is required"));
    }

    const lockReason = await isDateLocked(new Date());
    if (lockReason) return next(new ApiError(400, lockReason));

    // Verify the sale exists
    const sale = await Sale.findById(saleId);
    if (!sale) {
      return next(new ApiError(404, "Original sale not found"));
    }

    // Create the return/exchange record
    const returnRecord = await Return.create({
      saleId,
      date: new Date(),
      items,
      subtotal: subtotal || 0,
      refundAmount,
      reason: reason || "customer_change",
      notes,
      processedBy,
      processedByName,
      status: "approved",
      type: type || "return",
      exchangeItems: exchangeItems || [],
      exchangeTotal: exchangeTotal || 0,
      balanceDue: balanceDue || 0,
    });

    // Restore stock for returned items
    for (const item of items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: item.quantity },
      });
    }

    // Deduct stock for exchange items
    if (exchangeItems && exchangeItems.length > 0) {
      for (const item of exchangeItems) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { stock: -item.quantity },
        });
      }
    }

    // Best-effort accounting post — never fails the return
    postReturnJE(returnRecord).catch((err) =>
      console.error("[posting] return JE post failed:", err.message)
    );

    res.status(201).json({ success: true, data: formatReturn(returnRecord) });
  } catch (err) {
    next(err);
  }
};

// GET /api/returns/:id
exports.getById = async (req, res, next) => {
  try {
    const returnRecord = await Return.findById(req.params.id);

    if (!returnRecord) {
      return next(new ApiError(404, "Return not found"));
    }

    res.json({ success: true, data: formatReturn(returnRecord) });
  } catch (err) {
    next(err);
  }
};
