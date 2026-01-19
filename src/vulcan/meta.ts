/**
 * Vulcan Meta API Client
 * 
 * Handles fetching metadata from Vulcan Meta API.
 * This is a pure API client - no business logic.
 */

import { vulcanGet } from './http';
import type { TenantConfig } from './config';

// Minimal types - only what we need for lineage
export interface ModelReference {
  path: string;        // e.g., "tenant/product/name"
  model_name: string;  // e.g., "users"
}

export interface ModelView {
  name: string;        // e.g., "b2b_saas.users"
  path: string;        // e.g., "marketing/b2b_saas/users"
  depends_on: ModelReference[];  // Upstream dependencies
}

export interface Relationship {
  from_path: string;   // e.g., "/models/users"
  to_path: string;     // e.g., "/models/orders"
  type: string;        // e.g., "model_depends_on_model"
}

export interface MetaResponse {
  product: {
    path: string;
    name: string;
    tenant: string;
  };
  models: ModelView[];
  metrics: unknown[];  // Not used for lineage
  relationships: Relationship[] | null;  // Only when expand=true
}

/**
 * Fetch expanded metadata from Vulcan Meta API.
 * Returns raw MetaResponse with relationships included.
 */
export async function getMetaExpanded(
  tenantConfig: TenantConfig | null
): Promise<MetaResponse> {
  const data = await vulcanGet<MetaResponse>(
    tenantConfig,
    '/api/v1/meta',
    { expand: 'true' }
  );
  return data;
}

