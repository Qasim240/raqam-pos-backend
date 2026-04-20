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
      },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/settings
exports.update = async (req, res, next) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create(req.body);
    } else {
      Object.assign(settings, req.body);
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
      },
    });
  } catch (err) {
    next(err);
  }
};
