const express = require("express");
const cors = require("cors");

const routes = require("./routes");
const ensureUsersTable = require("./database/ensureSchema");

const app = express();

app.use(cors());
app.use(express.json());

let schemaPromise;

app.use(async (req, res, next) =>{
    try {
        if (!schemaPromise) {
            schemaPromise = ensureUsersTable().catch((error) =>{
                schemaPromise = null;
                throw error;
            });
        }

        await schemaPromise;
        next();
    } catch (error) {
        console.error("Erro ao preparar o banco:", error);
        res.status(500).json({
            error: 'Erro ao incicializar o banco de dados',
        });
    }
});

app.use(routes);

app.get('/', (req, res) =>{
    res.json({message: 'API do FocoQuest funcionando!'})
});

module.exports = app;