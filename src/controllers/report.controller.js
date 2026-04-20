const Sale = require("../models/sale.model");
const Return = require("../models/return.model");
const Product = require("../models/product.model");

// GET /api/reports/daily?date=YYYY-MM-DD
exports.getDailyReport = async (req, res, next) => {
  try {
    const dateStr = req.query.date;
    let targetDate;

    if (dateStr) {
      targetDate = new Date(dateStr + "T00:00:00");
    } else {
      targetDate = new Date();
    }

    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const sales = await Sale.find({
      date: { $gte: dayStart, $lt: dayEnd },
    }).sort({ date: 1 });

    const returns = await Return.find({
      date: { $gte: dayStart, $lt: dayEnd },
    }).sort({ date: 1 });

    // Calculate summary
    const totalTransactions = sales.length;
    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const totalSubtotal = sales.reduce((sum, s) => sum + s.subtotal, 0);
    const totalDiscount = sales.reduce((sum, s) => sum + s.discountAmount, 0);
    const totalCashReceived = sales.reduce(
      (sum, s) => sum + s.cashReceived,
      0
    );
    const totalChange = sales.reduce((sum, s) => sum + s.change, 0);
    const totalItemsSold = sales.reduce(
      (sum, s) => s.items.reduce((iSum, item) => iSum + item.quantity, 0) + sum,
      0
    );

    // Returns summary
    const totalReturns = returns.length;
    const totalRefundAmount = returns.reduce(
      (sum, r) => sum + r.refundAmount,
      0
    );

    // Net sales
    const netSales = totalSales - totalRefundAmount;

    // Product-wise breakdown
    const productMap = {};
    sales.forEach((sale) => {
      sale.items.forEach((item) => {
        if (!productMap[item.productId]) {
          productMap[item.productId] = {
            productId: item.productId,
            name: item.name,
            sku: item.sku || "",
            quantitySold: 0,
            revenue: 0,
          };
        }
        productMap[item.productId].quantitySold += item.quantity;
        productMap[item.productId].revenue += item.price * item.quantity;
      });
    });

    const productBreakdown = Object.values(productMap).sort(
      (a, b) => b.revenue - a.revenue
    );

    // Cashier-wise breakdown
    const cashierMap = {};
    sales.forEach((sale) => {
      if (!cashierMap[sale.cashierId]) {
        cashierMap[sale.cashierId] = {
          cashierId: sale.cashierId,
          cashierName: sale.cashierName,
          transactions: 0,
          total: 0,
        };
      }
      cashierMap[sale.cashierId].transactions += 1;
      cashierMap[sale.cashierId].total += sale.total;
    });

    const cashierBreakdown = Object.values(cashierMap).sort(
      (a, b) => b.total - a.total
    );

    // Hourly breakdown
    const hourlyMap = {};
    for (let h = 0; h < 24; h++) {
      hourlyMap[h] = { hour: h, transactions: 0, total: 0 };
    }
    sales.forEach((sale) => {
      const hour = new Date(sale.date).getHours();
      hourlyMap[hour].transactions += 1;
      hourlyMap[hour].total += sale.total;
    });
    const hourlyBreakdown = Object.values(hourlyMap).filter(
      (h) => h.transactions > 0
    );

    // Format individual sales
    const formattedSales = sales.map((s) => ({
      id: s._id,
      date: s.date.toISOString(),
      items: s.items,
      subtotal: s.subtotal,
      discountType: s.discountType,
      discountValue: s.discountValue,
      discountAmount: s.discountAmount,
      total: s.total,
      cashReceived: s.cashReceived,
      change: s.change,
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      customerPhone: s.customerPhone || "",
    }));

    res.json({
      success: true,
      data: {
        date: dayStart.toISOString().split("T")[0],
        summary: {
          totalTransactions,
          totalSales: Math.round(totalSales * 100) / 100,
          totalSubtotal: Math.round(totalSubtotal * 100) / 100,
          totalDiscount: Math.round(totalDiscount * 100) / 100,
          totalCashReceived: Math.round(totalCashReceived * 100) / 100,
          totalChange: Math.round(totalChange * 100) / 100,
          totalItemsSold,
          totalReturns,
          totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
          netSales: Math.round(netSales * 100) / 100,
          avgTransactionValue:
            totalTransactions > 0
              ? Math.round((totalSales / totalTransactions) * 100) / 100
              : 0,
        },
        productBreakdown,
        cashierBreakdown,
        hourlyBreakdown,
        sales: formattedSales,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/monthly?month=MM&year=YYYY
exports.getMonthlyReport = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);

    const sales = await Sale.find({
      date: { $gte: monthStart, $lt: monthEnd },
    }).sort({ date: 1 });

    const returns = await Return.find({
      date: { $gte: monthStart, $lt: monthEnd },
    }).sort({ date: 1 });

    // Overall summary
    const totalTransactions = sales.length;
    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const totalSubtotal = sales.reduce((sum, s) => sum + s.subtotal, 0);
    const totalDiscount = sales.reduce((sum, s) => sum + s.discountAmount, 0);
    const totalCashReceived = sales.reduce(
      (sum, s) => sum + s.cashReceived,
      0
    );
    const totalItemsSold = sales.reduce(
      (sum, s) => s.items.reduce((iSum, item) => iSum + item.quantity, 0) + sum,
      0
    );

    const totalReturns = returns.length;
    const totalRefundAmount = returns.reduce(
      (sum, r) => sum + r.refundAmount,
      0
    );
    const netSales = totalSales - totalRefundAmount;

    // Daily breakdown for the month
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyBreakdown = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStart = new Date(year, month - 1, d);
      const dayEnd = new Date(year, month - 1, d + 1);

      const daySales = sales.filter((s) => {
        const sd = new Date(s.date);
        return sd >= dayStart && sd < dayEnd;
      });

      const dayTotal = daySales.reduce((sum, s) => sum + s.total, 0);
      const dayItems = daySales.reduce(
        (sum, s) =>
          s.items.reduce((iSum, item) => iSum + item.quantity, 0) + sum,
        0
      );

      dailyBreakdown.push({
        day: d,
        date: dayStart.toISOString().split("T")[0],
        transactions: daySales.length,
        total: Math.round(dayTotal * 100) / 100,
        itemsSold: dayItems,
      });
    }

    // Product-wise breakdown
    const productMap = {};
    sales.forEach((sale) => {
      sale.items.forEach((item) => {
        if (!productMap[item.productId]) {
          productMap[item.productId] = {
            productId: item.productId,
            name: item.name,
            sku: item.sku || "",
            quantitySold: 0,
            revenue: 0,
          };
        }
        productMap[item.productId].quantitySold += item.quantity;
        productMap[item.productId].revenue += item.price * item.quantity;
      });
    });

    // Enrich with purchase price for profit calculation
    const productIds = Object.keys(productMap);
    const dbProducts = await Product.find({ _id: { $in: productIds } });
    const dbProductMap = {};
    dbProducts.forEach((p) => {
      dbProductMap[p._id.toString()] = p;
    });

    const productBreakdown = Object.values(productMap)
      .map((item) => {
        const dbProd = dbProductMap[item.productId];
        const purchasePrice = dbProd ? dbProd.purchasePrice : 0;
        const cost = purchasePrice * item.quantitySold;
        const profit = item.revenue - cost;
        return {
          ...item,
          purchasePrice,
          cost: Math.round(cost * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          margin:
            item.revenue > 0
              ? Math.round((profit / item.revenue) * 10000) / 100
              : 0,
          revenue: Math.round(item.revenue * 100) / 100,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Total profit
    const totalCost = productBreakdown.reduce((sum, p) => sum + p.cost, 0);
    const totalProfit = totalSales - totalCost;

    // Cashier-wise breakdown
    const cashierMap = {};
    sales.forEach((sale) => {
      if (!cashierMap[sale.cashierId]) {
        cashierMap[sale.cashierId] = {
          cashierId: sale.cashierId,
          cashierName: sale.cashierName,
          transactions: 0,
          total: 0,
        };
      }
      cashierMap[sale.cashierId].transactions += 1;
      cashierMap[sale.cashierId].total += sale.total;
    });

    const cashierBreakdown = Object.values(cashierMap).sort(
      (a, b) => b.total - a.total
    );

    // Top 5 best & worst selling days
    const sortedDays = [...dailyBreakdown]
      .filter((d) => d.transactions > 0)
      .sort((a, b) => b.total - a.total);
    const bestDays = sortedDays.slice(0, 5);
    const worstDays = sortedDays.slice(-5).reverse();

    res.json({
      success: true,
      data: {
        month,
        year,
        monthName: monthStart.toLocaleString("en-US", { month: "long" }),
        summary: {
          totalTransactions,
          totalSales: Math.round(totalSales * 100) / 100,
          totalSubtotal: Math.round(totalSubtotal * 100) / 100,
          totalDiscount: Math.round(totalDiscount * 100) / 100,
          totalCashReceived: Math.round(totalCashReceived * 100) / 100,
          totalItemsSold,
          totalReturns,
          totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
          netSales: Math.round(netSales * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          totalProfit: Math.round(totalProfit * 100) / 100,
          profitMargin:
            totalSales > 0
              ? Math.round((totalProfit / totalSales) * 10000) / 100
              : 0,
          avgDailySales:
            daysInMonth > 0
              ? Math.round((totalSales / daysInMonth) * 100) / 100
              : 0,
          avgTransactionValue:
            totalTransactions > 0
              ? Math.round((totalSales / totalTransactions) * 100) / 100
              : 0,
          activeDays: dailyBreakdown.filter((d) => d.transactions > 0).length,
        },
        dailyBreakdown,
        productBreakdown,
        cashierBreakdown,
        bestDays,
        worstDays,
      },
    });
  } catch (err) {
    next(err);
  }
};
