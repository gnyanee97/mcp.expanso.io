/**
 * Vulcan Activity API Handlers
 * 
 * Handles Activity API endpoints for timeline, runs, and plans.
 */

import { vulcanGet } from './http';
import type { TenantConfig } from './config';

// Types matching OpenAPI spec
export interface TimelineEvent {
  plan_id?: string | null;
  run_id?: string | null;
  start_ts: number;
  end_ts?: number | null;
  created_ts_ns: number;
  action: 'plan' | 'run';
  environment: string;
  success: boolean;
  models_affected?: string[] | null;
  rows_affected?: number | null;
  evaluation_ms?: number | null;
  quality_by_dimension?: Record<string, {
    pass: number;
    fail: number;
    warn: number;
    error: number;
    not_evaluated: number;
    total: number;
    pass_rate: number;
  }> | null;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  total: number;
  pagination: {
    limit: number;
    offset: number;
    has_more: boolean;
    order_by: string;
    order_direction: string;
  };
  _links: Record<string, unknown>;
}

export interface TimelineSummary {
  total_events: number;
  timestamp_range: {
    earliest: number | null;
    latest: number | null;
  };
  breakdown: {
    plans: { total: number; successful: number; failed: number };
    runs: { total: number; successful: number; failed: number };
  };
  latest_events: Array<{
    action: 'plan' | 'run';
    id: string;
    timestamp: number;
    success: boolean;
    environment: string;
    models_affected?: string[];
    quality_by_dimension?: Record<string, unknown>;
  }>;
}

export interface ActivityTimelineParams {
  action?: 'plan' | 'run';
  environment?: string;
  after_start_ts?: number;
  model_name?: string[];
  limit?: number;
  offset?: number;
  failed_only?: boolean;
}

export async function getActivityTimeline(
  tenantConfig: TenantConfig | null,
  params: ActivityTimelineParams
): Promise<{ summary: TimelineSummary; events: TimelineEvent[]; raw: TimelineResponse }> {
  const query: Record<string, string | number | undefined> = {
    action: params.action,
    environment: params.environment,
    after_start_ts: params.after_start_ts,
    model_name: params.model_name?.length ? params.model_name.join(',') : undefined,
    limit: params.limit ?? 100,
    offset: params.offset ?? 0,
  };

  const data = await vulcanGet<TimelineResponse>(tenantConfig, '/api/v1/activity/timeline', query);

  let events = data.events ?? [];

  // Client-side filtering for failed_only
  if (params.failed_only) {
    events = events.filter(e => e.success === false);
  }

  // Calculate summary
  const plans = events.filter(e => e.action === 'plan');
  const runs = events.filter(e => e.action === 'run');

  const timestamps = events.map(e => e.start_ts).filter(ts => ts != null) as number[];

  const summary: TimelineSummary = {
    total_events: events.length,
    timestamp_range: {
      earliest: timestamps.length > 0 ? Math.min(...timestamps) : null,
      latest: timestamps.length > 0 ? Math.max(...timestamps) : null,
    },
    breakdown: {
      plans: {
        total: plans.length,
        successful: plans.filter(p => p.success).length,
        failed: plans.filter(p => !p.success).length,
      },
      runs: {
        total: runs.length,
        successful: runs.filter(r => r.success).length,
        failed: runs.filter(r => !r.success).length,
      },
    },
    latest_events: events.slice(0, 10).map(e => ({
      action: e.action,
      id: e.action === 'run' ? (e.run_id || '') : (e.plan_id || ''),
      timestamp: e.start_ts,
      success: e.success,
      environment: e.environment,
      models_affected: e.models_affected ?? undefined,
      quality_by_dimension: e.quality_by_dimension ?? undefined,
    })),
  };

  return {
    summary,
    events,
    raw: data,
  };
}

// Types for RunDetail API
export interface ErrorExec {
  model_fqn?: string | null;
  model_name?: string | null;
  error_class: string;
  message: string;
  is_audit_error?: boolean;
  audit_name?: string | null;
  audit_failed_rows?: number | null;
  audit_sql?: string | null;
  audit_args?: Record<string, unknown> | null;
  audit_adapter_dialect?: string | null;
}

export interface ModelExec {
  name: string;
  fqn: string;
  model_kind?: string | null;
  start_ts: number;
  end_ts?: number;
  total_batches?: number;
  evaluation_ms?: number;
  rows_affected?: number;
  bytes_processed?: number;
  intervals?: unknown[];
}

export interface RunDetail {
  run_id: string;
  plan_id: string;
  environment: string;
  start_ts: number;
  end_ts: number;
  models_affected: ModelExec[];
  errors: ErrorExec[];
  success: boolean;
  quality?: Record<string, unknown[]> | null;
  profile?: Record<string, unknown> | null;
  _links: Record<string, unknown>;
}

/**
 * Fetch run details from Vulcan Activity API.
 * Returns complete run information including errors, quality, and profile data.
 */
export async function getRunDetail(
  tenantConfig: TenantConfig | null,
  runId: string
): Promise<RunDetail> {
  const data = await vulcanGet<RunDetail>(
    tenantConfig,
    `/api/v1/activity/timeline/runs/${runId}`,
    {}
  );
  return data;
}

// Types for PlanDetail API (minimal - only what recommendations need)
export interface ChangeDisplay {
  name: string;
  fqn: string;
  snapshot_id: string;
  version: string;
  node_type: string;
  model_kind?: string | null;
  parents?: string[];
}

export interface ChangeDirect extends ChangeDisplay {
  diff: string;
  indirect?: ChangeDisplay[];
  direct?: ChangeDisplay[];
  change_category?: string | null;
  data_hash_changed?: boolean;
  metadata_hash_changed?: boolean;
  parent_data_hash_changed?: boolean;
  old_version?: string;
  old_snapshot_id?: string;
  schema_diff?: unknown | null;
  needs_backfill?: boolean;
}

export interface ChangeIndirect extends ChangeDisplay {
  change_category?: string | null;
  needs_backfill?: boolean;
}

export interface ModelsDiff {
  direct: ChangeDirect[];
  indirect: ChangeIndirect[];
  added: ChangeDisplay[];
  removed: ChangeDisplay[];
  metadata?: ChangeDisplay[];
}

export interface BackfillInfo {
  name: string;
  fqn: string;
  node_type: string;
  snapshot_id: string;
  version: string;
  model_kind?: string | null;
  intervals: [number, number][];
  is_directly_modified?: boolean;
}

export interface PlanDetail {
  plan_id: string;
  environment: string;
  start_ts: number;
  end_ts: number;
  success: boolean;
  errors: ErrorExec[];
  changes: ModelsDiff;
  backfills: BackfillInfo[];
  _links: Record<string, unknown>;
}

/**
 * Fetch plan details from Vulcan Activity API.
 * Returns complete plan information including changes, backfills, and errors.
 */
export async function getPlanDetail(
  tenantConfig: TenantConfig | null,
  planId: string
): Promise<PlanDetail> {
  const data = await vulcanGet<PlanDetail>(
    tenantConfig,
    `/api/v1/activity/timeline/plans/${planId}`,
    {}
  );
  return data;
}

