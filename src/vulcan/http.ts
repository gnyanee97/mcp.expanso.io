/**
 * Vulcan API HTTP Client
 * 
 * Handles authentication and HTTP requests to Vulcan APIs.
 */

import type { TenantConfig } from './config';
import { buildVulcanBaseUrl, normalizeApiBaseUrl, type VulcanTarget } from './normalize';

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
 * Resolve Vulcan target from configuration.
 * Validates that all required fields are present.
 */
export function resolveVulcanTarget(cfg: TenantConfig): VulcanTarget {
  const apiBaseUrl = cfg.api_base_url;
  const tenant = cfg.tenant;
  const dataProductName = cfg.data_product_name || cfg.dataproduct_name; // Support both names
  
  const missing: string[] = [];
  if (!apiBaseUrl) missing.push("api_base_url");
  if (!tenant) missing.push("tenant");
  if (!dataProductName) missing.push("data_product_name");
  
  if (missing.length) {
    throw new Error(
      `Missing Vulcan target config: ${missing.join(", ")}. ` +
      `Provide these in the tool call or set them in KV (tenant:default) or env vars.`
    );
  }
  
  // TypeScript now knows these are not undefined after the checks above
  return {
    apiBaseUrl: apiBaseUrl!,
    tenant: tenant!,
    dataProductName: dataProductName!,
  };
}

/**
 * Create VulcanConfig from tenant configuration.
 * Constructs the base URL using: {api_base_url}/{tenant}/vulcan/{data_product_name}
 */
export function getVulcanConfig(tenantConfig: TenantConfig | null): VulcanConfig {
  if (!tenantConfig) {
    throw new Error("Missing tenant configuration");
  }

  // Resolve and validate target
  const target = resolveVulcanTarget(tenantConfig);
  
  // Build the base URL
  const baseUrl = buildVulcanBaseUrl(target);
  
  console.log("[Vulcan Config]", {
    apiBaseUrl: target.apiBaseUrl,
    tenant: target.tenant,
    dataProductName: target.dataProductName,
    normalizedBaseUrl: baseUrl,
  });

  // Get token (prefer vulcan_token, fallback to VULCAN_TOKEN for backward compat)
  const token = tenantConfig.vulcan_token || tenantConfig.VULCAN_TOKEN || '';
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
  const finalUrl = url.toString();
  console.log(`[Vulcan API] GET ${finalUrl}`);
  console.log(`[Vulcan API] Base URL: ${baseUrl}, Path: ${path}, Final URL: ${finalUrl}`);

  const res = await fetch(finalUrl, { method: "GET", headers });

  // Log response status
  console.log("[Vulcan API] Response", {
    status: res.status,
    statusText: res.statusText,
    url: finalUrl,
  });

  // Read body safely (truncate for logging)
  const text = await res.text();
  console.log("[Vulcan API] Body snippet", text.slice(0, 300));

  // Check if response is OK
  if (!res.ok) {
    const errorMessage = `Vulcan API error ${res.status} ${res.statusText}: ${text.slice(0, 300)}`;
    console.error(`[Vulcan API Error] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  // Parse as JSON
  const data = JSON.parse(text) as T;
  return data;
}

