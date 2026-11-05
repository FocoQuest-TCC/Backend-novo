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

async function moveGuildExperienceToUsers() {
    if (!(await knex.schema.hasTable("guild_memberships"))
        || !(await knex.schema.hasColumn("guild_memberships", "experience"))) {
        return;
    }

    await knex.transaction(async (transaction) => {
        const memberships = await transaction("guild_memberships")
            .select("user_id", "experience");
        for (const membership of memberships) {
            const experience = Number(membership.experience) || 0;
            if (experience > 0) {
                await transaction("users")
                    .where("UserID", membership.user_id)
                    .increment("experience", experience);
            }
        }
        await transaction.schema.alterTable("guild_memberships", (table) => {
            table.dropColumn("experience");
        });
    });
}

async function ensureUsersTable() {
    const hasUsersTable = await knex.schema.hasTable("users");

    if (!hasUsersTable) {
        await knex.schema.createTable("users", (table) => {
            table.increments("UserID").primary();
            table.string("name", 120).notNullable();
            table.string("email", 255).notNullable().unique();
            table.text("password").notNullable();
            table.string("character_id", 40);
            table.integer("experience").notNullable().defaultTo(0);
            table.jsonb("app_data").notNullable().defaultTo(JSON.stringify(defaultAppData()));
            table.boolean("email_verified").notNullable().defaultTo(true);
            table.text("email_verification_token");
            table.timestamp("email_verification_expires_at", { useTz: true });
        });

        await ensureGuildSchema(knex);
        await moveGuildExperienceToUsers();
        return;
    }

    const hasExperienceColumn = await knex.schema.hasColumn("users", "experience");
    if (!hasExperienceColumn) {
        await knex.schema.alterTable("users", (table) => {
            table.integer("experience").notNullable().defaultTo(0);
        });
    }

    const hasCharacterColumn = await knex.schema.hasColumn("users", "character_id");
    if (!hasCharacterColumn) {
        await knex.schema.alterTable("users", (table) => {
            table.string("character_id", 40);
        });
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
    await moveGuildExperienceToUsers();
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
