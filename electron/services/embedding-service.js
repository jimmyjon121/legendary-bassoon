const http = require('http');
const https = require('https');
const { URL } = require('url');

function makeRequest(url, body, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const req = protocol.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Embedding request timeout'));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
}

async function embedTextsWithOllama(endpoint, texts, modelName = 'nomic-embed-text') {
  const url = `${endpoint.replace(/\/$/, '')}/api/embeddings`;
  const vectors = [];

  for (const text of texts) {
    const res = await makeRequest(url, { model: modelName, prompt: text });
    if (!res?.embedding) {
      throw new Error('Invalid embeddings response from Ollama');
    }
    vectors.push(res.embedding);
  }

  return vectors;
}

// Cosine similarity between two embedding vectors
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  embedTextsWithOllama,
  cosineSimilarity,
};


