const Settings = require("../../models/settings.model");
const ChartAccount = require("../../models/chartAccount.model");

/**
 * Load the configured default accounting accounts from Settings.
 * Returns null if Settings doc doesn't exist.
 */
async function loadDefaults() {
  const settings = await Settings.findOne();
  if (!settings) return null;
  return {
    cash: settings.defaultCashAccountId || null,
    bank: settings.defaultBankAccountId || null,
    salesIncome: settings.defaultSalesIncomeAccountId || null,
    salesReturn: settings.defaultSalesReturnAccountId || null,
    customerReceivable: settings.defaultCustomerReceivableAccountId || null,
  };
}

/**
 * Cheap check that an account exists, is active, and accepts postings.
 */
async function isAccountPostable(id) {
  if (!id) return false;
  try {
    const a = await ChartAccount.findById(id).select("isActive allowPosting controlAccount");
    if (!a) return false;
    if (a.isActive === false) return false;
    if (a.controlAccount) return false;
    if (a.allowPosting === false) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = { loadDefaults, isAccountPostable };
