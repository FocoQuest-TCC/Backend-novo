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
            table.timestamp("joined_at").notNullable().defaultTo(knex.fn.now());
            table.unique(["guild_id", "user_id"]);
        });
    }

    if (!(await knex.schema.hasTable("guild_boards"))) {
        await knex.schema.createTable("guild_boards", (table) => {
            table.increments("id").primary();
            table.integer("guild_id").notNullable()
                .references("id").inTable("guilds").onDelete("CASCADE");
            table.string("name", 100).notNullable();
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
}

module.exports = ensureGuildSchema;
