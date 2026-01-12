/**
 * Vulcan Tenant Configuration
 * 
 * Handles reading tenant-specific Vulcan API configuration from KV storage.
 */

import type { Env } from '../index';

export interface TenantConfig {
  VULCAN_BASE_URL: string;
  VULCAN_TOKEN?: string;
  VULCAN_AUTH_HEADER?: string;
  VULCAN_AUTH_SCHEME?: string;
  default_environment?: string;
}

/**
 * Read tenant configuration from KV storage.
 * Falls back to environment variables if KV config not found.
 */
export async function getTenantConfig(
  env: Env,
  tenant: string
): Promise<TenantConfig | null> {
  // Try to read from KV first
  if (env.VULCAN_CONFIG) {
    try {
      const kvKey = `tenant:${tenant}`;
      const configJson = await env.VULCAN_CONFIG.get(kvKey);
      
      if (configJson) {
        const config = JSON.parse(configJson) as TenantConfig;
        if (config.VULCAN_BASE_URL) {
          return config;
        }
      }
    } catch (error) {
      console.error(`Failed to read tenant config for ${tenant}:`, error);
      // Fall through to env var fallback
    }
  }

  // Fallback to environment variables (for backward compatibility)
  if (env.VULCAN_BASE_URL) {
    return {
      VULCAN_BASE_URL: env.VULCAN_BASE_URL,
      VULCAN_TOKEN: env.VULCAN_TOKEN,
      VULCAN_AUTH_HEADER: env.VULCAN_AUTH_HEADER,
      VULCAN_AUTH_SCHEME: env.VULCAN_AUTH_SCHEME,
    };
  }

  return null;
}

