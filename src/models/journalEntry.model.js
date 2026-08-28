const mongoose = require("mongoose");

const SOURCE_KINDS = ["sale", "return", "manual", "opening", "payment", "purchase"];

// Voucher prefix per source. Used for auto-generated voucher numbers.
const VOUCHER_PREFIX = {
  sale: "SV",
  return: "RV",
  manual: "JV",
  opening: "OV",
  payment: "CV",
  purchase: "PV",
};

const journalLineSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartAccount",
      required: true,
    },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    memo: { type: String, default: "" },
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    voucherNumber: { type: String, default: null, index: true },
    voucherType: {
      type: String,
      enum: Object.values(VOUCHER_PREFIX),
      default: "JV",
    },
    date: { type: Date, default: Date.now, index: true },
    memo: { type: String, default: "" },
    narration: { type: String, default: "" },
    lines: { type: [journalLineSchema], required: true },
    source: {
      kind: { type: String, enum: SOURCE_KINDS, required: true },
      refId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true,
      },
    },
    postedBy: {
      id: { type: String, default: "" },
      name: { type: String, default: "" },
    },
    // Audit log: every edit / reverse appended here.
    auditLog: [
      {
        action: { type: String }, // "create" | "edit" | "reverse"
        by: { id: String, name: String },
        at: { type: Date, default: Date.now },
        note: { type: String, default: "" },
      },
    ],
    // Locked entries are immutable. Sale/return/payment auto-postings lock immediately.
    locked: { type: Boolean, default: false },
    lockedAt: { type: Date, default: null },
    reversed: { type: Boolean, default: false },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
  },
  { timestamps: true }
);

journalEntrySchema.pre("validate", function () {
  if (!Array.isArray(this.lines) || this.lines.length < 2) {
    throw new Error("Journal entry must have at least 2 lines");
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of this.lines) {
    const d = Number(line.debit) || 0;
    const c = Number(line.credit) || 0;
    if (d < 0 || c < 0) throw new Error("Line amounts cannot be negative");
    if (d > 0 && c > 0)
      throw new Error("A line cannot have both debit and credit");
    if (d === 0 && c === 0)
      throw new Error("A line must have a non-zero debit or credit");
    totalDebit += d;
    totalCredit += c;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Unbalanced entry: debit=${totalDebit.toFixed(
        2
      )} credit=${totalCredit.toFixed(2)}`
    );
  }
});

module.exports = mongoose.model("JournalEntry", journalEntrySchema);
module.exports.SOURCE_KINDS = SOURCE_KINDS;
module.exports.VOUCHER_PREFIX = VOUCHER_PREFIX;
