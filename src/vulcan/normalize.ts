/**
 * Vulcan URL Normalization
 * 
 * Constructs Vulcan API base URLs using the format: {api_base_url}/{tenant}/vulcan/{dataproduct_name}
 */

export type VulcanTarget = {
  apiBaseUrl: string;        // e.g. https://everest-010626.dataos.app/system
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
 * - everest-010626.dataos.app (missing protocol)
 * 
 * Returns the base API URL (without /vulcan/{dataproduct} part)
 */
export function normalizeApiBaseUrl(userUrl: string): string {
  try {
    const url = new URL(userUrl);
    
    // If URL already contains /system or similar tenant path, extract up to that
    // Otherwise, just return the base domain
    const pathParts = url.pathname.split('/').filter(p => p);
    
    // If path starts with a tenant-like segment (e.g., /system), include it
    // Otherwise, strip all paths (like /home/, /dashboard/)
    if (pathParts.length > 0 && !pathParts.includes('home') && !pathParts.includes('dashboard')) {
      // Has a meaningful path, keep it
      return `${url.protocol}//${url.host}/${pathParts[0]}`;
    }
    
    // No meaningful path or has UI paths, return just base domain
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    // If URL parsing fails (e.g., missing protocol), try to handle it
    let normalized = userUrl.endsWith('/') ? userUrl.slice(0, -1) : userUrl;
    
    // Try to extract base domain (everything before first /)
    const firstSlashIndex = normalized.indexOf('/');
    if (firstSlashIndex > 0) {
      normalized = normalized.substring(0, firstSlashIndex);
    }
    
    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    
    return normalized;
  }
}

