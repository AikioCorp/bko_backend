import type { Mail } from "./mail.service.js";

export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function layout(opts: { preheader: string; title: string; paragraphs: string[]; cta?: { label: string; url: string }; footer?: string }) {
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#d9d9d9">${esc(p)}</p>`).join("");
  const cta = opts.cta
    ? `<p style="margin:22px 0"><a href="${esc(opts.cta.url)}" style="background:#FFBF00;color:#0B0B0B;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">${esc(opts.cta.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#8a8a8a">Si le bouton ne fonctionne pas, copiez ce lien :<br>${esc(opts.cta.url)}</p>`
    : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0B0B0B;font-family:Arial,Helvetica,sans-serif">
<span style="display:none;opacity:0;height:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#161616;border:1px solid #262626;border-radius:16px">
<tr><td style="padding:28px">
<p style="margin:0 0 18px;font-size:13px;font-weight:700;letter-spacing:.12em;color:#FFBF00">BAMAKO PODCAST</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#ffffff">${esc(opts.title)}</h1>
${body}${cta}
<p style="margin:22px 0 0;font-size:12px;color:#8a8a8a">${esc(opts.footer ?? "Vous recevez cet email car vous avez un compte sur Bamako Podcast.")}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function text(title: string, paragraphs: string[], url?: string) {
  return [title, "", ...paragraphs, ...(url ? ["", url] : []), "", "— Bamako Podcast"].join("\n");
}

export const Emails = {
  otp(to: string, code: string): Mail {
    const paragraphs = [`Votre code de vérification est : ${code}`, "Il est valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email."];
    return {
      to,
      subject: `Votre code de vérification : ${code}`,
      html: layout({ preheader: `Code ${code}`, title: "Vérifiez votre compte", paragraphs }),
      text: text("Vérifiez votre compte", paragraphs),
    };
  },

  resetPassword(to: string, token: string): Mail {
    const url = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const paragraphs = [
      "Vous avez demandé à réinitialiser votre mot de passe.",
      "Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
    ];
    return {
      to,
      subject: "Réinitialisation de votre mot de passe",
      html: layout({
        preheader: "Réinitialisez votre mot de passe",
        title: "Réinitialisation du mot de passe",
        paragraphs,
        cta: { label: "Choisir un nouveau mot de passe", url },
      }),
      text: text("Réinitialisation du mot de passe", paragraphs, url),
    };
  },

  invitation(to: string, o: { podcastName: string; inviterName: string; roleLabel: string; token: string }): Mail {
    const url = `${APP_URL}/invitations/accept?token=${encodeURIComponent(o.token)}`;
    const paragraphs = [
      `${o.inviterName} vous invite à rejoindre l'équipe du podcast « ${o.podcastName} » en tant que ${o.roleLabel}.`,
      "Connectez-vous avec cette adresse email (ou créez un compte avec elle) puis acceptez l'invitation. Le lien est valable 7 jours.",
    ];
    return {
      to,
      subject: `Invitation : rejoignez « ${o.podcastName} »`,
      html: layout({ preheader: "Vous êtes invité(e) à rejoindre une équipe", title: "Invitation à rejoindre une équipe", paragraphs, cta: { label: "Voir l'invitation", url } }),
      text: text("Invitation à rejoindre une équipe", paragraphs, url),
    };
  },

  notification(to: string, o: { title: string; body?: string | null; link?: string | null }): Mail {
    const url = o.link ? `${APP_URL}${o.link}` : undefined;
    const paragraphs = o.body ? [o.body] : [];
    return {
      to,
      subject: o.title,
      html: layout({ preheader: o.title, title: o.title, paragraphs, cta: url ? { label: "Ouvrir", url } : undefined }),
      text: text(o.title, paragraphs, url),
    };
  },
};
