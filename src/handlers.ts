/**
 * Request Handlers
 *
 * Implements semantic search using Vectorize and content retrieval.
 */

import type { Env } from './index';

// Resource definition
interface Resource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// Search result
interface SearchResult {
  uri: string;
  title: string;
  snippet: string;
  score: number;
  domain: string;
}

// PRD search result
interface PrdSearchResult {
  uri: string;
  title: string;
  snippet: string;
  score: number;
  domain: string;
  product_name: string;
  section: string;
  owner_team?: string;
  source_repo?: string;
  tags?: string;
}

// Content response
interface ContentResponse {
  uri: string;
  content: string;
  title: string;
  domain: string;
}

// All available llms.txt resources
const RESOURCES: Resource[] = [
  {
    uri: 'https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs/llms.txt',
    name: 'Vulcan Book (LLMs Index)',
    description: 'Entry point listing all Vulcan documentation text exports for indexing/search.',
    mimeType: 'text/plain',
  },
  {
    uri: 'https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs/llms-full.txt',
    name: 'Vulcan Book (Full)',
    description: 'Flattened full Vulcan documentation export (large).',
    mimeType: 'text/plain',
  },
];

/**
 * Semantic search over documentation
 */
export async function handleSearch(
  env: Env,
  query: string,
  limit: number = 5,
  domain?: string
): Promise<{ results: SearchResult[]; query: string }> {
  // If Vectorize is not configured, use keyword search
  if (!env.VECTORIZE) {
    return {
      results: await fallbackKeywordSearch(env, query, limit, domain),
      query,
    };
  }

  try {
    // Generate embedding for query
    const embedding = await generateEmbedding(env, query);

    // Search Vectorize
    const vectorResults = await env.VECTORIZE.query(embedding, {
      topK: limit * 2, // Get more results to filter
      returnMetadata: 'all',
    });

    // Filter by domain if specified and format results
    let results: SearchResult[] = vectorResults.matches
      .filter((match) => {
        if (!domain) return true;
        const matchDomain = (match.metadata?.domain as string) || '';
        return matchDomain.includes(domain);
      })
      .slice(0, limit)
      .map((match) => ({
        uri: (match.metadata?.uri as string) || '',
        title: (match.metadata?.title as string) || 'Untitled',
        snippet: (match.metadata?.snippet as string) || '',
        score: match.score,
        domain: (match.metadata?.domain as string) || '',
      }));

    // If no vector results (index not populated), fall back to keyword search
    if (results.length === 0) {
      results = await fallbackKeywordSearch(env, query, limit, domain);
    }

    return { results, query };
  } catch (error) {
    console.error('Search error:', error);
    // Fall back to keyword search on any error
    return {
      results: await fallbackKeywordSearch(env, query, limit, domain),
      query,
    };
  }
}

/**
 * Fallback keyword search when vector search is unavailable
 */
async function fallbackKeywordSearch(
  env: Env,
  query: string,
  limit: number,
  domain?: string
): Promise<SearchResult[]> {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  // Filter resources by domain
  const filteredResources = domain
    ? RESOURCES.filter((r) => r.uri.includes(domain))
    : RESOURCES;

  // Score resources by keyword match
  const scored = filteredResources.map((resource) => {
    const text = `${resource.name} ${resource.description}`.toLowerCase();
    let score = 0;

    for (const term of queryTerms) {
      if (text.includes(term)) {
        score += 1;
        // Boost for exact name match
        if (resource.name.toLowerCase().includes(term)) {
          score += 0.5;
        }
      }
    }

    return {
      uri: resource.uri,
      title: resource.name,
      snippet: resource.description,
      score,
      domain: new URL(resource.uri).hostname,
    };
  });

  // Sort by score and return top results
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * List all available resources
 */
export async function handleListResources(env: Env): Promise<Resource[]> {
  return RESOURCES;
}

/**
 * Read resource content
 */
export async function handleReadResource(
  env: Env,
  uri: string
): Promise<ContentResponse | null> {
  // Parse allowed domains from env var
  const allowedDomains = (env.DOCS_DOMAINS || 'raw.githubusercontent.com,github.com,tmdc-io.github.io')
    .split(',')
    .map(d => d.trim());

  // Validate URI is from an allowed domain
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }

  const isAllowedDomain = allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  if (!isAllowedDomain) {
    return null;
  }

  // Check if URI is in RESOURCES for title/name
  const resource = RESOURCES.find((r) => r.uri === uri);

  // Check cache first (if KV is available)
  const cacheKey = `content:${uri}`;
  if (env.CONTENT_CACHE) {
    try {
      const cached = await env.CONTENT_CACHE.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // KV not available, continue without cache
    }
  }

  // Fetch content
  try {
    const response = await fetch(uri, {
      headers: {
        'User-Agent': 'VulcanMCPServer/1.0',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${uri}: ${response.status}`);
      return null;
    }

    const content = await response.text();
    
    // Extract title from URI path if not in RESOURCES
    let title = resource?.name || 'Untitled';
    if (!resource) {
      // Try to extract a meaningful title from the path
      const pathParts = url.pathname.split('/').filter(p => p);
      const fileName = pathParts[pathParts.length - 1] || '';
      if (fileName) {
        // Remove extension and format
        title = fileName.replace(/\.(txt|md)$/i, '').replace(/[-_]/g, ' ');
        // Capitalize first letter of each word
        title = title.split(' ').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      }
    }

    const result: ContentResponse = {
      uri,
      content,
      title,
      domain: url.hostname,
    };

    // Cache for 1 hour (if KV is available)
    if (env.CONTENT_CACHE) {
      try {
        await env.CONTENT_CACHE.put(cacheKey, JSON.stringify(result), {
          expirationTtl: 3600,
        });
      } catch {
        // KV not available, continue without caching
      }
    }

    return result;
  } catch (error) {
    console.error(`Error fetching ${uri}:`, error);
    return null;
  }
}

/**
 * Semantic search over PRDs
 */
export async function handleSearchPrds(
  env: Env,
  query: string,
  limit: number = 5,
  domain?: string
): Promise<{ results: PrdSearchResult[]; query: string }> {
  if (!env.VECTORIZE_PRD) {
    return { results: [], query };
  }

  try {
    const embedding = await generateEmbedding(env, query);

    const vectorResults = await env.VECTORIZE_PRD.query(embedding, {
      topK: limit * 2,
      returnMetadata: 'all',
    });

    const results: PrdSearchResult[] = vectorResults.matches
      .filter((match) => {
        if (!domain) return true;
        const matchDomain = (match.metadata?.domain as string) || '';
        return matchDomain.toLowerCase().includes(domain.toLowerCase());
      })
      .slice(0, limit)
      .map((match) => ({
        uri: (match.metadata?.uri as string) || '',
        title: (match.metadata?.title as string) || 'Untitled',
        snippet: (match.metadata?.snippet as string) || '',
        score: match.score,
        domain: (match.metadata?.domain as string) || 'unknown',
        product_name: (match.metadata?.product_name as string) || '',
        section: (match.metadata?.section as string) || '',
        owner_team: (match.metadata?.owner_team as string) || undefined,
        source_repo: (match.metadata?.source_repo as string) || undefined,
        tags: (match.metadata?.tags as string) || undefined,
      }));

    return { results, query };
  } catch (error) {
    console.error('PRD search error:', error);
    return { results: [], query };
  }
}

/**
 * Generate embedding using Workers AI
 */
async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });

  // AI.run returns { data: [[...embedding]] }
  if (result && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
    return result.data[0] as number[];
  }

  throw new Error('Failed to generate embedding');
}
