export const VECTOR_DIMENSIONS = 768;
export const EMBEDDING_MODEL_ID = 'Qwen3-Embedding-0.6B';
export const SQLITE_VEC_EXTENSION = 'sqlite-vec';

export interface VectorChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding?: number[];
}

export interface EmbeddingProvider {
  embed(text: string, dimensions: number): Promise<number[]>;
}

export interface VectorStoreAdapter {
  upsert(chunks: Required<VectorChunk>[]): Promise<void>;
  search(embedding: number[], limit: number): Promise<Array<{ chunk: VectorChunk; score: number }>>;
}

export function chunkSourceForVectorIndex(path: string, content: string, maxChars = 2400): VectorChunk[] {
  const lines = content.split('\n');
  const chunks: VectorChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && size + lines[end].length <= maxChars) {
      size += lines[end].length + 1;
      end += 1;
      if (/^\s*(export\s+)?(function|class|const|interface|type)\s+/.test(lines[end] || '') && size > maxChars * 0.6) break;
    }
    if (end === start) end += 1;
    chunks.push({
      id: `${path}:${start + 1}-${end}`,
      path,
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join('\n'),
    });
    start = end;
  }
  return chunks;
}

export async function embedChunks(chunks: VectorChunk[], provider: EmbeddingProvider): Promise<Required<VectorChunk>[]> {
  const embedded: Required<VectorChunk>[] = [];
  for (const chunk of chunks) {
    const embedding = await provider.embed(chunk.text, VECTOR_DIMENSIONS);
    if (embedding.length !== VECTOR_DIMENSIONS) {
      throw new Error(`Embedding dimension mismatch: expected ${VECTOR_DIMENSIONS}, received ${embedding.length}.`);
    }
    embedded.push({ ...chunk, embedding });
  }
  return embedded;
}

export async function indexChunks(chunks: VectorChunk[], provider: EmbeddingProvider, store: VectorStoreAdapter): Promise<void> {
  await store.upsert(await embedChunks(chunks, provider));
}
