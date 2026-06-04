export interface GitSnapshot {
  branch: string | null;
  dirty: boolean;
  worktree: boolean;
}

export interface DirectorySnapshot {
  cwd: string | null;
  name: string | null;
  git: GitSnapshot;
}

export interface ModelSnapshot {
  label: string | null;
  effort: string | null;
  agent: string | null;
}

export interface SessionSnapshot {
  id: string | null;
  startedAt: string | null;
  elapsedSeconds: number | null;
}

export interface ContextSnapshot {
  usedPercent: number | null;
  usedTokens: number | null;
  totalTokens: number | null;
}

export type QuotaUnit = "request" | "credit" | "token";

export interface QuotaSnapshot {
  login: string | null;
  host: string | null;
  label: string | null;
  unit: QuotaUnit;
  usedPercent: number | null;
  remainingPercent: number | null;
  entitlement: number | null;
  remaining: number | null;
  used: number | null;
  unlimited: boolean;
  overageUsed: number | null;
  overagePermitted: boolean | null;
  costUsd: number | null;
  creditAllowanceSource: string | null;
  resetAt: string | null;
  source: string | null;
  accountSource: string | null;
  tokenSource: string | null;
}

export interface BillingSnapshot {
  login: string | null;
  host: string | null;
  state: "exact" | "capability";
  label: string;
  monthlyCredits: number | null;
  monthlySpendUsd: number | null;
  period: "month";
  source: "official" | "unsupported" | "unauthorized" | "unavailable";
  tokenSource: string | null;
}

export interface StatusSnapshot {
  model: ModelSnapshot;
  session: SessionSnapshot;
  context: ContextSnapshot;
  quota: QuotaSnapshot;
  billing: BillingSnapshot | null;
  directory: DirectorySnapshot;
  rawKeys: string[];
}
