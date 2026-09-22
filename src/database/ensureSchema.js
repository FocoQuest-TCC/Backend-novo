const knex = require("./index.js");

function defaultAppData() {
    return {
        tasks: [],
        habits: [],
        boards: [],
        kanbanTasks: [],
        inventory: [],
        gold: 0,
        gems: 0,
    };
}

async function ensureUsersTable() {
    const hasUsersTable = await knex.schema.hasTable("users");

    if (!hasUsersTable) {
        await knex.schema.createTable("users", (table) => {
            table.increments("UserID").primary();
            table.string("name", 120).notNullable();
            table.string("email", 255).notNullable().unique();
            table.text("password").notNullable();
            table.jsonb("app_data").notNullable().defaultTo(JSON.stringify(defaultAppData()));
        });

        return;
    }

    const hasAppDataColumn = await knex.schema.hasColumn("users", "app_data");
    if (!hasAppDataColumn) {
        await knex.schema.alterTable("users", (table) => {
            table.jsonb("app_data").notNullable().defaultTo(JSON.stringify(defaultAppData()));
        });
    }
}

module.exports = ensureUsersTable;

if (require.main === module) {
    ensureUsersTable()
        .then(() => {
            console.log("Esquema do banco validado sem depender de knex_migrations.");
            process.exit(0);
        })
        .catch((error) => {
            console.error("Erro ao validar o esquema do banco:", error.message);
            process.exit(1);
        });
}
