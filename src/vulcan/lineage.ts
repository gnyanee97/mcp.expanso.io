/**
 * Vulcan Lineage Graph Traversal
 * 
 * Builds and traverses dependency graphs from Meta API data.
 * Reusable for both model lineage and root cause analysis.
 */

import type { MetaResponse, ModelView, Relationship } from './meta';

export interface ModelLineageNode {
  model_name: string;
  path: string;
  depth: number;  // Distance from target model
}

export interface ModelLineageResult {
  target_model: string;
  upstream: ModelLineageNode[];      // Models that target depends on
  downstream: ModelLineageNode[];    // Models that depend on target
  summary: {
    upstream_count: number;
    downstream_count: number;
    total_dependencies: number;
  };
}

/**
 * Build a dependency graph from Meta API response.
 * Returns maps: model_name -> Set of dependent model names (upstream)
 *              model_name -> Set of models that depend on it (downstream)
 */
function buildDependencyGraph(meta: MetaResponse): {
  upstream: Map<string, Set<string>>;
  downstream: Map<string, Set<string>>;
} {
  const upstream = new Map<string, Set<string>>();
  const downstream = new Map<string, Set<string>>();

  // Build graph from models[].depends_on (SQL dependencies)
  for (const model of meta.models) {
    const modelName = model.name;
    
    // Initialize sets if not present
    if (!upstream.has(modelName)) {
      upstream.set(modelName, new Set());
    }
    if (!downstream.has(modelName)) {
      downstream.set(modelName, new Set());
    }

    // Add dependencies from depends_on array
    for (const dep of model.depends_on) {
      const depName = dep.model_name;
      
      // Add to upstream (this model depends on dep)
      upstream.get(modelName)!.add(depName);
      
      // Add to downstream (dep is depended on by this model)
      if (!downstream.has(depName)) {
        downstream.set(depName, new Set());
      }
      downstream.get(depName)!.add(modelName);
    }
  }

  // Also process relationships array if available (semantic joins, etc.)
  if (meta.relationships) {
    for (const rel of meta.relationships) {
      // Only process model_depends_on_model relationships
      if (rel.type === 'model_depends_on_model') {
        // Extract model names from paths like "/models/users"
        const fromModel = extractModelNameFromPath(rel.from_path);
        const toModel = extractModelNameFromPath(rel.to_path);
        
        if (fromModel && toModel) {
          // fromModel depends on toModel (toModel is upstream of fromModel)
          if (!upstream.has(fromModel)) {
            upstream.set(fromModel, new Set());
          }
          upstream.get(fromModel)!.add(toModel);
          
          if (!downstream.has(toModel)) {
            downstream.set(toModel, new Set());
          }
          downstream.get(toModel)!.add(fromModel);
        }
      }
    }
  }

  return { upstream, downstream };
}

/**
 * Extract model name from path like "/models/users" or "marketing/b2b_saas/users"
 */
function extractModelNameFromPath(path: string): string | null {
  // Handle paths like "/models/users" or "/models/b2b_saas.users"
  if (path.startsWith('/models/')) {
    return path.slice('/models/'.length);
  }
  
  // Handle full paths like "marketing/b2b_saas/users"
  // Extract the last component
  const parts = path.split('/');
  if (parts.length > 0) {
    return parts[parts.length - 1];
  }
  
  return null;
}

/**
 * Traverse graph in a direction (upstream or downstream) from a starting model.
 * Returns all reachable models with their depth.
 */
function traverseGraph(
  graph: Map<string, Set<string>>,
  startModel: string,
  visited: Set<string> = new Set(),
  depth: number = 0,
  maxDepth: number = 10
): ModelLineageNode[] {
  if (depth > maxDepth || visited.has(startModel)) {
    return [];
  }

  visited.add(startModel);
  const result: ModelLineageNode[] = [];
  
  const dependencies = graph.get(startModel);
  if (dependencies) {
    for (const dep of dependencies) {
      if (!visited.has(dep)) {
        result.push({
          model_name: dep,
          path: dep,  // Will be enriched with full path if available
          depth: depth + 1,
        });
        
        // Recursively traverse
        const nested = traverseGraph(graph, dep, visited, depth + 1, maxDepth);
        result.push(...nested);
      }
    }
  }

  return result;
}

/**
 * Enrich nodes with full paths from MetaResponse
 */
function enrichWithPaths(
  nodes: ModelLineageNode[],
  meta: MetaResponse
): ModelLineageNode[] {
  const modelMap = new Map<string, string>();
  for (const model of meta.models) {
    modelMap.set(model.name, model.path);
  }

  return nodes.map(node => ({
    ...node,
    path: modelMap.get(node.model_name) || node.path,
  }));
}

/**
 * Get model lineage from Meta API response.
 * 
 * @param meta - MetaResponse from getMetaExpanded()
 * @param modelName - Target model name (e.g., "users" or "b2b_saas.users")
 * @param direction - "upstream", "downstream", or "both"
 * @param maxDepth - Maximum traversal depth (default: 10)
 * @param maxPaths - Maximum total number of paths to return (default: unlimited)
 */
export function getModelLineageFromMeta(
  meta: MetaResponse,
  modelName: string,
  direction: 'upstream' | 'downstream' | 'both' = 'both',
  maxDepth: number = 10,
  maxPaths?: number
): ModelLineageResult {
  // Find the exact model name (handle variations)
  const targetModel = findModelByName(meta.models, modelName);
  if (!targetModel) {
    throw new Error(`Model "${modelName}" not found in metadata`);
  }

  // Build dependency graph
  const { upstream: upstreamGraph, downstream: downstreamGraph } = buildDependencyGraph(meta);

  // Traverse based on direction
  let upstreamNodes: ModelLineageNode[] = [];
  let downstreamNodes: ModelLineageNode[] = [];

  if (direction === 'upstream' || direction === 'both') {
    // Upstream: models that target depends on
    upstreamNodes = traverseGraph(upstreamGraph, targetModel.name, new Set(), 0, maxDepth);
    upstreamNodes = enrichWithPaths(upstreamNodes, meta);
    // Sort by depth, then by name
    upstreamNodes.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.model_name.localeCompare(b.model_name);
    });
  }

  if (direction === 'downstream' || direction === 'both') {
    // Downstream: models that depend on target
    downstreamNodes = traverseGraph(downstreamGraph, targetModel.name, new Set(), 0, maxDepth);
    downstreamNodes = enrichWithPaths(downstreamNodes, meta);
    // Sort by depth, then by name
    downstreamNodes.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.model_name.localeCompare(b.model_name);
    });
  }

  // Apply max_paths limit if specified
  if (maxPaths !== undefined && maxPaths > 0) {
    const totalNodes = upstreamNodes.length + downstreamNodes.length;
    if (totalNodes > maxPaths) {
      // Prioritize upstream first, then downstream
      if (upstreamNodes.length > 0) {
        const upstreamLimit = Math.min(upstreamNodes.length, maxPaths);
        upstreamNodes = upstreamNodes.slice(0, upstreamLimit);
        const remaining = maxPaths - upstreamNodes.length;
        if (remaining > 0 && downstreamNodes.length > 0) {
          downstreamNodes = downstreamNodes.slice(0, remaining);
        }
      } else {
        downstreamNodes = downstreamNodes.slice(0, maxPaths);
      }
    }
  }

  return {
    target_model: targetModel.name,
    upstream: upstreamNodes,
    downstream: downstreamNodes,
    summary: {
      upstream_count: upstreamNodes.length,
      downstream_count: downstreamNodes.length,
      total_dependencies: upstreamNodes.length + downstreamNodes.length,
    },
  };
}

/**
 * Find model by name (handles variations like "users" vs "b2b_saas.users")
 */
function findModelByName(models: ModelView[], name: string): ModelView | null {
  // Exact match first
  const exact = models.find(m => m.name === name);
  if (exact) return exact;

  // Match by last component (e.g., "users" matches "b2b_saas.users")
  const nameParts = name.split('.');
  const lastPart = nameParts[nameParts.length - 1];
  
  return models.find(m => {
    const modelParts = m.name.split('.');
    return modelParts[modelParts.length - 1] === lastPart;
  }) || null;
}

