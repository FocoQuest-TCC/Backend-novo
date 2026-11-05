exports.up = async function up(knex) {
    const hasCharacterColumn = await knex.schema.hasColumn("users", "character_id");
    if (!hasCharacterColumn) {
        await knex.schema.alterTable("users", table => {
            table.string("character_id", 40);
        });
    }
};

exports.down = async function down(knex) {
    const hasCharacterColumn = await knex.schema.hasColumn("users", "character_id");
    if (hasCharacterColumn) {
        await knex.schema.alterTable("users", table => table.dropColumn("character_id"));
    }
};
