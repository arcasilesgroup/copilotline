export type DiagnosticStatus = "pass" | "warn" | "fail";

export interface DiagnosticLine {
  status: DiagnosticStatus;
  message: string;
  // Optional remediation hint. Explicitly admits `undefined` so report
  // builders can use the `cond ? undefined : msg` idiom under
  // exactOptionalPropertyTypes.
  fix?: string | undefined;
}

export interface DiagnosticSection {
  title: string;
  lines: DiagnosticLine[];
}

export interface DiagnosticSummary {
  pass: number;
  warn: number;
  fail: number;
}

export interface DoctorReport {
  version: string;
  generatedAt: string;
  sections: DiagnosticSection[];
  summary: DiagnosticSummary;
}

export function summarizeReport(
  sections: readonly DiagnosticSection[],
): DiagnosticSummary {
  const summary: DiagnosticSummary = { pass: 0, warn: 0, fail: 0 };

  for (const section of sections) {
    for (const line of section.lines) {
      summary[line.status] += 1;
    }
  }

  return summary;
}
