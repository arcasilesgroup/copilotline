import { describe, expect, test } from "bun:test";
import { resolveTokenForAccount } from "../src/infrastructure/copilot-account.js";
import {
  isAllowedHost,
  normalizeHost,
  resolveAllowedHost,
  usageApiBaseForHost,
} from "../src/infrastructure/host-policy.js";

describe("host allowlist — policy", () => {
  test("allows github.com and GHEC tenancy, rejects everything else", () => {
    expect(isAllowedHost("github.com")).toBe(true);
    expect(isAllowedHost("https://github.com/")).toBe(true);
    expect(isAllowedHost("acme.ghe.com")).toBe(true);
    expect(isAllowedHost("attacker.tld")).toBe(false);
    expect(isAllowedHost("api.enterprise.githubcopilot.com")).toBe(false);
  });

  test("usageApiBaseForHost fails closed to api.github.com", () => {
    expect(usageApiBaseForHost("github.com")).toBe("https://api.github.com");
    expect(usageApiBaseForHost("acme.ghe.com")).toBe("https://api.acme.ghe.com");
    expect(usageApiBaseForHost("api.acme.ghe.com")).toBe("https://api.acme.ghe.com");
    expect(usageApiBaseForHost("attacker.tld")).toBe("https://api.github.com");
  });

  test("resolveAllowedHost collapses tenancy and fails closed", () => {
    expect(resolveAllowedHost("acme.ghe.com")).toBe("acme.ghe.com");
    expect(resolveAllowedHost("attacker.tld")).toBe("github.com");
  });

  test("normalizeHost stays a syntactic strip", () => {
    expect(normalizeHost("https://github.com/")).toBe("github.com");
    expect(normalizeHost("")).toBe("github.com");
  });
});

describe("host allowlist — token exfiltration", () => {
  test("never sends the token to a non-allowlisted host", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ login: "victim" }), { status: 200 });
    };

    // Payload-supplied attacker host must NOT receive a token-bearing request.
    await resolveTokenForAccount(
      { login: "victim", host: "attacker.tld", source: "payload" },
      { env: { COPILOTLINE_GITHUB_TOKEN: "secret-token" }, fetchImpl },
    );

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => !u.includes("attacker"))).toBe(true);
    expect(urls.every((u) => u.startsWith("https://api.github.com/"))).toBe(true);
  });
});
