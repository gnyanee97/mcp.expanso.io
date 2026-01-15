/**
 * Vulcan Tenant Configuration
 * 
 * Handles reading tenant-specific Vulcan API configuration from KV storage.
 */

import type { Env } from '../index';

export interface TenantConfig {
  api_base_url?: string;        // e.g. https://everest-010626.dataos.app (origin only, no path)
  tenant?: string;              // e.g. system
  data_product_name?: string;  // e.g. sample-vulcan-dp
  vulcan_token?: string;        // API authentication token (should be from Worker secret/env)
  VULCAN_BASE_URL?: string;     // Legacy: backward compatibility
  VULCAN_TOKEN?: string;        // Legacy: backward compatibility
  VULCAN_AUTH_HEADER?: string;  // Legacy: backward compatibility
  VULCAN_AUTH_SCHEME?: string;  // Legacy: backward compatibility
  default_environment?: string; // Legacy: backward compatibility
  dataproduct_name?: string;    // Legacy: backward compatibility (use data_product_name)
}

/**
 * Read tenant configuration from KV storage.
 * Falls back to environment variables if KV config not found.
 */
export async function getTenantConfig(
  env: Env,
  tenantId: string
): Promise<TenantConfig> {
  // 1) Try to read from KV first
  let kvConfig: TenantConfig | null = null;
  if (env.VULCAN_CONFIG) {
    try {
      const kvKey = `tenant:${tenantId}`;
      const raw = await env.VULCAN_CONFIG.get(kvKey);
      if (raw) {
        kvConfig = JSON.parse(raw) as TenantConfig;
      }
    } catch (error) {
      console.error(`Failed to read tenant config for ${tenantId}:`, error);
      // Fall through to env var fallback
    }
  }

  // 2) Build config from environment variables (with backward compatibility)
  // Note: New env vars (VULCAN_API_BASE_URL, VULCAN_TENANT, VULCAN_DATA_PRODUCT_NAME) are not in Env type yet
  // For now, only use legacy VULCAN_BASE_URL and rely on KV or tool args for new format
  const envConfig: TenantConfig = {
    api_base_url: env.VULCAN_BASE_URL, // Legacy: can be set in env, but should use KV or tool args
    vulcan_token: env.VULCAN_TOKEN, // Should be from Worker secret
    // Legacy fields for backward compatibility
    VULCAN_BASE_URL: env.VULCAN_BASE_URL,
    VULCAN_TOKEN: env.VULCAN_TOKEN,
    VULCAN_AUTH_HEADER: env.VULCAN_AUTH_HEADER,
    VULCAN_AUTH_SCHEME: env.VULCAN_AUTH_SCHEME,
  };

  // Merge: KV config overrides env config
  return { ...envConfig, ...(kvConfig ?? {}) };
}

