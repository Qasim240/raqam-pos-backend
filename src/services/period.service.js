const Settings = require("../models/settings.model");
const PeriodClose = require("../models/periodClose.model");

/**
 * End-of-day for a given date input — sets time to 23:59:59.999 in the
 * server's local timezone. Treating dates as whole-day buckets is what
 * shop owners expect ("close today" → can't post anything dated today).
 */
function endOfDay(input) {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfDay(input) {
  const d = input instanceof Date ? new Date(input) : new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns null if the date is allowed, or a string reason if it's blocked
 * by the current period-close boundary.
 */
async function isDateLocked(date) {
  if (!date) return null;
  const settings = await Settings.findOne();
  const through = settings?.accountingClosedThroughDate;
  if (!through) return null;
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  if (target.getTime() <= through.getTime()) {
    return `Date is in a locked period (closed through ${through.toISOString().slice(0, 10)})`;
  }
  return null;
}

/**
 * Close the period through `date` (end-of-day inclusive). Updates Settings
 * and appends an audit-log row. Refuses if the new boundary is earlier than
 * the existing one (use reopenToDate for that direction).
 */
async function closeThroughDate({ date, by, note }) {
  const target = endOfDay(date);
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  if (settings.accountingClosedThroughDate &&
      target.getTime() <= settings.accountingClosedThroughDate.getTime()) {
    throw new Error(
      `Period is already closed through ${settings.accountingClosedThroughDate.toISOString().slice(0, 10)}`
    );
  }
  settings.accountingClosedThroughDate = target;
  await settings.save();
  await PeriodClose.create({
    action: "close",
    throughDate: target,
    by: by || { id: "", name: "" },
    note: note || "",
  });
  return target;
}

/**
 * Reopen the period back to `date` (everything strictly after start-of-day(date)
 * becomes editable again). Pass null to fully reopen.
 */
async function reopenToDate({ date, by, note }) {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  let newBoundary = null;
  if (date) {
    // The boundary becomes end-of-day of the day BEFORE `date`.
    const startTarget = startOfDay(date);
    newBoundary = new Date(startTarget.getTime() - 1); // one ms before start of `date`
  }
  if (newBoundary && settings.accountingClosedThroughDate &&
      newBoundary.getTime() >= settings.accountingClosedThroughDate.getTime()) {
    throw new Error(
      "Reopen target must be earlier than the current closed-through date"
    );
  }
  settings.accountingClosedThroughDate = newBoundary;
  await settings.save();
  await PeriodClose.create({
    action: "reopen",
    throughDate: newBoundary || new Date(0),
    by: by || { id: "", name: "" },
    note: note || "",
  });
  return newBoundary;
}

async function getHistory(limit = 100) {
  return PeriodClose.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 500));
}

module.exports = {
  isDateLocked,
  closeThroughDate,
  reopenToDate,
  getHistory,
  endOfDay,
  startOfDay,
};
