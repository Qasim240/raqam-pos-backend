const Category = require("../models/category.model");
const ApiError = require("../utils/ApiError");

// GET /api/categories
exports.getAll = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: categories.map((c) => ({
        id: c._id,
        name: c.name,
        nameAr: c.nameAr,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/categories
exports.create = async (req, res, next) => {
  try {
    const { name, nameAr } = req.body;

    if (!name || !name.trim()) {
      return next(new ApiError(400, "Category name is required"));
    }

    const existing = await Category.findOne({ name: name.trim() });
    if (existing) {
      return next(new ApiError(409, "Category already exists"));
    }

    const category = await Category.create({ name, nameAr });

    res.status(201).json({
      success: true,
      data: { id: category._id, name: category.name, nameAr: category.nameAr },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/categories/:id
exports.update = async (req, res, next) => {
  try {
    const { name, nameAr } = req.body;

    if (!name || !name.trim()) {
      return next(new ApiError(400, "Category name is required"));
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, nameAr },
      { new: true, runValidators: true }
    );

    if (!category) {
      return next(new ApiError(404, "Category not found"));
    }

    res.json({
      success: true,
      data: { id: category._id, name: category.name, nameAr: category.nameAr },
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/categories/:id
exports.remove = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);

    if (!category) {
      return next(new ApiError(404, "Category not found"));
    }

    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    next(err);
  }
};
