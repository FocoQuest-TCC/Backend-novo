exports.up = async function up(knex) {
    const hasContributionXp = await knex.schema.hasColumn(
        "guild_memberships",
        "contribution_xp",
    );
    if (!hasContributionXp) {
        await knex.schema.alterTable("guild_memberships", (table) => {
            table.integer("contribution_xp").notNullable().defaultTo(0);
        });

        if (await knex.schema.hasColumn("guild_memberships", "experience")) {
            await knex("guild_memberships").update({
                contribution_xp: knex.raw("COALESCE(experience, 0)"),
            });
        } else {
            const userExperience = knex("users")
                .select("experience")
                .whereRaw("?? = ??", ["users.UserID", "guild_memberships.user_id"]);
            await knex("guild_memberships").update({
                contribution_xp: knex.raw("COALESCE((?), 0)", [userExperience]),
            });
        }
    }
};

exports.down = async function down(knex) {
    if (await knex.schema.hasColumn("guild_memberships", "contribution_xp")) {
        await knex.schema.alterTable("guild_memberships", (table) => {
            table.dropColumn("contribution_xp");
        });
    }
};
