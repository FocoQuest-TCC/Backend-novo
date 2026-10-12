const knexfile = require("../../knexfile");
const environmet = process.env.NODE_ENV === 'production'
    ? 'production'
    : 'development';
const config = knexfile[environmet];

if (!config) {
    throw new Error(
        `Configuração do Knex não encontrada para: ${environmet}`
    );
}

const knex = require("knex")(config);

module.exports = knex;