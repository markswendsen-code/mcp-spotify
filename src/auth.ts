/**
 * Spotify Authentication & Token Management
 *
 * Handles OAuth 2.0 Authorization Code with PKCE flow,
 * token persistence, and automatic refresh.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import http from "http";
import crypto from "crypto";

const CONFIG_DIR = join(homedir(), ".striderlabs", "spotify");
const TOKENS_FILE = join(CONFIG_DIR, "tokens.json");

export const SPOTIFY_REDIRECT_URI = "http://localhost:8888/callback";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
  "user-read-private",
  "user-read-email",
].join(" ");

export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadTokens(): SpotifyTokens | null {
  if (!existsSync(TOKENS_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(TOKENS_FILE, "utf-8"));
    if (data && data.access_token) return data as SpotifyTokens;
    return null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: SpotifyTokens): void {
  ensureConfigDir();
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export function clearTokens(): void {
  ensureConfigDir();
  writeFileSync(TOKENS_FILE, "{}");
}

export function isTokenExpired(tokens: SpotifyTokens): boolean {
  // Refresh 60 seconds before actual expiry
  return Date.now() >= tokens.expires_at - 60_000;
}

export function getTokensPath(): string {
  return TOKENS_FILE;
}

// PKCE helpers
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthUrl(clientId: string, codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

// Start local HTTP server and wait for OAuth callback, returns { code, state }
export function waitForCallback(port = 8888, timeoutMs = 5 * 60 * 1000): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        const html = (title: string, msg: string) =>
          `<!DOCTYPE html><html><head><title>${title}</title>` +
          `<style>body{font-family:sans-serif;text-align:center;padding:60px;background:#191414;color:#fff;}` +
          `h1{color:${error ? "#e5534b" : "#1DB954"};}p{color:#b3b3b3;}</style></head>` +
          `<body><h1>${title}</h1><p>${msg}</p></body></html>`;

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(html("Authorization Failed", `Error: ${error}. You can close this tab.`));
          server.close();
          reject(new Error(`Spotify OAuth error: ${error}`));
        } else if (code && state) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(html("Authorization Successful!", "You can close this tab and return to your AI assistant."));
          server.close();
          resolve({ code, state });
        } else {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(html("Bad Request", "Missing code or state parameter."));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error");
        server.close();
        reject(err);
      }
    });

    server.listen(port, "127.0.0.1");
    server.on("error", reject);

    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timeout: no callback received within 5 minutes"));
    }, timeoutMs);
  });
}

// Exchange authorization code for tokens
export async function exchangeCodeForTokens(
  clientId: string,
  code: string,
  codeVerifier: string
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
}

// Refresh access token using refresh token
export async function refreshTokens(clientId: string, refreshToken: string): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
}
