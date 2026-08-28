const mongoose = require("mongoose");

// "received" → customer pays the shop (Dr Cash/Bank, Cr Customer Receivable)
// "paid"     → shop pays a supplier (Dr Supplier Payable, Cr Cash/Bank)
const DIRECTIONS = ["received", "paid"];
const METHODS = ["cash", "bank"];

const allocationSchema = new mongoose.Schema(
  {
    // Optional: the sale (or purchase, future) this allocation reduces.
    refKind: { type: String, enum: ["sale", "purchase"], default: "sale" },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const paymentVoucherSchema = new mongoose.Schema(
  {
    voucherNumber: { type: String, default: null, index: true },
    date: { type: Date, default: Date.now, index: true },
    direction: { type: String, enum: DIRECTIONS, required: true },
    // The party account (customer-typed for "received", supplier-typed for "paid")
    partyAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartAccount",
      required: true,
    },
    // Snapshot of party display info so the voucher list never shows blank
    partyName: { type: String, default: "" },
    partyPhone: { type: String, default: "" },

    method: { type: String, enum: METHODS, required: true },
    // The cash/bank account the money landed in / came from
    methodAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartAccount",
      required: true,
    },
    // Optional bank name when method === 'bank' (e.g. "HBL", "Meezan").
    // Free text, informational — shown on the voucher / receipt.
    bankName: { type: String, trim: true, default: "" },

    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "" },

    // Optional invoice-level breakdown. If omitted/empty, the JE still
    // posts to the party's running balance — allocations are informational.
    allocations: { type: [allocationSchema], default: [] },

    postedBy: { id: String, name: String },

    // Linked JE (filled in after posting)
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

paymentVoucherSchema.pre("validate", function () {
  if (!(this.amount > 0)) {
    throw new Error("Payment amount must be greater than 0");
  }
  if (Array.isArray(this.allocations) && this.allocations.length > 0) {
    const allocSum = this.allocations.reduce(
      (s, a) => s + (Number(a.amount) || 0),
      0
    );
    if (allocSum > this.amount + 0.01) {
      throw new Error(
        `Allocations (${allocSum.toFixed(2)}) exceed payment amount (${this.amount.toFixed(2)})`
      );
    }
  }
});

module.exports = mongoose.model("PaymentVoucher", paymentVoucherSchema);
module.exports.DIRECTIONS = DIRECTIONS;
module.exports.METHODS = METHODS;
