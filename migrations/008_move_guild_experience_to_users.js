exports.up = async function up(knex) {
    if (!(await knex.schema.hasColumn("users", "experience"))) {
        await knex.schema.alterTable("users", (table) => {
            table.integer("experience").notNullable().defaultTo(0);
        });
    }

    if (await knex.schema.hasColumn("guild_memberships", "experience")) {
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
};

exports.down = async function down(knex) {
    if (await knex.schema.hasColumn("users", "experience")) {
        await knex.schema.alterTable("users", (table) => {
            table.dropColumn("experience");
        });
    }
};
