const ChartAccount = require("../models/chartAccount.model");
const JournalEntry = require("../models/journalEntry.model");
const Settings = require("../models/settings.model");
const ApiError = require("../utils/ApiError");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const formatAccount = (a, currentBalance) => ({
  id: a._id.toString(),
  code: a.code,
  seriesCode: a.seriesCode || "",
  name: a.name,
  type: a.type,
  parentId: a.parentId ? a.parentId.toString() : null,
  controlAccount: !!a.controlAccount,
  allowPosting: a.allowPosting !== false,
  openingDebit: a.openingDebit || 0,
  openingCredit: a.openingCredit || 0,
  openingDate: a.openingDate ? a.openingDate.toISOString() : null,
  mobile: a.mobile || "",
  city: a.city || "",
  notes: a.notes || "",
  accountRights: a.accountRights || "",
  isActive: a.isActive !== false,
  isSystem: !!a.isSystem,
  ...(currentBalance !== undefined ? { currentBalance: r2(currentBalance) } : {}),
});

// Sign convention for normal balance side per type.
function signedBalance(type, debit, credit) {
  const d = Number(debit) || 0;
  const c = Number(credit) || 0;
  if (ChartAccount.isDebitNormal(type)) return d - c;
  return c - d;
}

async function aggregateBalances(accountIds) {
  if (!accountIds.length) return new Map();
  const rows = await JournalEntry.aggregate([
    { $match: { reversed: false } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": { $in: accountIds } } },
    {
      $group: {
        _id: "$lines.accountId",
        debit: { $sum: "$lines.debit" },
        credit: { $sum: "$lines.credit" },
      },
    },
  ]);
  const map = new Map();
  for (const r of rows) {
    map.set(r._id.toString(), { debit: r.debit, credit: r.credit });
  }
  return map;
}

// GET /api/accounts
exports.getAll = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.active === "true") filter.isActive = true;
    if (req.query.active === "false") filter.isActive = false;
    if (req.query.parentId === "null") filter.parentId = null;
    else if (req.query.parentId) filter.parentId = req.query.parentId;

    const accounts = await ChartAccount.find(filter).sort({ code: 1 });
    const ids = accounts.map((a) => a._id);
    const totals = await aggregateBalances(ids);

    const data = accounts.map((a) => {
      const t = totals.get(a._id.toString()) || { debit: 0, credit: 0 };
      const opening = signedBalance(a.type, a.openingDebit, a.openingCredit);
      const movement = signedBalance(a.type, t.debit, t.credit);
      return formatAccount(a, opening + movement);
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/:id
exports.getById = async (req, res, next) => {
  try {
    const a = await ChartAccount.findById(req.params.id);
    if (!a) return next(new ApiError(404, "Account not found"));
    const totals = await aggregateBalances([a._id]);
    const t = totals.get(a._id.toString()) || { debit: 0, credit: 0 };
    const opening = signedBalance(a.type, a.openingDebit, a.openingCredit);
    const movement = signedBalance(a.type, t.debit, t.credit);
    res.json({ success: true, data: formatAccount(a, opening + movement) });
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts
exports.create = async (req, res, next) => {
  try {
    const {
      code,
      seriesCode,
      name,
      type,
      parentId,
      controlAccount,
      allowPosting,
      openingDebit,
      openingCredit,
      openingDate,
      mobile,
      city,
      notes,
      accountRights,
      isActive,
    } = req.body;

    if (!code || !String(code).trim())
      return next(new ApiError(400, "Account code is required"));
    if (!name || !String(name).trim())
      return next(new ApiError(400, "Account name is required"));
    if (!ChartAccount.ACCOUNT_TYPES.includes(type))
      return next(new ApiError(400, "Invalid account type"));

    const dup = await ChartAccount.findOne({ code: code.trim() });
    if (dup) return next(new ApiError(409, "Account code already exists"));

    if (parentId) {
      const parent = await ChartAccount.findById(parentId);
      if (!parent) return next(new ApiError(400, "Parent account not found"));
    }

    const isControl = !!controlAccount;
    const account = await ChartAccount.create({
      code: code.trim(),
      seriesCode: seriesCode || "",
      name: name.trim(),
      type,
      parentId: parentId || null,
      controlAccount: isControl,
      allowPosting: isControl ? false : (allowPosting !== false),
      openingDebit: r2(openingDebit),
      openingCredit: r2(openingCredit),
      openingDate: openingDate ? new Date(openingDate) : null,
      mobile: mobile || "",
      city: city || "",
      notes: notes || "",
      accountRights: accountRights || "",
      isActive: isActive !== false,
      isSystem: false,
    });

    res.status(201).json({ success: true, data: formatAccount(account, 0) });
  } catch (err) {
    if (err.code === 11000)
      return next(new ApiError(409, "Account code already exists"));
    if (err.name === "ValidationError")
      return next(new ApiError(400, err.message));
    return next(new ApiError(400, err.message || "Failed to create account"));
  }
};

// PUT /api/accounts/:id
exports.update = async (req, res, next) => {
  try {
    const account = await ChartAccount.findById(req.params.id);
    if (!account) return next(new ApiError(404, "Account not found"));

    const {
      code,
      seriesCode,
      name,
      type,
      parentId,
      controlAccount,
      allowPosting,
      openingDebit,
      openingCredit,
      openingDate,
      mobile,
      city,
      notes,
      accountRights,
      isActive,
    } = req.body;

    // Code immutability if any JE references this account
    if (code !== undefined && code.trim() !== account.code) {
      const used = await JournalEntry.exists({ "lines.accountId": account._id });
      if (used)
        return next(
          new ApiError(409, "Cannot change code: account has journal entries")
        );
      const dup = await ChartAccount.findOne({
        code: code.trim(),
        _id: { $ne: account._id },
      });
      if (dup) return next(new ApiError(409, "Account code already exists"));
      account.code = code.trim();
    }

    // Type immutability if account has JE references
    if (type !== undefined && type !== account.type) {
      const used = await JournalEntry.exists({ "lines.accountId": account._id });
      if (used)
        return next(
          new ApiError(409, "Cannot change type: account has journal entries")
        );
      if (!ChartAccount.ACCOUNT_TYPES.includes(type))
        return next(new ApiError(400, "Invalid account type"));
      account.type = type;
    }

    if (name !== undefined) account.name = name.trim();
    if (seriesCode !== undefined) account.seriesCode = seriesCode;
    if (mobile !== undefined) account.mobile = mobile;
    if (city !== undefined) account.city = city;
    if (notes !== undefined) account.notes = notes;
    if (accountRights !== undefined) account.accountRights = accountRights;
    if (isActive !== undefined) account.isActive = !!isActive;
    if (openingDate !== undefined) {
      account.openingDate = openingDate ? new Date(openingDate) : null;
    }

    if (controlAccount !== undefined) {
      account.controlAccount = !!controlAccount;
      if (account.controlAccount) account.allowPosting = false;
    }
    if (allowPosting !== undefined && !account.controlAccount) {
      account.allowPosting = !!allowPosting;
    }

    // Opening balance edits are blocked once the account has any postings
    if (openingDebit !== undefined || openingCredit !== undefined) {
      const used = await JournalEntry.exists({ "lines.accountId": account._id });
      if (used) {
        return next(
          new ApiError(409, "Cannot change opening balance: account has journal entries")
        );
      }
      if (openingDebit !== undefined) account.openingDebit = r2(openingDebit);
      if (openingCredit !== undefined) account.openingCredit = r2(openingCredit);
    }

    if (parentId !== undefined) {
      if (parentId && parentId === account._id.toString())
        return next(new ApiError(400, "Account cannot be its own parent"));
      account.parentId = parentId || null;
    }

    await account.save();
    res.json({ success: true, data: formatAccount(account) });
  } catch (err) {
    if (err.code === 11000)
      return next(new ApiError(409, "Account code already exists"));
    if (err.name === "ValidationError")
      return next(new ApiError(400, err.message));
    return next(new ApiError(400, err.message || "Failed to update account"));
  }
};

// DELETE /api/accounts/:id  (soft delete unless ?hard=true and unused)
exports.remove = async (req, res, next) => {
  try {
    const account = await ChartAccount.findById(req.params.id);
    if (!account) return next(new ApiError(404, "Account not found"));

    const hard = req.query.hard === "true";

    if (hard) {
      if (account.isSystem)
        return next(new ApiError(409, "System accounts cannot be deleted"));
      const used = await JournalEntry.exists({ "lines.accountId": account._id });
      if (used)
        return next(
          new ApiError(409, "Account is referenced by journal entries; deactivate instead")
        );
      await account.deleteOne();
      return res.json({ success: true });
    }

    account.isActive = false;
    await account.save();
    res.json({ success: true, data: formatAccount(account) });
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/:id/ledger?from=&to=
exports.getLedger = async (req, res, next) => {
  try {
    const account = await ChartAccount.findById(req.params.id);
    if (!account) return next(new ApiError(404, "Account not found"));

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    // Opening = account opening + all entries strictly before `from`
    const dateMatch = {};
    if (from) dateMatch.$gte = from;
    if (to) dateMatch.$lte = to;

    const baseMatch = { reversed: false, "lines.accountId": account._id };
    const inRangeMatch = {
      ...baseMatch,
      ...(from || to ? { date: dateMatch } : {}),
    };

    let prePeriodTotals = { debit: 0, credit: 0 };
    if (from) {
      const pre = await JournalEntry.aggregate([
        { $match: { reversed: false, date: { $lt: from } } },
        { $unwind: "$lines" },
        { $match: { "lines.accountId": account._id } },
        {
          $group: {
            _id: null,
            debit: { $sum: "$lines.debit" },
            credit: { $sum: "$lines.credit" },
          },
        },
      ]);
      if (pre[0]) prePeriodTotals = { debit: pre[0].debit, credit: pre[0].credit };
    }

    const opening =
      signedBalance(account.type, account.openingDebit, account.openingCredit) +
      signedBalance(account.type, prePeriodTotals.debit, prePeriodTotals.credit);

    const entries = await JournalEntry.find(inRangeMatch).sort({ date: 1, _id: 1 });

    let running = opening;
    let totalDebit = 0;
    let totalCredit = 0;
    const lines = [];
    for (const e of entries) {
      for (const ln of e.lines) {
        if (ln.accountId.toString() !== account._id.toString()) continue;
        const d = ln.debit || 0;
        const c = ln.credit || 0;
        running += signedBalance(account.type, d, c);
        totalDebit += d;
        totalCredit += c;
        lines.push({
          entryId: e._id.toString(),
          date: e.date.toISOString(),
          memo: ln.memo || e.memo || "",
          source: e.source,
          debit: r2(d),
          credit: r2(c),
          balance: r2(running),
        });
      }
    }

    res.json({
      success: true,
      data: {
        account: formatAccount(account, running),
        opening: r2(opening),
        closing: r2(running),
        totalDebit: r2(totalDebit),
        totalCredit: r2(totalCredit),
        lines,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/day-end?date=YYYY-MM-DD
// Ledger-based day-end snapshot. Pulls all non-reversed JE lines dated within the
// chosen day and bundles them into the buckets a wholesale shop owner cares about.
exports.getDayEnd = async (req, res, next) => {
  try {
    const dayInput = req.query.date ? new Date(req.query.date) : new Date();
    const start = new Date(dayInput);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dayInput);
    end.setHours(23, 59, 59, 999);

    // Pull all account types in one shot — we'll bucket on the JS side
    const accounts = await ChartAccount.find({});
    const accountById = new Map(accounts.map((a) => [a._id.toString(), a]));

    // All lines for the day, non-reversed
    const lineRows = await JournalEntry.aggregate([
      { $match: { reversed: false, date: { $gte: start, $lte: end } } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: "$lines.accountId",
          debit: { $sum: "$lines.debit" },
          credit: { $sum: "$lines.credit" },
        },
      },
    ]);

    // Opening balances per account (everything strictly before `start`)
    const openingRows = await JournalEntry.aggregate([
      { $match: { reversed: false, date: { $lt: start } } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: "$lines.accountId",
          debit: { $sum: "$lines.debit" },
          credit: { $sum: "$lines.credit" },
        },
      },
    ]);
    const openingByAcc = new Map(
      openingRows.map((r) => [r._id.toString(), r])
    );

    const buckets = {
      cash: { inflow: 0, outflow: 0, opening: 0, closing: 0, accounts: [] },
      bank: { inflow: 0, outflow: 0, opening: 0, closing: 0, accounts: [] },
      sales: { credit: 0, debit: 0, net: 0 },
      salesReturn: { credit: 0, debit: 0, net: 0 },
      customerReceivable: { increase: 0, decrease: 0, net: 0 },
      supplierPayable: { increase: 0, decrease: 0, net: 0 },
      expense: { debit: 0, credit: 0, net: 0 },
    };

    for (const row of lineRows) {
      const acc = accountById.get(row._id.toString());
      if (!acc) continue;
      const dr = row.debit || 0;
      const cr = row.credit || 0;
      const isCashType = acc.type === "cash" || (acc.type === "asset" && /cash/i.test(acc.name));
      const isBankType = acc.type === "bank" || (acc.type === "asset" && /bank/i.test(acc.name));

      if (isCashType) {
        buckets.cash.inflow += dr;
        buckets.cash.outflow += cr;
      } else if (isBankType) {
        buckets.bank.inflow += dr;
        buckets.bank.outflow += cr;
      } else if (acc.type === "income") {
        if (/return/i.test(acc.name)) {
          buckets.salesReturn.credit += cr;
          buckets.salesReturn.debit += dr;
          buckets.salesReturn.net += dr - cr;
        } else {
          buckets.sales.credit += cr;
          buckets.sales.debit += dr;
          buckets.sales.net += cr - dr;
        }
      } else if (acc.type === "customer") {
        buckets.customerReceivable.increase += dr;
        buckets.customerReceivable.decrease += cr;
        buckets.customerReceivable.net += dr - cr;
      } else if (acc.type === "supplier") {
        buckets.supplierPayable.decrease += dr;
        buckets.supplierPayable.increase += cr;
        buckets.supplierPayable.net += cr - dr;
      } else if (acc.type === "expense") {
        buckets.expense.debit += dr;
        buckets.expense.credit += cr;
        buckets.expense.net += dr - cr;
      }
    }

    // Per-cash-account and per-bank-account opening/closing breakdown
    for (const acc of accounts) {
      const isCashType = acc.type === "cash" || (acc.type === "asset" && /cash/i.test(acc.name));
      const isBankType = acc.type === "bank" || (acc.type === "asset" && /bank/i.test(acc.name));
      if (!isCashType && !isBankType) continue;
      const opening = openingByAcc.get(acc._id.toString()) || { debit: 0, credit: 0 };
      const day = lineRows.find((r) => r._id.toString() === acc._id.toString()) || {
        debit: 0,
        credit: 0,
      };
      const openingBal = signedBalance(acc.type, acc.openingDebit, acc.openingCredit) +
        signedBalance(acc.type, opening.debit, opening.credit);
      const closingBal = openingBal + signedBalance(acc.type, day.debit, day.credit);
      const target = isCashType ? buckets.cash : buckets.bank;
      target.opening += openingBal;
      target.closing += closingBal;
      target.accounts.push({
        account: formatAccount(acc),
        opening: r2(openingBal),
        inflow: r2(day.debit),
        outflow: r2(day.credit),
        closing: r2(closingBal),
      });
    }

    // Round all bucket numbers
    for (const k of ["cash", "bank"]) {
      buckets[k].inflow = r2(buckets[k].inflow);
      buckets[k].outflow = r2(buckets[k].outflow);
      buckets[k].opening = r2(buckets[k].opening);
      buckets[k].closing = r2(buckets[k].closing);
    }
    for (const k of ["sales", "salesReturn", "expense"]) {
      buckets[k].credit = r2(buckets[k].credit);
      buckets[k].debit = r2(buckets[k].debit);
      buckets[k].net = r2(buckets[k].net);
    }
    for (const k of ["customerReceivable", "supplierPayable"]) {
      buckets[k].increase = r2(buckets[k].increase);
      buckets[k].decrease = r2(buckets[k].decrease);
      buckets[k].net = r2(buckets[k].net);
    }

    res.json({
      success: true,
      data: {
        date: start.toISOString().slice(0, 10),
        ...buckets,
        netCashMovement: r2(buckets.cash.inflow - buckets.cash.outflow),
        netBankMovement: r2(buckets.bank.inflow - buckets.bank.outflow),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/accounts/customers/quick   { phone?, name, openingDebit? }
// Quick-add a customer account from the Payments / Customers UI without
// detouring through the Chart of Accounts grid. Phone is optional (a
// synthetic code is generated when it's missing).
exports.quickAddCustomer = async (req, res, next) => {
  try {
    const { phone, name, openingDebit } = req.body;
    if (!name || !String(name).trim()) {
      return next(new ApiError(400, "Customer name is required"));
    }
    const ph = String(phone || "").trim();
    const cleanName = String(name).trim();
    let account;

    if (ph) {
      const { ensureCustomerAccount } = require("../services/parties.service");
      account = await ensureCustomerAccount({ phone: ph, name: cleanName });
      if (!account) return next(new ApiError(400, "Failed to create customer"));
      // ensureCustomerAccount only updates name if changed; force the latest name
      if (account.name !== cleanName) {
        account.name = cleanName;
        await account.save();
      }
    } else {
      const settings = await Settings.findOne();
      const parentId = settings?.defaultCustomerReceivableAccountId || null;
      const code = `CUST-${Date.now().toString(36).toUpperCase().slice(-8)}`;
      account = await ChartAccount.create({
        code,
        name: cleanName,
        type: "customer",
        parentId,
        isSystem: false,
        isActive: true,
        allowPosting: true,
      });
    }

    const od = parseFloat(openingDebit) || 0;
    if (od > 0) {
      // Only allow opening balance edits on a fresh account with no JEs yet
      const used = await JournalEntry.exists({ "lines.accountId": account._id });
      if (!used) {
        account.openingDebit = r2(od);
        account.openingCredit = 0;
        await account.save();
      }
    }

    const opening = signedBalance(
      account.type,
      account.openingDebit,
      account.openingCredit,
    );
    res.status(201).json({ success: true, data: formatAccount(account, opening) });
  } catch (err) {
    if (err.code === 11000)
      return next(new ApiError(409, "A customer with this phone already exists"));
    return next(new ApiError(400, err.message || "Failed to create customer"));
  }
};

// POST /api/accounts/suppliers/quick   { phone?, name, openingCredit? }
// Same pattern for suppliers (admin-only at the route level).
exports.quickAddSupplier = async (req, res, next) => {
  try {
    const { phone, name, openingCredit } = req.body;
    if (!name || !String(name).trim()) {
      return next(new ApiError(400, "Supplier name is required"));
    }
    const ph = String(phone || "").trim();
    const cleanName = String(name).trim();
    let account;

    if (ph) {
      const { ensureSupplierAccount } = require("../services/parties.service");
      account = await ensureSupplierAccount({ phone: ph, name: cleanName });
      if (!account) return next(new ApiError(400, "Failed to create supplier"));
      if (account.name !== cleanName) {
        account.name = cleanName;
        await account.save();
      }
    } else {
      const parent = await ChartAccount.findOne({ code: "2100" });
      const code = `SUPP-${Date.now().toString(36).toUpperCase().slice(-8)}`;
      account = await ChartAccount.create({
        code,
        name: cleanName,
        type: "supplier",
        parentId: parent ? parent._id : null,
        isSystem: false,
        isActive: true,
        allowPosting: true,
      });
    }

    const oc = parseFloat(openingCredit) || 0;
    if (oc > 0) {
      const used = await JournalEntry.exists({ "lines.accountId": account._id });
      if (!used) {
        account.openingCredit = r2(oc);
        account.openingDebit = 0;
        await account.save();
      }
    }

    const opening = signedBalance(
      account.type,
      account.openingDebit,
      account.openingCredit,
    );
    res.status(201).json({ success: true, data: formatAccount(account, opening) });
  } catch (err) {
    if (err.code === 11000)
      return next(new ApiError(409, "A supplier with this phone already exists"));
    return next(new ApiError(400, err.message || "Failed to create supplier"));
  }
};

// GET /api/accounts/parties/outstanding?type=customer|supplier
// Returns only party accounts (customer/supplier) with non-zero current balance.
// For customers, "outstanding" = positive balance (they owe us).
// For suppliers, "outstanding" = positive balance (we owe them).
exports.getOutstandingParties = async (req, res, next) => {
  try {
    const type = req.query.type === "supplier" ? "supplier" : "customer";
    const accounts = await ChartAccount.find({ type, isActive: true });
    if (accounts.length === 0) return res.json({ success: true, data: [] });

    const ids = accounts.map((a) => a._id);
    const totals = await aggregateBalances(ids);
    const rows = accounts
      .map((a) => {
        const t = totals.get(a._id.toString()) || { debit: 0, credit: 0 };
        const opening = signedBalance(a.type, a.openingDebit, a.openingCredit);
        const movement = signedBalance(a.type, t.debit, t.credit);
        const balance = r2(opening + movement);
        return { account: formatAccount(a, balance), balance };
      })
      .filter((r) => Math.abs(r.balance) > 0.01)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/accounts/trial-balance?asOf=
exports.getTrialBalance = async (req, res, next) => {
  try {
    const asOf = req.query.asOf ? new Date(req.query.asOf) : null;
    const accounts = await ChartAccount.find({ isActive: true }).sort({ code: 1 });

    const match = { reversed: false };
    if (asOf) match.date = { $lte: asOf };
    const aggregated = await JournalEntry.aggregate([
      { $match: match },
      { $unwind: "$lines" },
      {
        $group: {
          _id: "$lines.accountId",
          debit: { $sum: "$lines.debit" },
          credit: { $sum: "$lines.credit" },
        },
      },
    ]);
    const totals = new Map(
      aggregated.map((r) => [r._id.toString(), { debit: r.debit, credit: r.credit }])
    );

    let grandDebit = 0;
    let grandCredit = 0;
    const rows = accounts.map((a) => {
      const t = totals.get(a._id.toString()) || { debit: 0, credit: 0 };
      const debit = r2(a.openingDebit + t.debit);
      const credit = r2(a.openingCredit + t.credit);
      // For trial balance, present each side independently — net is in balance column
      const balance = signedBalance(a.type, debit, credit);
      grandDebit += balance > 0 && (a.type === "asset" || a.type === "expense") ? balance : 0;
      grandCredit += balance > 0 && (a.type === "liability" || a.type === "income") ? balance : 0;
      // For pure DR/CR columns we still report the raw totals
      return {
        account: formatAccount(a),
        debit,
        credit,
        balance: r2(balance),
      };
    });

    const totalDebit = r2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = r2(rows.reduce((s, r) => s + r.credit, 0));

    res.json({
      success: true,
      data: {
        asOf: asOf ? asOf.toISOString() : null,
        rows,
        totals: {
          debit: totalDebit,
          credit: totalCredit,
          balanced: Math.abs(totalDebit - totalCredit) < 0.01,
          netAsset: r2(grandDebit),
          netLiabIncome: r2(grandCredit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
