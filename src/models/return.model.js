const mongoose = require("mongoose");

const returnItemSchema = new mongoose.Schema(
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

const returnSchema = new mongoose.Schema(
  {
    saleId: {
      type: String,
      required: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    items: {
      type: [returnItemSchema],
      required: true,
      validate: {
        validator: (v) => v.length > 0,
        message: "Return must have at least one item",
      },
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    refundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      enum: ["defective", "wrong_item", "customer_change", "damaged", "other"],
      default: "customer_change",
    },
    notes: {
      type: String,
      trim: true,
    },
    processedBy: {
      type: String,
      required: true,
    },
    processedByName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },
    type: {
      type: String,
      enum: ["return", "exchange"],
      default: "return",
    },
    exchangeItems: {
      type: [
        {
          productId: { type: String, required: true },
          name: { type: String, required: true },
          price: { type: Number, required: true },
          quantity: { type: Number, required: true, min: 1 },
          sku: { type: String },
        },
      ],
      default: [],
    },
    exchangeTotal: {
      type: Number,
      default: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Return", returnSchema);
