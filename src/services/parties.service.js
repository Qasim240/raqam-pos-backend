const ChartAccount = require("../models/chartAccount.model");
const Settings = require("../models/settings.model");

// Naming convention for auto-created party accounts.
// Customer codes: CUST-<phoneDigits> ; Supplier codes: SUPP-<phoneDigits>
const codeForCustomer = (phone) => `CUST-${(phone || "").replace(/\D/g, "")}`;
const codeForSupplier = (phone) => `SUPP-${(phone || "").replace(/\D/g, "")}`;

const cleanPhone = (p) => (p || "").trim();

/**
 * Find or create a Customer-typed ChartAccount keyed by phone.
 * Parents the new account under the configured defaultCustomerReceivableAccountId
 * (the "Customer Receivables" control account).
 *
 * Idempotent. Concurrent calls for the same phone race-resolve via the unique code index.
 *
 * Returns the ChartAccount document, or null if phone is empty / no parent configured.
 */
async function ensureCustomerAccount({ phone, name }) {
  const ph = cleanPhone(phone);
  if (!ph) return null;
  const code = codeForCustomer(ph);

  const existing = await ChartAccount.findOne({ code });
  if (existing) {
    // Update name opportunistically if a new non-empty name was provided
    if (name && name.trim() && existing.name !== name.trim()) {
      existing.name = name.trim();
      try { await existing.save(); } catch { /* swallow — non-critical */ }
    }
    return existing;
  }

  const settings = await Settings.findOne();
  const parentId = settings?.defaultCustomerReceivableAccountId || null;

  try {
    return await ChartAccount.create({
      code,
      name: (name && name.trim()) || `Customer ${ph}`,
      type: "customer",
      parentId,
      mobile: ph,
      isSystem: false,
      isActive: true,
      allowPosting: true,
    });
  } catch (err) {
    // Lost the race to a concurrent create — fetch the winner.
    if (err.code === 11000) {
      return ChartAccount.findOne({ code });
    }
    throw err;
  }
}

/**
 * Same as ensureCustomerAccount but for suppliers.
 * Parents under a "Supplier Payables" control account looked up by code "2100"
 * (the seeded default). Future Settings field can override.
 */
async function ensureSupplierAccount({ phone, name }) {
  const ph = cleanPhone(phone);
  if (!ph) return null;
  const code = codeForSupplier(ph);

  const existing = await ChartAccount.findOne({ code });
  if (existing) {
    if (name && name.trim() && existing.name !== name.trim()) {
      existing.name = name.trim();
      try { await existing.save(); } catch { /* swallow */ }
    }
    return existing;
  }

  const parent = await ChartAccount.findOne({ code: "2100" });
  try {
    return await ChartAccount.create({
      code,
      name: (name && name.trim()) || `Supplier ${ph}`,
      type: "supplier",
      parentId: parent ? parent._id : null,
      mobile: ph,
      isSystem: false,
      isActive: true,
      allowPosting: true,
    });
  } catch (err) {
    if (err.code === 11000) return ChartAccount.findOne({ code });
    throw err;
  }
}

module.exports = {
  ensureCustomerAccount,
  ensureSupplierAccount,
  codeForCustomer,
  codeForSupplier,
};
