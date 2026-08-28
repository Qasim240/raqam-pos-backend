require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/user.model");
const ChartAccount = require("./models/chartAccount.model");
const Settings = require("./models/settings.model");

const MONGO_URI = process.env.DB_URI;

const adminUser = {
  name: "Admin",
  email: "admin@pos.com",
  password: "admin123",
  role: "admin",
  isActive: true,
};

// Hierarchical default chart of accounts.
// Root rows are "control accounts" — they don't accept postings, only roll up children.
// Leaf rows are typed (cash / bank / customer / supplier / income / expense / equity)
// so the posting service can route reliably without string-matching on names.
const DEFAULT_ACCOUNTS = [
  // Roots
  { code: "1000", name: "Assets",      type: "asset",     control: true,  isSystem: true },
  { code: "2000", name: "Liabilities", type: "liability", control: true,  isSystem: true },
  { code: "3000", name: "Equity",      type: "equity",    control: true,  isSystem: true },
  { code: "4000", name: "Income",      type: "income",    control: true,  isSystem: true },
  { code: "5000", name: "Expenses",    type: "expense",   control: true,  isSystem: true },

  // Asset leaves
  { code: "1010", name: "Cash in Hand",          type: "cash",     parent: "1000", isSystem: true },
  { code: "1020", name: "Bank Account",          type: "bank",     parent: "1000", isSystem: true },
  { code: "1100", name: "Customer Receivables",  type: "asset",    parent: "1000", control: true, isSystem: true },
  { code: "1110", name: "Inventory",             type: "asset",    parent: "1000", isSystem: true },

  // Liability leaves
  { code: "2100", name: "Supplier Payables",     type: "liability", parent: "2000", control: true, isSystem: true },

  // Equity leaves
  { code: "3010", name: "Owner's Capital",       type: "equity",    parent: "3000", isSystem: true },

  // Income leaves
  { code: "4010", name: "Sales Income",          type: "income",    parent: "4000", isSystem: true },
  { code: "4020", name: "Sales Returns",         type: "income",    parent: "4000", isSystem: true },

  // Expense leaves
  { code: "5010", name: "General Expenses",      type: "expense",   parent: "5000", isSystem: true },
];

async function seedAdminUser() {
  const existing = await User.findOne({ email: adminUser.email });
  if (existing) {
    console.log(`✓ Admin user already exists: ${adminUser.email}`);
    return;
  }
  const user = await User.create(adminUser);
  console.log(`✓ Admin user created: ${user.email} (password: admin123)`);
}

async function seedChartOfAccounts() {
  const existing = await ChartAccount.countDocuments();
  if (existing > 0) {
    console.log(`✓ Chart of accounts already populated (${existing} accounts)`);
    return null;
  }
  const created = {};
  for (const def of DEFAULT_ACCOUNTS) {
    const parentId = def.parent ? created[def.parent]?._id || null : null;
    const acc = await ChartAccount.create({
      code: def.code,
      name: def.name,
      type: def.type,
      parentId,
      controlAccount: !!def.control,
      allowPosting: !def.control,
      isSystem: !!def.isSystem,
    });
    created[def.code] = acc;
    console.log(`  + ${def.code} ${def.name} (${def.type})${def.control ? " [control]" : ""}`);
  }
  console.log(`✓ Seeded ${DEFAULT_ACCOUNTS.length} default accounts`);
  return created;
}

async function wireDefaultSettings(accounts) {
  if (!accounts) return;
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  let changed = false;
  const setIfMissing = (field, code) => {
    if (!settings[field] && accounts[code]) {
      settings[field] = accounts[code]._id.toString();
      changed = true;
    }
  };
  setIfMissing("defaultCashAccountId", "1010");
  setIfMissing("defaultBankAccountId", "1020");
  setIfMissing("defaultSalesIncomeAccountId", "4010");
  setIfMissing("defaultSalesReturnAccountId", "4020");
  setIfMissing("defaultCustomerReceivableAccountId", "1100");
  setIfMissing("defaultInventoryAccountId", "1110");
  if (changed) {
    await settings.save();
    console.log("✓ Wired default Cash / Bank / Sales / Returns / Receivables into Settings");
  }
}

async function seed() {
  try {
    if (!MONGO_URI) {
      console.error("DB_URI is not set in environment");
      process.exit(1);
    }
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    await seedAdminUser();
    const accounts = await seedChartOfAccounts();
    await wireDefaultSettings(accounts);

    console.log("\nSeed complete.");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();
