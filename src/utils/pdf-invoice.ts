/**
 * Minimal, zero-dependency valid PDF 1.4 generator for Studio Booking Invoices.
 */
function sanitizePdfText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export interface StudioInvoiceData {
  reference: string;
  createdAt: string;
  contactName: string;
  email: string;
  phone: string;
  company?: string | null;
  offerName?: string | null;
  needType: string;
  studioLocation?: string | null;
  preferredDate?: string | null;
  timeSlot?: string | null;
  durationHours?: number | null;
  estimatedPrice?: string | null;
  depositAmount?: number | null;
  depositStatus?: string | null;
  depositMethod?: string | null;
  depositRef?: string | null;
  status: string;
}

export function generateStudioInvoicePdf(data: StudioInvoiceData): Buffer {
  const lines: Array<{ text: string; size: number; bold?: boolean; y: number }> = [];
  let y = 760;
  const push = (text: string, size = 11, bold = false, gap = 18) => {
    lines.push({ text: sanitizePdfText(text), size, bold, y });
    y -= gap;
  };

  push("BAMAKO PODCAST STUDIO", 18, true, 24);
  push("Facture / Recu de Reservation Studio", 13, true, 28);
  push(`Reference dossier : ${data.reference}`, 11, true, 18);
  push(`Date d'emission : ${data.createdAt}`, 10, false, 16);
  push(`Statut dossier : ${data.status}`, 10, false, 26);

  push("INFORMATIONS CLIENT", 12, true, 20);
  push(`Nom : ${data.contactName}`, 10, false, 16);
  if (data.company) push(`Organisation : ${data.company}`, 10, false, 16);
  push(`Email : ${data.email}`, 10, false, 16);
  push(`Telephone : ${data.phone}`, 10, false, 26);

  push("DETAILS DE LA PRESTATION", 12, true, 20);
  push(`Type de besoin : ${data.needType}`, 10, false, 16);
  if (data.offerName) push(`Formule : ${data.offerName}`, 10, false, 16);
  if (data.studioLocation) push(`Espace : ${data.studioLocation}`, 10, false, 16);
  if (data.preferredDate) push(`Date souhaitee : ${data.preferredDate}`, 10, false, 16);
  if (data.timeSlot) push(`Creneau : ${data.timeSlot}`, 10, false, 16);
  if (data.durationHours) push(`Duree prevue : ${data.durationHours} heure(s)`, 10, false, 26);

  push("TARIFICATION & ACOMPTE", 12, true, 20);
  push(`Estimation totale : ${data.estimatedPrice || "Sur devis"}`, 11, true, 18);
  if (data.depositStatus === "PAID" && data.depositAmount) {
    push(
      `Acompte regle : ${data.depositAmount.toLocaleString("en-US").replace(/,/g, " ")} FCFA (${data.depositMethod || "Mobile Money"})`,
      11,
      true,
      16
    );
    if (data.depositRef) push(`Reference paiement : ${data.depositRef}`, 10, false, 18);
  } else {
    push("Acompte : Non regle (reglement sur place ou en ligne)", 10, false, 18);
  }

  y -= 16;
  push("Bamako Podcast SARL - Bamako, Mali - https://bamakopodcast.studio", 9, false, 14);

  const streamOps = [
    "BT",
    ...lines.map((l) => `${l.bold ? "/F2" : "/F1"} ${l.size} Tf 50 ${l.y} Td (${l.text}) Tj 0 0 Td`),
    "ET",
  ];
  // Use absolute positioning per line with Tm for clean layout
  const ops = ["BT"];
  for (const l of lines) {
    ops.push(`${l.bold ? "/F2" : "/F1"} ${l.size} Tf`);
    ops.push(`1 0 0 1 50 ${l.y} Tm`);
    ops.push(`(${l.text}) Tj`);
  }
  ops.push("ET");
  const contentStream = ops.join("\n");

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n",
    `6 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "latin1")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
