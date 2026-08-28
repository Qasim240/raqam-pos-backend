const Purchase = require("../models/purchase.model");
const Product = require("../models/product.model");
const ChartAccount = require("../models/chartAccount.model");
const ApiError = require("../utils/ApiError");
const {
  postPurchaseJE,
  reversePurchaseJE,
} = require("../services/posting/purchaseposting");
const { isDateLocked } = require("../services/period.service");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const formatPurchase = (p) => ({
  id: p._id.toString(),
  voucherNumber: p.voucherNumber || "",
  date: p.date.toISOString(),
  supplierAccountId: p.supplierAccountId ? p.supplierAccountId.toString() : null,
  supplierName: p.supplierName || "",
  supplierPhone: p.supplierPhone || "",
  supplierInvoiceNo: p.supplierInvoiceNo || "",
  items: (p.items || []).map((i) => ({
    productId: i.productId,
    name: i.name,
    sku: i.sku || "",
    quantity: i.quantity,
    unitCost: r2(i.unitCost),
    lineTotal: r2(i.lineTotal),
  })),
  subtotal: r2(p.subtotal),
  discountAmount: r2(p.discountAmount || 0),
  taxAmount: r2(p.taxAmount || 0),
  total: r2(p.total),
  paid: r2(p.paid || 0),
  paidMethod: p.paidMethod || "none",
  paidMethodAccountId: p.paidMethodAccountId
    ? p.paidMethodAccountId.toString()
    : null,
  balance: r2((p.total || 0) - (p.paid || 0)),
  notes: p.notes || "",
  createdBy: p.createdBy || { id: "", name: "" },
  journalEntryId: p.journalEntryId ? p.journalEntryId.toString() : null,
  cancelled: !!p.cancelled,
  cancelledAt: p.cancelledAt ? p.cancelledAt.toISOString() : null,
  cancelledBy: p.cancelledBy || { id: "", name: "" },
  reversalEntryId: p.reversalEntryId ? p.reversalEntryId.toString() : null,
  createdAt: p.createdAt ? p.createdAt.toISOString() : null,
});

// GET /api/purchases
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.supplierAccountId) filter.supplierAccountId = req.query.supplierAccountId;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const purchases = await Purchase.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit);
    res.json({ success: true, data: purchases.map(formatPurchase) });
  } catch (err) {
    next(err);
  }
};

// GET /api/purchases/:id
exports.getById = async (req, res, next) => {
  try {
    const p = await Purchase.findById(req.params.id);
    if (!p) return next(new ApiError(404, "Purchase not found"));
    res.json({ success: true, data: formatPurchase(p) });
  } catch (err) {
    next(err);
  }
};

// POST /api/purchases
exports.create = async (req, res, next) => {
  try {
    const {
      date,
      supplierAccountId,
      supplierInvoiceNo,
      items,
      discountAmount,
      taxAmount,
      paid,
      paidMethod,
      paidMethodAccountId,
      notes,
    } = req.body;

    if (!supplierAccountId)
      return next(new ApiError(400, "supplierAccountId is required"));
    if (!Array.isArray(items) || items.length === 0)
      return next(new ApiError(400, "At least one item is required"));

    const lockReason = await isDateLocked(date || new Date());
    if (lockReason) return next(new ApiError(400, lockReason));

    const supplier = await ChartAccount.findById(supplierAccountId);
    if (!supplier) return next(new ApiError(400, "Supplier account not found"));
    if (supplier.type !== "supplier") {
      return next(
        new ApiError(400, `Account ${supplier.code} is not a supplier (type=${supplier.type})`)
      );
    }

    // Resolve item details from product DB to snapshot name/sku reliably
    const productIds = items.map((i) => i.productId).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } });
    const productById = new Map(products.map((p) => [p._id.toString(), p]));

    const cleanItems = items.map((i, idx) => {
      const product = productById.get(String(i.productId));
      if (!product) throw new Error(`Item ${idx + 1}: product not found`);
      const qty = Number(i.quantity);
      const cost = Number(i.unitCost);
      if (!(qty > 0)) throw new Error(`Item ${idx + 1}: quantity must be > 0`);
      if (!(cost >= 0)) throw new Error(`Item ${idx + 1}: unit cost must be >= 0`);
      const lineTotal = r2(qty * cost);
      return {
        productId: product._id.toString(),
        name: product.name,
        sku: product.sku || "",
        quantity: qty,
        unitCost: r2(cost),
        lineTotal,
      };
    });

    const subtotal = r2(cleanItems.reduce((s, i) => s + i.lineTotal, 0));
    const disc = r2(discountAmount || 0);
    const tax = r2(taxAmount || 0);
    const total = r2(subtotal - disc + tax);
    const paidAmt = r2(paid || 0);
    const method = paidAmt > 0 ? (paidMethod || "cash") : "none";
    let methodAccId = null;
    if (paidAmt > 0) {
      if (!paidMethodAccountId)
        return next(new ApiError(400, "paidMethodAccountId is required when paid > 0"));
      const methodAcc = await ChartAccount.findById(paidMethodAccountId);
      if (!methodAcc)
        return next(new ApiError(400, "Paid method account not found"));
      const expectedType = method === "cash" ? "cash" : "bank";
      if (methodAcc.type !== expectedType && methodAcc.type !== "asset") {
        return next(
          new ApiError(400, `Method account type '${methodAcc.type}' doesn't match payment method '${method}'`)
        );
      }
      methodAccId = methodAcc._id;
    }

    const purchase = await Purchase.create({
      date: date ? new Date(date) : new Date(),
      supplierAccountId,
      supplierName: supplier.name,
      supplierPhone: supplier.mobile || "",
      supplierInvoiceNo: supplierInvoiceNo || "",
      items: cleanItems,
      subtotal,
      discountAmount: disc,
      taxAmount: tax,
      total,
      paid: paidAmt,
      paidMethod: method,
      paidMethodAccountId: methodAccId,
      notes: notes || "",
      createdBy: {
        id: req.admin?._id?.toString() || "",
        name: req.admin?.name || "",
      },
    });

    // Bump stock for each item — best effort, sequential
    for (const item of cleanItems) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: item.quantity },
      });
    }

    // Post the JE — best-effort
    const result = await postPurchaseJE(purchase);
    if (result.posted) {
      purchase.journalEntryId = result.entryId;
      purchase.voucherNumber = result.voucherNumber;
      await purchase.save();
    } else {
      console.warn(
        `[purchases] purchase ${purchase._id} posting failed: ${result.reason}`
      );
    }

    res.status(201).json({
      success: true,
      data: formatPurchase(purchase),
      posting: result,
    });
  } catch (err) {
    if (err.name === "ValidationError")
      return next(new ApiError(400, err.message));
    return next(new ApiError(400, err.message || "Failed to create purchase"));
  }
};

// POST /api/purchases/:id/cancel
exports.cancel = async (req, res, next) => {
  try {
    const p = await Purchase.findById(req.params.id);
    if (!p) return next(new ApiError(404, "Purchase not found"));
    if (p.cancelled) return next(new ApiError(409, "Purchase already cancelled"));

    const lockReason = await isDateLocked(p.date);
    if (lockReason)
      return next(new ApiError(400, `Cannot cancel — purchase ${lockReason.toLowerCase()}`));

    const by = {
      id: req.admin?._id?.toString() || "",
      name: req.admin?.name || "",
    };

    // Reverse the JE first; if that fails, abort cancel so books stay clean.
    const reversal = await reversePurchaseJE(p, by);
    if (!reversal.posted) {
      return next(
        new ApiError(400, `Cancel failed: ${reversal.reason || "unknown"}`)
      );
    }

    // Roll back stock
    for (const item of p.items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity },
      });
    }

    p.cancelled = true;
    p.cancelledAt = new Date();
    p.cancelledBy = by;
    p.reversalEntryId = reversal.entryId;
    await p.save();

    res.json({ success: true, data: formatPurchase(p) });
  } catch (err) {
    next(err);
  }
};
