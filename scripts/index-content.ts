#!/usr/bin/env npx tsx
/**
 * Index llms.txt content into Cloudflare Vectorize
 *
 * Usage: npm run index
 *
 * Requires CLOUDFLARE_API_TOKEN environment variable.
 * Account ID is read from wrangler.toml automatically.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// import { PIPELINE_EXAMPLES, getExampleSearchText } from '../src/examples-registry'; // Commented out - Vulcan doesn't have pipeline examples

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAccountIdFromWrangler(): string {
  try {
    const wranglerPath = join(__dirname, '..', 'wrangler.toml');
    const content = readFileSync(wranglerPath, 'utf-8');
    const match = content.match(/account_id\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {
    // Fall through to env var
  }
  return process.env.CLOUDFLARE_ACCOUNT_ID || '';
}

const RESOURCES = [
  // Vulcan Book (LLM-friendly exports) - from vulcan-ai branch
  // llms.txt will be expanded to individual page URLs
  'https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs/llms.txt',
];

interface Chunk {
  id: string;
  text: string;
  metadata: {
    uri: string;
    domain: string;
    title: string;
    snippet: string;
    section: string;
    type: 'doc' | 'example';
  };
}

async function main() {
  const accountId = getAccountIdFromWrangler();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error('Missing CLOUDFLARE_ACCOUNT_ID (in wrangler.toml) or CLOUDFLARE_API_TOKEN env var');
    process.exit(1);
  }

  const startTime = Date.now();
  const baseUrl = 'https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs';

  // If RESOURCES includes an llms.txt index, expand it into per-page .txt URLs
  let expandedResources = [...RESOURCES];
  
  for (const uri of RESOURCES) {
    if (uri.endsWith('/llms.txt') || uri.endsWith('llms.txt')) {
      console.log('Fetching llms.txt index to discover pages...');
      const r = await fetch(uri);
      if (r.ok) {
        const txt = await r.text();
        const links = extractTxtLinksFromLlmsIndex(txt, baseUrl);
        if (links.length > 0) {
          expandedResources = links;
          console.log(`Expanded to ${links.length} individual pages`);
        }
      } else {
        console.warn(`Failed to fetch llms.txt index: ${r.status}`);
      }
    }
  }

  console.log(`Indexing ${expandedResources.length} URLs...`);

  // Fetch all URLs in parallel
  const fetchResults = await Promise.allSettled(
    expandedResources.map(async (uri) => {
      const response = await fetch(uri);
      if (!response.ok) {
        console.warn(`Failed to fetch ${uri}: ${response.status}`);
        return null;
      }
      return { uri, content: await response.text() };
    })
  );

  const chunks: Chunk[] = [];
  for (const result of fetchResults) {
    if (result.status === 'rejected' || !result.value) continue;

    const { uri, content } = result.value;
    const domain = new URL(uri).hostname;
    const title = extractTitle(content);
    const sections = splitByHeadings(content);

    for (const section of sections) {
      chunks.push({
        id: generateId(uri, section.heading),
        text: section.content,
        metadata: {
          uri,
          domain,
          title,
          snippet: section.content.slice(0, 200),
          section: section.heading,
          type: 'doc',
        },
      });
    }
  }

  console.log(`Fetched ${expandedResources.length} URLs, created ${chunks.length} doc chunks in ${Date.now() - startTime}ms`);

  // Add pipeline examples to chunks
  // Commented out - Vulcan doesn't have pipeline examples like Expanso
  // console.log(`Adding ${PIPELINE_EXAMPLES.length} pipeline examples...`);
  // for (const example of PIPELINE_EXAMPLES) {
  //   const searchText = getExampleSearchText(example);
  //   chunks.push({
  //     id: example.id,
  //     text: searchText,
  //     metadata: {
  //       uri: `examples://expanso.io/${example.id}`,
  //       domain: 'examples.expanso.io',
  //       title: example.name,
  //       snippet: example.description.slice(0, 200),
  //       section: example.name,
  //       type: 'example',
  //     },
  //   });
  // }

  console.log(`Total chunks to index: ${chunks.length} docs`);

  if (chunks.length === 0) {
    console.log('No chunks to index');
    return;
  }

  console.log('Generating embeddings and upserting (parallel batches)...');

  // Process in larger batches, run embedding + upsert in parallel per batch
  const batchSize = 20; // Larger batches = fewer API calls
  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  // Process batches with limited concurrency (2 at a time to avoid rate limits)
  const concurrency = 2;
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchGroup = batches.slice(i, i + concurrency);

    await Promise.all(
      batchGroup.map(async (batch) => {
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

        await upsertVectors(vectors, accountId, apiToken);
      })
    );

    const processed = Math.min((i + concurrency) * batchSize, chunks.length);
    console.log(`  ${processed}/${chunks.length} chunks indexed`);
  }

  console.log(`\nDone in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

function extractTxtLinksFromLlmsIndex(content: string, baseUrl: string): string[] {
  const links: string[] = [];
  
  // Matches markdown links: [Title](URL or path)
  // Handles both absolute URLs and relative paths
  const re = /\[[^\]]+\]\(([^)]+\.txt)\)/g;
  let m: RegExpExecArray | null;
  
  while ((m = re.exec(content)) !== null) {
    let link = m[1];
    
    // If absolute URL (GitHub Pages), convert to raw GitHub URL
    if (link.startsWith('http://') || link.startsWith('https://')) {
      // Convert GitHub Pages URL to raw GitHub URL
      // From: https://tmdc-io.github.io/vulcan-book/llms/guides/plan.txt
      // To: https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs/llms/guides/plan.txt
      if (link.includes('tmdc-io.github.io/vulcan-book/')) {
        // Extract the path after /vulcan-book/
        const pathMatch = link.match(/\/vulcan-book\/(.+)$/);
        if (pathMatch) {
          const path = pathMatch[1];
          // Convert to raw GitHub URL with vulcan-ai branch
          link = `https://raw.githubusercontent.com/tmdc-io/vulcan-book/vulcan-ai/docs/${path}`;
        }
      }
      links.push(link);
    } else {
      // Relative path - convert to full URL
      const fullPath = link.startsWith('/') 
        ? link.slice(1) 
        : link.startsWith('llms/')
        ? link
        : `llms/${link}`;
      links.push(`${baseUrl}/${fullPath}`);
    }
  }
  
  // De-dupe and exclude llms-full.txt
  return Array.from(new Set(links)).filter(link => !link.includes('llms-full.txt'));
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Untitled';
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
        sections.push({
          heading: currentHeading,
          content: currentContent.join('\n').trim(),
        });
      }
      currentHeading = h2Match[1];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Add last section
  if (currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join('\n').trim(),
    });
  }

  // Filter out empty sections and merge small ones
  return sections.filter((s) => s.content.length > 50);
}

function generateId(uri: string, section: string): string {
  const base = uri.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const sectionSlug = section.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25);
  const id = `${base}_${sectionSlug}`;
  // Vectorize max ID is 64 bytes
  return id.slice(0, 64);
}

async function generateEmbeddings(
  texts: string[],
  accountId: string,
  apiToken: string
): Promise<number[][]> {
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
  apiToken: string
): Promise<void> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/vulcan-docs/upsert`,
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

main().catch(console.error);
