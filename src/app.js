const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const errorHandler = require("./middleware/errorHandler");

const app = express();
app.use(express.json()); 
// Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api", require("./routes"));

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
