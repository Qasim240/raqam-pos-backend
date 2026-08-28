const VoucherCounter = require("../models/voucherCounter.model");
const { VOUCHER_PREFIX } = require("../models/journalEntry.model");

const PAD = 5; // SV-00001

/**
 * Atomically increment the counter for the given source kind and return
 * the formatted voucher number ("SV-00001", "JV-00042", ...).
 * Safe under concurrent calls.
 */
async function nextVoucherNumber(sourceKind) {
  const prefix = VOUCHER_PREFIX[sourceKind] || "JV";
  const doc = await VoucherCounter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `${prefix}-${String(doc.seq).padStart(PAD, "0")}`;
}

module.exports = { nextVoucherNumber };
