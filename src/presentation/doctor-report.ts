import type { DoctorReport, DiagnosticStatus } from "../domain/doctor.js";

const LABELS: Record<DiagnosticStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
};

export function printDoctorReport(report: DoctorReport): string {
  const lines = [
    `copilotline ${report.version}`,
    `Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    "",
  ];

  for (const section of report.sections) {
    lines.push(section.title);

    for (const line of section.lines) {
      lines.push(`  [${LABELS[line.status]}] ${line.message}`);

      if (line.fix) {
        lines.push(`         fix: ${line.fix}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
