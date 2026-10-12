const path = require("path");
const { client, min } = require("./src/database");

require("dotenv").config({ path: path.join(__dirname, ".env") });

function createConfig() {
    const connection = process.env.DATABASE_URL || {
        host: process.env.PG_HOST,
        database: process.env.PG_DATABASE,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        port: Number(process.env.PG_PORT || 6900),
        ssl: process.env.PG_SSL === "true"
            ? { rejectUnauthorized: false }
            : false,
    };

    return {
        client: 'postgresql',
        connection,
        pool: {
            min: 0,
            max: 5,
        },
    };
}

const config = {
    development: {
        ...createConfig(),
    },
    
    production: {
        ...createConfig(),
    },

    migrations: {
        directory: "./migrations",
        tableName: "knex_migrations"
    },
};

module.exports = config;