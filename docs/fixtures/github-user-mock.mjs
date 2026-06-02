// DEMO-ONLY offline mock of `GET https://api.github.com/user`.
//
// Purpose: the install-wizard demo (docs/demo-install.tape) lists fabricated
// Copilot accounts (octocat / monalisa / hubot) and shows their token status.
// The live CLI marks a token "ok" only after it verifies against
// `api.github.com/user` (src/infrastructure/copilot-account.ts loginForToken),
// which needs the network and a real token. To keep the demo offline, PII-free,
// and reproducible, this preload intercepts that one endpoint and replies with
// the login derived from the bearer token.
//
// Token convention: `demo-<login>` -> `{ "login": "<login>" }` (so the
// fabricated token `demo-octocat` verifies as octocat). Any other token, or a
// request to any other URL, falls through untouched.
//
// THIS FILE IS DEMO-ONLY. It lives under docs/fixtures/ and is invoked solely
// by the demo harness via `node --import`. It is NEVER imported by src/ and
// adds NO runtime dependency to the published package (spec-005 Non-Goal: no
// change to production token verification).
//
// Implementation note: Node's `undici` is not exposed as an importable module
// in this environment, so rather than a MockAgent + setGlobalDispatcher we wrap
// the global `fetch` directly. The bundled CLI runs under Node and resolves its
// verification call to `globalThis.fetch` (loginForToken uses
// `options.fetchImpl ?? fetch`), so wrapping the global is sufficient and
// dependency-free.
//
// Self-test (prints `octocat`, no network):
//   node --import docs/fixtures/github-user-mock.mjs -e \
//     'const r=await fetch("https://api.github.com/user",{headers:{authorization:"Bearer demo-octocat"}}); console.log((await r.json()).login)'

const USER_ENDPOINT = "https://api.github.com/user";

// Pull the login out of `Bearer demo-<login>` or `token demo-<login>`.
function loginFromAuthorization(authorization) {
  if (typeof authorization !== "string") {
    return null;
  }
  const match = authorization
    .trim()
    .match(/^(?:Bearer|token)\s+demo-([A-Za-z0-9._-]+)$/i);
  return match ? match[1] : null;
}

function authorizationHeader(input, init) {
  // Headers can arrive on the init object or on a Request instance.
  const headers = new Headers(init?.headers);
  if (headers.has("authorization")) {
    return headers.get("authorization");
  }
  if (input instanceof Request) {
    return input.headers.get("authorization");
  }
  return null;
}

function requestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return "";
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function mockGitHubUserFetch(input, init) {
  const url = requestUrl(input);

  if (url === USER_ENDPOINT || url === `${USER_ENDPOINT}`) {
    const login = loginFromAuthorization(authorizationHeader(input, init));
    if (login) {
      return new Response(JSON.stringify({ login }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // A request to /user with no recognized demo token: behave like an
    // unauthorized API so the demo shows an honest "token missing" marker.
    return new Response(JSON.stringify({ message: "Bad credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Anything else is passed straight through to the real fetch.
  return realFetch(input, init);
};
