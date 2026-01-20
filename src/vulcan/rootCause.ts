/**
 * Root Cause Analysis for Failed Runs
 * 
 * Combines run errors with upstream dependency lineage to explain why a run failed.
 */

import type { RunDetail, ErrorExec } from './activity';
import type { MetaResponse } from './meta';
import { getModelLineageFromMeta, type ModelLineageResult } from './lineage';

export interface FailedModelAnalysis {
  model_name: string;
  error: ErrorExec;
  upstream_lineage: ModelLineageResult['upstream'];
  upstream_count: number;
}

export interface RunRootCauseResult {
  run_id: string;
  plan_id: string;
  environment: string;
  start_ts: number;
  end_ts: number;
  success: boolean;
  failed_models: FailedModelAnalysis[];
  summary: {
    total_errors: number;
    unique_failed_models: number;
    models_with_upstream_deps: number;
  };
}

/**
 * Analyze root cause of a failed run by combining:
 * - Run errors (which model errored, error message)
 * - Upstream dependency chains (what that failing model depends on)
 * 
 * @param runDetail - RunDetail from getRunDetail()
 * @param meta - MetaResponse from getMetaExpanded() (fetched once, reused for all models)
 * @param maxDepth - Maximum traversal depth for lineage (default: 5, shorter for root cause)
 * @param maxPaths - Maximum total number of paths per model (default: 20)
 * @param maxFailedModels - Maximum number of failed models to analyze (default: 5)
 */
export function analyzeRunRootCause(
  runDetail: RunDetail,
  meta: MetaResponse,
  maxDepth: number = 5,  // Shorter depth for root cause (focus on direct deps)
  maxPaths: number = 20,  // Cap output size per model
  maxFailedModels: number = 5  // Limit number of models analyzed
): RunRootCauseResult {
  // Extract unique failed models from errors
  const failedModels = new Map<string, ErrorExec>();
  
  for (const error of runDetail.errors) {
    const modelName = error.model_name;
    if (modelName && !failedModels.has(modelName)) {
      failedModels.set(modelName, error);
    }
  }

  // Limit to top N failed models (prioritize by order in errors array)
  const failedModelEntries = Array.from(failedModels.entries()).slice(0, maxFailedModels);

  // For each failed model, get upstream lineage (reusing the same meta object)
  const failedModelAnalyses: FailedModelAnalysis[] = [];
  
  for (const [modelName, error] of failedModelEntries) {
    try {
      const lineage = getModelLineageFromMeta(
        meta,  // Reuse the same meta object
        modelName,
        'upstream',  // Upstream-only for root cause
        maxDepth,
        maxPaths  // Cap output size
      );
      failedModelAnalyses.push({
        model_name: modelName,
        error,
        upstream_lineage: lineage.upstream,
        upstream_count: lineage.upstream.length,
      });
    } catch (err) {
      // Model not found in metadata - still include error but no lineage
      failedModelAnalyses.push({
        model_name: modelName,
        error,
        upstream_lineage: [],
        upstream_count: 0,
      });
    }
  }

  // Sort by upstream_count (desc) to prioritize models with dependencies
  failedModelAnalyses.sort((a, b) => b.upstream_count - a.upstream_count);

  return {
    run_id: runDetail.run_id,
    plan_id: runDetail.plan_id,
    environment: runDetail.environment,
    start_ts: runDetail.start_ts,
    end_ts: runDetail.end_ts,
    success: runDetail.success,
    failed_models: failedModelAnalyses,
    summary: {
      total_errors: runDetail.errors.length,
      unique_failed_models: failedModels.size,
      models_with_upstream_deps: failedModelAnalyses.filter(m => m.upstream_count > 0).length,
    },
  };
}

