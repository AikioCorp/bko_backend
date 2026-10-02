import nodemailer, { Transporter } from "nodemailer";
import { prisma } from "../../config/prisma.js";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim(); // anti injection d'en-têtes

type Provider = "smtp" | "resend" | "console";

function provider(): Provider {
  const forced = process.env.MAIL_PROVIDER as Provider | undefined;
  if (forced) return forced;
  if (process.env.SMTP_HOST) return "smtp";
  if (process.env.RESEND_API_KEY) return "resend";
  return "console";
}

let transporter: Transporter | null = null;
function smtp() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 8000,
      socketTimeout: 10000,
    });
  }
  return transporter;
}

export class MailService {
  static get from() {
    return process.env.MAIL_FROM ?? "Bamako Podcast <no-reply@bamakopodcast.studio>";
  }

  /** Remise réelle ; lève une erreur en cas d'échec (utilisée par le worker pour réessayer). */
  static async deliver(mail: Mail): Promise<void> {
    if (!EMAIL_RE.test(mail.to)) throw new Error(`Adresse email invalide : ${mail.to}`);
    const message = { from: this.from, to: mail.to, subject: clean(mail.subject), html: mail.html, text: mail.text };

    switch (provider()) {
      case "smtp":
        await smtp().sendMail(message);
        return;
      case "resend": {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
        return;
      }
      default:
        // Développement : aucun email réel, le contenu est affiché dans la console du serveur.
        if (process.env.NODE_ENV === "production") {
          throw new Error("Aucun fournisseur d'email configuré (SMTP_HOST ou RESEND_API_KEY) en production.");
        }
        console.log(`\n[mail:console] À : ${mail.to}\nSujet : ${message.subject}\n${mail.text}\n`);
    }
  }

  /**
   * Envoi immédiat pour les emails portant un secret (OTP, réinitialisation, invitation) :
   * rien n'est écrit en base. N'échoue jamais pour l'appelant ; renvoie false en cas d'échec.
   */
  static async sendNow(mail: Mail): Promise<boolean> {
    try {
      await this.deliver(mail);
      return true;
    } catch (e: any) {
      console.error(`[mail] échec d'envoi à ${mail.to} :`, e.message);
      return false;
    }
  }

  /** Envoi différé avec nouvelles tentatives (worker) : réservé aux emails sans secret. */
  static async enqueue(mail: Mail): Promise<void> {
    await prisma.jobQueueItem.create({
      data: { queueName: "emails", jobType: "SEND_EMAIL", payload: { ...mail }, maxAttempts: 5 },
    });
  }
}
