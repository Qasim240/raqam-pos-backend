// Re-export the new modular posting helpers under the legacy path so existing
// controllers (sale, return) keep working without import changes.
module.exports = require("./posting/saleposting");
