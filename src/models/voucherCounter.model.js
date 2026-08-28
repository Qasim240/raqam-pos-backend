const mongoose = require("mongoose");

// One row per voucher prefix (SV, RV, JV, CV, BV, PV, OV).
// `seq` is incremented atomically via $inc to avoid races.
const voucherCounterSchema = new mongoose.Schema(
  {
    _id: { type: String }, // the prefix
    seq: { type: Number, default: 0 },
  },
  { collection: "vouchercounters" }
);

module.exports = mongoose.model("VoucherCounter", voucherCounterSchema);
