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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Settings", settingsSchema);
