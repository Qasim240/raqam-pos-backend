const Settings = require("../models/settings.model");

// GET /api/settings
exports.get = async (req, res, next) => {
  try {
    // Always return the single settings document (create default if none exists)
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    res.json({
      success: true,
      data: {
        shopName: settings.shopName,
        shopNameAr: settings.shopNameAr,
        shopAddress: settings.shopAddress,
        shopAddressAr: settings.shopAddressAr,
        shopPhone: settings.shopPhone,
        shopEmail: settings.shopEmail,
        currency: settings.currency,
        lowStockThreshold: settings.lowStockThreshold,
        receiptFooter: settings.receiptFooter,
        receiptFooterAr: settings.receiptFooterAr,
        logo: settings.logo,
        defaultCashAccountId: settings.defaultCashAccountId || null,
        defaultBankAccountId: settings.defaultBankAccountId || null,
        defaultSalesIncomeAccountId: settings.defaultSalesIncomeAccountId || null,
        defaultSalesReturnAccountId: settings.defaultSalesReturnAccountId || null,
        defaultCustomerReceivableAccountId: settings.defaultCustomerReceivableAccountId || null,
        defaultInventoryAccountId: settings.defaultInventoryAccountId || null,
        accountingClosedThroughDate: settings.accountingClosedThroughDate
          ? settings.accountingClosedThroughDate.toISOString()
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings
exports.update = async (req, res, next) => {
  try {
    // accountingClosedThroughDate is managed exclusively by the /period endpoints
    // (which audit-log the change). Block it from the generic settings update.
    const { accountingClosedThroughDate: _ignored, ...safe } = req.body;

    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create(safe);
    } else {
      Object.assign(settings, safe);
      await settings.save();
    }

    res.json({
      success: true,
      data: {
        shopName: settings.shopName,
        shopNameAr: settings.shopNameAr,
        shopAddress: settings.shopAddress,
        shopAddressAr: settings.shopAddressAr,
        shopPhone: settings.shopPhone,
        shopEmail: settings.shopEmail,
        currency: settings.currency,
        lowStockThreshold: settings.lowStockThreshold,
        receiptFooter: settings.receiptFooter,
        receiptFooterAr: settings.receiptFooterAr,
        logo: settings.logo,
        defaultCashAccountId: settings.defaultCashAccountId || null,
        defaultBankAccountId: settings.defaultBankAccountId || null,
        defaultSalesIncomeAccountId: settings.defaultSalesIncomeAccountId || null,
        defaultSalesReturnAccountId: settings.defaultSalesReturnAccountId || null,
        defaultCustomerReceivableAccountId: settings.defaultCustomerReceivableAccountId || null,
        defaultInventoryAccountId: settings.defaultInventoryAccountId || null,
        accountingClosedThroughDate: settings.accountingClosedThroughDate
          ? settings.accountingClosedThroughDate.toISOString()
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};
