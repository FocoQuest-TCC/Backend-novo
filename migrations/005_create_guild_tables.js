const ensureGuildSchema = require("../src/database/guildSchema");

exports.up = ensureGuildSchema;

exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists("guild_task_assignees");
    await knex.schema.dropTableIfExists("guild_tasks");
    await knex.schema.dropTableIfExists("guild_boards");
    await knex.schema.dropTableIfExists("guild_memberships");
    await knex.schema.dropTableIfExists("guilds");
};
