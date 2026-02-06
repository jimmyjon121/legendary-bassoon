const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Optional dependencies - graceful degradation if not installed
let pdfParse = null;
let mammoth = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('pdf-parse not available - PDF support disabled');
}
try {
  mammoth = require('mammoth');
} catch (e) {
  console.warn('mammoth not available - DOCX support disabled');
}

const { embedTextsWithOllama, cosineSimilarity } = require('./embedding-service');

function hashContent(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function chunkText(text, maxChars = 2000) {
  const chunks = [];
  const paragraphs = (text || '').split(/\n{2,}/g);
  let buffer = '';

  const pushBuffer = () => {
    if (buffer.trim()) {
      chunks.push(buffer.trim());
      buffer = '';
    }
  };

  paragraphs.forEach((para) => {
    const trimmed = para.trim();
    if (!trimmed) return;
    if ((buffer + '\n\n' + trimmed).length > maxChars) {
      pushBuffer();
      if (trimmed.length > maxChars) {
        for (let i = 0; i < trimmed.length; i += maxChars) {
          chunks.push(trimmed.slice(i, i + maxChars));
        }
      } else {
        buffer = trimmed;
      }
    } else {
      buffer = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
    }
  });

  pushBuffer();
  return chunks.filter(Boolean);
}

async function ingestDocument(db, store, filePath, workspace) {
  if (!db) throw new Error('Database not initialized');
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('File not found');
  }

  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  let content = '';
  try {
    if (ext === '.pdf') {
      if (!pdfParse) {
        throw new Error('PDF support not available - install pdf-parse package');
      }
      const data = await pdfParse(await fsPromises.readFile(filePath));
      content = data.text;
    } else if (ext === '.docx') {
      if (!mammoth) {
        throw new Error('DOCX support not available - install mammoth package');
      }
      const result = await mammoth.extractRawText({ path: filePath });
      content = result.value;
    } else {
      content = await fsPromises.readFile(filePath, 'utf-8');
    }
  } catch (error) {
    throw new Error(`Failed to read document: ${error.message}`);
  }

  const contentHash = hashContent(content);
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    throw new Error('Document is empty');
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

  // Insert document metadata
  db.run(
    `
    INSERT INTO documents (id, filename, filepath, content_hash, chunk_count, workspace, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `,
    [id, filename, filePath, contentHash, chunks.length, workspace || null],
  );

  const endpoint = store.get('llmEndpoint');
  let embeddings = [];
  try {
    embeddings = await embedTextsWithOllama(endpoint, chunks);
  } catch (error) {
    console.error('Failed to generate embeddings:', error);
    // Still store chunks without embeddings; RAG search will be disabled
  }

  // Insert chunks
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkId =
      crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
    const embedding = embeddings[i] ? JSON.stringify(embeddings[i]) : null;
    db.run(
      `
      INSERT INTO document_chunks (id, document_id, content, embedding, chunk_index)
      VALUES (?, ?, ?, ?, ?)
    `,
      [chunkId, id, chunks[i], embedding, i],
    );
  }

  return {
    id,
    filename,
    filepath: filePath,
    workspace,
    chunk_count: chunks.length,
  };
}

function listDocuments(db, workspace) {
  if (!db) return [];
  try {
    const result = db.exec(
      `
      SELECT id, filename, filepath, content_hash, chunk_count, workspace, created_at
      FROM documents
      WHERE workspace IS NULL OR workspace = ?
      ORDER BY created_at DESC
    `,
      [workspace || null],
    );
    if (!result.length) return [];
    return result[0].values.map(
      ([id, filename, filepath, contentHash, chunkCount, ws, createdAt]) => ({
        id,
        filename,
        filepath,
        content_hash: contentHash,
        chunk_count: chunkCount,
        workspace: ws,
        created_at: createdAt,
      }),
    );
  } catch (error) {
    console.error('Failed to list documents:', error);
    return [];
  }
}

function deleteDocument(db, id) {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    db.run('DELETE FROM document_chunks WHERE document_id = ?', [id]);
    db.run('DELETE FROM documents WHERE id = ?', [id]);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete document:', error);
    return { success: false, error: error.message };
  }
}

async function searchDocuments(db, store, workspace, query, limit = 4) {
  if (!db) return [];
  if (!query || !query.trim()) return [];

  const endpoint = store.get('llmEndpoint');
  let queryEmbedding;
  try {
    const embedded = await embedTextsWithOllama(endpoint, [query]);
    if (!embedded || embedded.length === 0) {
      // Embedding model unavailable - degrade gracefully
      return [];
    }
    queryEmbedding = embedded[0];
  } catch (error) {
    console.error('Failed to embed query:', error);
    return [];
  }

  try {
    const result = db.exec(
      `
      SELECT c.id, c.document_id, c.content, c.embedding, c.chunk_index,
             d.filename, d.filepath, d.workspace
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.workspace IS NULL OR d.workspace = ?
    `,
      [workspace || null],
    );
    if (!result.length) return [];

    const rows = result[0].values;
    const scored = [];
    for (const row of rows) {
      const [id, documentId, content, embeddingJson, chunkIndex, filename, filepath, ws] =
        row;
      if (!embeddingJson) continue;
      let embedding;
      try {
        embedding = JSON.parse(embeddingJson);
      } catch {
        continue;
      }
      const score = cosineSimilarity(queryEmbedding, embedding);
      scored.push({
        id,
        document_id: documentId,
        content,
        chunk_index: chunkIndex,
        filename,
        filepath,
        workspace: ws,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  } catch (error) {
    console.error('Failed to search documents:', error);
    return [];
  }
}

async function exportWorkspace(db, workspace, targetPath) {
  if (!db) throw new Error('Database not initialized');
  if (!targetPath) throw new Error('Target path required');

  const whereClause = workspace
    ? 'WHERE workspace = ?'
    : 'WHERE workspace IS NULL OR workspace = ""';
  const params = workspace ? [workspace] : [];

  const docsResult = db.exec(
    `
    SELECT id, filename, filepath, content_hash, chunk_count, workspace, created_at
    FROM documents
    ${whereClause}
    ORDER BY created_at DESC
  `,
    params,
  );

  const documents = [];
  if (docsResult?.[0]) {
    for (const row of docsResult[0].values) {
      const [id, filename, filepath, contentHash, chunkCount, ws, createdAt] = row;
      const chunksResult = db.exec(
        `SELECT content, embedding, chunk_index FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC`,
        [id],
      );
      const chunks = chunksResult?.[0]
        ? chunksResult[0].values.map(([content, embedding, chunkIndex]) => ({
            content,
            embedding,
            chunk_index: chunkIndex,
          }))
        : [];
      documents.push({
        id,
        filename,
        filepath,
        content_hash: contentHash,
        chunk_count: chunkCount,
        workspace: ws,
        created_at: createdAt,
        chunks,
      });
    }
  }

  const payload = {
    version: 1,
    workspace: workspace || null,
    exported_at: new Date().toISOString(),
    documents,
  };

  await fsPromises.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf-8');
  return { count: documents.length };
}

async function importWorkspace(db, workspace, sourcePath) {
  if (!db) throw new Error('Database not initialized');
  if (!sourcePath) throw new Error('Source path required');
  const raw = await fsPromises.readFile(sourcePath, 'utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid knowledge pack file');
  }

  const documents = payload.documents || [];
  let imported = 0;
  for (const doc of documents) {
    const id =
      crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
    db.run(
      `
      INSERT INTO documents (id, filename, filepath, content_hash, chunk_count, workspace, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        doc.filename,
        doc.filepath,
        doc.content_hash,
        doc.chunk_count,
        workspace || doc.workspace || null,
        doc.created_at || new Date().toISOString(),
      ],
    );

    for (const chunk of doc.chunks || []) {
      const chunkId =
        crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex');
      db.run(
        `
        INSERT INTO document_chunks (id, document_id, content, embedding, chunk_index)
        VALUES (?, ?, ?, ?, ?)
      `,
        [chunkId, id, chunk.content, chunk.embedding || null, chunk.chunk_index || 0],
      );
    }
    imported += 1;
  }

  return { imported };
}

module.exports = {
  ingestDocument,
  listDocuments,
  deleteDocument,
  searchDocuments,
  exportWorkspace,
  importWorkspace,
};


