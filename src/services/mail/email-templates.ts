import type { Mail } from "./mail.service.js";

export const APP_URL = (process.env.APP_URL ?? "https://www.bamakopodcast.studio").replace(/\/$/, "");

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function emailShell(opts: {
  preheader: string;
  badge?: string;
  title: string;
  contentHtml: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}) {
  const ctaHtml = opts.cta
    ? `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 28px auto 16px auto;">
      <tr>
        <td align="center" bgcolor="#FFBF00" style="background-color: #FFBF00 !important; border-radius: 12px; padding: 0;">
          <a href="${esc(opts.cta.url)}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 700; color: #09090B !important; text-decoration: none; border-radius: 12px; letter-spacing: 0.3px; background-color: #FFBF00 !important;">
            ${esc(opts.cta.label)} &rarr;
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; color: #71717A; text-align: center;">
      Si le bouton ne s'ouvre pas, suivez ce lien :<br>
      <a href="${esc(opts.cta.url)}" target="_blank" style="color: #FFBF00; text-decoration: underline; word-break: break-all;">
        ${esc(opts.cta.url)}
      </a>
    </p>
  `
    : "";

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${esc(opts.title)}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  </style>
</head>
<body bgcolor="#09090B" style="margin: 0; padding: 0; background-color: #09090B; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <!-- Preheader text for inbox preview -->
  <span style="display: none; font-size: 1px; color: #09090B; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${esc(opts.preheader)}
  </span>

  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#09090B" style="background-color: #09090B;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <!-- Card Container -->
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; background-color: #141416; border: 1px solid #27272A; border-radius: 18px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);">
          <!-- Top Header -->
          <tr>
            <td align="center" style="padding: 32px 32px 12px 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" bgcolor="#1F1F23" style="background-color: #1F1F23; border: 1px solid #333338; border-radius: 100px; padding: 7px 18px;">
                    <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #FFBF00; text-transform: uppercase;">
                      ${esc(opts.badge ?? "BAMAKO PODCAST")}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 12px 32px 28px 32px;">
              <h1 style="margin: 0 0 18px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 700; color: #FFFFFF; line-height: 1.35; letter-spacing: -0.3px; text-align: center;">
                ${esc(opts.title)}
              </h1>

              ${opts.contentHtml}

              ${ctaHtml}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top: 1px solid #27272A; font-size: 1px; line-height: 1px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 32px 28px 32px; text-align: center;">
              <p style="margin: 0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 600; color: #A1A1AA;">
                Bamako Podcast &bull; La voix du Mali et d'Afrique
              </p>
              <p style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #71717A;">
                ${esc(opts.footerNote ?? "Vous recevez cet email car vous avez un compte sur Bamako Podcast.")}
              </p>
              <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #52525B;">
                <a href="${APP_URL}" target="_blank" style="color: #A1A1AA; text-decoration: underline;">bamakopodcast.studio</a>
                &nbsp;&bull;&nbsp;
                <a href="${APP_URL}/privacy" target="_blank" style="color: #A1A1AA; text-decoration: underline;">Confidentialité</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderOtpBox(code: string) {
  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 24px auto;">
      <tr>
        <td align="center" bgcolor="#1C1C1F" style="background-color: #1C1C1F; border: 1px solid #333338; border-radius: 14px; padding: 22px 32px; text-align: center;">
          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #A1A1AA; text-transform: uppercase; display: block; margin-bottom: 8px;">CODE DE VÉRIFICATION</span>
          <span style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif; font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #FFBF00; display: block; margin-bottom: 8px; padding-left: 10px;">${esc(code)}</span>
          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 500; color: #71717A; display: block;">Valable 15 minutes &bull; Usage unique</span>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
      <tr>
        <td bgcolor="#18181B" style="background-color: #18181B; border-left: 3px solid #FFBF00; border-radius: 8px; padding: 12px 16px;">
          <p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 18px; color: #D4D4D8;">
            &#128274; <strong>Sécurité :</strong> Ne partagez jamais ce code. L'équipe de Bamako Podcast ne vous le demandera jamais.
          </p>
        </td>
      </tr>
    </table>
  `;
}

function text(title: string, paragraphs: string[], url?: string) {
  return [title, "", ...paragraphs, ...(url ? ["", url] : []), "", "— Bamako Podcast"].join("\n");
}

export const Emails = {
  async otp(to: string, code: string, userName?: string | null): Promise<Mail> {
    const greeting = userName?.trim() ? `Bonjour ${userName.trim().split(" ")[0]},` : "Bonjour,";
    const paragraphs = [
      greeting,
      "Pour sécuriser votre compte et finaliser votre inscription, veuillez saisir le code de vérification ci-dessous :",
    ];

    const contentHtml = `
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        ${esc(greeting)}
      </p>
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        Pour sécuriser votre compte et finaliser votre inscription, veuillez saisir le code de vérification ci-dessous :
      </p>
      ${renderOtpBox(code)}
      <p style="margin: 16px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 18px; color: #71717A;">
        Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité : votre compte reste protégé.
      </p>
    `;

    const htmlContent = emailShell({
      preheader: `${code} est votre code de vérification Bamako Podcast`,
      badge: "VÉRIFICATION",
      title: "Vérifiez votre compte",
      contentHtml,
    });

    return {
      to,
      subject: `${code} est votre code de vérification Bamako Podcast`,
      html: htmlContent,
      text: text("Vérifiez votre compte", paragraphs),
    };
  },

  async loginOtp(to: string, code: string, userName?: string | null): Promise<Mail> {
    const greeting = userName?.trim() ? `Bonjour ${userName.trim().split(" ")[0]},` : "Bonjour,";
    const paragraphs = [
      greeting,
      "Voici votre code de connexion instantanée pour accéder directement à votre compte Bamako Podcast :",
    ];

    const contentHtml = `
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        ${esc(greeting)}
      </p>
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        Voici votre code de connexion instantanée pour accéder directement à votre compte Bamako Podcast :
      </p>
      ${renderOtpBox(code)}
      <p style="margin: 16px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 18px; color: #71717A;">
        Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.
      </p>
    `;

    const htmlContent = emailShell({
      preheader: `${code} est votre code de connexion instantanée`,
      badge: "CONNEXION",
      title: "Connexion instantanée",
      contentHtml,
    });

    return {
      to,
      subject: `${code} est votre code de connexion Bamako Podcast`,
      html: htmlContent,
      text: text("Connexion instantanée", paragraphs),
    };
  },

  async resetPassword(to: string, otpCode: string, userName?: string | null): Promise<Mail> {
    const url = `${APP_URL}/reset-password?email=${encodeURIComponent(to)}&code=${encodeURIComponent(otpCode)}`;
    const greeting = userName?.trim() ? `Bonjour ${userName.trim().split(" ")[0]},` : "Bonjour,";
    const paragraphs = [
      greeting,
      "Vous avez demandé à réinitialiser le mot de passe de votre compte Bamako Podcast.",
      `Votre code de réinitialisation est : ${otpCode}`,
      "Ce code est valable 15 minutes.",
    ];

    const contentHtml = `
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        ${esc(greeting)}
      </p>
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        Vous avez demandé à réinitialiser votre mot de passe. Voici votre code sécurisé à usage unique :
      </p>
      ${renderOtpBox(otpCode)}
      <p style="margin: 16px 0 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 18px; color: #71717A;">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.
      </p>
    `;

    const htmlContent = emailShell({
      preheader: `Code ${otpCode} — Réinitialisation de votre mot de passe`,
      badge: "SÉCURITÉ",
      title: "Réinitialisation du mot de passe",
      contentHtml,
      cta: { label: "Réinitialiser mon mot de passe", url },
    });

    return {
      to,
      subject: `${otpCode} est votre code de réinitialisation Bamako Podcast`,
      html: htmlContent,
      text: text("Réinitialisation du mot de passe", paragraphs, url),
    };
  },

  invitation(to: string, o: { podcastName: string; inviterName: string; roleLabel: string; token: string }): Mail {
    const url = `${APP_URL}/invitations/accept?token=${encodeURIComponent(o.token)}`;
    const paragraphs = [
      `${o.inviterName} vous invite à rejoindre l'équipe du podcast « ${o.podcastName} » en tant que ${o.roleLabel}.`,
      "Connectez-vous avec cette adresse email pour accepter l'invitation. Le lien est valable 7 jours.",
    ];

    const contentHtml = `
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        <strong>${esc(o.inviterName)}</strong> vous invite à rejoindre l'équipe du podcast <strong>« ${esc(o.podcastName)} »</strong> en tant que <strong>${esc(o.roleLabel)}</strong>.
      </p>
      <p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">
        Rejoignez le studio pour collaborer à la production et à la publication des épisodes.
      </p>
    `;

    const htmlContent = emailShell({
      preheader: `Invitation : rejoignez l'équipe de « ${o.podcastName} »`,
      badge: "INVITATION STUDIO",
      title: "Rejoignez l'équipe",
      contentHtml,
      cta: { label: "Voir et accepter l'invitation", url },
    });

    return {
      to,
      subject: `Invitation : rejoignez « ${o.podcastName} »`,
      html: htmlContent,
      text: text("Invitation à rejoindre une équipe", paragraphs, url),
    };
  },

  notification(to: string, o: { title: string; body?: string | null; link?: string | null }): Mail {
    const url = o.link ? (o.link.startsWith("http") ? o.link : `${APP_URL}${o.link}`) : undefined;
    const paragraphs = o.body ? [o.body] : [];

    const contentHtml = paragraphs
      .map(
        (p) =>
          `<p style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.65; color: #D4D4D8;">${esc(
            p
          )}</p>`
      )
      .join("");

    const htmlContent = emailShell({
      preheader: o.title,
      badge: "BAMAKO PODCAST",
      title: o.title,
      contentHtml,
      cta: url ? { label: "Écouter sur Bamako Podcast", url } : undefined,
    });

    return {
      to,
      subject: o.title,
      html: htmlContent,
      text: text(o.title, paragraphs, url),
    };
  },
};
