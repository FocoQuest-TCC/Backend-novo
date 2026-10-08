const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const knex = require("../database/index.js");
const { sendVerificationEmail } = require("../services/emailVerification.js");

const JWT_SECRET = process.env.JWT_SECRET || "focoquest-development-secret";
const PASSWORD_ROUNDS = 12;
const googleClient = new OAuth2Client();

function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmail(email) {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user) {
    const {
        password: _password,
        email_verification_token: _verificationToken,
        email_verification_expires_at: _verificationExpiry,
        ...safeUser
    } = user;
    return safeUser;
}

function createToken(user) {
    return jwt.sign({ userId: String(user.UserID) }, JWT_SECRET, { expiresIn: "7d" });
}

function defaultAppData() {
    return {
        tasks: [],
        habits: [],
        boards: [],
        kanbanTasks: [],
        inventory: [],
        gold: 0,
        gems: 0,
    };
}

module.exports = {

    async login(req, res){
        const { password } = req.body;
        const email = normalizeEmail(req.body.email);

        if (!email || !password) {
            return res.status(400).send({ message: "Email e senha são obrigatórios" });
        }

        try {
            const user = await knex("users").whereRaw("LOWER(email) = ?", [email]).first();

            if (!user) {
                return res.status(401).send({ message: "Email ou senha inválidos" });
            }

            if (user.email_verified === false) {
                return res.status(403).send({ message: "Confirme seu email pelo link que enviamos antes de entrar." });
            }

            let passwordMatches = await bcrypt.compare(password, user.password);

            // Rehashes accounts created before bcrypt was enabled.
            if (!passwordMatches && !user.password.startsWith("$2")) {
                passwordMatches = user.password === password;
                if (passwordMatches) {
                    const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
                    await knex("users").where("UserID", user.UserID).update({ password: passwordHash });
                }
            }

            if (!passwordMatches) {
                return res.status(401).send({ message: "Email ou senha inválidos" });
            }

            return res.status(200).send({ token: createToken(user), user: publicUser(user) });
        } catch (error) {
            return res.status(500).send({ message: "Erro ao entrar", error: error.message });
        }
    },

    async googleAuth(req, res) {
        const credential = req.body?.credential;
        const clientId = process.env.GOOGLE_CLIENT_ID;

        if (!clientId) {
            return res.status(503).send({ message: "O acesso com Google ainda não está configurado no servidor." });
        }
        if (typeof credential !== "string" || !credential) {
            return res.status(400).send({ message: "A credencial do Google é obrigatória." });
        }

        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
            payload = ticket.getPayload();
        } catch (error) {
            console.error("Erro ao validar credencial do Google:", error.message);
            return res.status(401).send({ message: "Não foi possível validar sua conta Google. Tente novamente." });
        }

        if (!payload || payload.email_verified !== true || !payload.email) {
            return res.status(401).send({ message: "A conta Google precisa ter um email verificado." });
        }

        const email = normalizeEmail(payload.email);
        try {
            let user = await knex("users").whereRaw("LOWER(email) = ?", [email]).first();

            if (user) {
                if (user.email_verified === false) {
                    await knex("users").where("UserID", user.UserID).update({
                        email_verified: true,
                        email_verification_token: null,
                        email_verification_expires_at: null,
                    });
                    user = await knex("users").where("UserID", user.UserID).first();
                }
            } else {
                const randomPassword = crypto.randomBytes(32).toString("hex");
                const passwordHash = await bcrypt.hash(randomPassword, PASSWORD_ROUNDS);
                [user] = await knex("users")
                    .insert({
                        name: (payload.name || email.split("@")[0]).slice(0, 120),
                        email,
                        password: passwordHash,
                        app_data: defaultAppData(),
                        email_verified: true,
                    })
                    .returning("*");
            }

            return res.status(200).send({ token: createToken(user), user: publicUser(user) });
        } catch (error) {
            console.error("Erro ao criar ou localizar usuário Google:", error.message);
            return res.status(500).send({ message: "Não foi possível concluir o acesso com Google." });
        }
    },

    async verifyEmail(req, res) {
        const token = req.body?.token;
        if (typeof token !== "string" || !token) {
            return res.status(400).send({ message: "O link de confirmação é inválido." });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        try {
            const user = await knex("users")
                .where({ email_verification_token: tokenHash })
                .where("email_verification_expires_at", ">", new Date())
                .first();

            if (!user) {
                return res.status(400).send({ message: "Este link de confirmação é inválido ou expirou." });
            }

            await knex("users").where("UserID", user.UserID).update({
                email_verified: true,
                email_verification_token: null,
                email_verification_expires_at: null,
            });

            return res.status(200).send({ message: "Email confirmado! Agora você já pode entrar na sua conta." });
        } catch (error) {
            console.error("Erro ao confirmar email:", error.message);
            return res.status(500).send({ message: "Não foi possível confirmar seu email agora." });
        }
    },

    //Search

    async getAllUsers(req, res){
        try {
            const result = await knex("users").select("UserID", "name", "email").orderBy("UserID")
            return res.status(200).send(result)
        } catch (error) {
            return res.status(500).send({ error: error.message })
        }
    },

    async getUserById(req, res){
        const { id } = req.params
        try {
            const result = await knex("users").select("UserID", "name", "email").where("UserID", id)
            return res.status(200).send(result)
        } catch (error) {
            return res.status(500).send({ error: error.message })
        }
    },

    //Creation

    async createUser(req, res){
        const { name, password } = req.body || {};
        const email = normalizeEmail(req.body?.email);

        if (!name || !email || !password) {
            return res.status(400).send({ message: "Nome, email e senha são obrigatórios" });
        }
        if (typeof name !== "string" || name.trim().length > 120) {
            return res.status(400).send({ message: "O nome deve ter no máximo 120 caracteres." });
        }
        if (!isValidEmail(email)) {
            return res.status(400).send({ message: "Informe um endereço de email válido." });
        }
        if (typeof password !== "string" || password.length < 6) {
            return res.status(400).send({ message: "A senha deve ter pelo menos 6 caracteres." });
        }

        try {
            const existingUser = await knex("users").whereRaw("LOWER(email) = ?", [email]).first();
            if (existingUser) {
                return res.status(409).send({ message: "Este email já está cadastrado" });
            }

            const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
            const verificationToken = crypto.randomBytes(32).toString("hex");
            const verificationTokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const [user] = await knex("users")
                .insert({
                    name: name.trim(),
                    email,
                    password: passwordHash,
                    app_data: defaultAppData(),
                    email_verified: false,
                    email_verification_token: verificationTokenHash,
                    email_verification_expires_at: expiresAt,
                })
                .returning(["UserID", "name", "email", "app_data"]);

            try {
                await sendVerificationEmail({ email, name: name.trim(), token: verificationToken });
            } catch (mailError) {
                await knex("users").where("UserID", user.UserID).del();
                console.error("Erro ao enviar email de confirmação:", mailError.message);
                return res.status(503).send({
                    message: "Não foi possível enviar o email de confirmação. Verifique a configuração SMTP no .env do backend e tente novamente.",
                });
            }

            return res.status(201).send({
                message: "Enviamos um link de confirmação para seu email. Confirme o endereço antes de entrar.",
            });
        } catch (error) {
            if (error.code === "23505") {
                return res.status(409).send({ message: "Este email já está cadastrado" });
            }
            console.error("Erro ao criar usuário:", error.message);
            return res.status(500).send({ message: "Erro ao criar usuário." });
        }
    },

    async updateUser(req, res){
        const { id } = req.params;
        const { name, email, password } = req.body;
        const info = {};

        if (name) info.name = name;
        if (email) info.email = email.toLowerCase();
        if (password) info.password = await bcrypt.hash(password, PASSWORD_ROUNDS);

        await knex("users").where("UserID", id).update(info);
        return res.status(200).send({ message: "User updated successfully" });
    },

    async deleteUser(req, res){
        const {id} = req.params;
        await knex("users").where("UserID", id).del()
        return res.status(200).send({ message: "User deleted successfully" });
    },

    async getUserData(req, res) {
        const user = await knex("users").select("app_data").where("UserID", req.params.id).first();
        if (!user) return res.status(404).send({ message: "Usuário não encontrado" });
        return res.status(200).send({ data: user.app_data || defaultAppData() });
    },

    async updateUserData(req, res) {
        const data = req.body?.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return res.status(400).send({ message: "Os dados do usuário são inválidos" });
        }

        await knex("users").where("UserID", req.params.id).update({ app_data: data });
        return res.status(200).send({ data });
    }
}