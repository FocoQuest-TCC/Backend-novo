const nodemailer = require("nodemailer");

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

async function sendVerificationEmail({ email, name, token }) {
    const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;
    const from = EMAIL_FROM || SMTP_USER;
    const frontendUrl = process.env.FRONTEND_URL || (
        process.env.NODE_ENV === "production" ? "" : "http://localhost:5173"
    );

    if (!SMTP_HOST || !from) {
        throw new Error("SMTP_HOST e EMAIL_FROM (ou SMTP_USER) precisam estar configurados.");
    }
    if (!frontendUrl) {
        throw new Error("FRONTEND_URL precisa estar configurada para enviar links de confirmação em produção.");
    }

    let verificationUrl;
    try {
        verificationUrl = new URL("/verify-email", frontendUrl);
    } catch {
        throw new Error("FRONTEND_URL precisa ser uma URL válida.");
    }
    if (!["http:", "https:"].includes(verificationUrl.protocol)) {
        throw new Error("FRONTEND_URL precisa usar HTTP ou HTTPS.");
    }

    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT || 587),
        secure: SMTP_SECURE === "true",
        ...(SMTP_USER && SMTP_PASSWORD ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD } } : {}),
    });
    verificationUrl.searchParams.set("token", token);

    await transporter.sendMail({
        from,
        to: email,
        subject: "Confirme seu email - FocoQuest",
        text: `Olá, ${name}!\n\nConfirme seu endereço de email acessando: ${verificationUrl.href}\n\nO link expira em 24 horas.`,
        html: `<p>Olá, ${escapeHtml(name)}!</p><p>Para confirmar seu endereço de email, <a href="${verificationUrl.href}">clique neste link</a>.</p><p>O link expira em 24 horas.</p>`,
    });
}

module.exports = { sendVerificationEmail };
