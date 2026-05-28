import { Easing, interpolate } from "remotion";

export const COLORS = {
  bg: "#0d1117",
  outer: "#08090c",
  panelBorder: "#1f2937",
  blue: "rgb(0, 153, 255)",
  cyan: "rgb(86, 182, 194)",
  green: "rgb(0, 175, 80)",
  orange: "rgb(255, 176, 85)",
  yellow: "rgb(230, 200, 0)",
  red: "rgb(255, 85, 85)",
  magenta: "rgb(180, 140, 255)",
  white: "rgb(220, 220, 220)",
  dim: "rgba(220, 220, 220, 0.42)",
  rule: "rgba(220, 220, 220, 0.25)",
} as const;

export const FONT =
  "'JetBrains Mono', 'Cascadia Code', 'Menlo', 'Monaco', 'Courier New', monospace";

export function colorForPct(pct: number): string {
  if (pct >= 90) return COLORS.red;
  if (pct >= 70) return COLORS.yellow;
  if (pct >= 50) return COLORS.orange;
  return COLORS.green;
}

export function appearAt(
  frame: number,
  startFrame: number,
  duration = 10,
): { opacity: number; transform: string } {
  const opacity = interpolate(frame, [startFrame, startFrame + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });
  const translate = interpolate(frame, [startFrame, startFrame + duration], [5, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  });
  return { opacity, transform: `translateY(${translate}px)` };
}

export function barCells(pct: number, width: number): boolean[] {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.floor((clamped * width) / 100);
  return Array.from({ length: width }, (_, index) => index < filled);
}
