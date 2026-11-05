const ensureGuildSchema = require("../src/database/guildSchema");

exports.up = ensureGuildSchema;

exports.down = async function down(knex) {
    if (await knex.schema.hasColumn("guild_tasks", "boss_damage")) {
        await knex.schema.alterTable("guild_tasks", (table) => table.dropColumn("boss_damage"));
    }

    const hasBossId = await knex.schema.hasColumn("guild_boards", "boss_id");
    const hasClosedAt = await knex.schema.hasColumn("guild_boards", "closed_at");
    if (hasBossId || hasClosedAt) {
        await knex.schema.alterTable("guild_boards", (table) => {
            if (hasBossId) table.dropColumn("boss_id");
            if (hasClosedAt) table.dropColumn("closed_at");
        });
    }

    if (await knex.schema.hasColumn("guild_memberships", "experience")) {
        await knex.schema.alterTable("guild_memberships", (table) => table.dropColumn("experience"));
    }
};
