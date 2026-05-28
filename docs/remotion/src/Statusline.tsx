import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { appearAt, barCells, colorForPct, COLORS, FONT } from "./_helpers";

const Separator: React.FC = () => (
  <span style={{ color: COLORS.dim, margin: "0 14px" }}>│</span>
);

const Bar: React.FC<{ pct: number; width?: number }> = ({ pct, width = 8 }) => {
  const color = colorForPct(pct);
  return (
    <span>
      {barCells(pct, width).map((filled, index) => (
        <span
          key={index}
          style={{ color: filled ? color : COLORS.dim, letterSpacing: "0.5px" }}
        >
          {filled ? "●" : "○"}
        </span>
      ))}
    </span>
  );
};

export const Statusline: React.FC = () => {
  const frame = useCurrentFrame();
  const modelStyle = appearAt(frame, 0);
  const contextStyle = appearAt(frame, 22);
  const dirStyle = appearAt(frame, 42);
  const timeStyle = appearAt(frame, 72);
  const quotaStyle = appearAt(frame, 104);

  const contextPct = Math.round(
    interpolate(frame, [26, 88], [0, 47], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.ease),
    }),
  );
  const quotaPct = Math.round(
    interpolate(frame, [108, 210], [8, 84], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    }),
  );
  const used = Math.round((quotaPct / 100) * 300);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.outer,
        fontFamily: FONT,
        fontSize: 28,
        lineHeight: 1.45,
        color: COLORS.white,
        padding: 30,
        boxSizing: "border-box",
        fontFeatureSettings: '"liga" 0',
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: COLORS.bg,
          borderRadius: 16,
          padding: "34px 36px",
          boxSizing: "border-box",
          boxShadow: `0 0 0 1px ${COLORS.panelBorder}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", whiteSpace: "pre" }}>
          <span style={{ color: COLORS.blue, ...modelStyle, display: "inline-block" }}>
            gpt-5.5 · xhigh
          </span>

          <span style={{ ...contextStyle, display: "inline-flex", alignItems: "center" }}>
            <Separator />
            <span style={{ marginRight: 8 }}>✍️</span>
            <span style={{ color: colorForPct(contextPct), fontVariantNumeric: "tabular-nums" }}>
              {contextPct}%
            </span>
          </span>

          <span style={{ ...dirStyle, display: "inline-flex", alignItems: "center" }}>
            <Separator />
            <span style={{ color: COLORS.cyan }}>copilotline</span>
            <span style={{ color: COLORS.green, marginLeft: 10 }}>
              (⎇:main<span style={{ color: COLORS.red }}>*</span>)
            </span>
          </span>

          <span style={{ ...timeStyle, display: "inline-flex", alignItems: "center" }}>
            <Separator />
            <span style={{ color: COLORS.dim, marginRight: 8 }}>⏱</span>
            <span style={{ color: COLORS.white }}>2h27m</span>
          </span>
        </div>

        <div
          style={{
            marginTop: 22,
            display: "flex",
            alignItems: "center",
            whiteSpace: "pre",
            ...quotaStyle,
          }}
        >
          <span>💸</span>
          <span style={{ color: COLORS.white, marginLeft: 10 }}>premium</span>
          <span style={{ marginLeft: 14 }}>
            <Bar pct={quotaPct} />
          </span>
          <span
            style={{
              color: colorForPct(quotaPct),
              marginLeft: 14,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {quotaPct}%
          </span>
          <span style={{ color: COLORS.dim, marginLeft: 14, fontVariantNumeric: "tabular-nums" }}>
            {used}/300
          </span>
          <span style={{ color: COLORS.dim, marginLeft: 14 }}>⟳</span>
          <span style={{ color: COLORS.white, marginLeft: 8 }}>Jun 1 02:00</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
