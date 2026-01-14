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

  // Normalize baseUrl - remove trailing slash
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  // Normalize path - ensure it starts with / but doesn't replace baseUrl's path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Construct URL properly: if baseUrl has a path, append to it; otherwise use new URL
  let url: URL;
  try {
    const baseUrlObj = new URL(normalizedBaseUrl);
    // If baseUrl has a path component, append the path to it
    if (baseUrlObj.pathname && baseUrlObj.pathname !== '/') {
      const combinedPath = baseUrlObj.pathname.endsWith('/') 
        ? `${baseUrlObj.pathname}${normalizedPath.slice(1)}` 
        : `${baseUrlObj.pathname}${normalizedPath}`;
      url = new URL(combinedPath, `${baseUrlObj.protocol}//${baseUrlObj.host}`);
    } else {
      // Base URL has no path, use standard URL construction
      url = new URL(normalizedPath, normalizedBaseUrl);
    }
  } catch (e) {
    // Fallback: simple string concatenation if URL parsing fails
    url = new URL(`${normalizedBaseUrl}${normalizedPath}`);
  }

  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && `${v}`.length > 0) {
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "Vulcan-MCP-Server/1.0", // Add User-Agent header
  };

  // Auth header (only add if token is provided)
  if (auth.token) {
    if (auth.scheme) {
      headers[auth.headerName] = `${auth.scheme} ${auth.token}`;
    } else {
      headers[auth.headerName] = auth.token;
    }
  }

  // Log the URL being called for debugging
  console.log(`[Vulcan API] GET ${url.toString()}`);

  const res = await fetch(url.toString(), { method: "GET", headers });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const errorMessage = `Vulcan GET ${url.pathname} failed: ${res.status} ${res.statusText}\n${body}\nRequest URL: ${url.toString()}`;
    console.error(`[Vulcan API Error] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  return (await res.json()) as T;
}

