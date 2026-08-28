const JournalEntry = require("../../models/journalEntry.model");
const ChartAccount = require("../../models/chartAccount.model");
const { loadDefaults, isAccountPostable } = require("./defaults");
const { nextVoucherNumber } = require("../voucher.service");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Post a journal entry for a purchase. Best-effort: never throws.
 *
 *   Dr Inventory   total
 *   Cr Cash/Bank   paid           (when paid > 0)
 *   Cr Supplier    (total - paid) (when remainder > 0)
 *
 * Returns { posted, reason?, entryId?, voucherNumber? }.
 */
async function postPurchaseJE(purchase) {
  try {
    if (!purchase || !purchase._id) return { posted: false, reason: "no-purchase" };
    const total = r2(purchase.total);
    if (total <= 0) return { posted: false, reason: "zero-total" };

    const defaults = await loadDefaults();
    const inventoryId =
      purchase.inventoryAccountId ||
      (await loadInventoryDefault());
    if (!inventoryId) {
      console.warn(
        `[posting] purchase ${purchase._id} skipped: defaultInventoryAccountId missing`
      );
      return { posted: false, reason: "defaults-missing-inventory" };
    }
    if (!(await isAccountPostable(inventoryId))) {
      console.warn(
        `[posting] purchase ${purchase._id} skipped: inventory account not postable`
      );
      return { posted: false, reason: "inventory-not-postable" };
    }

    const supplier = await ChartAccount.findById(purchase.supplierAccountId);
    if (!supplier) return { posted: false, reason: "supplier-account-missing" };

    const paid = r2(purchase.paid || 0);
    const remainder = r2(total - paid);

    if (paid > 0) {
      if (!(await isAccountPostable(purchase.paidMethodAccountId))) {
        return { posted: false, reason: "paid-method-account-not-postable" };
      }
    }
    if (remainder > 0) {
      if (!(await isAccountPostable(supplier._id))) {
        return { posted: false, reason: "supplier-account-not-postable" };
      }
    }

    const lines = [
      { accountId: inventoryId, debit: total, credit: 0, memo: "Inventory purchase" },
    ];
    if (paid > 0) {
      lines.push({
        accountId: purchase.paidMethodAccountId,
        debit: 0,
        credit: paid,
        memo: purchase.paidMethod === "bank" ? "Paid via bank" : "Paid in cash",
      });
    }
    if (remainder > 0) {
      lines.push({
        accountId: supplier._id,
        debit: 0,
        credit: remainder,
        memo: `Payable to ${supplier.name}`,
      });
    }

    const voucherNumber = await nextVoucherNumber("purchase");
    const entry = await JournalEntry.create({
      voucherNumber,
      voucherType: "PV",
      date: purchase.date || new Date(),
      memo: `Purchase ${voucherNumber} — ${supplier.name}`,
      narration: purchase.supplierInvoiceNo
        ? `Supplier invoice: ${purchase.supplierInvoiceNo}`
        : "",
      lines,
      source: { kind: "purchase", refId: purchase._id },
      postedBy: purchase.createdBy || { id: "", name: "" },
      locked: true,
      lockedAt: new Date(),
      auditLog: [
        {
          action: "create",
          by: purchase.createdBy || { id: "", name: "" },
          at: new Date(),
          note: "Auto-posted from purchase",
        },
      ],
    });
    return { posted: true, entryId: entry._id.toString(), voucherNumber };
  } catch (err) {
    console.error("[posting] postPurchaseJE error:", err.message);
    return { posted: false, reason: "error", error: err.message };
  }
}

async function loadInventoryDefault() {
  const Settings = require("../../models/settings.model");
  const s = await Settings.findOne();
  return s?.defaultInventoryAccountId || null;
}

/**
 * Reverse a previously-posted purchase JE — produces an offsetting entry
 * and marks the original as reversed.
 */
async function reversePurchaseJE(purchase, by = { id: "", name: "" }) {
  try {
    if (!purchase.journalEntryId) return { posted: false, reason: "no-original-je" };
    const original = await JournalEntry.findById(purchase.journalEntryId);
    if (!original) return { posted: false, reason: "original-je-missing" };
    if (original.reversed) return { posted: false, reason: "already-reversed" };

    const reversedLines = original.lines.map((ln) => ({
      accountId: ln.accountId,
      debit: ln.credit || 0,
      credit: ln.debit || 0,
      memo: `Reversal: ${ln.memo || ""}`.trim(),
    }));

    const voucherNumber = await nextVoucherNumber("manual");
    const reversal = await JournalEntry.create({
      voucherNumber,
      voucherType: "JV",
      date: new Date(),
      memo: `Reversal of ${original.voucherNumber || original._id}`,
      lines: reversedLines,
      source: { kind: "manual", refId: original._id },
      postedBy: by,
      auditLog: [
        {
          action: "create",
          by,
          at: new Date(),
          note: `Reversal of purchase ${original.voucherNumber || ""}`,
        },
      ],
    });
    original.reversed = true;
    original.reversedBy = reversal._id;
    original.auditLog = original.auditLog || [];
    original.auditLog.push({
      action: "reverse",
      by,
      at: new Date(),
      note: `Reversed by ${voucherNumber}`,
    });
    await original.save();

    return { posted: true, entryId: reversal._id.toString(), voucherNumber };
  } catch (err) {
    console.error("[posting] reversePurchaseJE error:", err.message);
    return { posted: false, reason: "error", error: err.message };
  }
}

module.exports = { postPurchaseJE, reversePurchaseJE };
