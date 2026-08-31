import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";

export const X_AUTH_COOKIE_NAME = "pop_person_auth";
export const X_OAUTH_STATE_COOKIE_NAME = "pop_person_x_state";
export const X_OAUTH_VERIFIER_COOKIE_NAME = "pop_person_x_verifier";
export const X_OAUTH_RETURN_TO_COOKIE_NAME = "pop_person_x_return_to";

const AUTH_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_COOKIE_TTL_SECONDS = 60 * 10;
const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_USER_URL = "https://api.x.com/2/users/me";

export type AuthenticatedUser = {
  xUserId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  email: string | null;
};

type AuthCookiePayload = AuthenticatedUser & {
  iat: number;
  exp: number;
};

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for X authentication.");
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function signedCookieValue(payload: AuthCookiePayload): string {
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function isValidUrl(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048;
}

export function createAuthCookie(user: AuthenticatedUser): string {
  const now = Math.floor(Date.now() / 1000);
  return signedCookieValue({
    ...user,
    iat: now,
    exp: now + AUTH_TTL_SECONDS,
  });
}

export function verifyAuthCookie(token: unknown): AuthenticatedUser | null {
  if (typeof token !== "string") return null;
  const [encodedPayload, providedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !providedSignature || extraParts.length > 0) return null;

  const expectedSignature = sign(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<AuthCookiePayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      !isValidUrl(payload.xUserId) ||
      !isValidUrl(payload.username) ||
      !isValidUrl(payload.name) ||
      (payload.avatarUrl !== null && !isValidUrl(payload.avatarUrl)) ||
      (payload.email !== null && !isValidUrl(payload.email)) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      payload.iat > now + 60
    ) {
      return null;
    }
    return {
      xUserId: payload.xUserId,
      username: payload.username,
      name: payload.name,
      avatarUrl: payload.avatarUrl ?? null,
      email: payload.email ?? null,
    };
  } catch {
    return null;
  }
}

function isSecureRequest(req: Request): boolean {
  return req.secure || req.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

function cookieAttributes(req: Request, maxAge: number): string {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  const sameSite = process.env.NODE_ENV === "production" ? "None" : "Lax";
  return `Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=${sameSite}${secure}`;
}

export function setAuthCookie(req: Request, res: Response, user: AuthenticatedUser): void {
  res.setHeader(
    "Set-Cookie",
    `${X_AUTH_COOKIE_NAME}=${createAuthCookie(user)}; ${cookieAttributes(req, AUTH_TTL_SECONDS)}`,
  );
}

export function clearAuthCookie(req: Request, res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${X_AUTH_COOKIE_NAME}=; ${cookieAttributes(req, 0)}`,
  );
}

function setOAuthCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
): void {
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; ${cookieAttributes(req, OAUTH_COOKIE_TTL_SECONDS)}`,
  );
}

export function clearOAuthCookies(req: Request, res: Response): void {
  for (const name of [
    X_OAUTH_STATE_COOKIE_NAME,
    X_OAUTH_VERIFIER_COOKIE_NAME,
    X_OAUTH_RETURN_TO_COOKIE_NAME,
  ]) {
    res.append("Set-Cookie", `${name}=; ${cookieAttributes(req, 0)}`);
  }
}

function getClientCredentials(): {
  clientId: string;
  clientSecret: string | null;
} {
  const clientId = process.env.X_CLIENT_ID?.trim();
  const clientSecret = process.env.X_CLIENT_SECRET?.trim() || null;
  if (!clientId) {
    throw new Error("X_CLIENT_ID must be configured.");
  }
  return { clientId, clientSecret };
}

export function getXRedirectUri(req: Request): string {
  const configured = process.env.X_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() || req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0].trim() || req.get("host");
  if (!host) throw new Error("Cannot determine the X OAuth redirect host.");
  return `${protocol}://${host}/api/auth/x/callback`;
}

function getRequestOrigin(req: Request): string {
  const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() || req.protocol;
  const host = req.get("x-forwarded-host")?.split(",")[0].trim() || req.get("host");
  if (!host) throw new Error("Cannot determine the request origin.");
  return `${protocol}://${host}`;
}

function getFrontendOrigin(): string | null {
  const configured =
    process.env.FRONTEND_URL?.trim() ||
    process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).find(Boolean);
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    throw new Error("FRONTEND_URL or CORS_ORIGIN must contain a valid frontend URL.");
  }
}

export function getFrontendRedirectUri(req: Request, returnTo: unknown): string {
  const origin = getFrontendOrigin() || getRequestOrigin(req);
  return new URL(normalizeReturnTo(returnTo), `${origin}/`).toString();
}

export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const decoded = value.trim();
  return decoded.startsWith("/") && !decoded.startsWith("//") ? decoded : "/";
}

export function beginXAuthorization(req: Request, res: Response): void {
  const { clientId } = getClientCredentials();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const returnTo = normalizeReturnTo(req.query.returnTo);

  setOAuthCookie(req, res, X_OAUTH_STATE_COOKIE_NAME, state);
  setOAuthCookie(req, res, X_OAUTH_VERIFIER_COOKIE_NAME, verifier);
  setOAuthCookie(req, res, X_OAUTH_RETURN_TO_COOKIE_NAME, returnTo);

  const authorizationUrl = new URL(X_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: getXRedirectUri(req),
    scope: "users.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  res.redirect(302, authorizationUrl.toString());
}

function readCookie(req: Request, name: string): string | null {
  const value = req.cookies?.[name];
  return typeof value === "string" ? value : null;
}

async function exchangeCodeForAccessToken(
  req: Request,
  code: string,
  verifier: string,
): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: getXRedirectUri(req),
    code_verifier: verifier,
  });

  if (clientSecret) {
    const basicCredentials = Buffer.from(
      `${clientId}:${clientSecret}`,
    ).toString("base64");
    headers.Authorization = `Basic ${basicCredentials}`;
  } else {
    body.set("client_id", clientId);
  }

  const response = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const rawResponse = await response.text();
  let data: { access_token?: unknown; error?: unknown; error_description?: unknown };
  try {
    data = JSON.parse(rawResponse) as typeof data;
  } catch {
    data = {};
  }
  if (!response.ok) {
    const providerError =
      typeof data.error === "string" ? data.error : "unknown_provider_error";
    const description =
      typeof data.error_description === "string"
        ? ` ${data.error_description}`
        : "";
    throw new Error(
      `X token exchange failed with status ${response.status}: ${providerError}.${description}`,
    );
  }
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("X token exchange did not return an access token.");
  }
  return data.access_token;
}

export function getPublicAuthErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Invalid X OAuth state")) return "invalid_state";
  if (message.includes("did not return an authorization code")) {
    return "missing_code";
  }
  if (message.includes("token exchange")) return "token_exchange";
  if (message.includes("user lookup failed")) return "profile_http";
  if (message.includes("incomplete profile")) return "profile_incomplete";
  if (message.includes("profile")) return "profile";
  return "unknown";
}

export async function completeXAuthorization(
  req: Request,
  res: Response,
): Promise<AuthenticatedUser> {
  const state = readCookie(req, X_OAUTH_STATE_COOKIE_NAME);
  const verifier = readCookie(req, X_OAUTH_VERIFIER_COOKIE_NAME);
  if (!state || !verifier || state !== req.query.state) {
    throw new Error("Invalid X OAuth state.");
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) throw new Error("X OAuth did not return an authorization code.");

  const accessToken = await exchangeCodeForAccessToken(req, code, verifier);
  const response = await fetch(
    `${X_USER_URL}?user.fields=profile_image_url,username,name`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const rawProfileResponse = await response.text();
  let profileResponse: {
    data?: {
      id?: unknown;
      username?: unknown;
      name?: unknown;
      profile_image_url?: unknown;
      email?: unknown;
    };
    error?: unknown;
    detail?: unknown;
    title?: unknown;
  };
  try {
    profileResponse = JSON.parse(rawProfileResponse) as typeof profileResponse;
  } catch {
    profileResponse = {};
  }
  if (!response.ok) {
    const providerError =
      typeof profileResponse.title === "string"
        ? profileResponse.title
        : typeof profileResponse.error === "string"
          ? profileResponse.error
          : "unknown_provider_error";
    const detail =
      typeof profileResponse.detail === "string"
        ? ` ${profileResponse.detail}`
        : "";
    throw new Error(
      `X user lookup failed with status ${response.status}: ${providerError}.${detail}`,
    );
  }

  const profile = profileResponse.data;
  if (
    typeof profile?.id !== "string" ||
    typeof profile.username !== "string" ||
    typeof profile.name !== "string"
  ) {
    throw new Error("X user lookup returned an incomplete profile.");
  }
  const user: AuthenticatedUser = {
    xUserId: profile.id,
    username: profile.username,
    name: profile.name,
    avatarUrl: typeof profile.profile_image_url === "string"
      ? profile.profile_image_url.replace("_normal.", "_400x400.")
      : null,
    email: typeof profile.email === "string" ? profile.email : null,
  };
  setAuthCookie(req, res, user);
  clearOAuthCookies(req, res);
  return user;
}

export function getReturnTo(req: Request): string {
  return normalizeReturnTo(req.cookies?.[X_OAUTH_RETURN_TO_COOKIE_NAME]);
}