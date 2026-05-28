import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { appearAt, COLORS, FONT } from "./_helpers";

const Line: React.FC<{ startFrame: number; bold?: boolean; children: React.ReactNode }> = ({
  startFrame,
  bold = false,
  children,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        ...appearAt(frame, startFrame),
        color: COLORS.white,
        fontWeight: bold ? 700 : 400,
        whiteSpace: "pre",
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
};

const Rule: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        ...appearAt(frame, startFrame),
        color: COLORS.rule,
        whiteSpace: "pre",
        lineHeight: 1.55,
      }}
    >
      {"─".repeat(72)}
    </div>
  );
};

const Branch: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: COLORS.dim }}>{"  "}{children}</span>
);

const Section: React.FC<{
  title: string;
  startFrame: number;
  lines: React.ReactNode[];
}> = ({ title, startFrame, lines }) => (
  <>
    <Line startFrame={startFrame} bold>{`  ${title}`}</Line>
    {lines.map((text, index) => {
      const last = index === lines.length - 1;
      return (
        <Line key={index} startFrame={startFrame + (index + 1) * 6}>
          <Branch>{last ? "└" : "├"}</Branch>
          <span> {text}</span>
        </Line>
      );
    })}
    <Line startFrame={startFrame + (lines.length + 1) * 6}>{" "}</Line>
  </>
);

export const Cli: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.outer,
        padding: 28,
        fontFamily: FONT,
        fontSize: 20,
      }}
    >
      <div
        style={{
          backgroundColor: COLORS.bg,
          border: `1px solid ${COLORS.panelBorder}`,
          borderRadius: 10,
          padding: "20px 28px",
          height: "100%",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <Line startFrame={0}>
          <span style={{ color: COLORS.green, fontWeight: 700 }}>$ </span>
          <span>copilotline doctor</span>
        </Line>
        <div style={{ height: 16 }} />
        <Rule startFrame={28} />
        <Line startFrame={34}>{" "}</Line>
        <Section
          title="Environment"
          startFrame={42}
          lines={[
            "Copilot home: ~/.copilot",
            "Node: 22.x",
            "copilotline command available on PATH",
            "copilot command available",
            "git command available",
          ]}
        />
        <Section
          title="Configuration"
          startFrame={84}
          lines={[
            "Settings file found: ~/.copilot/settings.json",
            "statusLine.command points to copilotline",
            "footer.showCustom is enabled",
          ]}
        />
        <Section
          title="Rendering"
          startFrame={120}
          lines={[
            <>
              Synthetic render succeeded:{" "}
              <span style={{ color: COLORS.blue }}>gpt-5.5</span>
              {" │ ✍️  42% │ copilotline (main*)"}
            </>,
          ]}
        />
        <Line startFrame={162}>
          <span style={{ fontWeight: 700 }}>{"  Summary:"}</span>
          <span> 9 pass, 0 warn, 0 fail</span>
        </Line>
      </div>
    </AbsoluteFill>
  );
};
