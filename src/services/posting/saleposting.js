const JournalEntry = require("../../models/journalEntry.model");
const { loadDefaults, isAccountPostable } = require("./defaults");
const { nextVoucherNumber } = require("../voucher.service");
const { ensureCustomerAccount } = require("../parties.service");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build debit lines for a sale. Routes amounts per payment method:
 *   - cash         → defaults.cash
 *   - card/wallet  → defaults.bank
 *   - credit       → customer's own ChartAccount (auto-created)
 *
 * Returns { lines, missing[] } where `missing` lists any required default
 * accounts that weren't configured. If `missing.length > 0`, posting
 * should be aborted upstream.
 *
 * Falls back to legacy "all cash" when no paymentMethods are provided.
 */
async function buildDebitLines(sale, defaults) {
  const total = r2(sale.total);
  const credit = r2(sale.creditAmount || 0);
  const methods = Array.isArray(sale.paymentMethods) ? sale.paymentMethods : [];
  const missing = [];

  // Sum of paid via payment methods
  const cashAmt = r2(methods.filter((m) => m.method === "cash").reduce((s, m) => s + (m.amount || 0), 0));
  const bankAmt = r2(methods.filter((m) => m.method === "card" || m.method === "wallet").reduce((s, m) => s + (m.amount || 0), 0));

  // Legacy fallback: no paymentMethods array → treat full total as cash unless creditAmount is set
  const useLegacy = methods.length === 0 && credit === 0;
  const debits = [];

  const pushCash = (amt) => {
    if (amt <= 0) return;
    if (!defaults.cash) { missing.push("cash"); return; }
    debits.push({ accountId: defaults.cash, amount: amt, memo: "Cash in" });
  };
  const pushBank = (amt) => {
    if (amt <= 0) return;
    if (!defaults.bank) { missing.push("bank"); return; }
    debits.push({ accountId: defaults.bank, amount: amt, memo: "Bank/Card in" });
  };

  if (useLegacy) {
    pushCash(total);
  } else {
    pushCash(cashAmt);
    pushBank(bankAmt);
  }

  // Credit / udhaar leg → customer receivable account
  if (credit > 0) {
    if (!sale.customerPhone) {
      missing.push("customer-phone-required-for-credit");
    } else {
      const customerAccount = await ensureCustomerAccount({
        phone: sale.customerPhone,
        name: sale.customerName,
      });
      if (!customerAccount) {
        missing.push("customer-account-create-failed");
      } else {
        debits.push({
          accountId: customerAccount._id,
          amount: credit,
          memo: `Receivable from ${customerAccount.name}`,
        });
      }
    }
  }

  return { lines: debits, missing };
}

/**
 * Post a journal entry for a sale. Best-effort: never throws.
 * Returns { posted, reason?, entryId?, voucherNumber? }.
 */
async function postSaleJE(sale) {
  try {
    if (!sale || !sale._id) return { posted: false, reason: "no-sale" };
    const total = r2(sale.total);
    if (total <= 0) return { posted: false, reason: "zero-total" };

    const defaults = await loadDefaults();
    if (!defaults || !defaults.salesIncome) {
      console.warn(`[posting] sale ${sale._id} skipped: salesIncome default missing`);
      return { posted: false, reason: "defaults-missing" };
    }
    if (!(await isAccountPostable(defaults.salesIncome))) {
      console.warn(`[posting] sale ${sale._id} skipped: salesIncome not postable`);
      return { posted: false, reason: "default-account-not-postable" };
    }

    const { lines: debitLines, missing } = await buildDebitLines(sale, defaults);
    if (missing.length > 0) {
      console.warn(`[posting] sale ${sale._id} skipped: missing ${missing.join(",")}`);
      return { posted: false, reason: `missing:${missing.join(",")}` };
    }
    if (debitLines.length === 0) {
      return { posted: false, reason: "no-debit-lines" };
    }

    // Sanity: sum of debits must equal total (credit-side)
    const debitSum = r2(debitLines.reduce((s, d) => s + d.amount, 0));
    if (Math.abs(debitSum - total) > 0.01) {
      console.warn(
        `[posting] sale ${sale._id} skipped: debit sum ${debitSum} != total ${total}`
      );
      return { posted: false, reason: "unbalanced-input" };
    }

    const lines = [
      ...debitLines.map((d) => ({
        accountId: d.accountId,
        debit: d.amount,
        credit: 0,
        memo: d.memo,
      })),
      {
        accountId: defaults.salesIncome,
        debit: 0,
        credit: total,
        memo: "Sales income",
      },
    ];

    const voucherNumber = await nextVoucherNumber("sale");
    const entry = await JournalEntry.create({
      voucherNumber,
      voucherType: "SV",
      date: sale.date || new Date(),
      memo: `Sale ${voucherNumber}`,
      narration: sale.customerName || sale.customerPhone || "",
      lines,
      source: { kind: "sale", refId: sale._id },
      postedBy: { id: sale.cashierId || "", name: sale.cashierName || "" },
      locked: true,
      lockedAt: new Date(),
      auditLog: [
        {
          action: "create",
          by: { id: sale.cashierId || "", name: sale.cashierName || "" },
          at: new Date(),
          note: "Auto-posted from sale",
        },
      ],
    });
    return { posted: true, entryId: entry._id.toString(), voucherNumber };
  } catch (err) {
    console.error("[posting] postSaleJE error:", err.message);
    return { posted: false, reason: "error", error: err.message };
  }
}

/**
 * Post a journal entry for a return.
 *
 * Refund routing mirrors the original sale's payment mix:
 *   - if the sale was fully cash → credit Cash for the refund
 *   - if it was fully card/wallet → credit Bank
 *   - if it was credit-only → credit the customer's receivable (lowering their balance)
 *   - mixed → split the refund proportionally across the sale's original payment-method totals
 *
 * Falls back to "all cash" when the original sale has no payment-method info.
 */
async function buildRefundCreditLines(saleReturn, originalSale, defaults) {
  const refund = r2(saleReturn.refundAmount);
  const missing = [];

  if (!originalSale) {
    if (!defaults.cash) { missing.push("cash"); return { lines: [], missing }; }
    return {
      lines: [{ accountId: defaults.cash, amount: refund, memo: "Refund out" }],
      missing,
    };
  }

  const methods = originalSale.paymentMethods || [];
  const cashPaid = r2(methods.filter((m) => m.method === "cash").reduce((s, m) => s + (m.amount || 0), 0));
  const bankPaid = r2(methods.filter((m) => m.method === "card" || m.method === "wallet").reduce((s, m) => s + (m.amount || 0), 0));
  const creditPaid = r2(originalSale.creditAmount || 0);
  const totalPaid = r2(cashPaid + bankPaid + creditPaid);

  // No payment-method info at all → legacy cash refund
  if (totalPaid <= 0) {
    if (!defaults.cash) { missing.push("cash"); return { lines: [], missing }; }
    return {
      lines: [{ accountId: defaults.cash, amount: refund, memo: "Refund out" }],
      missing,
    };
  }

  const lines = [];
  const cashShare = r2((cashPaid / totalPaid) * refund);
  const bankShare = r2((bankPaid / totalPaid) * refund);
  // Take rounding remainder onto the credit share so the JE balances exactly
  const creditShare = r2(refund - cashShare - bankShare);

  if (cashShare > 0) {
    if (!defaults.cash) missing.push("cash");
    else lines.push({ accountId: defaults.cash, amount: cashShare, memo: "Refund (cash)" });
  }
  if (bankShare > 0) {
    if (!defaults.bank) missing.push("bank");
    else lines.push({ accountId: defaults.bank, amount: bankShare, memo: "Refund (bank/card)" });
  }
  if (creditShare > 0) {
    if (!originalSale.customerPhone) missing.push("customer-phone-required-for-credit");
    else {
      const customerAccount = await ensureCustomerAccount({
        phone: originalSale.customerPhone,
        name: originalSale.customerName,
      });
      if (!customerAccount) missing.push("customer-account-create-failed");
      else lines.push({
        accountId: customerAccount._id,
        amount: creditShare,
        memo: `Refund offsets receivable ${customerAccount.name}`,
      });
    }
  }

  return { lines, missing };
}

async function postReturnJE(saleReturn) {
  try {
    if (!saleReturn || !saleReturn._id) return { posted: false, reason: "no-return" };
    const refund = r2(saleReturn.refundAmount);
    if (refund <= 0) return { posted: false, reason: "zero-refund" };

    const defaults = await loadDefaults();
    if (!defaults || !defaults.salesReturn) {
      console.warn(`[posting] return ${saleReturn._id} skipped: salesReturn default missing`);
      return { posted: false, reason: "defaults-missing" };
    }
    if (!(await isAccountPostable(defaults.salesReturn))) {
      console.warn(`[posting] return ${saleReturn._id} skipped: salesReturn not postable`);
      return { posted: false, reason: "default-account-not-postable" };
    }

    // Look up the original sale to mirror its payment routing
    const Sale = require("../../models/sale.model");
    const originalSale = saleReturn.saleId
      ? await Sale.findById(saleReturn.saleId)
      : null;

    const { lines: creditLines, missing } = await buildRefundCreditLines(
      saleReturn,
      originalSale,
      defaults
    );
    if (missing.length > 0) {
      console.warn(`[posting] return ${saleReturn._id} skipped: missing ${missing.join(",")}`);
      return { posted: false, reason: `missing:${missing.join(",")}` };
    }
    if (creditLines.length === 0) {
      return { posted: false, reason: "no-credit-lines" };
    }

    const creditSum = r2(creditLines.reduce((s, c) => s + c.amount, 0));
    if (Math.abs(creditSum - refund) > 0.01) {
      console.warn(
        `[posting] return ${saleReturn._id} skipped: credit sum ${creditSum} != refund ${refund}`
      );
      return { posted: false, reason: "unbalanced-input" };
    }

    const voucherNumber = await nextVoucherNumber("return");
    const entry = await JournalEntry.create({
      voucherNumber,
      voucherType: "RV",
      date: saleReturn.date || new Date(),
      memo: `Return ${voucherNumber}`,
      lines: [
        {
          accountId: defaults.salesReturn,
          debit: refund,
          credit: 0,
          memo: "Sales return",
        },
        ...creditLines.map((c) => ({
          accountId: c.accountId,
          debit: 0,
          credit: c.amount,
          memo: c.memo,
        })),
      ],
      source: { kind: "return", refId: saleReturn._id },
      postedBy: {
        id: saleReturn.processedBy || "",
        name: saleReturn.processedByName || "",
      },
      locked: true,
      lockedAt: new Date(),
      auditLog: [
        {
          action: "create",
          by: {
            id: saleReturn.processedBy || "",
            name: saleReturn.processedByName || "",
          },
          at: new Date(),
          note: "Auto-posted from return",
        },
      ],
    });
    return { posted: true, entryId: entry._id.toString(), voucherNumber };
  } catch (err) {
    console.error("[posting] postReturnJE error:", err.message);
    return { posted: false, reason: "error", error: err.message };
  }
}

module.exports = { postSaleJE, postReturnJE };
