#!/usr/bin/env npx tsx
/**
 * Index PRDs from central repo registry.json into Cloudflare Vectorize (vulcan-prds)
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... npm run index:prds
 *
 * Optional:
 *   PRD_REGISTRY_URL=... (raw github URL to registry.json)
 *   PRD_INDEX_NAME=... (default: vulcan-prds)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAccountIdFromWrangler(): string {
  try {
    const wranglerPath = join(__dirname, '..', 'wrangler.toml');
    const content = readFileSync(wranglerPath, 'utf-8');
    const match = content.match(/account_id\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {}
  return process.env.CLOUDFLARE_ACCOUNT_ID || '';
}

const PRD_INDEX_NAME = process.env.PRD_INDEX_NAME || 'vulcan-prds';

const PRD_REGISTRY_URL =
  process.env.PRD_REGISTRY_URL ||
  'https://raw.githubusercontent.com/gnyanee97/vulcan-prds/main/registry.json';

interface RegistryItem {
  product_name: string;
  domain: string; // Important: use domain from registry for filtering
  owner_team?: string;
  source_repo?: string;
  prd_path: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

interface Registry {
  version: string;
  items: RegistryItem[];
}

interface Chunk {
  id: string;
  text: string;
  metadata: Record<string, string>;
}

async function main() {
  const accountId = getAccountIdFromWrangler();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error('Missing account_id (wrangler.toml) or CLOUDFLARE_API_TOKEN env var');
    process.exit(1);
  }

  console.log(`Indexing PRDs into Vectorize index: ${PRD_INDEX_NAME}`);
  console.log(`Fetching PRD registry: ${PRD_REGISTRY_URL}`);

  const regResp = await fetch(PRD_REGISTRY_URL);
  if (!regResp.ok) {
    console.error(`Failed to fetch registry.json: ${regResp.status}`);
    process.exit(1);
  }

  const registry = (await regResp.json()) as Registry;

  // Base prefix: ".../main/registry.json" -> ".../main/"
  const basePrefix = PRD_REGISTRY_URL.replace(/registry\.json$/, '');
  const prdItems = registry.items.map((it) => ({
    ...it,
    uri: `${basePrefix}${it.prd_path}`,
  }));

  console.log(`Found ${prdItems.length} PRDs in registry`);

  if (prdItems.length === 0) {
    console.log('No PRDs to index');
    return;
  }

  const fetchResults = await Promise.allSettled(
    prdItems.map(async (it) => {
      const r = await fetch(it.uri);
      if (!r.ok) {
        console.warn(`Failed to fetch ${it.uri}: ${r.status}`);
        return null;
      }
      return { it, content: await r.text() };
    })
  );

  const chunks: Chunk[] = [];

  for (const res of fetchResults) {
    if (res.status === 'rejected' || !res.value) continue;

    const { it, content } = res.value;

    // Remove filename comment if present
    const cleanContent = content.replace(/<!--[\s\S]*?-->\n\n?/g, '');
    const title = it.product_name || extractTitle(cleanContent);
    const sections = splitByHeadings(cleanContent);

    for (const section of sections) {
      chunks.push({
        id: generateId(it.uri, section.heading),
        text: section.content,
        metadata: {
          type: 'prd',
          uri: it.uri,
          domain: it.domain || 'unknown', // Use domain from registry (analytics, platform, etc.)
          title,
          snippet: section.content.slice(0, 200),
          section: section.heading,
          product_name: it.product_name || '',
          owner_team: it.owner_team || '',
          source_repo: it.source_repo || '',
          tags: (it.tags || []).join(', '),
        },
      });
    }
  }

  console.log(`Created ${chunks.length} PRD chunks`);
  if (chunks.length === 0) {
    console.log('No PRD chunks to index');
    return;
  }

  console.log('Generating embeddings and upserting...');

  const batchSize = 20;
  const concurrency = 2;

  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  const start = Date.now();
  for (let i = 0; i < batches.length; i += concurrency) {
    const group = batches.slice(i, i + concurrency);

    await Promise.all(
      group.map(async (batch) => {
        const embeddings = await generateEmbeddings(
          batch.map((c) => c.text),
          accountId,
          apiToken
        );

        const vectors = batch.map((chunk, idx) => ({
          id: chunk.id,
          values: embeddings[idx],
          metadata: chunk.metadata,
        }));

        await upsertVectors(vectors, accountId, apiToken, PRD_INDEX_NAME);
      })
    );

    const processed = Math.min((i + concurrency) * batchSize, chunks.length);
    console.log(`  ${processed}/${chunks.length} chunks indexed`);
  }

  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

function extractTitle(content: string): string {
  // Handle "PRD: Product Name" format
  const match = content.match(/^#\s+PRD:\s*(.+)$/m) || content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

function splitByHeadings(content: string): Array<{ heading: string; content: string }> {
  const lines = content.split('\n');
  const sections: Array<{ heading: string; content: string }> = [];
  let currentHeading = 'Introduction';
  let currentContent: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentContent.length > 0) {
        const joined = currentContent.join('\n').trim();
        if (joined.length > 50) {
          sections.push({ heading: currentHeading, content: joined });
        }
      }
      currentHeading = h2Match[1];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    const joined = currentContent.join('\n').trim();
    if (joined.length > 50) {
      sections.push({ heading: currentHeading, content: joined });
    }
  }

  return sections;
}

function generateId(uri: string, section: string): string {
  const base = uri.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const sectionSlug = section.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25);
  const id = `${base}__${sectionSlug}`;
  // Vectorize max ID is 64 bytes
  return id.slice(0, 64);
}

async function generateEmbeddings(texts: string[], accountId: string, apiToken: string): Promise<number[][]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-base-en-v1.5`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts }),
    }
  );

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`);
  }

  const result = await response.json();
  return (result as { result: { data: number[][] } }).result.data;
}

async function upsertVectors(
  vectors: Array<{ id: string; values: number[]; metadata: Record<string, string> }>,
  accountId: string,
  apiToken: string,
  indexName: string
): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexName}/upsert`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: vectors.map((v) => JSON.stringify(v)).join('\n'),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vectorize upsert error: ${response.status} - ${error}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
