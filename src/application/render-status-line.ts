import type { StatusSnapshot } from "../domain/status-line.js";
import { directoryName, type GitInfo } from "../infrastructure/git-info.js";
import {
  asRecord,
  listKeys,
  pickNumber,
  pickRecord,
  pickString,
  pickUnknown,
} from "../infrastructure/value-reader.js";
import {
  deriveQuotaUnit,
  normalizeQuotaUnit,
  parseQuotaSnapshot,
} from "../infrastructure/quota-snapshot.js";
import type { UsageConfig } from "../infrastructure/copilotline-config.js";

const RESET = "\x1b[0m";
const CONTEXT_GLYPH = "✍️";
const QUOTA_BAR_WIDTH = 8;
const style = {
  dim: "\x1b[2m",
} as const;

function color(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function buildBar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.floor((clamped * width) / 100);
  const empty = width - filled;
  return `${colorForPercentage(clamped)}${"●".repeat(filled)}${style.dim}${"○".repeat(empty)}${RESET}`;
}

const palette = {
  blue: color(0, 153, 255),
  cyan: color(86, 182, 194),
  green: color(0, 175, 80),
  orange: color(255, 176, 85),
  yellow: color(230, 200, 0),
  red: color(255, 85, 85),
  magenta: color(180, 140, 255),
  white: color(220, 220, 220),
} as const;

export interface RenderDeps {
  now?: () => number;
  getGitInfo?: (cwd: string) => GitInfo;
  quota?: StatusSnapshot["quota"] | null;
  usage?: UsageConfig;
}

export function buildStatusSnapshot(
  input: unknown,
  deps: RenderDeps = {},
): StatusSnapshot {
  const now = deps.now ?? Date.now;
  const getGitInfo =
    deps.getGitInfo ??
    (() => ({ branch: null, dirty: false, worktree: false }));

  const cwd =
    pickString(
      input,
      ["cwd"],
      ["workingDirectory"],
      ["workspace", "current_dir"],
      ["workspace", "currentDir"],
      ["workspace", "project_dir"],
      ["workspace", "projectDir"],
    ) ?? null;

  const git = cwd
    ? getGitInfo(cwd)
    : { branch: null, dirty: false, worktree: false };
  const modelLabel =
    pickString(
      input,
      ["model", "display_name"],
      ["model", "displayName"],
      ["model", "name"],
      ["model", "id"],
      ["previewModel", "display_name"],
      ["previewModel", "displayName"],
      ["previewModel", "name"],
      ["previewModel", "id"],
    ) ?? null;
  const modelEffort =
    pickString(
      input,
      ["effort", "level"],
      ["effort_level"],
      ["effortLevel"],
      ["reasoning", "effort"],
      ["reasoning", "effort_level"],
      ["reasoning", "effortLevel"],
      ["reasoning", "level"],
      ["model", "effort"],
      ["model", "effort_level"],
      ["model", "effortLevel"],
      ["model", "reasoning_effort"],
      ["model", "reasoningEffort"],
      ["model", "reasoning_effort_level"],
      ["model", "reasoningEffortLevel"],
      ["model", "reasoning", "effort"],
      ["model", "reasoning", "effort_level"],
      ["model", "reasoning", "effortLevel"],
      ["model", "reasoning", "level"],
      ["previewModel", "effort"],
      ["previewModel", "effort_level"],
      ["previewModel", "effortLevel"],
      ["previewModel", "reasoning_effort"],
      ["previewModel", "reasoningEffort"],
      ["previewModel", "reasoning", "effort"],
    ) ?? inferEffortFromModelLabel(modelLabel);
  const startedAt =
    pickString(
      input,
      ["session", "start_time"],
      ["session", "startTime"],
      ["session", "started_at"],
      ["session", "startedAt"],
    ) ?? null;
  const elapsedSeconds =
    computeElapsedSeconds(startedAt, now()) ??
    computeDurationSeconds(
      pickNumber(
        input,
        ["cost", "total_duration_ms"],
        ["cost", "totalDurationMs"],
        ["session", "duration_ms"],
        ["session", "durationMs"],
      ),
    );

  const inputQuota = normalizeQuota(input);

  return {
    model: {
      label: modelLabel,
      effort: modelEffort,
      agent:
        pickString(
          input,
          ["agent", "display_name"],
          ["agent", "displayName"],
          ["agent", "name"],
          ["agent", "kind"],
          ["mode", "name"],
          ["task", "agent"],
        ) ?? null,
    },
    session: {
      id:
        pickString(input, ["session", "id"], ["session_id"], ["sessionId"]) ??
        null,
      startedAt,
      elapsedSeconds,
    },
    context: normalizeContext(input),
    quota: hasQuotaData(inputQuota) ? inputQuota : (deps.quota ?? emptyQuota()),
    directory: {
      cwd,
      name: directoryName(cwd),
      git: {
        branch: git.branch,
        dirty: git.dirty,
        worktree: git.worktree,
      },
    },
    rawKeys: listKeys(input),
  };
}

export function renderStatusLine(
  input: unknown,
  deps: RenderDeps = {},
): string {
  return formatStatusLine(buildStatusSnapshot(input, deps), deps.usage);
}

export function formatStatusLine(
  snapshot: StatusSnapshot,
  usage?: UsageConfig,
): string {
  const separator = ` ${style.dim}│${RESET} `;
  const segments = [
    modelSegment(snapshot.model.label, snapshot.model.effort),
    contextSegment(snapshot.context.usedPercent),
    snapshot.context.usedPercent !== null
      ? null
      : tokenContextSegment(
          snapshot.context.usedTokens,
          snapshot.context.totalTokens,
        ),
    directorySegment(snapshot),
    snapshot.session.elapsedSeconds !== null
      ? sessionSegment(snapshot.session.elapsedSeconds)
      : null,
    hasQuotaData(snapshot.quota) ? quotaSegment(snapshot.quota, usage) : null,
    snapshot.model.agent ? agentSegment(snapshot.model.agent) : null,
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(separator);
}

function normalizeContext(input: unknown): StatusSnapshot["context"] {
  const usedPercent =
    clampPercent(
      pickNumber(
        input,
        ["context_window", "used_percentage"],
        ["context_window", "usedPercent"],
        ["context_window", "current_context_used_percentage"],
        ["context_window", "currentContextUsedPercentage"],
        ["contextWindow", "used_percentage"],
        ["contextWindow", "usedPercent"],
        ["contextWindow", "current_context_used_percentage"],
        ["contextWindow", "currentContextUsedPercentage"],
        ["context", "used_percentage"],
        ["context", "usedPercent"],
      ),
    ) ?? null;

  const usedTokens =
    pickNumber(
      input,
      ["context_window", "used_tokens"],
      ["context_window", "usedTokens"],
      ["context_window", "current_context_tokens"],
      ["context_window", "currentContextTokens"],
      ["contextWindow", "used_tokens"],
      ["contextWindow", "usedTokens"],
      ["contextWindow", "current_context_tokens"],
      ["contextWindow", "currentContextTokens"],
      ["context", "used_tokens"],
      ["context", "usedTokens"],
    ) ?? null;

  const totalTokens =
    pickNumber(
      input,
      ["context_window", "total_tokens"],
      ["context_window", "totalTokens"],
      ["context_window", "displayed_context_limit"],
      ["context_window", "displayedContextLimit"],
      ["contextWindow", "total_tokens"],
      ["contextWindow", "totalTokens"],
      ["contextWindow", "displayed_context_limit"],
      ["contextWindow", "displayedContextLimit"],
      ["context_window", "context_window_size"],
      ["contextWindow", "context_window_size"],
      ["context_window", "max_tokens"],
      ["context_window", "maxTokens"],
      ["contextWindow", "max_tokens"],
      ["contextWindow", "maxTokens"],
      ["context", "total_tokens"],
      ["context", "totalTokens"],
      ["context", "maxTokens"],
    ) ?? null;

  return {
    usedPercent:
      usedPercent ??
      (usedTokens !== null && totalTokens !== null && totalTokens > 0
        ? (clampPercent((usedTokens / totalTokens) * 100) ?? null)
        : null),
    usedTokens,
    totalTokens,
  };
}

function normalizeQuota(input: unknown): StatusSnapshot["quota"] {
  const snapshotQuota = quotaFromSnapshots(input);
  if (snapshotQuota) {
    return snapshotQuota;
  }

  const headerQuota = quotaFromHeaders(input);
  if (headerQuota) {
    return headerQuota;
  }

  const label =
    pickString(
      input,
      ["quota", "label"],
      ["quota", "name"],
      ["quota", "kind"],
      ["quota_window", "label"],
      ["quotaWindow", "label"],
    ) ?? null;
  const usedPercent =
    clampPercent(
      pickNumber(
        input,
        ["quota", "used_percentage"],
        ["quota", "usedPercent"],
        ["quota", "percent_used"],
        ["quota", "percentUsed"],
        ["quota_window", "used_percentage"],
        ["quota_window", "usedPercent"],
        ["quotaWindow", "used_percentage"],
        ["quotaWindow", "usedPercent"],
      ),
    ) ?? null;
  const remainingPercent =
    clampPercent(
      pickNumber(
        input,
        ["quota", "remaining_percentage"],
        ["quota", "remainingPercent"],
        ["quota", "percent_remaining"],
        ["quota", "percentRemaining"],
        ["quota_window", "remaining_percentage"],
        ["quota_window", "remainingPercent"],
        ["quota_window", "percent_remaining"],
        ["quota_window", "percentRemaining"],
        ["quotaWindow", "remaining_percentage"],
        ["quotaWindow", "remainingPercent"],
        ["quotaWindow", "percent_remaining"],
        ["quotaWindow", "percentRemaining"],
      ),
    ) ?? null;
  // Read counts through the credit/token aliases too (not only the bare
  // `entitlement`/`remaining`/`used`), so a flat stdin `quota` object expressed
  // in token-billing field names is not silently dropped.
  const rawEntitlement =
    pickNumber(
      input,
      ["quota", "entitlement"],
      ["quota", "credit_entitlement"],
      ["quota", "creditEntitlement"],
      ["quota", "token_entitlement"],
      ["quota", "tokenEntitlement"],
      ["quota", "allowance"],
      ["quota", "credit_allowance"],
      ["quota_window", "entitlement"],
    ) ?? null;
  // A negative allowance is a sentinel, not a denominator (mirrors the snapshot
  // parser); fall through to the used-only clause instead of rendering "/-1".
  const entitlement =
    rawEntitlement !== null && rawEntitlement < 0 ? null : rawEntitlement;
  const remaining =
    pickNumber(
      input,
      ["quota", "remaining"],
      ["quota", "credits_remaining"],
      ["quota", "creditsRemaining"],
      ["quota", "tokens_remaining"],
      ["quota", "tokensRemaining"],
      ["quota_window", "remaining"],
    ) ?? null;
  const used =
    pickNumber(
      input,
      ["quota", "used"],
      ["quota", "credits_used"],
      ["quota", "creditsUsed"],
      ["quota", "tokens_used"],
      ["quota", "tokensUsed"],
      ["quota_window", "used"],
    ) ?? computeUsedQuota(entitlement, remaining);
  const usedPercentFromCounts =
    entitlement !== null && entitlement > 0 && used !== null
      ? (clampPercent((used / entitlement) * 100) ?? null)
      : null;
  const quotaRecord =
    asRecord(
      pickUnknown(input, ["quota"], ["quota_window"], ["quotaWindow"]),
    ) ?? {};
  const unit =
    normalizeQuotaUnit(
      pickString(
        input,
        ["quota", "unit"],
        ["quota", "type"],
        ["quota_window", "unit"],
      ),
    ) ?? deriveQuotaUnit(quotaRecord);
  const costUsd =
    pickNumber(
      input,
      ["quota", "cost_usd"],
      ["quota", "costUsd"],
      ["quota", "cost"],
    ) ?? null;
  const creditAllowanceSource =
    pickString(
      input,
      ["quota", "allowance_source"],
      ["quota", "allowanceSource"],
      ["quota", "creditAllowanceSource"],
    ) ?? null;

  return {
    login:
      pickString(
        input,
        ["quota", "login"],
        ["quota", "account"],
        ["quota_window", "login"],
      ) ?? null,
    host:
      pickString(
        input,
        ["quota", "host"],
        ["quota", "hostname"],
        ["quota_window", "host"],
      ) ?? null,
    label,
    unit,
    usedPercent:
      usedPercent ?? invertPercent(remainingPercent) ?? usedPercentFromCounts,
    remainingPercent,
    entitlement,
    remaining,
    used,
    unlimited: false,
    overageUsed: null,
    overagePermitted: null,
    costUsd,
    creditAllowanceSource,
    resetAt:
      pickString(
        input,
        ["quota", "reset_at"],
        ["quota", "resetAt"],
        ["quota", "reset_date"],
        ["quota", "resetDate"],
        ["quota_window", "reset_at"],
        ["quota_window", "resetAt"],
      ) ?? null,
    source: null,
    accountSource:
      pickString(
        input,
        ["quota", "accountSource"],
        ["quota", "account_source"],
      ) ?? null,
    tokenSource:
      pickString(input, ["quota", "tokenSource"], ["quota", "token_source"]) ??
      null,
  };
}

function quotaFromSnapshots(input: unknown): StatusSnapshot["quota"] | null {
  const snapshots =
    pickRecord(
      input,
      ["quota_snapshots"],
      ["quotaSnapshots"],
      ["copilot_quota_snapshots"],
      ["copilotQuotaSnapshots"],
      ["usage", "quota_snapshots"],
      ["usage", "quotaSnapshots"],
      ["usage", "copilot_quota_snapshots"],
      ["usage", "copilotQuotaSnapshots"],
      ["response", "copilot_quota_snapshots"],
      ["response", "copilotQuotaSnapshots"],
      ["event", "copilot_quota_snapshots"],
      ["event", "copilotQuotaSnapshots"],
    ) ?? null;

  if (!snapshots) {
    return null;
  }

  const candidates: Array<[string, string, string]> = [
    ["premium_models", "premiumModels", "premium"],
    ["premium_interactions", "premiumInteractions", "premium"],
    ["chat", "chat", "chat"],
    ["completions", "completions", "completions"],
  ];
  const resetAt = readString(
    pickUnknown(
      input,
      ["quota_reset_date"],
      ["quotaResetDate"],
      ["quota_reset_date_utc"],
      ["quotaResetDateUtc"],
    ),
  );

  for (const [snakeKey, camelKey, label] of candidates) {
    const snapshot =
      asRecord(snapshots[snakeKey]) ?? asRecord(snapshots[camelKey]);
    if (!snapshot) {
      continue;
    }

    const quota = parseQuotaSnapshot(snapshot, label, snakeKey, resetAt);
    if (quota && hasQuotaData(quota)) {
      return withPayloadAccount(quota, input);
    }
  }

  return null;
}

function quotaFromHeaders(input: unknown): StatusSnapshot["quota"] | null {
  const headerRecord =
    pickRecord(
      input,
      ["headers"],
      ["response", "headers"],
      ["request", "headers"],
      ["quota_headers"],
      ["quotaHeaders"],
    ) ?? asRecord(input);

  if (!headerRecord) {
    return null;
  }

  const candidates: Array<[string[], string]> = [
    [
      ["x-quota-snapshot-premium_models", "x-quota-snapshot-premiummodels"],
      "premium_models",
    ],
    [
      [
        "x-quota-snapshot-premium_interactions",
        "x-quota-snapshot-premiuminteractions",
      ],
      "premium_interactions",
    ],
    [["x-quota-snapshot-chat"], "chat"],
    [["x-quota-snapshot-completions"], "completions"],
  ];

  for (const [names, source] of candidates) {
    const value = findHeaderValue(headerRecord, names);
    if (!value) {
      continue;
    }

    const label =
      source === "chat"
        ? "chat"
        : source === "completions"
          ? "completions"
          : "premium";
    const quota = quotaFromHeaderValue(value, label, source);
    if (quota && hasQuotaData(quota)) {
      return withPayloadAccount(quota, input);
    }
  }

  return null;
}

function withPayloadAccount(
  quota: StatusSnapshot["quota"],
  input: unknown,
): StatusSnapshot["quota"] {
  const login = accountLoginFromInput(input);
  return {
    ...quota,
    login: login ?? quota.login,
    host: accountHostFromInput(input) ?? quota.host,
    accountSource: login ? "payload" : quota.accountSource,
  };
}

function accountLoginFromInput(input: unknown): string | null {
  return (
    pickString(
      input,
      ["account", "login"],
      ["account", "username"],
      ["github", "login"],
      ["github", "user", "login"],
      ["user", "login"],
      ["user", "username"],
      ["authentication", "login"],
      ["authentication", "user", "login"],
      ["copilot", "account", "login"],
      ["copilot", "user", "login"],
    ) ?? null
  );
}

function accountHostFromInput(input: unknown): string | null {
  return (
    pickString(
      input,
      ["account", "host"],
      ["account", "hostname"],
      ["github", "host"],
      ["github", "hostname"],
      ["authentication", "host"],
      ["authentication", "hostname"],
    ) ?? null
  );
}

function quotaFromHeaderValue(
  value: string,
  label: string,
  source: string,
): StatusSnapshot["quota"] | null {
  const params = new URLSearchParams(value);
  const unit = normalizeQuotaUnit(params.get("unit")) ?? "request";
  const entitlement = readNumberValue(params.get("ent"));
  const remainingPercent =
    clampPercent(readNumberValue(params.get("rem"))) ?? null;
  const overagePermitted = params.get("ovPerm") === "true";
  // D-002-10: only the legacy request unit treats entitlement === -1 as unlimited.
  const unlimited = unit === "request" && entitlement === -1;

  return {
    login: null,
    host: null,
    label,
    unit,
    usedPercent: unlimited ? 0 : invertPercent(remainingPercent),
    remainingPercent,
    entitlement,
    remaining: null,
    used: null,
    unlimited,
    overageUsed: readNumberValue(params.get("ov")),
    overagePermitted,
    costUsd: readNumberValue(params.get("cost")),
    creditAllowanceSource: readString(params.get("allowance_source")),
    resetAt: readString(params.get("rst")),
    source,
    accountSource: null,
    tokenSource: null,
  };
}

function computeElapsedSeconds(
  startedAt: string | null,
  nowMs: number,
): number | null {
  if (!startedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs) || startedMs > nowMs) {
    return null;
  }

  return Math.floor((nowMs - startedMs) / 1000);
}

function computeDurationSeconds(durationMs: number | undefined): number | null {
  if (durationMs === undefined || durationMs < 0) {
    return null;
  }

  return Math.floor(durationMs / 1000);
}

function clampPercent(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, value));
}

function modelSegment(label: string | null, effort: string | null): string {
  const safeLabel = sanitizeText(label?.trim() || "Copilot");
  const base = paint(safeLabel, palette.blue);
  const safeEffort = effort ? sanitizeText(effort.trim()) : "";

  if (safeEffort === "" || labelContainsEffort(safeLabel, safeEffort)) {
    return base;
  }

  return `${base} ${style.dim}·${RESET} ${paint(safeEffort, palette.blue)}`;
}

function contextSegment(usedPercent: number | null): string | null {
  if (usedPercent === null) {
    return null;
  }

  const percent = Math.round(usedPercent);
  return `${CONTEXT_GLYPH}  ${colorForPercentage(percent)}${percent}%${RESET}`;
}

function tokenContextSegment(
  usedTokens: number | null,
  totalTokens: number | null,
): string | null {
  if (usedTokens === null || totalTokens === null || totalTokens <= 0) {
    return null;
  }

  return contextSegment((usedTokens / totalTokens) * 100);
}

function directorySegment(snapshot: StatusSnapshot): string | null {
  if (!snapshot.directory.name) {
    return null;
  }

  const branch = snapshot.directory.git.branch;
  const name = paint(sanitizeText(snapshot.directory.name), palette.cyan);

  if (!branch) {
    return name;
  }

  const dirty = snapshot.directory.git.dirty
    ? `${palette.red}*${palette.green}`
    : "";
  const worktree = snapshot.directory.git.worktree ? "⎇:" : "";
  return `${name} ${palette.green}(${worktree}${sanitizeText(branch)}${dirty})${RESET}`;
}

function sessionSegment(elapsedSeconds: number): string {
  return `${style.dim}⏱ ${RESET}${palette.white}${formatDuration(elapsedSeconds)}${RESET}`;
}

function formatDuration(elapsedSeconds: number): string {
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  if (elapsedSeconds < 3600) {
    return `${Math.floor(elapsedSeconds / 60)}m`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}

function quotaNoun(quota: StatusSnapshot["quota"]): string {
  // D-002-02: the noun derives from the billing unit. Credit/token accounts read
  // "credits"/"tokens"; the legacy request unit keeps its GitHub-supplied label
  // (premium/chat/completions), defaulting to "premium".
  if (quota.unit === "credit") {
    return "credits";
  }
  if (quota.unit === "token") {
    return "tokens";
  }
  return quota.label ?? "premium";
}

function quotaSegment(
  quota: StatusSnapshot["quota"],
  usage?: UsageConfig,
): string {
  const noun = quotaNoun(quota);
  const label = sanitizeText(quota.login ? `${quota.login} ${noun}` : noun);

  if (quota.unlimited) {
    return `💸 ${palette.white}${label}${RESET} ${palette.green}∞${RESET}`;
  }

  const cost = quota.costUsd;

  // D-002-02: `usage.units: usd` shows GitHub-reported cost as the primary value
  // when available; it never estimates, so without a costUsd it falls through to
  // the native count display.
  if (usage?.units === "usd" && cost !== null) {
    const parts = [
      `${palette.white}${label}${RESET}`,
      `${palette.white}${formatUsd(cost)}${RESET}`,
      formatReset(quota.resetAt),
      formatOverage(quota.overageUsed, quota.overagePermitted),
    ].filter((part): part is string => Boolean(part));
    return `💸 ${parts.join(" ")}`;
  }

  const percent =
    quota.usedPercent === null ? null : Math.round(quota.usedPercent);
  const counts = formatQuotaCounts(quota);
  const costClause =
    usage?.showCost && cost !== null
      ? `${style.dim}≈ ${formatUsd(cost)}${RESET}`
      : null;
  const parts = [
    `${palette.white}${label}${RESET}`,
    percent === null ? null : buildBar(percent, QUOTA_BAR_WIDTH),
    percent === null
      ? null
      : `${colorForPercentage(percent)}${percent}%${RESET}`,
    counts ? `${style.dim}${counts}${RESET}` : null,
    costClause,
    formatReset(quota.resetAt),
    formatOverage(quota.overageUsed, quota.overagePermitted),
  ].filter((part): part is string => Boolean(part));

  return `💸 ${parts.join(" ")}`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function hasQuotaData(quota: StatusSnapshot["quota"]): boolean {
  return (
    quota.unlimited ||
    quota.usedPercent !== null ||
    quota.entitlement !== null ||
    quota.remaining !== null ||
    quota.used !== null
  );
}

function emptyQuota(): StatusSnapshot["quota"] {
  return {
    login: null,
    host: null,
    label: null,
    unit: "request",
    usedPercent: null,
    remainingPercent: null,
    entitlement: null,
    remaining: null,
    used: null,
    unlimited: false,
    overageUsed: null,
    overagePermitted: null,
    costUsd: null,
    creditAllowanceSource: null,
    resetAt: null,
    source: null,
    accountSource: null,
    tokenSource: null,
  };
}

function agentSegment(agent: string): string {
  return `${style.dim}agent ${sanitizeText(agent)}${RESET}`;
}

function paint(text: string, ansi: string): string {
  return `${ansi}${text}${RESET}`;
}

function colorForPercentage(percent: number): string {
  if (percent >= 90) {
    return palette.red;
  }

  if (percent >= 70) {
    return palette.yellow;
  }

  if (percent >= 50) {
    return palette.orange;
  }

  return palette.green;
}

function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

function inferEffortFromModelLabel(label: string | null): string | null {
  if (!label) {
    return null;
  }

  const match = label.match(/\b(xhigh|high|medium|low|max)\b/i);
  return match?.[1] ?? null;
}

function labelContainsEffort(label: string, effort: string): boolean {
  return new RegExp(`\\b${escapeRegExp(effort)}\\b`, "i").test(label);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function invertPercent(percent: number | null): number | null {
  return percent === null ? null : (clampPercent(100 - percent) ?? null);
}

function findHeaderValue(
  headers: Record<string, unknown>,
  names: string[],
): string | null {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" && value.trim() !== "") {
      normalized.set(key.toLowerCase(), value);
    }
  }

  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value) {
      return value;
    }
  }

  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function computeUsedQuota(
  entitlement: number | null,
  remaining: number | null,
): number | null {
  if (entitlement === null || remaining === null) {
    return null;
  }

  return Math.max(0, entitlement - remaining);
}

function formatQuotaCounts(quota: StatusSnapshot["quota"]): string | null {
  const used =
    quota.used ?? computeUsedQuota(quota.entitlement, quota.remaining);
  if (used === null) {
    return null;
  }

  // D-002-12: no reported allowance -> show a used-only clause with no fabricated
  // denominator (the most likely live shape under token billing).
  if (quota.entitlement === null) {
    return `${formatCompactNumber(used)} used`;
  }

  return `${formatCompactNumber(used)}/${formatCompactNumber(quota.entitlement)}`;
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${formatCompactDecimal(value / 1_000_000)}m`;
  }

  if (Math.abs(value) >= 1_000) {
    return `${formatCompactDecimal(value / 1_000)}k`;
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatCompactDecimal(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, "");
}

export function formatReset(resetAt: string | null): string | null {
  if (!resetAt) {
    return null;
  }

  const date = new Date(resetAt);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getUTCMonth()] ?? "";
  const day = date.getUTCDate();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${style.dim}⟳${RESET} ${palette.white}${month} ${day} ${hour}:${minute} UTC${RESET}`;
}

function formatOverage(
  overageUsed: number | null,
  overagePermitted: boolean | null,
): string | null {
  if (!overagePermitted || overageUsed === null || overageUsed <= 0) {
    return null;
  }

  return `${palette.yellow}+${formatCompactNumber(overageUsed)} extra${RESET}`;
}
