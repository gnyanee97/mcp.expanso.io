/**
 * Vulcan URL Normalization
 * 
 * Constructs Vulcan API base URLs using the format: {api_base_url}/{tenant}/vulcan/{dataproduct_name}
 */

export type VulcanTarget = {
  apiBaseUrl: string;        // e.g. https://everest-010626.dataos.app (origin only, no path)
  tenant: string;            // e.g. system
  dataProductName: string;   // e.g. sample-vulcan-dp
};

/**
 * Build Vulcan API base URL from target components.
 * Format: {api_base_url}/{tenant}/vulcan/{dataproduct_name}
 */
export function buildVulcanBaseUrl(t: VulcanTarget): string {
  // Normalize: remove trailing slashes from apiBaseUrl
  const api = t.apiBaseUrl.replace(/\/+$/, "");
  
  // Normalize: remove leading/trailing slashes from tenant and dataProductName
  const tenant = t.tenant.replace(/^\/+|\/+$/g, "");
  const dp = t.dataProductName.replace(/^\/+|\/+$/g, "");
  
  // Construct: {api}/{tenant}/vulcan/{dataproduct-name}
  return `${api}/${tenant}/vulcan/${dp}`;
}

/**
 * Normalize user-provided API base URL.
 * Handles cases like:
 * - https://everest-010626.dataos.app (base domain)
 * - https://everest-010626.dataos.app/home/ (with UI path)
 * - https://everest-010626.dataos.app/system (with tenant path - will be stripped)
 * - everest-010626.dataos.app (missing protocol)
 * 
 * Returns only the origin (scheme + host), no path.
 * The tenant and data product name are added separately by buildVulcanBaseUrl().
 */
export function normalizeApiBaseUrl(userUrl: string): string {
  const u = new URL(userUrl.startsWith("http") ? userUrl : `https://${userUrl}`);
  return u.origin; // Only scheme + host, no path
}

/**
 * Parse Vulcan OpenAPI URL to extract api_base_url, tenant, and data_product_name.
 * 
 * Expected format: https://{domain}/{tenant}/vulcan/{data_product_name}/openapi.json
 * 
 * @param openapiUrl - Full OpenAPI URL (e.g., https://everest-010626.dataos.app/system/vulcan/sample-vulcan-dp/openapi.json)
 * @returns Parsed components or null if format doesn't match
 */
export function parseVulcanOpenApiUrl(openapiUrl: string): VulcanTarget | null {
  try {
    const u = new URL(openapiUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    
    // Expected: [tenant, "vulcan", dataProductName, "openapi.json"]
    const vulcanIdx = parts.indexOf("vulcan");
    
    if (vulcanIdx <= 0 || vulcanIdx + 1 >= parts.length) {
      return null;
    }
    
    return {
      apiBaseUrl: u.origin, // Only origin, no path
      tenant: parts[vulcanIdx - 1],
      dataProductName: parts[vulcanIdx + 1],
    };
  } catch {
    return null;
  }
}

