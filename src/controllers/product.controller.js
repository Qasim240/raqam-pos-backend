const Product = require("../models/product.model");
const ApiError = require("../utils/ApiError");

// GET /api/products
exports.getAll = async (req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: products.map((p) => ({
        id: p._id,
        name: p.name,
        nameAr: p.nameAr,
        category: p.category,
        sku: p.sku,
        barcode: p.barcode,
        purchasePrice: p.purchasePrice,
        salePrice: p.salePrice,
        stock: p.stock,
        minStock: p.minStock,
        image: p.image,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/products
exports.create = async (req, res, next) => {
  try {
    const { name, nameAr, category, barcode, purchasePrice, salePrice, stock, minStock, image } = req.body;

    if (!name || !category || purchasePrice == null || salePrice == null) {
      return next(new ApiError(400, "Name, category, purchasePrice, and salePrice are required"));
    }

    const sku = "QM-" + name.substring(0, 3).toUpperCase() + Date.now().toString().slice(-4);

    const product = await Product.create({
      name,
      nameAr,
      category,
      sku,
      barcode,
      purchasePrice,
      salePrice,
      stock: stock || 0,
      minStock: minStock || 0,
      image,
    });

    res.status(201).json({
      success: true,
      data: {
        id: product._id,
        name: product.name,
        nameAr: product.nameAr,
        category: product.category,
        sku: product.sku,
        barcode: product.barcode,
        purchasePrice: product.purchasePrice,
        salePrice: product.salePrice,
        stock: product.stock,
        minStock: product.minStock,
        image: product.image,
      },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/products/:id
exports.update = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return next(new ApiError(404, "Product not found"));
    }

    res.json({
      success: true,
      data: {
        id: product._id,
        name: product.name,
        nameAr: product.nameAr,
        category: product.category,
        sku: product.sku,
        barcode: product.barcode,
        purchasePrice: product.purchasePrice,
        salePrice: product.salePrice,
        stock: product.stock,
        minStock: product.minStock,
        image: product.image,
      },
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/products/:id
exports.remove = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return next(new ApiError(404, "Product not found"));
    }

    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    next(err);
  }
};
