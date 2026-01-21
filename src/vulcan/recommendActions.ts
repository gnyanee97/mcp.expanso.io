/**
 * Recommendation Logic for Failed Runs
 * 
 * Pure functions (no API calls) that classify failures and recommend actions.
 */

import type { RunDetail } from './activity';
import type { RunRootCauseResult } from './rootCause';
import type { QualitySnapshotResponse } from './quality';
import type { PlanDetail } from './activity';

export enum FailureCategory {
  SYSTEM = 'SYSTEM',
  SYNTAX = 'SYNTAX',
  UPSTREAM = 'UPSTREAM',
  QUALITY = 'QUALITY',
  CHANGE = 'CHANGE',
  DATA_LOGIC = 'DATA_LOGIC',
  UNKNOWN = 'UNKNOWN',
}

export type Decision = 'rerun' | 'fix' | 'backfill' | 'fix_upstream_first' | 'investigate';

export interface ClassificationResult {
  category: FailureCategory;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
}

export interface Action {
  title: string;
  why: string; // Must cite evidence
  steps: string[]; // Short bullets
}

export interface RecommendationResult {
  category: FailureCategory;
  confidence: number;
  decision: Decision;
  actions: Action[];
  evidence: {
    error_classes?: string[];
    error_messages?: string[];
    audit_names?: string[];
    upstream_paths?: string[];
    plan_changes?: string[];
    backfill_intervals?: string[];
    quality_dimensions?: string[];
  };
}

export interface RecommendationInput {
  runDetail: RunDetail;
  rootCause: RunRootCauseResult;
  qualitySnapshot?: QualitySnapshotResponse;
  planDetail?: PlanDetail;
  max_actions?: number;
}

/**
 * Classify failure category based on error patterns and context.
 * 
 * Priority order (first match wins):
 * 1. QUALITY - audit errors or quality failures
 * 2. UPSTREAM - blocked by upstream dependencies
 * 3. SYNTAX - SQL/parse errors
 * 4. SYSTEM - infrastructure/network/auth errors
 * 5. CHANGE - recent plan changes
 * 6. DATA_LOGIC - data type/constraint errors
 * 7. UNKNOWN - fallback
 */
export function classifyFailure(input: RecommendationInput): ClassificationResult {
  const { runDetail, rootCause, qualitySnapshot, planDetail } = input;
  const reasons: string[] = [];
  let confidence = 0.0;

  // 1. QUALITY - Check for audit errors or quality failures
  const hasAuditErrors = runDetail.errors.some(e => e.is_audit_error === true);
  if (hasAuditErrors) {
    const auditErrors = runDetail.errors.filter(e => e.is_audit_error === true);
    reasons.push(`Found ${auditErrors.length} audit error(s): ${auditErrors.map(e => e.audit_name || 'unknown').join(', ')}`);
    return {
      category: FailureCategory.QUALITY,
      confidence: 0.9,
      reasons,
    };
  }

  // Check quality snapshot for high failure rates
  if (qualitySnapshot) {
    const dimensions = Object.entries(qualitySnapshot.quality_by_dimension);
    const failingDimensions = dimensions.filter(([_, summary]) => {
      const passRate = summary.pass_rate;
      const failCount = summary.fail + summary.error;
      return passRate < 80 || failCount > 0;
    });

    if (failingDimensions.length > 0) {
      reasons.push(`Quality snapshot shows failures in dimensions: ${failingDimensions.map(([dim, _]) => dim).join(', ')}`);
      reasons.push(`Pass rates: ${failingDimensions.map(([dim, sum]) => `${dim}=${sum.pass_rate.toFixed(1)}%`).join(', ')}`);
      return {
        category: FailureCategory.QUALITY,
        confidence: 0.85,
        reasons,
      };
    }
  }

  // 2. UPSTREAM - Check if blocked by upstream failure (not just has dependencies)
  // Condition 1: Multiple failed models with dependency path between them
  if (rootCause.failed_models.length > 1) {
    const failedModelNames = new Set(rootCause.failed_models.map(m => m.model_name));
    
    // Check if any failed model has another failed model in its upstream chain
    for (const failedModel of rootCause.failed_models) {
      const upstreamNames = new Set(failedModel.upstream_lineage.map(n => n.model_name));
      const blockedByFailedUpstream = Array.from(failedModelNames).filter(name => 
        name !== failedModel.model_name && upstreamNames.has(name)
      );
      
      if (blockedByFailedUpstream.length > 0) {
        reasons.push(`Model "${failedModel.model_name}" is blocked by failed upstream model(s): ${blockedByFailedUpstream.join(', ')}`);
        reasons.push(`Dependency path: ${blockedByFailedUpstream[0]} → ${failedModel.model_name}`);
        return {
          category: FailureCategory.UPSTREAM,
          confidence: 0.85,
          reasons,
        };
      }
    }
  }

  // Condition 2: Error messages contain dependency-blocked patterns
  const upstreamBlockedPatterns = [
    'dependency failed', 'upstream failed', 'blocked', 'skipped due to upstream',
    'upstream error', 'dependency error', 'blocked by', 'depends on failed',
    'upstream dependency', 'dependency blocked'
  ];
  const upstreamBlockedErrors = runDetail.errors.filter(e => {
    const errorText = `${e.error_class} ${e.message}`.toLowerCase();
    return upstreamBlockedPatterns.some(pattern => errorText.includes(pattern));
  });

  if (upstreamBlockedErrors.length > 0) {
    reasons.push(`Found ${upstreamBlockedErrors.length} error(s) indicating upstream blocking`);
    reasons.push(`Error messages: ${upstreamBlockedErrors.map(e => e.message.substring(0, 60)).join('; ')}`);
    return {
      category: FailureCategory.UPSTREAM,
      confidence: 0.8,
      reasons,
    };
  }

  // 3. SYNTAX - Check for parse/compile errors
  const syntaxPatterns = [
    'parse', 'syntax', 'compile', 'parser', 'invalid sql', 'semantic compile',
    'sql syntax', 'parsing error', 'compilation error', 'syntax error'
  ];
  const syntaxErrors = runDetail.errors.filter(e => {
    const errorText = `${e.error_class} ${e.message}`.toLowerCase();
    return syntaxPatterns.some(pattern => errorText.includes(pattern));
  });

  if (syntaxErrors.length > 0) {
    reasons.push(`Found ${syntaxErrors.length} syntax/parse error(s)`);
    reasons.push(`Error classes: ${syntaxErrors.map(e => e.error_class).join(', ')}`);
    return {
      category: FailureCategory.SYNTAX,
      confidence: 0.85,
      reasons,
    };
  }

  // 4. SYSTEM - Check for infrastructure errors
  const systemPatterns = [
    'timeout', 'network', 'connection', 'refused', '503', '504',
    'auth', 'permission', 'unauthorized', 'forbidden', '502', '500',
    'connection error', 'network error', 'connection refused'
  ];
  const systemErrors = runDetail.errors.filter(e => {
    const errorText = `${e.error_class} ${e.message}`.toLowerCase();
    return systemPatterns.some(pattern => errorText.includes(pattern));
  });

  if (systemErrors.length > 0) {
    reasons.push(`Found ${systemErrors.length} system/infrastructure error(s)`);
    reasons.push(`Error classes: ${systemErrors.map(e => e.error_class).join(', ')}`);
    return {
      category: FailureCategory.SYSTEM,
      confidence: 0.8,
      reasons,
    };
  }

  // 5. CHANGE - Check if failing models were recently changed
  if (planDetail) {
    const failedModelNames = new Set(rootCause.failed_models.map(m => m.model_name));
    
    // Check direct changes
    const directChanges = planDetail.changes.direct.filter(c => 
      failedModelNames.has(c.name) || failedModelNames.has(c.fqn)
    );
    
    // Check if any changed models need backfill
    const needsBackfill = directChanges.some(c => c.needs_backfill === true);
    const hasBackfills = planDetail.backfills.length > 0;

    if (directChanges.length > 0 || needsBackfill || hasBackfills) {
      if (directChanges.length > 0) {
        reasons.push(`Failing models were directly modified: ${directChanges.map(c => c.name).join(', ')}`);
      }
      if (needsBackfill) {
        reasons.push('Modified models require backfill');
      }
      if (hasBackfills) {
        reasons.push(`Plan includes ${planDetail.backfills.length} backfill requirement(s)`);
      }
      return {
        category: FailureCategory.CHANGE,
        confidence: 0.75,
        reasons,
      };
    }
  }

  // 6. DATA_LOGIC - Check for data type/constraint errors
  const dataLogicPatterns = [
    'column not found', 'cannot cast', 'type mismatch', 'null constraint',
    'join explosion', 'divide by zero', 'type error', 'cast error',
    'invalid type', 'type conversion', 'constraint violation'
  ];
  const dataLogicErrors = runDetail.errors.filter(e => {
    const errorText = `${e.error_class} ${e.message}`.toLowerCase();
    return dataLogicPatterns.some(pattern => errorText.includes(pattern));
  });

  if (dataLogicErrors.length > 0) {
    reasons.push(`Found ${dataLogicErrors.length} data logic error(s)`);
    reasons.push(`Error messages: ${dataLogicErrors.map(e => e.message.substring(0, 50)).join('; ')}`);
    return {
      category: FailureCategory.DATA_LOGIC,
      confidence: 0.8,
      reasons,
    };
  }

  // 7. UNKNOWN - Fallback
  reasons.push('No specific pattern matched - unknown failure type');
  return {
    category: FailureCategory.UNKNOWN,
    confidence: 0.3,
    reasons,
  };
}

/**
 * Recommend actions based on failure classification.
 * 
 * Returns decision, actions, and evidence.
 */
export function recommendActions(input: RecommendationInput): RecommendationResult {
  const classification = classifyFailure(input);
  const { runDetail, rootCause, qualitySnapshot, planDetail } = input;
  const maxActions = input.max_actions ?? 5;

  const evidence: RecommendationResult['evidence'] = {
    error_classes: [...new Set(runDetail.errors.map(e => e.error_class))],
    error_messages: runDetail.errors.map(e => e.message).slice(0, 5), // Limit to 5
    audit_names: runDetail.errors.filter(e => e.audit_name).map(e => e.audit_name!),
    upstream_paths: rootCause.failed_models
      .filter(m => m.upstream_count > 0)
      .map(m => `${m.model_name} → ${m.upstream_lineage.slice(0, 2).map(n => n.model_name).join(' → ')}`)
      .slice(0, 3),
    plan_changes: planDetail?.changes.direct.map(c => `${c.name} (${c.change_category || 'modified'})`).slice(0, 3),
    backfill_intervals: planDetail?.backfills.map(b => `${b.name}: ${b.intervals.length} interval(s)`).slice(0, 3),
    quality_dimensions: qualitySnapshot ? Object.keys(qualitySnapshot.quality_by_dimension) : undefined,
  };

  const actions: Action[] = [];
  let decision: Decision = 'investigate';

  switch (classification.category) {
    case FailureCategory.QUALITY:
      decision = 'fix';
      actions.push({
        title: 'Fix data quality issues',
        why: `Audit errors detected: ${evidence.audit_names?.join(', ') || 'quality checks failed'}. ${qualitySnapshot ? `Quality snapshot shows failures in: ${evidence.quality_dimensions?.join(', ')}` : ''}`,
        steps: [
          'Review audit check definitions and thresholds',
          'Inspect source data for quality violations',
          'Fix data issues at source or adjust check thresholds',
          'Re-run quality checks to verify fixes',
        ],
      });
      if (qualitySnapshot) {
        const failingDims = Object.entries(qualitySnapshot.quality_by_dimension)
          .filter(([_, sum]) => sum.fail + sum.error > 0)
          .map(([dim, sum]) => `${dim} (${sum.fail + sum.error} failures)`);
        if (failingDims.length > 0) {
          actions.push({
            title: 'Address quality dimension failures',
            why: `Quality snapshot shows failures in dimensions: ${failingDims.join(', ')}`,
            steps: [
              'Review quality metrics by dimension',
              'Identify root cause of quality degradation',
              'Apply fixes and re-run pipeline',
            ],
          });
        }
      }
      break;

    case FailureCategory.UPSTREAM:
      decision = 'fix_upstream_first';
      // Find which model is blocked by which upstream
      const failedModelNames = new Set(rootCause.failed_models.map(m => m.model_name));
      let blockedModel: typeof rootCause.failed_models[0] | null = null;
      let blockingUpstream: string[] = [];
      
      for (const failedModel of rootCause.failed_models) {
        const upstreamNames = new Set(failedModel.upstream_lineage.map(n => n.model_name));
        const blockedBy = Array.from(failedModelNames).filter(name => 
          name !== failedModel.model_name && upstreamNames.has(name)
        );
        if (blockedBy.length > 0) {
          blockedModel = failedModel;
          blockingUpstream = blockedBy;
          break;
        }
      }
      
      if (blockedModel && blockingUpstream.length > 0) {
        actions.push({
          title: 'Fix upstream dependencies first',
          why: `Model "${blockedModel.model_name}" is blocked by failed upstream model(s): ${blockingUpstream.join(', ')}. Dependency path: ${blockingUpstream[0]} → ${blockedModel.model_name}`,
          steps: [
            `Fix failures in upstream models: ${blockingUpstream.join(', ')}`,
            'Re-run upstream models to completion',
            'Verify upstream models succeed',
            'Then re-run the downstream model',
          ],
        });
      } else {
        // Fallback if we detected via error message patterns
        const topFailedModel = rootCause.failed_models[0];
        actions.push({
          title: 'Fix upstream dependencies first',
          why: `Error messages indicate upstream blocking. Model "${topFailedModel.model_name}" appears to be blocked by upstream dependencies.`,
          steps: [
            'Review error messages for upstream dependency failures',
            'Identify which upstream models are failing',
            'Fix failures in upstream models',
            'Re-run upstream models, then downstream',
          ],
        });
      }
      break;

    case FailureCategory.SYNTAX:
      decision = 'fix';
      actions.push({
        title: 'Fix SQL syntax errors',
        why: `Syntax/parse errors detected. Error classes: ${evidence.error_classes?.join(', ')}. Messages: ${evidence.error_messages?.slice(0, 2).join('; ')}`,
        steps: [
          'Review SQL syntax in model definitions',
          'Check for invalid SQL keywords or expressions',
          'Validate SQL against database dialect',
          'Fix syntax errors and re-run',
        ],
      });
      break;

    case FailureCategory.SYSTEM:
      decision = 'rerun';
      actions.push({
        title: 'Retry after system issue resolution',
        why: `System/infrastructure errors detected: ${evidence.error_classes?.join(', ')}. This may be a transient network or infrastructure issue.`,
        steps: [
          'Check system/network connectivity',
          'Verify authentication credentials',
          'Check service availability and status',
          'Retry the run after confirming system health',
        ],
      });
      break;

    case FailureCategory.CHANGE:
      if (planDetail?.backfills.length && planDetail.backfills.length > 0) {
        decision = 'backfill';
        actions.push({
          title: 'Perform backfill for changed models',
          why: `Plan shows ${planDetail.backfills.length} backfill requirement(s). Models were modified and require historical data reprocessing: ${planDetail.backfills.map(b => b.name).join(', ')}`,
          steps: [
            `Backfill intervals: ${planDetail.backfills.map(b => `${b.name} (${b.intervals.length} intervals)`).join(', ')}`,
            'Execute backfill for affected time ranges',
            'Verify backfill completion',
            'Re-run the pipeline',
          ],
        });
      } else {
        decision = 'fix';
        actions.push({
          title: 'Review and fix model changes',
          why: `Failing models were recently modified in plan: ${evidence.plan_changes?.join(', ')}`,
          steps: [
            'Review model change diffs',
            'Verify changes are correct',
            'Fix any issues introduced by changes',
            'Re-run the pipeline',
          ],
        });
      }
      break;

    case FailureCategory.DATA_LOGIC:
      decision = 'fix';
      actions.push({
        title: 'Fix data type and constraint issues',
        why: `Data logic errors detected: ${evidence.error_messages?.slice(0, 2).join('; ')}`,
        steps: [
          'Review column types and constraints',
          'Check for type mismatches in joins or expressions',
          'Fix data type issues or adjust model logic',
          'Re-run the pipeline',
        ],
      });
      break;

    case FailureCategory.UNKNOWN:
    default:
      decision = 'investigate';
      actions.push({
        title: 'Investigate unknown failure',
        why: `Unable to classify failure. Errors: ${evidence.error_classes?.join(', ')}. Messages: ${evidence.error_messages?.slice(0, 2).join('; ')}`,
        steps: [
          'Review error messages and stack traces',
          'Check run logs for additional context',
          'Examine model definitions and dependencies',
          'Consult with team for root cause analysis',
        ],
      });
      break;
  }

  // Limit actions to max_actions
  const limitedActions = actions.slice(0, maxActions);

  return {
    category: classification.category,
    confidence: classification.confidence,
    decision,
    actions: limitedActions,
    evidence,
  };
}

