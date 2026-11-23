const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const connection = process.env.DATABASE_URL || {
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: true } : false,
};

const common = { client: "pg", connection,
    pool: { min: 0, max: 2, },

    migrations: {
        directory: path.join(__dirname, "migrations"),
        tableName: "knex_migrations",
    },
};

module.exports = {
    development: {...common,},
    production: {...common,},
};