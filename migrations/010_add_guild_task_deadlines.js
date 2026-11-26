exports.up = async function up(knex) {
    const hasDueDate = await knex.schema.hasColumn("guild_tasks", "due_date");
    const hasPenaltyDays = await knex.schema.hasColumn("guild_tasks", "penalty_days_applied");
    if (!hasDueDate || !hasPenaltyDays) {
        await knex.schema.alterTable("guild_tasks", (table) => {
            if (!hasDueDate) table.date("due_date").nullable();
            if (!hasPenaltyDays) table.integer("penalty_days_applied").notNullable().defaultTo(0);
        });
    }
};

exports.down = async function down(knex) {
    const hasDueDate = await knex.schema.hasColumn("guild_tasks", "due_date");
    const hasPenaltyDays = await knex.schema.hasColumn("guild_tasks", "penalty_days_applied");
    if (hasDueDate || hasPenaltyDays) {
        await knex.schema.alterTable("guild_tasks", (table) => {
            if (hasDueDate) table.dropColumn("due_date");
            if (hasPenaltyDays) table.dropColumn("penalty_days_applied");
        });
    }
};
