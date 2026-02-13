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
    let res;
    try {
      res = await makeRequest(url, { model: modelName, prompt: text });
    } catch (err) {
      // Network error or Ollama not running - return empty to degrade gracefully
      console.warn(`[Embedding] Request failed (model=${modelName}): ${err.message}`);
      return [];
    }

    if (!res?.embedding) {
      // Model might not be pulled or returned unexpected format
      const hint = res?.error || 'no embedding field in response';
      console.warn(`[Embedding] Invalid response from Ollama (model=${modelName}): ${hint}`);
      return [];
    }
    vectors.push(res.embedding);
  }

  return vectors;
}

async function embedTextsWithOpenVino(endpoint, texts, modelName = '') {
  const base = String(endpoint || '').replace(/\/$/, '');
  if (!base) return [];

  const url = `${base}/embed`;
  let response;
  try {
    response = await makeRequest(
      url,
      {
        texts,
        model: modelName || undefined,
      },
      45000,
    );
  } catch (error) {
    console.warn(`[Embedding] OpenVINO request failed: ${error.message}`);
    return [];
  }

  const embeddings = Array.isArray(response?.embeddings) ? response.embeddings : [];
  if (embeddings.length !== texts.length) {
    const count = Number(response?.count || 0);
    console.warn(
      `[Embedding] OpenVINO embed returned ${embeddings.length} vectors for ${texts.length} text(s) (reported count=${count}).`,
    );
    return [];
  }

  return embeddings;
}

async function embedTextsWithRouting({
  texts = [],
  ollamaEndpoint = 'http://127.0.0.1:11434',
  openvinoEndpoint = 'http://127.0.0.1:8081',
  modelName = 'nomic-embed-text',
  preferNpu = true,
} = {}) {
  const safeTexts = Array.isArray(texts)
    ? texts.map((item) => String(item || '')).filter(Boolean)
    : [];

  if (safeTexts.length === 0) {
    return {
      vectors: [],
      route: null,
      fallbackReason: 'no-texts',
    };
  }

  if (preferNpu) {
    const npuVectors = await embedTextsWithOpenVino(openvinoEndpoint, safeTexts, modelName);
    if (npuVectors.length === safeTexts.length) {
      return {
        vectors: npuVectors,
        route: 'openvino-npu',
        fallbackReason: null,
      };
    }
  }

  const ollamaVectors = await embedTextsWithOllama(ollamaEndpoint, safeTexts, modelName);
  if (ollamaVectors.length === safeTexts.length) {
    return {
      vectors: ollamaVectors,
      route: 'ollama',
      fallbackReason: preferNpu ? 'openvino-unavailable-or-invalid' : null,
    };
  }

  return {
    vectors: [],
    route: null,
    fallbackReason: preferNpu
      ? 'openvino-and-ollama-failed'
      : 'ollama-failed',
  };
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
  embedTextsWithOpenVino,
  embedTextsWithRouting,
  cosineSimilarity,
};

