import React from "react";
import { Composition } from "remotion";
import { Cli } from "./Cli";
import { Statusline } from "./Statusline";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="statusline"
        component={Statusline}
        durationInFrames={330}
        fps={30}
        width={1280}
        height={240}
      />
      <Composition
        id="cli"
        component={Cli}
        durationInFrames={390}
        fps={30}
        width={1280}
        height={680}
      />
    </>
  );
};
