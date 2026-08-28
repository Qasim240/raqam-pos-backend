const mongoose = require("mongoose");

const purchaseItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    sku: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    voucherNumber: { type: String, default: null, index: true },
    date: { type: Date, default: Date.now, index: true },

    // Supplier (a ChartAccount of type 'supplier')
    supplierAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartAccount",
      required: true,
    },
    supplierName: { type: String, default: "" },
    supplierPhone: { type: String, default: "" },

    // Optional reference number from the supplier's printed invoice
    supplierInvoiceNo: { type: String, default: "" },

    items: {
      type: [purchaseItemSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "Purchase must have at least one item",
      },
    },

    subtotal: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },

    // Amount paid up-front; the remainder becomes payable to the supplier.
    paid: { type: Number, default: 0, min: 0 },
    paidMethod: { type: String, enum: ["cash", "bank", "none"], default: "none" },
    // The Cash/Bank account the up-front payment touches (null when paid=0)
    paidMethodAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartAccount",
      default: null,
    },

    notes: { type: String, default: "" },

    createdBy: { id: String, name: String },
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },

    cancelled: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { id: String, name: String },
    reversalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
  },
  { timestamps: true }
);

purchaseSchema.pre("validate", function () {
  const sumLines = (this.items || []).reduce(
    (s, i) => s + (Number(i.lineTotal) || 0),
    0
  );
  if (Math.abs(sumLines - this.subtotal) > 0.01) {
    throw new Error(
      `Subtotal (${this.subtotal.toFixed(2)}) doesn't match item line totals (${sumLines.toFixed(2)})`
    );
  }
  const calcTotal = (this.subtotal || 0) - (this.discountAmount || 0) + (this.taxAmount || 0);
  if (Math.abs(calcTotal - this.total) > 0.01) {
    throw new Error(
      `Total (${this.total.toFixed(2)}) doesn't equal subtotal - discount + tax (${calcTotal.toFixed(2)})`
    );
  }
  if ((this.paid || 0) > (this.total || 0) + 0.01) {
    throw new Error(`Paid (${this.paid.toFixed(2)}) exceeds total (${this.total.toFixed(2)})`);
  }
  if ((this.paid || 0) > 0 && this.paidMethod === "none") {
    throw new Error("paidMethod must be cash/bank when paid > 0");
  }
  if ((this.paid || 0) > 0 && !this.paidMethodAccountId) {
    throw new Error("paidMethodAccountId is required when paid > 0");
  }
});

module.exports = mongoose.model("Purchase", purchaseSchema);
