const config = require("./config");
const app = require("./app");
const connectDB = require("./config/db");

connectDB();

app.listen(config.port, () => {
  console.log(`Server running in ${config.env} mode on port ${config.port}`);
});