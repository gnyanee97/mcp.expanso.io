/**
 * Vulcan API HTTP Client
 * 
 * Handles authentication and HTTP requests to Vulcan APIs.
 */

import type { Env } from '../index';

export type VulcanAuth = {
  headerName: string;      // e.g. "Authorization" or "X-API-Key"
  scheme?: string;         // e.g. "Bearer"
  token: string;
};

export interface VulcanConfig {
  baseUrl: string;
  auth: VulcanAuth;
}

export function getVulcanConfig(env: Env): VulcanConfig {
  const baseUrl = env.VULCAN_BASE_URL;
  const token = env.VULCAN_TOKEN || ''; // Optional - default to empty if not provided

  if (!baseUrl) throw new Error("Missing VULCAN_BASE_URL in environment");

  const headerName = env.VULCAN_AUTH_HEADER || "Authorization";
  const scheme = env.VULCAN_AUTH_SCHEME || "Bearer";

  return { 
    baseUrl, 
    auth: { headerName, scheme, token } as VulcanAuth 
  };
}

export async function vulcanGet<T>(
  env: Env,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const { baseUrl, auth } = getVulcanConfig(env);

  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && `${v}`.length > 0) {
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    "Accept": "application/json",
  };

  // Auth header (only add if token is provided)
  if (auth.token) {
    if (auth.scheme) {
      headers[auth.headerName] = `${auth.scheme} ${auth.token}`;
    } else {
      headers[auth.headerName] = auth.token;
    }
  }

  const res = await fetch(url.toString(), { method: "GET", headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Vulcan GET ${url.pathname} failed: ${res.status} ${res.statusText}\n${body}`
    );
  }

  return (await res.json()) as T;
}

