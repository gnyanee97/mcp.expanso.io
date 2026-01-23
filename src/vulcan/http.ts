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

  // Get API key/token: prefer api_key, then vulcan_token, then VULCAN_TOKEN (backward compat)
  // api_key uses raw Authorization header (no Bearer prefix) to match Postman working format
  const apiKey = tenantConfig.api_key || tenantConfig.vulcan_token || tenantConfig.VULCAN_TOKEN || '';
  const headerName = tenantConfig.VULCAN_AUTH_HEADER || "Authorization";
  // If api_key is provided, use empty scheme (raw key, no Bearer prefix); otherwise use configured scheme
  const scheme = tenantConfig.api_key ? "" : (tenantConfig.VULCAN_AUTH_SCHEME || "Bearer");
  
  // Debug logging for API key (redacted)
  console.log("[Vulcan Config] API Key check", {
    has_api_key: !!tenantConfig.api_key,
    has_vulcan_token: !!tenantConfig.vulcan_token,
    has_VULCAN_TOKEN: !!tenantConfig.VULCAN_TOKEN,
    apiKey_length: apiKey.length,
    apiKey_preview: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'EMPTY',
    scheme: scheme || '(empty - raw token)',
    headerName,
  });

  return { 
    baseUrl, 
    auth: { headerName, scheme, token: apiKey } as VulcanAuth 
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

  // Log the URL being called for debugging (redact API key from logs)
  const finalUrl = url.toString();
  const redactedHeaders = { ...headers };
  if (redactedHeaders[auth.headerName]) {
    const authValue = redactedHeaders[auth.headerName];
    if (authValue && typeof authValue === 'string') {
      // Redact: show first 4 chars and last 4 chars, replace middle with ***
      const parts = authValue.split(' ');
      if (parts.length > 1) {
        const token = parts.slice(1).join(' ');
        if (token.length > 8) {
          redactedHeaders[auth.headerName] = `${parts[0]} ${token.slice(0, 4)}***${token.slice(-4)}`;
        } else {
          redactedHeaders[auth.headerName] = `${parts[0]} ***`;
        }
      } else {
        redactedHeaders[auth.headerName] = '***';
      }
    }
  }
  console.log(`[Vulcan API] GET ${finalUrl}`);
  console.log(`[Vulcan API] Base URL: ${baseUrl}, Path: ${path}, Final URL: ${finalUrl}`);
  console.log(`[Vulcan API] Headers:`, JSON.stringify(redactedHeaders, null, 2));

  const res = await fetch(finalUrl, { method: "GET", headers });

  // Log response status
  console.log("[Vulcan API] Response", {
    status: res.status,
    statusText: res.statusText,
    url: finalUrl,
  });

  // Read body safely (truncate for logging)
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  const isJsonContentType = contentType.includes('application/json') || contentType.includes('text/json');
  
  // Log response snippet (safe - no secrets in response body)
  console.log("[Vulcan API] Body snippet", text.slice(0, 300));

          // Check if response is OK
          if (!res.ok) {
            // Handle authentication errors specifically
            if (res.status === 401 || res.status === 403) {
              const errorMessage = `Auth failed (${res.status}). Please provide a valid api_key.`;
              console.error(`[Vulcan API Auth Error] ${errorMessage}`);
              throw new Error(errorMessage);
            }
            
            // Handle Cloudflare timeout errors (522 = Connection timed out)
            if (res.status === 522) {
              const errorMessage = `Connection timeout (522). The Vulcan API server did not respond in time. This could indicate: 1) The API server is slow or down, 2) Network connectivity issues, 3) The API URL might be incorrect. Check the URL: ${finalUrl}`;
              console.error(`[Vulcan API Timeout Error] ${errorMessage}`);
              throw new Error(errorMessage);
            }
    
    // Other errors - check if response is JSON
    if (isJsonContentType) {
      // Try to parse as JSON
      try {
        const errorJson = JSON.parse(text);
        const errorDetails = errorJson.message || errorJson.error || JSON.stringify(errorJson).slice(0, 200);
        const errorMessage = `Vulcan API error ${res.status} ${res.statusText}: ${errorDetails}`;
        console.error(`[Vulcan API Error] ${errorMessage}`);
        throw new Error(errorMessage);
      } catch {
        // Fall through to non-JSON handling
      }
    }
    
    // Not JSON or failed to parse - provide concise error
    const isHtml = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');
    const responseType = isHtml ? 'HTML (likely auth redirect)' : 'non-JSON';
    const snippet = text.slice(0, 100).replace(/\s+/g, ' ').trim(); // Clean up whitespace
    const errorMessage = `Vulcan API error ${res.status} ${res.statusText}: got ${responseType}. Response snippet: ${snippet}`;
    console.error(`[Vulcan API Error] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  // Response is OK (200-299) - check if it's actually JSON
  // Detect HTML responses (even with 200 OK) - indicates routing/auth issue
  const isHtml = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');
  if (isHtml || (!isJsonContentType && text.length > 0)) {
    const responseType = isHtml ? 'HTML (likely auth redirect)' : 'non-JSON';
    const snippet = text.slice(0, 100).replace(/\s+/g, ' ').trim(); // Clean up whitespace
    const errorMessage = `Vulcan API returned ${responseType} instead of JSON (status: ${res.status}). Response snippet: ${snippet}`;
    console.error(`[Vulcan API Error] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  // Parse as JSON
  try {
    const data = JSON.parse(text) as T;
    return data;
  } catch (parseError) {
    // This should rarely happen if Content-Type is correct, but handle gracefully
    const isHtmlResponse = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');
    const responseType = isHtmlResponse ? 'HTML (likely auth redirect)' : 'non-JSON';
    const snippet = text.slice(0, 100).replace(/\s+/g, ' ').trim(); // Clean up whitespace
    const errorMessage = `Failed to parse Vulcan API response as JSON (status: ${res.status}): got ${responseType}. Response snippet: ${snippet}`;
    console.error(`[Vulcan API Parse Error] ${errorMessage}`);
    throw new Error(errorMessage);
  }
}

