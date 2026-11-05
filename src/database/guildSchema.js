async function ensureGuildSchema(knex) {
    if (!(await knex.schema.hasTable("guilds"))) {
        await knex.schema.createTable("guilds", (table) => {
            table.increments("id").primary();
            table.string("name", 80).notNullable();
            table.string("code", 12).notNullable().unique();
            table.integer("created_by").notNullable()
                .references("UserID").inTable("users").onDelete("CASCADE");
            table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
        });
    }

    if (!(await knex.schema.hasTable("guild_memberships"))) {
        await knex.schema.createTable("guild_memberships", (table) => {
            table.increments("id").primary();
            table.integer("guild_id").notNullable()
                .references("id").inTable("guilds").onDelete("CASCADE");
            table.integer("user_id").notNullable().unique()
                .references("UserID").inTable("users").onDelete("CASCADE");
            table.enu("role", ["admin", "member"]).notNullable().defaultTo("member");
            table.integer("contribution_xp").notNullable().defaultTo(0);
            table.timestamp("joined_at").notNullable().defaultTo(knex.fn.now());
            table.unique(["guild_id", "user_id"]);
        });
    }

    const membershipHasLegacyExperience = await knex.schema.hasColumn(
        "guild_memberships",
        "experience",
    );
    const membershipHasContributionXp = await knex.schema.hasColumn(
        "guild_memberships",
        "contribution_xp",
    );
    if (!membershipHasContributionXp) {
        await knex.schema.alterTable("guild_memberships", (table) => {
            table.integer("contribution_xp").notNullable().defaultTo(0);
        });
        if (membershipHasLegacyExperience) {
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

    if (!(await knex.schema.hasTable("guild_boards"))) {
        await knex.schema.createTable("guild_boards", (table) => {
            table.increments("id").primary();
            table.integer("guild_id").notNullable()
                .references("id").inTable("guilds").onDelete("CASCADE");
            table.string("name", 100).notNullable();
            table.string("boss_id", 40).notNullable().defaultTo("cao");
            table.timestamp("closed_at").nullable();
            table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
        });
    }

    if (!(await knex.schema.hasTable("guild_tasks"))) {
        await knex.schema.createTable("guild_tasks", (table) => {
            table.increments("id").primary();
            table.integer("board_id").notNullable()
                .references("id").inTable("guild_boards").onDelete("CASCADE");
            table.string("text", 240).notNullable();
            table.enu("column", ["todo", "doing"]).notNullable().defaultTo("todo");
            table.integer("boss_damage").notNullable().defaultTo(0);
            table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
        });
    }

    if (!(await knex.schema.hasTable("guild_task_assignees"))) {
        await knex.schema.createTable("guild_task_assignees", (table) => {
            table.increments("id").primary();
            table.integer("task_id").notNullable()
                .references("id").inTable("guild_tasks").onDelete("CASCADE");
            table.integer("user_id").notNullable()
                .references("UserID").inTable("users").onDelete("CASCADE");
            table.boolean("completed").notNullable().defaultTo(false);
            table.timestamp("completed_at").nullable();
            table.unique(["task_id", "user_id"]);
        });
    }

    const boardHasBossId = await knex.schema.hasColumn("guild_boards", "boss_id");
    const boardHasClosedAt = await knex.schema.hasColumn("guild_boards", "closed_at");
    if (!boardHasBossId || !boardHasClosedAt) {
        await knex.schema.alterTable("guild_boards", (table) => {
            if (!boardHasBossId) table.string("boss_id", 40).notNullable().defaultTo("cao");
            if (!boardHasClosedAt) table.timestamp("closed_at").nullable();
        });
    }
    await knex("guild_boards")
        .where((query) => query.whereNull("boss_id").orWhere("boss_id", ""))
        .update({
            boss_id: knex.raw("CASE WHEN random() < 0.5 THEN 'bluelobister' ELSE 'cao' END"),
        });

    const taskHasBossDamage = await knex.schema.hasColumn("guild_tasks", "boss_damage");
    if (!taskHasBossDamage) {
        await knex.schema.alterTable("guild_tasks", (table) => {
            table.integer("boss_damage").notNullable().defaultTo(0);
        });
    }

    await knex("guild_tasks")
        .where({ boss_damage: 0 })
        .update({ boss_damage: knex.raw("floor(random() * 80001) + 20000") });
}

module.exports = ensureGuildSchema;
