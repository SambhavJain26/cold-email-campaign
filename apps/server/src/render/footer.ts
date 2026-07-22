// CAN-SPAM footer (docs/08 §4): appended at render time AFTER all expansion,
// unconditional - template text cannot alter or remove it. NOT stored in
// step_variants.body_template. Subjects never get the footer.

export interface ComplianceInfo {
  physicalAddress: string;
  optoutText: string;
}

export function appendFooter(body: string, compliance: ComplianceInfo): string {
  return `${body}\n\n---\n${compliance.physicalAddress}\n${compliance.optoutText}`;
}
