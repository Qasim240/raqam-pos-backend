const mongoose = require("mongoose");

// All supported account types. Customer/Supplier/Cash/Bank are first-class so
// posting code can route to the correct account by type without string matching.
const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
  "customer",
  "supplier",
  "cash",
  "bank",
];

// Types whose normal balance is on the debit side
const DEBIT_NORMAL_TYPES = new Set(["asset", "expense", "customer", "cash", "bank"]);

const chartAccountSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    // Optional series / sub-code (the "S. Code" column in traditional Forms-style
    // chart-of-accounts UIs). Free-form, e.g. "01" or "ASSET-CASH".
    seriesCode: { type: String, trim: true, default: "" },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartAccount",
      default: null,
    },
    // Control accounts cannot themselves receive postings — they only roll up children.
    controlAccount: { type: Boolean, default: false },
    // Setting allowPosting=false blocks any JE from referencing this account.
    allowPosting: { type: Boolean, default: true },
    openingDebit: { type: Number, default: 0, min: 0 },
    openingCredit: { type: Number, default: 0, min: 0 },
    // The date the opening balance is effective from. Optional; informational.
    openingDate: { type: Date, default: null },
    mobile: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    // Free-form per-account rights label (e.g. "Read-only", "All", "Cashier")
    // Surfaced in the COA grid; not enforced server-side beyond allowPosting.
    accountRights: { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chartAccountSchema.pre("save", function () {
  if ((this.openingDebit || 0) > 0 && (this.openingCredit || 0) > 0) {
    throw new Error(
      "Only one of openingDebit or openingCredit may be greater than 0"
    );
  }
  if (this.controlAccount && this.allowPosting) {
    // Defensive: control accounts must not be posted to
    this.allowPosting = false;
  }
});

chartAccountSchema.pre("save", async function () {
  if (!this.parentId) return;
  if (this.parentId.toString() === this._id.toString()) {
    throw new Error("Account cannot be its own parent");
  }
  const seen = new Set([this._id.toString()]);
  let cursor = this.parentId;
  while (cursor) {
    const cursorId = cursor.toString();
    if (seen.has(cursorId)) {
      throw new Error("Circular parent reference detected");
    }
    seen.add(cursorId);
    const parent = await mongoose
      .model("ChartAccount")
      .findById(cursor)
      .select("parentId");
    if (!parent) throw new Error("Parent account does not exist");
    cursor = parent.parentId;
  }
});

chartAccountSchema.statics.ACCOUNT_TYPES = ACCOUNT_TYPES;
chartAccountSchema.statics.DEBIT_NORMAL_TYPES = DEBIT_NORMAL_TYPES;
chartAccountSchema.statics.isDebitNormal = (type) => DEBIT_NORMAL_TYPES.has(type);

module.exports = mongoose.model("ChartAccount", chartAccountSchema);
module.exports.ACCOUNT_TYPES = ACCOUNT_TYPES;
module.exports.DEBIT_NORMAL_TYPES = DEBIT_NORMAL_TYPES;
module.exports.isDebitNormal = (type) => DEBIT_NORMAL_TYPES.has(type);
