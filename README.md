# Vulcan MCP Server

A Model Context Protocol (MCP) server for semantic search and retrieval over Vulcan documentation. Deployed on Cloudflare Workers with Vectorize for vector search.

## Features

- **Semantic Search**: Query documentation using natural language
- **MCP Protocol**: Compatible with Claude, ChatGPT, and other AI assistants
- **Multi-Domain**: Searches across Vulcan documentation from GitHub
- **HTTP API**: Direct API access for custom integrations
- **Edge Deployment**: Low latency via Cloudflare's global network

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                        │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │   HTTP API  │  │ MCP Protocol │  │ Resource Handler  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                │                    │             │
│         └────────────────┼────────────────────┘             │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                   Search Handler                       │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│  ┌────────────┐  ┌────────────────┐  ┌─────────────┐       │
│  │ Workers AI │  │   Vectorize    │  │  KV Cache   │       │
│  │ (Embeddings)│  │ (Vector Store) │  │  (Content)  │       │
│  └────────────┘  └────────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### Prerequisites

1. [Cloudflare account](https://dash.cloudflare.com) with Workers paid plan (for Vectorize)
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
3. Node.js 18+

### Installation

```bash
cd mcp-server
npm install
```

### Create Cloudflare Resources

```bash
# Login to Cloudflare
wrangler login

# Create KV namespace for content cache
wrangler kv namespace create CONTENT_CACHE
# Update wrangler.toml with the returned ID

# Create Vectorize index
wrangler vectorize create vulcan-docs --dimensions=768 --metric=cosine
```

### Index Content

```bash
# Set environment variables
export CLOUDFLARE_ACCOUNT_ID=your-account-id
export CLOUDFLARE_API_TOKEN=your-api-token

# Run indexer
npm run index
```

### Deploy

```bash
# Deploy to production
npm run deploy

# Or development
npm run dev
```

## API Reference

### HTTP API

#### Search Documentation

```bash
GET /api/search?q=<query>&limit=<n>&domain=<domain>
```

Parameters:
- `q` (required): Search query
- `limit` (optional): Max results (default: 5, max: 20)
- `domain` (optional): Filter by domain

Example:
```bash
curl "https://mcp.vulcan.io/api/search?q=vulcan+getting+started&limit=3"
```

#### List Resources

```bash
GET /api/resources
```

Returns all available documentation resources.

#### Get Resource Content

```bash
GET /api/resources/<encoded-uri>
```

Example:
```bash
curl "https://mcp.vulcan.io/api/resources/https%3A%2F%2Fraw.githubusercontent.com%2Ftmdc-io%2Fvulcan-book%2Fvulcan-ai%2Fdocs%2Fllms%2Fgetting_started%2Fcli.txt"
```

### MCP Protocol

The server implements MCP protocol version 2024-11-05.

#### Tools

1. **search_docs**: Semantic search over documentation
   - `query` (string, required): Search query
   - `limit` (number, optional): Max results
   - `domain` (string, optional): Filter by domain

2. **get_resource**: Retrieve full content of a resource
   - `uri` (string, required): Resource URI

3. **list_resources**: List all available resources

#### Example MCP Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_docs",
    "arguments": {
      "query": "how to configure circuit breakers",
      "limit": 5
    }
  }
}
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vulcan-docs": {
      "url": "https://mcp.vulcan.io/mcp"
    }
  }
}
```

### Custom Integration

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'my-app',
  version: '1.0.0',
});

await client.connect({
  url: 'https://mcp.vulcan.io/mcp',
});

const results = await client.callTool('search_docs', {
  query: 'vulcan getting started',
});
```

## Development

```bash
# Start local dev server
npm run dev

# Run tests
npm test

# View logs
npm run tail
```

## Domains Indexed

| Domain | Content |
|--------|---------|
| raw.githubusercontent.com | Vulcan documentation from GitHub (vulcan-ai branch) |
| github.com | Vulcan repository and documentation |
| tmdc-io.github.io | Vulcan GitHub Pages documentation |

## License

MIT
