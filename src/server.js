const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const routes = require("./routes");
const ensureUsersTable = require("./database/ensureSchema");

const app = express();
app.use(cors());
app.use(express.json());
app.use(routes);

const port = process.env.PORT ?? 6900;

async function startServer() {
    try {
        if (!process.env.DATABASE_URL && !process.env.PG_HOST) {
            throw new Error(
                "Banco não configurado. Crie Backend-novo-back/.env com DATABASE_URL (recomendado para o Neon) ou configure PG_HOST, PG_DATABASE, PG_USER e PG_PASSWORD."
            );
        }

        await ensureUsersTable();

        app.listen(port, () => {
            console.log(`Servidor rodando na porta ${port}`);
        });
    } catch (error) {
        console.error("Erro ao iniciar o backend:", error.message);
        process.exit(1);
    }
}

startServer();