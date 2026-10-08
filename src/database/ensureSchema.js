const knex = require("./index.js");
const ensureGuildSchema = require("./guildSchema");

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
            table.boolean("email_verified").notNullable().defaultTo(true);
            table.text("email_verification_token");
            table.timestamp("email_verification_expires_at", { useTz: true });
        });

        await ensureGuildSchema(knex);
        return;
    }

    const hasAppDataColumn = await knex.schema.hasColumn("users", "app_data");
    if (!hasAppDataColumn) {
        await knex.schema.alterTable("users", (table) => {
            table.jsonb("app_data").notNullable().defaultTo(JSON.stringify(defaultAppData()));
        });
    }

    const hasEmailVerifiedColumn = await knex.schema.hasColumn("users", "email_verified");
    if (!hasEmailVerifiedColumn) {
        await knex.schema.alterTable("users", (table) => {
            table.boolean("email_verified").notNullable().defaultTo(true);
            table.text("email_verification_token");
            table.timestamp("email_verification_expires_at", { useTz: true });
        });
    } else {
        const hasVerificationTokenColumn = await knex.schema.hasColumn("users", "email_verification_token");
        const hasVerificationExpiryColumn = await knex.schema.hasColumn("users", "email_verification_expires_at");
        if (!hasVerificationTokenColumn || !hasVerificationExpiryColumn) {
            await knex.schema.alterTable("users", (table) => {
                if (!hasVerificationTokenColumn) table.text("email_verification_token");
                if (!hasVerificationExpiryColumn) table.timestamp("email_verification_expires_at", { useTz: true });
            });
        }
    }

    await ensureGuildSchema(knex);
}

module.exports = ensureUsersTable;
module.exports.ensureGuildSchema = ensureGuildSchema;

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
