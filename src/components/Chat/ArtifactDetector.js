/**
 * ArtifactDetector - Utility to detect renderable content in LLM responses
 * 
 * Identifies code blocks that can be rendered as live previews:
 * - HTML/SVG - Rendered in sandboxed iframe
 * - Mermaid - Rendered as diagrams using mermaid.js
 * - React/JSX - Rendered with live React component preview
 * - CSS - Rendered with visual output
 */

// Supported artifact types with their configurations
export const ARTIFACT_TYPES = {
  html: {
    name: 'HTML',
    icon: 'Code2',
    color: 'text-orange-400',
    bg: 'bg-orange-500/20',
    languages: ['html', 'htm'],
    canRender: true,
  },
  svg: {
    name: 'SVG',
    icon: 'Image',
    color: 'text-green-400',
    bg: 'bg-green-500/20',
    languages: ['svg'],
    canRender: true,
  },
  mermaid: {
    name: 'Mermaid Diagram',
    icon: 'GitBranch',
    color: 'text-pink-400',
    bg: 'bg-pink-500/20',
    languages: ['mermaid'],
    canRender: true,
  },
  react: {
    name: 'React Component',
    icon: 'Atom',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/20',
    languages: ['jsx', 'tsx', 'react'],
    canRender: true, // Requires special handling
  },
  css: {
    name: 'CSS',
    icon: 'Palette',
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
    languages: ['css', 'scss', 'sass', 'less'],
    canRender: true, // Shows with HTML wrapper
  },
  markdown: {
    name: 'Markdown',
    icon: 'FileText',
    color: 'text-gray-400',
    bg: 'bg-gray-500/20',
    languages: ['md', 'markdown'],
    canRender: true,
  },
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeScriptTagBreakout(value = '') {
  return String(value).replace(/<\/script/gi, '<\\/script');
}

/**
 * Extract code blocks from markdown content
 * Returns array of { language, code, startIndex, endIndex }
 */
export function extractCodeBlocks(content) {
  if (!content || typeof content !== 'string') return [];
  
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1].toLowerCase() || 'text';
    const code = match[2].trim();
    
    blocks.push({
      language,
      code,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      raw: match[0],
    });
  }
  
  return blocks;
}

/**
 * Detect artifact type from language identifier
 */
export function getArtifactType(language) {
  const lang = language?.toLowerCase() || '';
  
  for (const [type, config] of Object.entries(ARTIFACT_TYPES)) {
    if (config.languages.includes(lang)) {
      return { type, ...config };
    }
  }
  
  return null;
}

/**
 * Check if a code block can be rendered as an artifact
 */
export function isRenderableArtifact(language) {
  const artifactType = getArtifactType(language);
  return artifactType?.canRender === true;
}

/**
 * Detect all artifacts in a message
 * Returns array of artifact objects with type, code, and metadata
 */
export function detectArtifacts(content) {
  const codeBlocks = extractCodeBlocks(content);
  const artifacts = [];
  
  for (const block of codeBlocks) {
    const artifactType = getArtifactType(block.language);
    
    if (artifactType?.canRender) {
      artifacts.push({
        id: `artifact-${block.startIndex}`,
        type: artifactType.type,
        typeName: artifactType.name,
        icon: artifactType.icon,
        color: artifactType.color,
        bg: artifactType.bg,
        language: block.language,
        code: block.code,
        startIndex: block.startIndex,
        endIndex: block.endIndex,
      });
    }
  }
  
  return artifacts;
}

/**
 * Get the first renderable artifact (for quick preview)
 */
export function getFirstArtifact(content) {
  const artifacts = detectArtifacts(content);
  return artifacts[0] || null;
}

/**
 * Check if content has any renderable artifacts
 */
export function hasArtifacts(content) {
  return detectArtifacts(content).length > 0;
}

/**
 * Prepare HTML content for safe iframe rendering
 * Wraps code in a complete HTML document with styling
 */
export function prepareHtmlForIframe(code, type = 'html') {
  const content = String(code || '');

  // If it's already a complete HTML document, return as-is
  if (content.toLowerCase().includes('<!doctype') || content.toLowerCase().includes('<html')) {
    return content;
  }
  
  // SVG can be rendered directly
  if (type === 'svg') {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      min-height: 100vh;
      background: #1a1a2e;
      padding: 20px;
    }
    svg { max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }
  
  // CSS gets a demo wrapper
  if (type === 'css') {
    const safeCss = content.replace(/<\/style/gi, '<\\/style');
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: #1a1a2e;
      color: #fff;
      font-family: system-ui, sans-serif;
      padding: 20px;
    }
    ${safeCss}
  </style>
</head>
<body>
  <div class="demo-content">
    <h1>CSS Preview</h1>
    <p>This is a paragraph with your styles applied.</p>
    <button>Sample Button</button>
    <div class="box">Sample Box</div>
  </div>
</body>
</html>`;
  }
  
  // HTML fragment gets wrapped
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: #1a1a2e;
      color: #fff;
      font-family: system-ui, sans-serif;
      padding: 20px;
    }
    a { color: #60a5fa; }
    button { 
      padding: 8px 16px; 
      background: #3b82f6; 
      color: white; 
      border: none; 
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { background: #2563eb; }
    input, textarea {
      padding: 8px 12px;
      border: 1px solid #374151;
      border-radius: 6px;
      background: #1f2937;
      color: white;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}

/**
 * Prepare React/JSX code for rendering
 * Returns an HTML document with React loaded via CDN
 */
export function prepareReactForIframe(code) {
  const safeCode = escapeScriptTagBreakout(code || '');
  // Try to extract the component name
  const componentMatch = safeCode.match(/(?:function|const|class)\s+(\w+)/);
  const componentName = componentMatch ? componentMatch[1] : 'App';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: #1a1a2e;
      color: #fff;
      font-family: system-ui, sans-serif;
      padding: 20px;
    }
    .error { color: #ef4444; padding: 20px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    try {
      ${safeCode}
      
      // Try to render the component
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(${componentName}));
    } catch (error) {
      document.getElementById('root').innerHTML = '<div class="error">Error: ' + error.message + '</div>';
    }
  </script>
</body>
</html>`;
}

/**
 * Prepare Mermaid code for rendering
 * Returns HTML with mermaid.js loaded
 */
export function prepareMermaidForIframe(code) {
  const safeCode = escapeHtml(code || '');
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #1a1a2e;
      padding: 20px;
    }
    .mermaid { 
      background: transparent;
    }
    .error { color: #ef4444; padding: 20px; }
  </style>
</head>
<body>
  <pre class="mermaid">
${safeCode}
  </pre>
  <script>
    mermaid.initialize({ 
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#3b82f6',
        primaryTextColor: '#fff',
        primaryBorderColor: '#60a5fa',
        lineColor: '#6b7280',
        secondaryColor: '#1f2937',
        tertiaryColor: '#111827',
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Prepare markdown for rendering
 */
export function prepareMarkdownForIframe(code) {
  const markdownJson = JSON.stringify(String(code || '')).replace(/</g, '\\u003c');
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: #1a1a2e;
      color: #e5e7eb;
      font-family: system-ui, sans-serif;
      padding: 20px;
      line-height: 1.6;
    }
    h1, h2, h3 { color: #fff; margin-top: 1em; }
    a { color: #60a5fa; }
    code { 
      background: #374151; 
      padding: 2px 6px; 
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre { 
      background: #1f2937; 
      padding: 12px; 
      border-radius: 8px;
      overflow-x: auto;
    }
    pre code { background: transparent; padding: 0; }
    blockquote {
      border-left: 3px solid #3b82f6;
      padding-left: 12px;
      color: #9ca3af;
      margin: 1em 0;
    }
  </style>
</head>
<body>
  <div id="content"></div>
  <script type="application/json" id="markdown-source">${markdownJson}</script>
  <script>
    const source = document.getElementById('markdown-source');
    const markdown = source ? JSON.parse(source.textContent || '""') : '';
    document.getElementById('content').innerHTML = marked.parse(markdown);
  </script>
</body>
</html>`;
}

/**
 * Get prepared iframe content for any artifact type
 */
export function prepareArtifactForIframe(artifact) {
  if (!artifact?.code) return '';
  
  switch (artifact.type) {
    case 'html':
      return prepareHtmlForIframe(artifact.code, 'html');
    case 'svg':
      return prepareHtmlForIframe(artifact.code, 'svg');
    case 'css':
      return prepareHtmlForIframe(artifact.code, 'css');
    case 'react':
      return prepareReactForIframe(artifact.code);
    case 'mermaid':
      return prepareMermaidForIframe(artifact.code);
    case 'markdown':
      return prepareMarkdownForIframe(artifact.code);
    default:
      return prepareHtmlForIframe(artifact.code, 'html');
  }
}

export default {
  ARTIFACT_TYPES,
  extractCodeBlocks,
  getArtifactType,
  isRenderableArtifact,
  detectArtifacts,
  getFirstArtifact,
  hasArtifacts,
  prepareArtifactForIframe,
};
