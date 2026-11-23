const knex = require("knex");
const knexfile = require("../../knexfile");

const environment = process.env.NODE_ENV === "production" ? "production" : "development";
const database = knex(knexfile[environment]);

module.exports = database;