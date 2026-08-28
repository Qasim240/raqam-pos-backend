const Sale = require("../models/sale.model");
const Product = require("../models/product.model");
const ApiError = require("../utils/ApiError");
const { postSaleJE } = require("../services/posting.service");
const { ensureCustomerAccount } = require("../services/parties.service");
const { isDateLocked } = require("../services/period.service");

const formatSale = (s) => ({
  id: s._id,
  date: s.date.toISOString(),
  items: s.items,
  subtotal: s.subtotal,
  discountType: s.discountType,
  discountValue: s.discountValue,
  discountAmount: s.discountAmount,
  total: s.total,
  cashReceived: s.cashReceived,
  change: s.change,
  cashierId: s.cashierId,
  cashierName: s.cashierName,
  customerPhone: s.customerPhone || "",
  customerName: s.customerName || "",
  paymentMethods: (s.paymentMethods || []).map((p) => ({
    method: p.method,
    amount: p.amount,
  })),
  creditAmount: s.creditAmount || 0,
  creditCustomer: s.creditCustomer || "",
  taxAmount: s.taxAmount || 0,
  taxMode: s.taxMode || "none",
  taxRate: s.taxRate || 0,
});

// GET /api/sales
exports.getAll = async (req, res, next) => {
  try {
    const sales = await Sale.find().sort({ date: -1 });
    res.json({ success: true, data: sales.map(formatSale) });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales
exports.create = async (req, res, next) => {
  try {
    const {
      date,
      items,
      subtotal,
      discountType,
      discountValue,
      discountAmount,
      total,
      cashReceived,
      change,
      cashierId,
      cashierName,
      customerPhone,
      customerName,
      paymentMethods,
      creditAmount,
      creditCustomer,
      taxAmount,
      taxMode,
      taxRate,
    } = req.body;

    if (!items || items.length === 0) {
      return next(new ApiError(400, "Sale must have at least one item"));
    }

    if (total == null || cashReceived == null) {
      return next(new ApiError(400, "Total and cashReceived are required"));
    }

    const lockReason = await isDateLocked(date || new Date());
    if (lockReason) return next(new ApiError(400, lockReason));

    const sale = await Sale.create({
      date: date || new Date(),
      items,
      subtotal,
      discountType: discountType || "fixed",
      discountValue: discountValue || 0,
      discountAmount: discountAmount || 0,
      total,
      cashReceived,
      change: change || 0,
      cashierId,
      cashierName,
      customerPhone: customerPhone || "",
      customerName: customerName || "",
      paymentMethods: Array.isArray(paymentMethods) ? paymentMethods : [],
      creditAmount: creditAmount || 0,
      creditCustomer: creditCustomer || "",
      taxAmount: taxAmount || 0,
      taxMode: taxMode || "none",
      taxRate: taxRate || 0,
    });

    // Deduct stock for each item
    for (const item of items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity },
      });
    }

    // Best-effort: ensure a customer account exists when a phone was captured.
    if (sale.customerPhone) {
      ensureCustomerAccount({
        phone: sale.customerPhone,
        name: sale.customerName,
      }).catch((err) =>
        console.error("[parties] ensureCustomerAccount failed:", err.message)
      );
    }

    // Best-effort accounting post — never fails the sale
    postSaleJE(sale).catch((err) =>
      console.error("[posting] sale JE post failed:", err.message)
    );

    res.status(201).json({ success: true, data: formatSale(sale) });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/:id
exports.getById = async (req, res, next) => {
  try {
    const sale = await Sale.findById(req.params.id);

    if (!sale) {
      return next(new ApiError(404, "Sale not found"));
    }

    res.json({ success: true, data: formatSale(sale) });
  } catch (err) {
    next(err);
  }
};

// GET /api/sales/customer/:phone
exports.getByCustomerPhone = async (req, res, next) => {
  try {
    const phone = req.params.phone;
    const sales = await Sale.find({
      customerPhone: { $regex: phone, $options: "i" },
    }).sort({ date: -1 });

    res.json({ success: true, data: sales.map(formatSale) });
  } catch (err) {
    next(err);
  }
};
