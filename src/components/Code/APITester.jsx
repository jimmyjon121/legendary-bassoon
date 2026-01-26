import React, { useState, useCallback } from 'react';
import { Globe, Send, Clock, CheckCircle2, XCircle, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_COLORS = {
  GET: 'text-green-400',
  POST: 'text-blue-400',
  PUT: 'text-yellow-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
};

export function APITester() {
  const [url, setUrl] = useState('http://localhost:3000/api/');
  const [method, setMethod] = useState('GET');
  const [headers, setHeaders] = useState([{ key: 'Content-Type', value: 'application/json' }]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [history, setHistory] = useState([]);

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }]);
  };

  const removeHeader = (index) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const updateHeader = (index, field, value) => {
    const newHeaders = [...headers];
    newHeaders[index][field] = value;
    setHeaders(newHeaders);
  };

  const sendRequest = useCallback(async () => {
    if (!url.trim()) return;
    setIsLoading(true);
    setResponse(null);

    const startTime = Date.now();

    try {
      const headerObj = {};
      headers.forEach(h => {
        if (h.key.trim()) headerObj[h.key] = h.value;
      });

      const options = {
        method,
        headers: headerObj,
      };

      if (['POST', 'PUT', 'PATCH'].includes(method) && body.trim()) {
        options.body = body;
      }

      const res = await fetch(url, options);
      const duration = Date.now() - startTime;

      let responseBody;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseBody = await res.json();
      } else {
        responseBody = await res.text();
      }

      const result = {
        status: res.status,
        statusText: res.statusText,
        duration,
        headers: Object.fromEntries(res.headers.entries()),
        body: responseBody,
        ok: res.ok,
      };

      setResponse(result);

      // Add to history
      setHistory(prev => [{
        url,
        method,
        status: res.status,
        duration,
        timestamp: Date.now(),
      }, ...prev].slice(0, 10));

    } catch (error) {
      setResponse({
        error: true,
        message: error.message,
        duration: Date.now() - startTime,
      });
    }

    setIsLoading(false);
  }, [url, method, headers, body]);

  const loadFromHistory = (item) => {
    setUrl(item.url);
    setMethod(item.method);
  };

  return (
    <div className="bg-forge-surface/50 rounded-lg border border-forge-border/30 p-3 flex flex-col gap-3">
      <h3 className="text-xs font-medium text-forge-text-muted flex items-center gap-1.5">
        <Globe size={12} />
        API Tester
      </h3>

      {/* URL and method */}
      <div className="flex gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className={`bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-1 text-xs font-medium ${METHOD_COLORS[method]} focus:outline-none`}
        >
          {METHODS.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
          placeholder="https://api.example.com/endpoint"
          className="flex-1 bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-1 text-xs text-forge-text placeholder:text-forge-text-muted/50 focus:outline-none focus:border-workspace-code/50"
        />
        <button
          onClick={sendRequest}
          disabled={isLoading || !url.trim()}
          className="px-3 py-1 bg-workspace-code/20 hover:bg-workspace-code/30 text-workspace-code rounded text-xs disabled:opacity-50 flex items-center gap-1"
        >
          <Send size={12} />
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Headers toggle */}
      <button
        onClick={() => setShowHeaders(!showHeaders)}
        className="flex items-center gap-1 text-xs text-forge-text-muted hover:text-forge-text"
      >
        {showHeaders ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Headers ({headers.length})
      </button>

      {showHeaders && (
        <div className="space-y-1 pl-3">
          {headers.map((h, i) => (
            <div key={i} className="flex gap-1">
              <input
                type="text"
                value={h.key}
                onChange={(e) => updateHeader(i, 'key', e.target.value)}
                placeholder="Header"
                className="flex-1 bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-0.5 text-xs text-forge-text"
              />
              <input
                type="text"
                value={h.value}
                onChange={(e) => updateHeader(i, 'value', e.target.value)}
                placeholder="Value"
                className="flex-1 bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-0.5 text-xs text-forge-text"
              />
              <button onClick={() => removeHeader(i)} className="text-red-400 hover:text-red-300">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button onClick={addHeader} className="text-xs text-workspace-code hover:underline flex items-center gap-1">
            <Plus size={10} /> Add header
          </button>
        </div>
      )}

      {/* Body toggle (for POST/PUT/PATCH) */}
      {['POST', 'PUT', 'PATCH'].includes(method) && (
        <>
          <button
            onClick={() => setShowBody(!showBody)}
            className="flex items-center gap-1 text-xs text-forge-text-muted hover:text-forge-text"
          >
            {showBody ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Body
          </button>
          {showBody && (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{"key": "value"}'
              rows={4}
              className="bg-forge-bg/50 border border-forge-border/30 rounded px-2 py-1 text-xs text-forge-text font-mono resize-none focus:outline-none focus:border-workspace-code/50"
            />
          )}
        </>
      )}

      {/* Response */}
      {response && (
        <div className="bg-forge-bg/30 rounded p-2 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            {response.error ? (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle size={12} /> Error
              </span>
            ) : (
              <span className={`flex items-center gap-1 ${response.ok ? 'text-green-400' : 'text-yellow-400'}`}>
                <CheckCircle2 size={12} /> {response.status} {response.statusText}
              </span>
            )}
            <span className="text-forge-text-muted flex items-center gap-1">
              <Clock size={10} /> {response.duration}ms
            </span>
          </div>
          
          <pre className="text-xs text-forge-text font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
            {response.error 
              ? response.message
              : typeof response.body === 'object' 
                ? JSON.stringify(response.body, null, 2)
                : response.body
            }
          </pre>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="border-t border-forge-border/20 pt-2">
          <p className="text-xs text-forge-text-muted mb-1">Recent</p>
          <div className="space-y-0.5">
            {history.slice(0, 5).map((item, i) => (
              <button
                key={i}
                onClick={() => loadFromHistory(item)}
                className="flex items-center gap-2 w-full text-left text-xs hover:bg-forge-bg/30 rounded px-1 py-0.5"
              >
                <span className={`font-medium ${METHOD_COLORS[item.method]}`}>{item.method}</span>
                <span className="text-forge-text truncate flex-1">{item.url}</span>
                <span className="text-forge-text-muted">{item.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default APITester;













