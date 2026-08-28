const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      default: "QuickMart Store",
    },
    shopNameAr: {
      type: String,
      default: "متجر كويك مارت",
    },
    shopAddress: {
      type: String,
      default: "Faisalabad, Pakistan",
    },
    shopAddressAr: {
      type: String,
      default: "فيصل آباد، باكستان",
    },
    shopPhone: {
      type: String,
      default: "+92-300-1234567",
    },
    shopEmail: {
      type: String,
      default: "info@quickmart.com",
    },
    currency: {
      type: String,
      default: "PKR",
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
    },
    receiptFooter: {
      type: String,
      default: "Thank you for shopping with us!",
    },
    receiptFooterAr: {
      type: String,
      default: "شكراً لتسوقك معنا!",
    },
    logo: {
      type: String,
    },
    defaultCashAccountId: { type: String, default: null },
    defaultBankAccountId: { type: String, default: null },
    defaultSalesIncomeAccountId: { type: String, default: null },
    defaultSalesReturnAccountId: { type: String, default: null },
    defaultCustomerReceivableAccountId: { type: String, default: null },
    defaultInventoryAccountId: { type: String, default: null },

    // Period-lock state. Anything dated <= this is locked: no new entries
    // can be backdated into it, no reversals or cancellations against it.
    accountingClosedThroughDate: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
