const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const ensureUsersTable = require("./database/ensureSchema");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(routes);

const port = process.env.PORT ?? 6900;

async function startServer() {
    try {
        await ensureUsersTable();

        if (!process.env.DATABASE_URL && !process.env.PG_HOST) {
            console.warn("Banco não configurado: crie Backend-TCC-Back/.env com DATABASE_URL ou PG_*.");
        }

        app.listen(port, () => {
            console.log(`Servidor rodando na porta ${port}`);
        });
    } catch (error) {
        console.error("Erro ao iniciar o backend:", error.message);
        process.exit(1);
    }
}

startServer();