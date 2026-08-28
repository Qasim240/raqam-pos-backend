/**
 * End-to-end accounting smoke test.
 *
 * Walks through the whole stack against the live DB:
 *   1. Loads/seeds default accounts
 *   2. Creates an udhaar (credit) sale → verifies JE
 *   3. Receives a customer payment → verifies customer balance drops
 *   4. Creates a manual JE → verifies + reverses it
 *   5. Closes a period → verifies a backdated sale is rejected
 *   6. Reopens the period → verifies the sale now succeeds
 *   7. Records a credit purchase → verifies inventory + supplier accrual
 *   8. Trial balance balances
 *   9. Cleans up everything it created
 *
 * Run: node src/scripts/testAccounting.js
 *
 * Exits non-zero on any failure. Prints a green check / red X per step.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const ChartAccount = require("../models/chartAccount.model");
const JournalEntry = require("../models/journalEntry.model");
const PaymentVoucher = require("../models/paymentVoucher.model");
const Purchase = require("../models/purchase.model");
const Sale = require("../models/sale.model");
const Product = require("../models/product.model");
const Settings = require("../models/settings.model");
const PeriodClose = require("../models/periodClose.model");

const { postSaleJE, postReturnJE } = require("../services/posting/saleposting");
const { postPaymentVoucherJE } = require("../services/posting/paymentposting");
const { postPurchaseJE } = require("../services/posting/purchaseposting");
const { ensureCustomerAccount, ensureSupplierAccount, codeForCustomer, codeForSupplier } = require("../services/parties.service");
const periodService = require("../services/period.service");
const { nextVoucherNumber } = require("../services/voucher.service");

const TEST_PHONE = "9999000001";
const TEST_SUPPLIER_PHONE = "9999000002";
const TEST_PRODUCT_NAME = "ACCOUNTING-TEST-PRODUCT";

let pass = 0;
let fail = 0;
const results = [];
const created = { saleIds: [], jeIds: [], voucherIds: [], purchaseIds: [], productIds: [], accountCodes: [], periodLogIds: [] };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function ok(label, detail = "") {
  pass += 1;
  results.push(`  \x1b[32m✓\x1b[0m ${label}${detail ? "  \x1b[90m" + detail + "\x1b[0m" : ""}`);
}
function bad(label, detail = "") {
  fail += 1;
  results.push(`  \x1b[31m✗\x1b[0m ${label}${detail ? "  \x1b[90m" + detail + "\x1b[0m" : ""}`);
}
function step(name) {
  results.push(`\n\x1b[36m▸ ${name}\x1b[0m`);
}

async function balanceOf(accountId) {
  // Sum all non-reversed JE lines + opening
  const acc = await ChartAccount.findById(accountId);
  if (!acc) return 0;
  const rows = await JournalEntry.aggregate([
    { $match: { reversed: false } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": acc._id } },
    { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  const t = rows[0] || { debit: 0, credit: 0 };
  const isDebitNormal = ChartAccount.isDebitNormal(acc.type);
  const opening = isDebitNormal
    ? (acc.openingDebit - acc.openingCredit)
    : (acc.openingCredit - acc.openingDebit);
  const movement = isDebitNormal ? (t.debit - t.credit) : (t.credit - t.debit);
  return r2(opening + movement);
}

async function trialBalance() {
  const rows = await JournalEntry.aggregate([
    { $match: { reversed: false } },
    { $unwind: "$lines" },
    { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  return rows[0] || { debit: 0, credit: 0 };
}

async function ensureSettings() {
  const s = await Settings.findOne();
  if (!s || !s.defaultCashAccountId || !s.defaultSalesIncomeAccountId || !s.defaultSalesReturnAccountId
        || !s.defaultCustomerReceivableAccountId || !s.defaultInventoryAccountId) {
    throw new Error(
      "Settings defaults are not wired. Run `node src/scripts/seed.js` (or seed.js) first.",
    );
  }
  return s;
}

async function ensureTestProduct() {
  let p = await Product.findOne({ name: TEST_PRODUCT_NAME });
  if (!p) {
    p = await Product.create({
      name: TEST_PRODUCT_NAME,
      sku: "TEST-SKU-" + Date.now(),
      category: "Test",
      purchasePrice: 100,
      salePrice: 150,
      stock: 0,
    });
    created.productIds.push(p._id);
  }
  return p;
}

// ─── Test steps ─────────────────────────────────────────

async function testCreditSaleAndJE(settings, product) {
  step("Credit sale → JE posted to customer receivable");
  const customer = await ensureCustomerAccount({ phone: TEST_PHONE, name: "Test Customer" });
  if (!customer) {
    bad("ensureCustomerAccount returned null");
    return null;
  }
  ok("Customer account auto-created/loaded", customer.code);
  if (!created.accountCodes.includes(customer.code)) created.accountCodes.push(customer.code);

  const balanceBefore = await balanceOf(customer._id);

  const sale = await Sale.create({
    items: [{ productId: product._id.toString(), name: product.name, price: 200, quantity: 1, sku: product.sku }],
    subtotal: 200,
    discountType: "fixed",
    discountValue: 0,
    discountAmount: 0,
    total: 200,
    cashReceived: 0,
    change: 0,
    cashierId: "test-cashier",
    cashierName: "Test Cashier",
    customerPhone: TEST_PHONE,
    customerName: "Test Customer",
    paymentMethods: [],
    creditAmount: 200,
    creditCustomer: "Test Customer",
  });
  created.saleIds.push(sale._id);
  ok("Sale created", sale._id.toString());

  const result = await postSaleJE(sale);
  if (!result.posted) {
    bad("Sale JE post failed", result.reason);
    return null;
  }
  created.jeIds.push(result.entryId);
  ok("Sale JE posted", result.voucherNumber);

  const je = await JournalEntry.findById(result.entryId);
  if (!je) {
    bad("Posted JE not findable");
    return null;
  }

  const totalDebit = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) < 0.01) ok("JE is balanced", `Dr=${totalDebit} Cr=${totalCredit}`);
  else bad("JE unbalanced", `Dr=${totalDebit} Cr=${totalCredit}`);

  if (je.locked) ok("JE locked at creation");
  else bad("JE not locked");

  const debitsCustomer = je.lines.some(l =>
    l.accountId.toString() === customer._id.toString() && (l.debit || 0) === 200);
  if (debitsCustomer) ok("Debits the customer account by 200");
  else bad("Customer not debited correctly");

  const creditsSalesIncome = je.lines.some(l =>
    l.accountId.toString() === settings.defaultSalesIncomeAccountId && (l.credit || 0) === 200);
  if (creditsSalesIncome) ok("Credits Sales Income by 200");
  else bad("Sales Income not credited");

  const balanceAfter = await balanceOf(customer._id);
  if (Math.abs((balanceAfter - balanceBefore) - 200) < 0.01) ok("Customer balance increased by 200");
  else bad("Customer balance delta wrong", `before=${balanceBefore} after=${balanceAfter}`);

  return { customer, sale };
}

async function testCustomerPayment(settings, customer) {
  step("Receive customer payment → balance drops");
  const balanceBefore = await balanceOf(customer._id);

  const voucher = await PaymentVoucher.create({
    direction: "received",
    partyAccountId: customer._id,
    partyName: customer.name,
    partyPhone: customer.mobile || TEST_PHONE,
    method: "cash",
    methodAccountId: settings.defaultCashAccountId,
    amount: 80,
    notes: "Smoke-test partial payment",
    postedBy: { id: "test-admin", name: "Test Admin" },
  });
  created.voucherIds.push(voucher._id);
  ok("Payment voucher created", voucher._id.toString());

  const result = await postPaymentVoucherJE(voucher);
  if (!result.posted) {
    bad("Payment JE post failed", result.reason);
    return;
  }
  voucher.journalEntryId = result.entryId;
  voucher.voucherNumber = result.voucherNumber;
  await voucher.save();
  created.jeIds.push(result.entryId);
  ok("Payment JE posted", result.voucherNumber);

  const balanceAfter = await balanceOf(customer._id);
  if (Math.abs((balanceBefore - balanceAfter) - 80) < 0.01) ok("Customer balance decreased by 80");
  else bad("Customer balance delta wrong", `before=${balanceBefore} after=${balanceAfter}`);
}

async function testManualJEAndReverse(settings) {
  step("Manual JE create → balanced, then reverse");
  const cash = settings.defaultCashAccountId;
  const expense = await ChartAccount.findOne({ code: "5010" });
  if (!expense) { bad("Default expense account 5010 missing"); return; }

  const voucherNumber = await nextVoucherNumber("manual");
  const je = await JournalEntry.create({
    voucherNumber,
    voucherType: "JV",
    date: new Date(),
    memo: "Test expense",
    lines: [
      { accountId: expense._id, debit: 50, credit: 0, memo: "Stationery" },
      { accountId: cash, debit: 0, credit: 50, memo: "Paid cash" },
    ],
    source: { kind: "manual" },
    postedBy: { id: "test-admin", name: "Test Admin" },
    auditLog: [{ action: "create", by: { id: "test-admin", name: "Test Admin" }, at: new Date(), note: "Smoke test" }],
  });
  created.jeIds.push(je._id);
  ok("Manual JE created", voucherNumber);

  // Try unbalanced — must reject
  let unbalancedRejected = false;
  try {
    await JournalEntry.create({
      voucherType: "JV",
      lines: [
        { accountId: expense._id, debit: 10, credit: 0 },
        { accountId: cash, debit: 0, credit: 5 },
      ],
      source: { kind: "manual" },
    });
  } catch (err) {
    if (/[Uu]nbalanced/.test(err.message)) unbalancedRejected = true;
  }
  if (unbalancedRejected) ok("Unbalanced JE was rejected at validation");
  else bad("Unbalanced JE was NOT rejected");

  // Reverse the original
  const revVoucherNumber = await nextVoucherNumber("manual");
  const reversal = await JournalEntry.create({
    voucherNumber: revVoucherNumber,
    voucherType: "JV",
    date: new Date(),
    memo: `Reversal of ${je.voucherNumber}`,
    lines: je.lines.map(l => ({
      accountId: l.accountId,
      debit: l.credit || 0,
      credit: l.debit || 0,
      memo: `Reversal: ${l.memo || ""}`.trim(),
    })),
    source: { kind: "manual", refId: je._id },
    postedBy: { id: "test-admin", name: "Test Admin" },
  });
  created.jeIds.push(reversal._id);
  je.reversed = true;
  je.reversedBy = reversal._id;
  await je.save();
  ok("Reversal JE posted, original marked reversed", revVoucherNumber);
}

async function testPeriodCloseAndReject(settings, product) {
  step("Period close blocks backdated entries");

  // Close through yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const closeAt = await periodService.closeThroughDate({
    date: yesterday,
    by: { id: "test-admin", name: "Test Admin" },
    note: "smoke-test close",
  });
  ok("Closed period through yesterday", closeAt.toISOString().slice(0, 10));

  // Capture the audit log row that just got created
  const recentLog = await PeriodClose.findOne({ note: "smoke-test close" }).sort({ createdAt: -1 });
  if (recentLog) created.periodLogIds.push(recentLog._id);

  // Try a backdated entry — must reject
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const lockReason = await periodService.isDateLocked(twoDaysAgo);
  if (lockReason) ok("isDateLocked() rejects backdated date", lockReason);
  else bad("isDateLocked() did NOT reject backdated date");

  // Today should still be allowed (we closed through yesterday)
  const todayCheck = await periodService.isDateLocked(new Date());
  if (!todayCheck) ok("Today is NOT in the locked period");
  else bad("Today incorrectly rejected", todayCheck);

  // Reopen to two-days-ago — this makes anything from twoDaysAgo onward editable.
  // Semantics: reopenToDate(X) sets the boundary to "1 ms before start of X",
  // so X and everything after is editable; days strictly before X stay locked.
  const reopenAt = await periodService.reopenToDate({
    date: twoDaysAgo,
    by: { id: "test-admin", name: "Test Admin" },
    note: "smoke-test reopen",
  });
  ok("Reopened to two-days-ago", reopenAt ? reopenAt.toISOString() : "null");
  const reopenLog = await PeriodClose.findOne({ note: "smoke-test reopen" }).sort({ createdAt: -1 });
  if (reopenLog) created.periodLogIds.push(reopenLog._id);

  // The reopen target itself (twoDaysAgo, end-of-day) should now be allowed
  const reopenedDate = new Date(twoDaysAgo);
  reopenedDate.setHours(23, 59, 59, 999);
  const recheck = await periodService.isDateLocked(reopenedDate);
  if (!recheck) ok("After reopen, two-days-ago is editable again");
  else bad("After reopen, two-days-ago STILL rejected", recheck);

  // Fully clear the boundary so we don't leave the DB in a half-locked state
  const finalReopen = await periodService.reopenToDate({
    date: null,
    by: { id: "test-admin", name: "Test Admin" },
    note: "smoke-test full reopen",
  });
  ok("Boundary fully cleared", finalReopen ? finalReopen.toISOString() : "null");
  const finalReopenLog = await PeriodClose.findOne({ note: "smoke-test full reopen" }).sort({ createdAt: -1 });
  if (finalReopenLog) created.periodLogIds.push(finalReopenLog._id);

  // Suppress unused var warnings
  void settings;
  void product;
}

async function testCreditPurchase(settings, product) {
  step("Credit purchase → inventory up, supplier payable up");

  const supplier = await ensureSupplierAccount({ phone: TEST_SUPPLIER_PHONE, name: "Test Supplier" });
  if (!supplier) { bad("ensureSupplierAccount returned null"); return; }
  if (!created.accountCodes.includes(supplier.code)) created.accountCodes.push(supplier.code);

  const inventoryBefore = await balanceOf(settings.defaultInventoryAccountId);
  const supplierBefore = await balanceOf(supplier._id);
  const stockBefore = (await Product.findById(product._id)).stock;

  const purchase = await Purchase.create({
    date: new Date(),
    supplierAccountId: supplier._id,
    supplierName: supplier.name,
    supplierPhone: supplier.mobile || TEST_SUPPLIER_PHONE,
    items: [{
      productId: product._id.toString(),
      name: product.name,
      sku: product.sku,
      quantity: 5,
      unitCost: 100,
      lineTotal: 500,
    }],
    subtotal: 500,
    discountAmount: 0,
    taxAmount: 0,
    total: 500,
    paid: 0,
    paidMethod: "none",
    createdBy: { id: "test-admin", name: "Test Admin" },
  });
  created.purchaseIds.push(purchase._id);
  ok("Purchase created", purchase._id.toString());

  await Product.findByIdAndUpdate(product._id, { $inc: { stock: 5 } });

  const result = await postPurchaseJE(purchase);
  if (!result.posted) { bad("Purchase JE post failed", result.reason); return; }
  purchase.journalEntryId = result.entryId;
  purchase.voucherNumber = result.voucherNumber;
  await purchase.save();
  created.jeIds.push(result.entryId);
  ok("Purchase JE posted", result.voucherNumber);

  const inventoryAfter = await balanceOf(settings.defaultInventoryAccountId);
  const supplierAfter = await balanceOf(supplier._id);
  const stockAfter = (await Product.findById(product._id)).stock;

  if (Math.abs((inventoryAfter - inventoryBefore) - 500) < 0.01) ok("Inventory account ↑ by 500");
  else bad("Inventory delta wrong", `before=${inventoryBefore} after=${inventoryAfter}`);

  if (Math.abs((supplierAfter - supplierBefore) - 500) < 0.01) ok("Supplier payable ↑ by 500");
  else bad("Supplier delta wrong", `before=${supplierBefore} after=${supplierAfter}`);

  if (stockAfter - stockBefore === 5) ok("Product stock ↑ by 5");
  else bad("Stock delta wrong", `before=${stockBefore} after=${stockAfter}`);
}

async function testTrialBalance() {
  step("Trial balance");
  const tb = await trialBalance();
  if (Math.abs(tb.debit - tb.credit) < 0.01) ok("Books balance globally", `Dr=${r2(tb.debit)} Cr=${r2(tb.credit)}`);
  else bad("Books are out of balance", `Dr=${r2(tb.debit)} Cr=${r2(tb.credit)}`);
}

async function cleanup() {
  step("Cleanup test data");
  await Sale.deleteMany({ _id: { $in: created.saleIds } });
  await JournalEntry.deleteMany({ _id: { $in: created.jeIds } });
  // Also wipe any reversal JEs that might point to our test entries
  await JournalEntry.deleteMany({ "source.refId": { $in: [...created.saleIds, ...created.purchaseIds, ...created.voucherIds] } });
  await PaymentVoucher.deleteMany({ _id: { $in: created.voucherIds } });
  await Purchase.deleteMany({ _id: { $in: created.purchaseIds } });
  await Product.deleteMany({ _id: { $in: created.productIds } });
  await ChartAccount.deleteMany({ code: { $in: created.accountCodes } });
  await PeriodClose.deleteMany({ _id: { $in: created.periodLogIds } });
  ok("Cleanup complete");
}

async function main() {
  const uri = process.env.DB_URI;
  if (!uri) {
    console.error("DB_URI is not set in environment.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Connected to MongoDB\n");

  let exitCode = 0;
  try {
    const settings = await ensureSettings();
    const product = await ensureTestProduct();

    const sale = await testCreditSaleAndJE(settings, product);
    if (sale) await testCustomerPayment(settings, sale.customer);
    await testManualJEAndReverse(settings);
    await testPeriodCloseAndReject(settings, product);
    await testCreditPurchase(settings, product);
    await testTrialBalance();
  } catch (err) {
    bad("Fatal error during tests", err.message);
    console.error(err);
    exitCode = 1;
  } finally {
    try { await cleanup(); } catch (err) { console.error("Cleanup error:", err.message); }
    await mongoose.disconnect();
  }

  console.log(results.join("\n"));
  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (fail > 0) exitCode = 1;
  process.exit(exitCode);
}

main();
