const mongoose = require("mongoose");

const saleItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    sku: {
      type: String,
    },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (v) => v.length > 0,
        message: "Sale must have at least one item",
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    discountType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    cashReceived: {
      type: Number,
      required: true,
      min: 0,
    },
    change: {
      type: Number,
      default: 0,
      min: 0,
    },
    cashierId: {
      type: String,
      required: true,
    },
    cashierName: {
      type: String,
      required: true,
    },
    customerPhone: {
      type: String,
      trim: true,
      default: "",
    },
    customerName: {
      type: String,
      trim: true,
      default: "",
    },
    // Multi-method payments captured at POS.
    // Each entry = { method: 'cash'|'card'|'wallet', amount }.
    // If the array is empty, fall back to the legacy cash-only path
    // (entire sale.total treated as cash).
    paymentMethods: {
      type: [
        {
          method: {
            type: String,
            enum: ["cash", "card", "wallet"],
            required: true,
          },
          amount: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    // Amount the customer still owes after payment — posts to receivables.
    creditAmount: { type: Number, default: 0, min: 0 },
    creditCustomer: { type: String, default: "" },
    // Tax book-keeping (informational; not posted as a separate JE line in v1).
    taxAmount: { type: Number, default: 0, min: 0 },
    taxMode: {
      type: String,
      enum: ["none", "inclusive", "exclusive"],
      default: "none",
    },
    taxRate: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Sale", saleSchema);
