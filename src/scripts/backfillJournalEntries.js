// Idempotent backfill:
//   1. Creates a customer ChartAccount for any historical sale.customerPhone that doesn't have one.
//   2. Posts journal entries for any historical sales/returns that don't already have one.
//
// Safe to re-run.
//
// Usage: node src/scripts/backfillJournalEntries.js

require("dotenv").config();
const mongoose = require("mongoose");
const Sale = require("../models/sale.model");
const Return = require("../models/return.model");
const JournalEntry = require("../models/journalEntry.model");
const { postSaleJE, postReturnJE } = require("../services/posting.service");
const { ensureCustomerAccount } = require("../services/parties.service");

const MONGO_URI = process.env.DB_URI;

async function backfill() {
  if (!MONGO_URI) {
    console.error("DB_URI is not set in environment");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  // ── 1. Customer accounts ──────────────────────────────────
  const phones = await Sale.distinct("customerPhone", { customerPhone: { $nin: [null, ""] } });
  console.log(`\nProcessing ${phones.length} unique customer phone(s)…`);
  let custCreated = 0;
  for (const phone of phones) {
    const sample = await Sale.findOne({ customerPhone: phone }).select("customerName");
    const before = await require("../models/chartAccount.model").exists({ code: `CUST-${phone.replace(/\D/g, "")}` });
    await ensureCustomerAccount({ phone, name: sample?.customerName || "" });
    if (!before) custCreated += 1;
  }
  console.log(`  customer accounts: ${custCreated} new, ${phones.length - custCreated} already present`);

  // ── 2. Sale journal entries ───────────────────────────────
  let salePosted = 0, saleSkipped = 0, saleFailed = 0;
  const sales = await Sale.find().sort({ date: 1 });
  console.log(`\nProcessing ${sales.length} sale(s)…`);
  for (const sale of sales) {
    const existing = await JournalEntry.exists({
      "source.kind": "sale",
      "source.refId": sale._id,
    });
    if (existing) { saleSkipped += 1; continue; }
    const result = await postSaleJE(sale);
    if (result.posted) salePosted += 1;
    else {
      saleFailed += 1;
      console.warn(`  sale ${sale._id} not posted: ${result.reason}`);
    }
  }

  // ── 3. Return journal entries ─────────────────────────────
  let retPosted = 0, retSkipped = 0, retFailed = 0;
  const returns = await Return.find().sort({ date: 1 });
  console.log(`\nProcessing ${returns.length} return(s)…`);
  for (const r of returns) {
    const existing = await JournalEntry.exists({
      "source.kind": "return",
      "source.refId": r._id,
    });
    if (existing) { retSkipped += 1; continue; }
    const result = await postReturnJE(r);
    if (result.posted) retPosted += 1;
    else {
      retFailed += 1;
      console.warn(`  return ${r._id} not posted: ${result.reason}`);
    }
  }

  console.log("\n=== Backfill summary ===");
  console.log(`Customers: ${custCreated} created, ${phones.length - custCreated} already present`);
  console.log(`Sales:     posted=${salePosted}  skipped=${saleSkipped}  failed=${saleFailed}`);
  console.log(`Returns:   posted=${retPosted}  skipped=${retSkipped}  failed=${retFailed}`);

  await mongoose.disconnect();
  process.exit(0);
}

backfill().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
