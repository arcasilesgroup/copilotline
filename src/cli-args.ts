/**
 * Read the value that follows `flag` in `args`, rejecting a flag-shaped value
 * (one that begins with `-`). Without this guard, `render --capture --json`
 * would treat `--json` as the capture value; callers want `undefined` so the
 * missing argument can be reported rather than silently mis-parsed.
 */
export function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  return value === undefined || value.startsWith("-") ? undefined : value;
}
