const JournalEntry = require("../../models/journalEntry.model");
const ChartAccount = require("../../models/chartAccount.model");
const { isAccountPostable } = require("./defaults");
const { nextVoucherNumber } = require("../voucher.service");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Post the journal entry for a payment voucher.
 *
 *   "received" (customer pays):  Dr methodAccount (Cash/Bank)
 *                                Cr partyAccount (Customer)
 *
 *   "paid"     (supplier paid):  Dr partyAccount (Supplier)
 *                                Cr methodAccount (Cash/Bank)
 *
 * Voucher type is "CV" if method=cash, "BV" if method=bank, regardless of direction.
 *
 * Best-effort: never throws. Returns { posted, reason?, entryId?, voucherNumber? }.
 */
async function postPaymentVoucherJE(voucher) {
  try {
    if (!voucher || !voucher._id) return { posted: false, reason: "no-voucher" };
    const amount = r2(voucher.amount);
    if (amount <= 0) return { posted: false, reason: "zero-amount" };

    if (!voucher.partyAccountId || !voucher.methodAccountId) {
      return { posted: false, reason: "missing-accounts" };
    }
    const [party, methodAcc] = await Promise.all([
      ChartAccount.findById(voucher.partyAccountId),
      ChartAccount.findById(voucher.methodAccountId),
    ]);
    if (!party || !methodAcc) return { posted: false, reason: "account-not-found" };
    if (!(await isAccountPostable(voucher.partyAccountId)) ||
        !(await isAccountPostable(voucher.methodAccountId))) {
      return { posted: false, reason: "account-not-postable" };
    }

    const isReceived = voucher.direction === "received";
    const debitId = isReceived ? methodAcc._id : party._id;
    const creditId = isReceived ? party._id : methodAcc._id;
    const debitMemo = isReceived
      ? `Received from ${party.name}`
      : `Paid to ${party.name}`;
    const creditMemo = isReceived
      ? `Settles receivable ${party.name}`
      : `Settles payable ${party.name}`;

    // Voucher type: CV for cash, BV for bank
    const sourceKind = "payment";
    const voucherNumberRaw = await nextVoucherNumber(sourceKind);
    // nextVoucherNumber currently uses the "payment" → CV prefix mapping.
    // For bank receipts we substitute the prefix to BV for clarity.
    const voucherNumber =
      voucher.method === "bank"
        ? voucherNumberRaw.replace(/^CV-/, "BV-")
        : voucherNumberRaw;
    const voucherType = voucher.method === "bank" ? "BV" : "CV";

    const memoLine = isReceived
      ? `Receipt ${voucherNumber} — ${party.name}`
      : `Payment ${voucherNumber} — ${party.name}`;

    const entry = await JournalEntry.create({
      voucherNumber,
      voucherType,
      date: voucher.date || new Date(),
      memo: memoLine,
      narration: voucher.notes || "",
      lines: [
        { accountId: debitId, debit: amount, credit: 0, memo: debitMemo },
        { accountId: creditId, debit: 0, credit: amount, memo: creditMemo },
      ],
      source: { kind: sourceKind, refId: voucher._id },
      postedBy: voucher.postedBy || { id: "", name: "" },
      locked: true,
      lockedAt: new Date(),
      auditLog: [
        {
          action: "create",
          by: voucher.postedBy || { id: "", name: "" },
          at: new Date(),
          note: `Auto-posted from payment voucher (${voucher.direction})`,
        },
      ],
    });
    return {
      posted: true,
      entryId: entry._id.toString(),
      voucherNumber,
      voucherType,
    };
  } catch (err) {
    console.error("[posting] postPaymentVoucherJE error:", err.message);
    return { posted: false, reason: "error", error: err.message };
  }
}

/**
 * Reverse a previously-posted payment voucher's JE by creating an offsetting JE
 * (and marking the original as reversed via the existing JE flow).
 */
async function reversePaymentVoucherJE(voucher, by = { id: "", name: "" }) {
  try {
    if (!voucher.journalEntryId) return { posted: false, reason: "no-original-je" };
    const original = await JournalEntry.findById(voucher.journalEntryId);
    if (!original) return { posted: false, reason: "original-je-missing" };
    if (original.reversed) return { posted: false, reason: "already-reversed" };

    const reversedLines = original.lines.map((ln) => ({
      accountId: ln.accountId,
      debit: ln.credit || 0,
      credit: ln.debit || 0,
      memo: `Reversal: ${ln.memo || ""}`.trim(),
    }));

    const voucherNumberRaw = await nextVoucherNumber("manual");
    const reversal = await JournalEntry.create({
      voucherNumber: voucherNumberRaw,
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
          note: `Reversal of payment voucher ${original.voucherNumber || ""}`,
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
      note: `Reversed by ${voucherNumberRaw}`,
    });
    await original.save();

    return { posted: true, entryId: reversal._id.toString(), voucherNumber: voucherNumberRaw };
  } catch (err) {
    console.error("[posting] reversePaymentVoucherJE error:", err.message);
    return { posted: false, reason: "error", error: err.message };
  }
}

module.exports = { postPaymentVoucherJE, reversePaymentVoucherJE };
