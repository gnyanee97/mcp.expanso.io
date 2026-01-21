/**
 * Vulcan Quality API Client
 * 
 * Handles fetching quality snapshots from Vulcan Quality API.
 * This is a pure API client - no business logic.
 */

import { vulcanGet } from './http';
import type { TenantConfig } from './config';

// Minimal types - only what we need for summarization
export interface QualitySummary {
  pass: number;
  fail: number;
  warn: number;
  error: number;
  not_evaluated: number;
  total: number;
  pass_rate: number;
}

export interface QualitySnapshotResponse {
  run_id: string;
  start_ts: number;
  end_ts?: number | null;
  environment: string;
  quality_by_dimension: Record<string, QualitySummary>;
  models_included: string[];
  models_total?: number | null;
  prev_run_id?: string | null;
  next_run_id?: string | null;
  quality_by_model?: Record<string, unknown> | null;
  _links: Record<string, unknown>;
}

/**
 * Fetch quality snapshot from Vulcan Quality API.
 * 
 * @param tenantConfig - Tenant configuration for API access
 * @param runIdOrLatest - Run ID to get snapshot for, or 'latest' for most recent snapshot
 * @returns QualitySnapshotResponse with quality metrics grouped by dimension
 */
export async function getQualitySnapshot(
  tenantConfig: TenantConfig | null,
  runIdOrLatest: string = 'latest'
): Promise<QualitySnapshotResponse> {
  const data = await vulcanGet<QualitySnapshotResponse>(
    tenantConfig,
    `/api/v1/quality/snapshot/${runIdOrLatest}`,
    {}
  );
  return data;
}

