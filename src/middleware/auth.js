const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

if (
  !JWT_SECRET ||
  Buffer.byteLength(JWT_SECRET, "utf8") < 32
) {
  throw new Error("Configure JWT_SECRET com uma chave aleatória de pelo menos 32 bytes.");
}

function authenticate(req, res, next) {
    const authorization = req.headers.authorization || "";

    const match = /^Bearer\s+(\S+)$/i.exec(authorization);

    if (!match) {
        return res.status(401).json({message: "Token de autenticação ausente.",});
    }

    try {
        const payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ["HS256"] });

        if (!payload || typeof payload !== "object") {
          throw new Error("Payload inválido");
        }

        const userId = Number(payload.userId);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
          throw new Error("ID inválido");
        }

        req.auth = {userId: String(userId),};

        return next();

    } catch {
        return res.status(401).json({message:"Token inválido ou expirado.",});
    }
}

function sameUser(req, res, next) {
    if (!req.auth || String(req.auth.userId) !== String(req.params.id)) {
        return res.status(403).json({message:"Você não pode acessar os dados de outro usuário.",});
    }

    next();
}

module.exports = {authenticate, sameUser,};