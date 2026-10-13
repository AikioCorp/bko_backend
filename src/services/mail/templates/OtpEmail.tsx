import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Hr,
  Link,
  Img,
  Preview,
} from "@react-email/components";

interface OtpEmailProps {
  code: string;
  userName?: string | null;
}

export const OtpEmail: React.FC<OtpEmailProps> = ({
  code = "123456",
  userName,
}) => {
  // Déterminer la salutation (ex: "Bonjour Salif," ou simplement "Bonjour,")
  const greeting = userName?.trim()
    ? `Bonjour ${userName.trim().split(" ")[0]},`
    : "Bonjour,";

  return (
    <Html lang="fr">
      <Head>
        <title>Votre code de vérification Bamako Podcast</title>
      </Head>
      <Preview>Votre code de vérification Bamako Podcast : {code}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header avec Logo officiel Bamako Podcast */}
          <Section style={headerSection}>
            <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
              <tr>
                <td align="center" style={{ textAlign: "center", padding: "8px 0" }}>
                  <Img
                    src="https://bamakopodcast.studio/logo.png"
                    alt="Bamako Podcast"
                    width="220"
                    height="86"
                    style={logoImg}
                  />
                </td>
              </tr>
            </table>
          </Section>

          <Hr style={divider} />

          {/* Corps de l'email */}
          <Section style={contentSection}>
            <Heading style={heading}>Vérification de sécurité</Heading>
            
            <Text style={greetingText}>{greeting}</Text>
            
            <Text style={paragraph}>
              Pour sécuriser votre compte et finaliser votre connexion, veuillez saisir le code de vérification à usage unique ci-dessous :
            </Text>

            {/* Box OTP Stylisée */}
            <Section style={otpCard}>
              <Text style={otpLabel}>VOTRE CODE DE VÉRIFICATION</Text>
              <Text style={otpCodeText}>{code}</Text>
              <Text style={otpExpiry}>Valable pendant 15 minutes • À usage unique</Text>
            </Section>

            {/* Note de sécurité */}
            <Section style={securityNote}>
              <Text style={securityText}>
                ⚠️ <strong>Important :</strong> Ne partagez ce code avec personne. Les équipes de Bamako Podcast ne vous demanderont jamais votre code.
              </Text>
            </Section>

            <Text style={helpText}>
              Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer sobre sans slogan territorial */}
          <Section style={footerSection}>
            <Text style={footerText}>
              © {new Date().getFullYear()} Bamako Podcast. Tous droits réservés.
            </Text>
            <Text style={footerLinks}>
              <Link href="https://bamakopodcast.studio" style={footerLink}>
                bamakopodcast.studio
              </Link>
              {" • "}
              <Link href="https://bamakopodcast.studio/privacy" style={footerLink}>
                Confidentialité
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default OtpEmail;

// --- STYLES (Charte Bamako Podcast : Fond sombre sobre, or plein #FFBF00, zéro dégradé) ---
const main: React.CSSProperties = {
  backgroundColor: "#0B0B0B",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: "0",
  padding: "40px 16px",
};

const container: React.CSSProperties = {
  backgroundColor: "#141414",
  border: "1px solid #262626",
  borderRadius: "16px",
  maxWidth: "520px",
  margin: "0 auto",
  overflow: "hidden",
  padding: "32px 28px",
};

const headerSection: React.CSSProperties = {
  marginBottom: "16px",
};

const logoImg: React.CSSProperties = {
  display: "block",
  margin: "0 auto",
  maxWidth: "100%",
  height: "auto",
};

const brandTitle: React.CSSProperties = {
  fontSize: "17px",
  fontWeight: 900,
  letterSpacing: "1.8px",
  margin: "0",
  textTransform: "uppercase",
};

const divider: React.CSSProperties = {
  border: "none",
  borderTop: "1px solid #262626",
  margin: "20px 0",
};

const contentSection: React.CSSProperties = {
  padding: "4px 0",
};

const heading: React.CSSProperties = {
  color: "#FFFFFF",
  fontSize: "22px",
  fontWeight: 700,
  margin: "0 0 16px",
  letterSpacing: "-0.3px",
};

const greetingText: React.CSSProperties = {
  color: "#FFFFFF",
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const paragraph: React.CSSProperties = {
  color: "#CFCFCF",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 14px",
};

const otpCard: React.CSSProperties = {
  backgroundColor: "#1A1A1A",
  border: "1px solid #333333",
  borderRadius: "14px",
  padding: "24px 16px",
  textAlign: "center",
  margin: "24px 0",
};

const otpLabel: React.CSSProperties = {
  color: "#A0A0A0",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1.5px",
  margin: "0 0 12px",
  textTransform: "uppercase",
};

const otpCodeText: React.CSSProperties = {
  color: "#FFBF00",
  fontSize: "38px",
  fontWeight: 800,
  letterSpacing: "8px",
  fontFamily: "'Courier New', Courier, monospace",
  margin: "0 0 10px",
  paddingLeft: "8px",
};

const otpExpiry: React.CSSProperties = {
  color: "#757575",
  fontSize: "12px",
  fontWeight: 500,
  margin: "0",
};

const securityNote: React.CSSProperties = {
  backgroundColor: "#171510",
  borderLeft: "3px solid #FFBF00",
  borderRadius: "6px",
  padding: "12px 14px",
  margin: "20px 0",
};

const securityText: React.CSSProperties = {
  color: "#D4B46A",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0",
};

const helpText: React.CSSProperties = {
  color: "#757575",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "18px 0 0",
};

const footerSection: React.CSSProperties = {
  textAlign: "center",
  paddingTop: "6px",
};

const footerText: React.CSSProperties = {
  color: "#5A5A5A",
  fontSize: "12px",
  margin: "0 0 8px",
};

const footerLinks: React.CSSProperties = {
  color: "#5A5A5A",
  fontSize: "12px",
  margin: "0",
};

const footerLink: React.CSSProperties = {
  color: "#8A8A8A",
  textDecoration: "underline",
};
