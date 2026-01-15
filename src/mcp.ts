/**
 * MCP Protocol Handler
 *
 * Implements the Model Context Protocol for AI tool integration.
 * Supports JSON-RPC over HTTP and SSE for streaming.
 */

import type { Env } from './index';
import { handleSearch, handleSearchPrds, handleListResources, handleReadResource } from './handlers';
import { validatePipelineYaml } from './pipeline-validator';
import type { components } from './types/validate-api';
import { getActivityTimeline } from './vulcan/activity';
import { getTenantConfig, type TenantConfig } from './vulcan/config';

// Typed external validation using validate.expanso.io API contract
type ValidateResponse = components['schemas']['ValidateResponse'];
type Hallucination = components['schemas']['Hallucination'];
import {
  getComponentSchema,
  getSchemasByCategory,
  listComponentNames,
  formatComponentSchema,
  type ComponentCategory,
} from './component-schemas';
import {
  listComponents,
  getAvailableTags,
  getCategoryCounts,
  formatComponentList,
  type ComponentCategory as CatalogCategory,
  type ComponentTag,
} from './component-catalog';
import {
  getByCategory,
  searchBloblang,
  formatBloblangReference,
  type BloblangCategory,
} from './bloblang-reference';
import { suggestWithFallback } from './pattern-suggester';
import { explainError } from './error-explainer';
import { generateTestData } from './test-data-generator';
import {
  PRD_QUESTIONNAIRE_V1,
  validateAnswers,
  renderPrdMarkdown,
  type PrdAnswers,
} from './prd';

// MCP Protocol types
interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Tool definitions
export const TOOLS = [
  {
    name: 'search_docs',
    description:
      'Search Vulcan documentation using semantic search. Returns relevant documentation sections for a given query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query - natural language question or keywords',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5, max: 20)',
          default: 5,
        },
        domain: {
          type: 'string',
          description:
            'Filter by domain: raw.githubusercontent.com, github.com, tmdc-io.github.io',
          enum: ['raw.githubusercontent.com', 'github.com', 'tmdc-io.github.io'],
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_prds',
    description:
      'Search data product PRDs using semantic search. Returns relevant PRD sections with product metadata (domain, owner_team, tags, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query - natural language question or keywords (e.g., "analytics data products", "user engagement metrics")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5, max: 20)',
          default: 5,
        },
        domain: {
          type: 'string',
          description: 'Filter by business domain (e.g., analytics, platform, marketing, finance, operations)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_resource',
    description:
      'Retrieve the full content of a documentation resource by its URI. Use search_docs first to find relevant resources.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'The resource URI (e.g., https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs/llms.txt)',
        },
      },
      required: ['uri'],
    },
  },
  {
    name: 'list_resources',
    description:
      'List all available documentation resources for Vulcan. Returns URIs and descriptions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'validate_pipeline',
    description:
      'Validate an Expanso pipeline YAML configuration. Returns detailed errors with fix suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        yaml: {
          type: 'string',
          description: 'Pipeline YAML to validate',
        },
        include_external: {
          type: 'boolean',
          description:
            'Also validate against Expanso external validator (slower but authoritative)',
          default: true,
        },
      },
      required: ['yaml'],
    },
  },
  {
    name: 'get_component_schema',
    description:
      'Get the schema for an Expanso pipeline component including field definitions, types, defaults, and examples. Use this to understand what fields a component accepts.',
    inputSchema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description:
            'Component name (e.g., kafka, http_server, mapping, aws_s3)',
        },
        category: {
          type: 'string',
          description: 'Filter by category: input, processor, output',
          enum: ['input', 'processor', 'output'],
        },
        list_only: {
          type: 'boolean',
          description: 'If true, only list available component names without full schemas',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_bloblang_reference',
    description:
      'Get Bloblang function and method reference for writing data transformations. Use this to find the correct syntax for Bloblang expressions.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Category to list functions/methods from',
          enum: [
            'functions',
            'string',
            'array',
            'object',
            'number',
            'timestamp',
            'encoding',
            'parsing',
            'type',
            'regex',
            'all',
          ],
        },
        search: {
          type: 'string',
          description: 'Search term to filter by name or description',
        },
      },
    },
  },
  {
    name: 'suggest_pipeline_pattern',
    description:
      'Get pipeline pattern suggestions based on a natural language use case description. Returns relevant examples with explanations and customization hints.',
    inputSchema: {
      type: 'object',
      properties: {
        use_case: {
          type: 'string',
          description:
            'Natural language description of what you want to build (e.g., "consume from kafka and write to s3", "filter events and send to slack")',
        },
        input_type: {
          type: 'string',
          description:
            'Optional: filter by source system (kafka, http, s3, database)',
        },
        output_type: {
          type: 'string',
          description:
            'Optional: filter by destination system (kafka, s3, elasticsearch, webhook)',
        },
        limit: {
          type: 'number',
          description: 'Maximum suggestions to return (default: 3)',
          default: 3,
        },
      },
      required: ['use_case'],
    },
  },
  {
    name: 'explain_error',
    description:
      'Get detailed explanation and fix suggestions for a pipeline validation or runtime error. Transforms cryptic error messages into actionable guidance with before/after code examples.',
    inputSchema: {
      type: 'object',
      properties: {
        error_message: {
          type: 'string',
          description: 'The error message to explain',
        },
        context: {
          type: 'string',
          description:
            'Optional: the YAML snippet or code that caused the error',
        },
        error_type: {
          type: 'string',
          enum: ['validation', 'runtime', 'connection', 'bloblang', 'unknown'],
          description: 'Type of error (auto-detected if not specified)',
        },
      },
      required: ['error_message'],
    },
  },
  {
    name: 'list_components',
    description:
      'List available Expanso pipeline components with filtering by category, tag, or search term. Use this to discover what inputs, processors, and outputs are available.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['input', 'processor', 'output', 'cache', 'buffer', 'all'],
          description: 'Filter by component category (default: all)',
        },
        tag: {
          type: 'string',
          enum: [
            'messaging',
            'cloud',
            'database',
            'http',
            'file',
            'ai',
            'transform',
            'utility',
            'observability',
            'aws',
            'gcp',
            'azure',
            'streaming',
          ],
          description: 'Filter by component tag/domain',
        },
        search: {
          type: 'string',
          description: 'Search term to filter by name or description',
        },
        format: {
          type: 'string',
          enum: ['summary', 'detailed'],
          description: 'Output format: summary (names only) or detailed (with descriptions)',
          default: 'detailed',
        },
      },
    },
  },
  {
    name: 'generate_test_data',
    description:
      'Generate sample input data for testing a pipeline. Supports schema-based, example-based, or pipeline-analysis generation.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: {
          type: 'object',
          description:
            'JSON schema with type specifications (uuid, name, email, timestamp, number, number:min:max, boolean, string) or an example object to infer types from',
        },
        pipeline_yaml: {
          type: 'string',
          description:
            'Pipeline YAML to analyze and infer input format from field references',
        },
        count: {
          type: 'number',
          description: 'Number of records to generate (default: 5, max: 100)',
          default: 5,
        },
        format: {
          type: 'string',
          enum: ['json', 'jsonl', 'csv', 'yaml'],
          description: 'Output format for the generated data',
          default: 'jsonl',
        },
      },
    },
  },
  {
    name: 'get_data_product_prd_questionnaire',
    description:
      'MANDATORY FIRST STEP: Returns the Vulcan-first PRD questionnaire (v1). You MUST call this tool first, then interview the user by asking each question from the questionnaire. DO NOT proceed to generate_data_product_prd until you have collected ALL answers directly from the user. DO NOT make up or assume any answers.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'generate_data_product_prd',
    description:
      'CRITICAL: Only call this tool AFTER you have: (1) called get_data_product_prd_questionnaire, (2) asked the user ALL questions from the questionnaire, and (3) collected their actual answers. DO NOT generate or assume answers. DO NOT call this tool with placeholder or example data. The answers parameter must contain real answers provided by the user during the interview. Generates a Data Product PRD in Markdown from the user-provided answers.',
    inputSchema: {
      type: 'object',
      properties: {
        answers: {
          type: 'object',
          description:
            'REQUIRED: Answers JSON containing ONLY the user\'s actual responses collected during the questionnaire interview. Must include: product_name, goal, consumers, grain, entities, primary_time, dimensions, measures, metrics, sources, freshness_backfill. These must be real answers from the user, not examples or placeholders. See get_data_product_prd_questionnaire for the expected structure.',
        },
      },
      required: ['answers'],
      additionalProperties: false,
    },
  },
  {
    name: 'vulcan_activity_timeline',
    description: `Query Vulcan Activity API to get timeline of plan deployments and run executions. Returns LIVE operational data from Vulcan APIs.
    
CRITICAL: Use this tool when the user asks about:
- Current state / operational status ("What happened?", "What failed?", "What's running?", "Show me status")
- Run execution history ("Did model X run?", "Show me recent runs", "What runs happened today?", "Latest runs")
- Plan deployments ("What was the last plan?", "Show me recent deployments", "Latest plan")
- Failures and errors ("What failed today?", "Show me failures in prod", "Any errors today?", "What broke?")
- Activity timeline ("Show me activity", "What's the latest activity?", "Recent timeline", "Pipeline status")
- Time-based queries ("today", "yesterday", "last hour", "recent", "latest")
- Environment-specific ("prod", "production", "staging", "dev", "local")
- Model-specific ("Did model users run?", "Show runs for model X")

IMPORTANT: This tool queries LIVE operational data from Vulcan APIs, NOT documentation. 
- Use search_docs for documentation questions
- Use search_prds for PRD questions
- Use this tool for "What happened?" / operational status questions

ENVIRONMENT CONFIGURATION (REQUIRED):
- The environment_base_url parameter is ALWAYS required. The tool will NOT use any default configuration.
- When user asks about any environment (prod, local, staging, etc.), you MUST ask them for the API base URL.
- CRITICAL WORKFLOW - Follow these steps exactly:
  1. Ask the user: "What is the API base URL for the [environment] environment?" where [environment] is detected from their query.
  2. Wait for user to provide a URL in their response (e.g., "everest-010626.dataos.app" or "https://everest-010626.dataos.app/home").
  3. Extract the URL from their response (handle variations: add https:// if missing, remove trailing slashes, handle paths like /home/).
  4. Call the tool again with environment_base_url parameter set to the extracted URL, along with ALL other parameters from the original request (action, environment, failed_only, limit, offset, model_name, after_start_ts, etc.).
- If no environment is specified, ask: "Which environment would you like to query? Please provide the environment name and its API base URL."

URL ACCESSIBILITY REQUIREMENTS:
- The URL MUST be publicly accessible from the internet (Cloudflare Workers cannot access localhost/127.0.0.1).
- For local environments, users need to expose their API using:
  - ngrok: "https://abc123.ngrok.io"
  - Cloudflare Tunnel
  - Public IP with port forwarding
- localhost/127.0.0.1 URLs will NOT work from Cloudflare Workers.

Examples:
- "What failed today in prod?" → Ask: "What is the API base URL for your prod environment?" → User: "https://everest-010626.dataos.app" or "https://everest-010626.dataos.app/home/" → Tool auto-appends API path → Set environment_base_url="https://everest-010626.dataos.app", failed_only=true, environment="prod", after_start_ts=today_start_ms
- "Did model users run?" → Ask for environment URL first, then set model_name=["users"]
- "Show recent activity" → Ask: "Which environment? Please provide the environment name and API base URL (base domain is fine, e.g., https://everest-010626.dataos.app)."
- "What happened in local?" → Ask: "What is the API base URL for your local environment? (Note: must be publicly accessible, e.g., via ngrok)" → User: "https://abc123.ngrok.io" → Tool auto-appends API path → Set environment_base_url="https://abc123.ngrok.io"
- "What happened in the last hour?" → Ask for environment URL, then set after_start_ts=(now - 3600000)ms
- "Latest runs" → Ask for environment URL, then set action="run", limit=10
- "Show me the last plan" → Ask for environment URL, then set action="plan", limit=1

Returns both raw events and a summary view with breakdown by plans/runs, success/failure counts, and latest events.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'run'],
          description: 'Filter by event type: "plan" for deployments/changes, "run" for model executions. Omit for both types.',
        },
        environment: {
          type: 'string',
          description: 'Filter by environment name (e.g., "prod", "production", "staging", "dev"). Omit to return events from all environments.',
        },
        after_start_ts: {
          type: 'number',
          description: 'Filter events with start_ts >= this timestamp (Unix milliseconds). Convert time phrases: "today" → today\'s 00:00:00 UTC, "last hour" → (now - 3600000)ms, "yesterday" → yesterday\'s 00:00:00 UTC, "last 24h" → (now - 86400000)ms.',
        },
        model_name: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter activities affecting these model names (e.g., ["users", "orders"]). Will be sent as comma-separated to API. Use when user asks "Did model X run?" or "Show runs for model Y".',
        },
        limit: {
          type: 'number',
          default: 100,
          minimum: 1,
          maximum: 1000,
          description: 'Maximum number of events to return. Use smaller values (10-20) for "latest" or "recent" queries, larger (100-1000) for comprehensive history.',
        },
        offset: {
          type: 'number',
          default: 0,
          minimum: 0,
          description: 'Pagination offset for retrieving additional pages of results. Use with limit for pagination.',
        },
        failed_only: {
          type: 'boolean',
          default: false,
          description: 'If true, filter to only failed events (success=false). Applied client-side after fetching from API. Use when user asks "What failed?", "Show failures", "Any errors?", etc.',
        },
        environment_base_url: {
          type: 'string',
          description: 'REQUIRED: Base URL for the specific environment to query. Users can provide the base domain (e.g., "https://everest-010626.dataos.app" or "https://everest-010626.dataos.app/home/") - the tool will automatically append the API path (/system/vulcan/vulcan-app). Must be publicly accessible from the internet (Cloudflare Workers cannot access localhost/127.0.0.1). For local environments, users must expose their API using ngrok, Cloudflare Tunnel, or public IP. Always ask the user for this URL before calling the tool.',
        },
      },
    },
  },
];

// ============================================================================
// Pipeline Validation Helpers
// ============================================================================

/**
 * External validation result using typed API contract
 */
interface ExternalValidationResult {
  valid: boolean;
  error_count: number;
  hallucinations: Hallucination[];
  corrected_yaml?: string;
}

/**
 * Call the external Expanso validator API with auto-correction enabled
 * Fails open on errors (returns valid) to avoid blocking on external service issues
 */
async function callExternalValidator(
  yaml: string
): Promise<ExternalValidationResult> {
  try {
    const response = await fetch('https://validate.expanso.io/validate?auto_correct=true', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: yaml,
    });

    if (!response.ok) {
      // Fail open on server errors
      if (response.status >= 500) {
        console.error('External validator 5xx error:', response.status);
        return { valid: true, error_count: 0, hallucinations: [] };
      }
      const text = await response.text();
      return {
        valid: false,
        error_count: 1,
        hallucinations: [{
          category: 'UNKNOWN',
          severity: 'ERROR',
          path: 'root',
          hallucination: 'request_failed',
          message: text || `Validation failed with status ${response.status}`,
        }],
      };
    }

    // Response is now typed via OpenAPI contract
    const result: ValidateResponse = await response.json();

    return {
      valid: result.valid,
      error_count: result.error_count,
      hallucinations: result.hallucinations,
      corrected_yaml: result.corrected_yaml,
    };
  } catch (error) {
    // Fail open on network errors
    console.error('External validator error:', error);
    return { valid: true, error_count: 0, hallucinations: [] };
  }
}

/**
 * Validation result format for MCP tool response
 */
interface McpValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    suggestion?: string;
    category?: string;
  }>;
  warnings: string[];
  corrected_yaml?: string;
  action_required?: string;
  external_validation?: {
    valid: boolean;
    error_count: number;
    hallucinations: Hallucination[];
  };
}

/**
 * Orchestrate pipeline validation combining local and external validators
 * Returns corrected YAML when available - AI should use corrected version
 */
async function validatePipelineForMcp(
  yaml: string,
  includeExternal: boolean
): Promise<McpValidationResult> {
  // Run local validation
  const localResult = validatePipelineYaml(yaml);

  // Optionally run external validation with auto-correction
  let externalResult: ExternalValidationResult | undefined;
  if (includeExternal) {
    externalResult = await callExternalValidator(yaml);
  }

  // Check if we have a corrected version
  const hasCorrectedYaml = externalResult?.corrected_yaml && !externalResult.valid;

  // Combine local and external errors
  const combinedErrors = [
    ...localResult.errors,
    ...(externalResult?.hallucinations
      .filter(h => h.severity === 'ERROR')
      .map(h => ({
        path: h.path,
        message: h.message,
        suggestion: h.correction || undefined,
        category: h.category,
      })) || []),
  ];

  const isValid = localResult.valid && (externalResult?.valid ?? true);

  // Determine action required
  let actionRequired: string | undefined;
  if (!isValid && hasCorrectedYaml) {
    actionRequired = 'YAML has errors but auto-correction is available. Use the corrected_yaml field instead of showing errors to the user.';
  } else if (!isValid) {
    actionRequired = 'YAML has errors that could not be auto-corrected. Review the errors and fix the YAML before showing to user.';
  }

  return {
    valid: isValid,
    errors: combinedErrors,
    warnings: localResult.warnings,
    corrected_yaml: hasCorrectedYaml ? externalResult!.corrected_yaml : undefined,
    action_required: actionRequired,
    external_validation: externalResult ? {
      valid: externalResult.valid,
      error_count: externalResult.error_count,
      hallucinations: externalResult.hallucinations,
    } : undefined,
  };
}

/**
 * Format MCP validation result for human-readable output
 */
function formatMcpValidationResult(result: McpValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push('✓ Pipeline configuration is valid');
    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const warning of result.warnings) {
        lines.push(`  ⚠ ${warning}`);
      }
    }
    return lines.join('\n');
  }

  // Show errors
  lines.push('✗ Pipeline validation failed');
  lines.push('');
  lines.push('Errors:');

  for (const error of result.errors) {
    lines.push(`  • ${error.path}: ${error.message}`);
    if (error.suggestion) {
      lines.push(`    → Fix: ${error.suggestion}`);
    }
  }

  // Show warnings if any
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  // Show corrected YAML if available
  if (result.corrected_yaml) {
    lines.push('');
    lines.push('─'.repeat(50));
    lines.push('Auto-corrected YAML available:');
    lines.push('```yaml');
    lines.push(result.corrected_yaml);
    lines.push('```');
  }

  // Show action required
  if (result.action_required) {
    lines.push('');
    lines.push(`Action: ${result.action_required}`);
  }

  return lines.join('\n');
}

// Handle MCP JSON-RPC request
export async function handleMcpRequest(request: Request, env: Env, tenant: string = 'default'): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await request.json()) as McpRequest;
  const response = await processRequest(body, env, tenant);

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Handle SSE connection for streaming MCP
export function handleSseConnection(request: Request, env: Env): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      const initMessage = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
          },
          serverInfo: {
            name: 'vulcan-mcp-server',
            version: '1.0.0',
          },
        },
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initMessage)}\n\n`));

      // Keep connection alive with periodic pings
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 30000);

      // Handle incoming messages would require WebSocket upgrade
      // For now, SSE is read-only from server to client
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// Process MCP request
async function processRequest(request: McpRequest, env: Env, tenant: string = 'default'): Promise<McpResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: false },
            },
            serverInfo: {
              name: 'expanso-mcp-server',
              version: '1.0.0',
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        };

      case 'tools/call':
        const toolParams = params as ToolCallParams | undefined;
        if (!toolParams?.name) {
          return errorResponse(id, -32602, 'Missing tool name');
        }
        return await handleToolCall(id, toolParams, env, tenant);

      case 'resources/list':
        const resources = await handleListResources(env);
        return {
          jsonrpc: '2.0',
          id,
          result: { resources },
        };

      case 'resources/read':
        const uri = (params as { uri: string })?.uri;
        if (!uri) {
          return errorResponse(id, -32602, 'Missing uri parameter');
        }
        const content = await handleReadResource(env, uri);
        if (!content) {
          return errorResponse(id, -32602, 'Resource not found');
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: content.content,
              },
            ],
          },
        };

      case 'ping':
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };

      default:
        return errorResponse(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    console.error(`MCP error processing ${method}:`, error);
    return errorResponse(id, -32603, error instanceof Error ? error.message : 'Internal error');
  }
}

interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

// Helper: Sanitize product name for use as filename
function sanitizeFilename(name: string): string {
  // Remove or replace invalid filename characters
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .substring(0, 100) // Limit length
    || 'data-product-prd'; // Fallback if empty
}

// Handle tool calls
async function handleToolCall(
  id: string | number,
  params: ToolCallParams,
  env: Env,
  tenant: string = 'default'
): Promise<McpResponse> {
  const { name, arguments: args } = params;

  switch (name) {
    case 'search_docs': {
      const query = args?.query as string;
      const limit = Math.min((args?.limit as number) || 5, 20);
      const domain = args?.domain as string | undefined;

      if (!query) {
        return errorResponse(id, -32602, 'Missing required argument: query');
      }

      const results = await handleSearch(env, query, limit, domain);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        },
      };
    }

    case 'search_prds': {
      const query = args?.query as string;
      const limit = Math.min((args?.limit as number) || 5, 20);
      const domain = args?.domain as string | undefined;

      if (!query) {
        return errorResponse(id, -32602, 'Missing required argument: query');
      }

      const results = await handleSearchPrds(env, query, limit, domain);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        },
      };
    }

    case 'get_resource': {
      const uri = args?.uri as string;
      if (!uri) {
        return errorResponse(id, -32602, 'Missing required argument: uri');
      }

      const content = await handleReadResource(env, uri);
      if (!content) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Resource not found',
              },
            ],
            isError: true,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: content.content,
            },
          ],
        },
      };
    }

    case 'list_resources': {
      const resources = await handleListResources(env);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(resources, null, 2),
            },
          ],
        },
      };
    }

    case 'validate_pipeline': {
      const yaml = args?.yaml as string;
      const includeExternal = (args?.include_external as boolean) ?? true;

      if (!yaml) {
        return errorResponse(id, -32602, 'Missing required argument: yaml');
      }

      const result = await validatePipelineForMcp(yaml, includeExternal);

      // Format the result for human readability
      const formattedText = formatMcpValidationResult(result);

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: formattedText,
            },
          ],
        },
      };
    }

    case 'get_component_schema': {
      const componentName = args?.component as string | undefined;
      const category = args?.category as ComponentCategory | undefined;
      const listOnly = (args?.list_only as boolean) ?? false;

      // If list_only, just return component names
      if (listOnly) {
        const names = listComponentNames(category);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    components: names,
                    count: names.length,
                    category: category || 'all',
                  },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }

      // If component specified, get its schema
      if (componentName) {
        const schema = getComponentSchema(componentName);
        if (!schema) {
          // Try to find similar components
          const allNames = listComponentNames();
          const similar = allNames.filter(
            (n) =>
              n.includes(componentName.toLowerCase()) ||
              componentName.toLowerCase().includes(n)
          );
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: `Unknown component: ${componentName}`,
                      similar_components: similar.slice(0, 5),
                      hint: 'Use list_only=true to see all available components',
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: formatComponentSchema(schema),
              },
            ],
          },
        };
      }

      // If category specified, get all schemas for that category
      if (category) {
        const schemas = getSchemasByCategory(category);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: schemas.map((s) => formatComponentSchema(s)).join('\n\n---\n\n'),
              },
            ],
          },
        };
      }

      // No parameters - return usage info
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  usage:
                    'Provide component name for specific schema, or category to list schemas, or list_only=true for names',
                  available_categories: ['input', 'processor', 'output'],
                  example_components: ['kafka', 'http_server', 'mapping', 'aws_s3'],
                },
                null,
                2
              ),
            },
          ],
        },
      };
    }

    case 'get_bloblang_reference': {
      const category = args?.category as (BloblangCategory | 'functions' | 'all') | undefined;
      const search = args?.search as string | undefined;

      let items;

      // If search is provided, use search
      if (search) {
        items = searchBloblang(search);
      } else if (category) {
        items = getByCategory(category);
      } else {
        // Default to all
        items = getByCategory('all');
      }

      if (items.length === 0) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    results: [],
                    message: search
                      ? `No items found matching "${search}"`
                      : `No items found in category "${category}"`,
                    hint: 'Try searching for "json", "map", "time", or use category: "all"',
                  },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: formatBloblangReference(items),
            },
          ],
        },
      };
    }

    case 'suggest_pipeline_pattern': {
      const use_case = args?.use_case as string;
      const input_type = args?.input_type as string | undefined;
      const output_type = args?.output_type as string | undefined;
      const limit = Math.min((args?.limit as number) || 3, 10);

      if (!use_case) {
        return errorResponse(id, -32602, 'Missing required argument: use_case');
      }

      const result = suggestWithFallback({
        use_case,
        input_type,
        output_type,
        limit,
      });

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    }

    case 'explain_error': {
      const error_message = args?.error_message as string;
      const context = args?.context as string | undefined;
      const error_type = args?.error_type as 'validation' | 'runtime' | 'connection' | 'bloblang' | 'unknown' | undefined;

      if (!error_message) {
        return errorResponse(id, -32602, 'Missing required argument: error_message');
      }

      const result = explainError({
        error_message,
        context,
        error_type,
      });

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    }

    case 'list_components': {
      const category = (args?.category as CatalogCategory | 'all') || 'all';
      const tag = args?.tag as ComponentTag | undefined;
      const search = args?.search as string | undefined;
      const format = (args?.format as 'summary' | 'detailed') || 'detailed';

      const result = listComponents({ category, tag, search });

      // Summary format: just names grouped by category
      if (format === 'summary') {
        const summary: Record<string, string[]> = {};
        for (const comp of result.components) {
          const cat = comp.category;
          if (!summary[cat]) summary[cat] = [];
          summary[cat].push(comp.name);
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    total: result.count,
                    by_category: summary,
                    available_tags: getAvailableTags().slice(0, 10),
                    category_counts: getCategoryCounts(),
                  },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }

      // Detailed format: full component list with descriptions
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: formatComponentList(result),
            },
          ],
        },
      };
    }

    case 'generate_test_data': {
      const schema = args?.schema as Record<string, unknown> | undefined;
      const pipeline_yaml = args?.pipeline_yaml as string | undefined;
      const count = args?.count as number | undefined;
      const format = args?.format as 'json' | 'jsonl' | 'csv' | 'yaml' | undefined;

      const result = generateTestData({
        schema,
        pipeline_yaml,
        count,
        format,
      });

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    }

    case 'get_data_product_prd_questionnaire': {
      // Return as JSON text so Cursor can render and also reuse it to build answers JSON.
      const payload = JSON.stringify(PRD_QUESTIONNAIRE_V1, null, 2);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: payload }],
        },
      };
    }

    case 'generate_data_product_prd': {
      const answers = args?.answers as Partial<PrdAnswers> | undefined;

      if (!answers) {
        return errorResponse(id, -32602, 'Missing required argument: answers');
      }

      // Check if answers look like placeholder/example data from the questionnaire
      const productNameLower = answers.product_name?.toLowerCase() || '';
      const isPlaceholder = 
        productNameLower.includes('device360') || 
        productNameLower.includes('example') ||
        productNameLower.includes('placeholder') ||
        productNameLower.includes('sample');
      
      if (isPlaceholder) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Invalid answers: Detected placeholder or example data',
                    message: 'You provided example/placeholder answers instead of collecting real answers from the user. You MUST: (1) Call get_data_product_prd_questionnaire first, (2) Ask the user each question from the questionnaire, (3) Collect their actual answers, (4) Only then call generate_data_product_prd with the user\'s real answers. DO NOT use example data from the questionnaire.',
                    hint: 'Start by calling get_data_product_prd_questionnaire, then interview the user with each question.',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          },
        };
      }

      const v = validateAnswers(answers);
      if (!v.ok) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Validation failed',
                    missing: v.missing,
                    errors: v.errors,
                    message: 'You must collect ALL required answers from the user before generating the PRD. Call get_data_product_prd_questionnaire first, then ask the user each question and collect their responses.',
                    hint: 'Interview the user using the questionnaire, collect all answers, then call generate_data_product_prd again with the complete answers.',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          },
        };
      }

      const prd = renderPrdMarkdown(answers as PrdAnswers);
      const productName = (answers as PrdAnswers).product_name;
      const filename = `${sanitizeFilename(productName)}.md`;

      // Prepend filename comment to markdown so AI can extract and use it when saving
      // The comment is HTML-style so it won't render in markdown viewers but is visible to AI
      const prdWithFilename = `<!-- 
Suggested filename: ${filename}
This PRD should be saved as: ${filename}
-->

${prd}`;

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: prdWithFilename,
            },
          ],
        },
      };
    }

    case 'vulcan_activity_timeline': {
      const action = args?.action as 'plan' | 'run' | undefined;
      const environment = args?.environment as string | undefined;
      const after_start_ts = args?.after_start_ts as number | undefined;
      const model_name = args?.model_name as string[] | undefined;
      const limit = Math.min((args?.limit as number) || 100, 1000);
      const offset = (args?.offset as number) || 0;
      const failed_only = (args?.failed_only as boolean) || false;
      const environment_base_url = args?.environment_base_url as string | undefined;

      // Always require environment_base_url for dynamic environment selection
      if (!environment_base_url) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'Vulcan API environment URL required',
                    message: 'Please specify the environment API base URL to query.',
                    action_required: 'CRITICAL: Ask the user for the URL, then when they respond with a URL, you MUST extract that URL and pass it as the environment_base_url parameter in your next tool call.',
                    step_by_step: [
                      'Step 1: Ask the user: "What is the API base URL for the [environment] environment?" where [environment] is detected from their query (e.g., "prod", "local", "staging").',
                      'Step 2: Wait for user response with a URL (e.g., "https://everest-010626.dataos.app" or "everest-010626.dataos.app/home").',
                      'Step 3: Extract the URL from their response (add https:// if missing, handle variations like missing protocol, trailing slashes, etc.).',
                      'Step 4: Call the tool again with environment_base_url parameter set to the extracted URL, along with ALL other parameters from the original request (action, environment, failed_only, limit, etc.).',
                    ],
                    example_questions: [
                      'If user asks "What failed in prod?" → Ask: "What is the API base URL for your prod environment?" → User responds: "everest-010626.dataos.app" → Extract URL → Call tool with environment_base_url="https://everest-010626.dataos.app" (add https:// if missing), failed_only=true, environment="prod", and all other original parameters',
                      'If user asks "Show activity in local" → Ask: "What is the API base URL for your local environment?" → User responds: "https://abc123.ngrok.io" → Call tool with environment_base_url="https://abc123.ngrok.io" and all other original parameters',
                      'If user asks "What happened today?" → Ask: "Which environment? Please provide the API base URL." → User responds with URL → Extract and use it in environment_base_url parameter with all other original parameters',
                    ],
                    url_requirements: 'The URL must be publicly accessible from the internet. For local environments, use services like ngrok, Cloudflare Tunnel, or expose via public IP. localhost/127.0.0.1 will NOT work from Cloudflare Workers.',
                    url_format: 'Users can provide the base domain URL (e.g., "https://everest-010626.dataos.app" or "https://everest-010626.dataos.app/home/"). The tool will automatically append the API path (/system/vulcan/vulcan-app).',
                    example_urls: [
                      'Base domain: "https://everest-010626.dataos.app" (will auto-append API path)',
                      'Home page: "https://everest-010626.dataos.app/home/" (will auto-append API path)',
                      'Full API path: "https://everest-010626.dataos.app/system/vulcan/vulcan-app" (used as-is)',
                      'Local (via ngrok): "https://abc123.ngrok.io" (will auto-append API path)',
                      'Public IP: "https://your-public-ip:8000" (will auto-append API path if exposed)',
                    ],
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          },
        };
      }

      // Use the provided environment base URL (normalization happens in getVulcanConfig)
      const tenantConfig: TenantConfig = {
        VULCAN_BASE_URL: environment_base_url,
        VULCAN_TOKEN: undefined,
        VULCAN_AUTH_HEADER: undefined,
        VULCAN_AUTH_SCHEME: undefined,
      };

      try {
        const result = await getActivityTimeline(tenantConfig, {
          action,
          environment,
          after_start_ts,
          model_name,
          limit,
          offset,
          failed_only,
        });

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      } catch (error) {
        return errorResponse(
          id,
          -32603,
          `Failed to fetch activity timeline: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    default:
      return errorResponse(id, -32602, `Unknown tool: ${name}`);
  }
}

// Helper: Create error response
function errorResponse(id: string | number, code: number, message: string): McpResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}
