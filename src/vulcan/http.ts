/**
 * Vulcan API HTTP Client
 * 
 * Handles authentication and HTTP requests to Vulcan APIs.
 */

import type { TenantConfig } from './config';

export type VulcanAuth = {
  headerName: string;      // e.g. "Authorization" or "X-API-Key"
  scheme?: string;         // e.g. "Bearer"
  token: string;
};

export interface VulcanConfig {
  baseUrl: string;
  auth: VulcanAuth;
}

/**
 * Create VulcanConfig from tenant configuration.
 * Accepts either TenantConfig (from KV) or legacy env vars.
 */
export function getVulcanConfig(tenantConfig: TenantConfig | null): VulcanConfig {
  if (!tenantConfig || !tenantConfig.VULCAN_BASE_URL) {
    throw new Error("Missing VULCAN_BASE_URL in tenant configuration");
  }

  const baseUrl = tenantConfig.VULCAN_BASE_URL;
  const token = tenantConfig.VULCAN_TOKEN || ''; // Optional - default to empty if not provided
  const headerName = tenantConfig.VULCAN_AUTH_HEADER || "Authorization";
  const scheme = tenantConfig.VULCAN_AUTH_SCHEME || "Bearer";

  return { 
    baseUrl, 
    auth: { headerName, scheme, token } as VulcanAuth 
  };
}

export async function vulcanGet<T>(
  tenantConfig: TenantConfig | null,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const { baseUrl, auth } = getVulcanConfig(tenantConfig);

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

