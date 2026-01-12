/**
 * Vulcan Activity API Handlers
 * 
 * Handles Activity API endpoints for timeline, runs, and plans.
 */

import { vulcanGet } from './http';
import type { Env } from '../index';

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
  env: Env,
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

  const data = await vulcanGet<TimelineResponse>(env, '/api/v1/activity/timeline', query);

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

