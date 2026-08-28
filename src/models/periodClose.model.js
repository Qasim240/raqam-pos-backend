const mongoose = require("mongoose");

// Append-only audit log of every "close" / "reopen" action.
// Settings.accountingClosedThroughDate holds the current effective state;
// this collection is just history.
const periodCloseSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["close", "reopen"], required: true },
    // The date the period boundary was moved TO (inclusive end-of-day for "close",
    // start-of-day-of-following-day for "reopen" — practically: the new
    // accountingClosedThroughDate after this action).
    throughDate: { type: Date, required: true },
    by: { id: String, name: String },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PeriodClose", periodCloseSchema);
