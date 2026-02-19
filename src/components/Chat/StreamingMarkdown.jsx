import { useMemo, memo, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * StreamingMarkdown - Renders markdown incrementally during streaming.
 * 
 * The key insight: instead of the old approach (basic HTML escaping during stream,
 * full markdown only after), we parse markdown on EVERY render but handle incomplete
 * blocks gracefully. This gives us bold, links, lists, code blocks, math etc. LIVE
 * while the model is typing -- just like ChatGPT and Claude.
 * 
 * Strategy:
 * 1. Detect and protect incomplete blocks (unclosed ``` or $$)
 * 2. Parse the "safe" portion with full marked
 * 3. Append the "pending" portion as raw text with a blinking cursor
 * 4. Render KaTeX for math blocks
 */

// Custom marked renderer with copy buttons on code blocks
function createRenderer() {
  const renderer = new marked.Renderer();

  renderer.code = function (code, language) {
    const token = code && typeof code === 'object' ? code : null;
    const rawCode =
      typeof code === 'string'
        ? code
        : (token?.text ?? token?.raw ?? String(code ?? ''));
    const langFromArg = typeof language === 'string' ? language : '';
    const langFromToken = typeof token?.lang === 'string'
      ? token.lang
      : (typeof token?.language === 'string' ? token.language : '');
    const lang = (langFromArg || langFromToken).replace(/[^\w.+-]/g, '');

    let highlighted;
    if (lang && hljs.getLanguage(lang)) {
      try { highlighted = hljs.highlight(rawCode, { language: lang }).value; }
      catch { highlighted = hljs.highlightAuto(rawCode).value; }
    } else {
      highlighted = hljs.highlightAuto(rawCode).value;
    }

    const encoded = rawCode
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<div class="code-block-wrapper relative group/code my-3">
      <div class="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-white/[0.04]">
        <div class="flex items-center gap-2">
          <div class="flex gap-1.5">
            <div class="w-2.5 h-2.5 rounded-full bg-white/[0.06]"></div>
            <div class="w-2.5 h-2.5 rounded-full bg-white/[0.06]"></div>
            <div class="w-2.5 h-2.5 rounded-full bg-white/[0.06]"></div>
          </div>
          <span class="text-[10px] text-white/35 font-mono ml-1">${lang || 'text'}</span>
        </div>
        <button class="copy-code-btn text-[10px] px-2.5 py-1 rounded-md text-white/35 hover:text-white/80 hover:bg-white/[0.06] transition-colors font-medium" data-code="${encoded}">Copy</button>
      </div>
      <pre class="!mt-0 !rounded-t-none !py-3.5 !px-4"><code class="language-${lang}" data-highlighted="true">${highlighted}</code></pre>
    </div>`;
  };

  return renderer;
}

const streamingRenderer = createRenderer();
const finalRenderer = createRenderer();

// Configure two instances of marked settings
const streamingMarkedOptions = {
  renderer: streamingRenderer,
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
};

const finalMarkedOptions = {
  renderer: finalRenderer,
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
};

/**
 * Render LaTeX math expressions.
 * Handles both block math ($$..$$) and inline math ($..$ or \(...\) or \[...\])
 */
function renderMath(html) {
  if (!html) return html;

  // Block math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<span class="text-red-400">Math error: ${math}</span>`;
    }
  });

  // Block math: \[...\]
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<span class="text-red-400">Math error: ${math}</span>`;
    }
  });

  // Inline math: $...$ (but not $$)
  html = html.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code>${math}</code>`;
    }
  });

  // Inline math: \(...\)
  html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code>${math}</code>`;
    }
  });

  return html;
}

/**
 * Split streaming content into a "safe" parsed portion and a "pending" tail.
 * The pending tail is content in an incomplete block (unclosed ```, $$, etc.)
 */
function splitStreamingContent(content) {
  if (!content) return { safe: '', pending: '' };

  // Check for unclosed code fences
  const fenceMatches = content.match(/```/g);
  const fenceCount = fenceMatches ? fenceMatches.length : 0;

  if (fenceCount % 2 !== 0) {
    // We have an unclosed code fence
    const lastFenceIdx = content.lastIndexOf('```');
    return {
      safe: content.substring(0, lastFenceIdx),
      pending: content.substring(lastFenceIdx),
    };
  }

  // Check for unclosed block math
  const blockMathOpen = (content.match(/\$\$/g) || []).length;
  if (blockMathOpen % 2 !== 0) {
    const lastMathIdx = content.lastIndexOf('$$');
    return {
      safe: content.substring(0, lastMathIdx),
      pending: content.substring(lastMathIdx),
    };
  }

  // All blocks are closed, everything is safe to parse
  return { safe: content, pending: '' };
}

/**
 * Parse markdown content (safe portion) to HTML
 */
function parseMarkdown(content, isStreaming) {
  if (!content) return '';

  const opts = isStreaming ? streamingMarkedOptions : finalMarkedOptions;
  try {
    let html = marked.parse(content, opts);
    // Render math expressions
    html = renderMath(html);
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['span', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'mtable', 'mtr', 'mtd', 'annotation'],
      ADD_ATTR: ['class', 'style', 'aria-hidden', 'data-code', 'encoding', 'xmlns'],
    });
  } catch (e) {
    console.warn('[StreamingMarkdown] Parse error:', e);
    return DOMPurify.sanitize(content);
  }
}

/**
 * Format the pending (incomplete) block for display.
 * Shows it as raw pre-formatted text with syntax context.
 */
function formatPending(pending) {
  if (!pending) return '';

  const escaped = pending
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // If it starts with ``` it's an incomplete code block
  if (pending.startsWith('```')) {
    const langMatch = pending.match(/^```(\w*)\n?/);
    const lang = langMatch?.[1] || '';
    const codeContent = pending.substring(pending.indexOf('\n') + 1);
    const escapedCode = codeContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<div class="code-block-wrapper relative my-3">
      <div class="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-white/[0.04]">
        <div class="flex items-center gap-2">
          <div class="flex gap-1.5">
            <div class="w-2.5 h-2.5 rounded-full bg-white/[0.06]"></div>
            <div class="w-2.5 h-2.5 rounded-full bg-white/[0.06]"></div>
            <div class="w-2.5 h-2.5 rounded-full bg-white/[0.06]"></div>
          </div>
          <span class="text-[10px] text-white/35 font-mono ml-1">${lang || 'text'}</span>
        </div>
        <span class="text-[10px] text-cyan-400/50 animate-pulse font-medium">writing...</span>
      </div>
      <pre class="!mt-0 !rounded-t-none !py-3.5 !px-4"><code>${escapedCode}</code></pre>
    </div>`;
  }

  // If it starts with $$ it's an incomplete math block
  if (pending.startsWith('$$')) {
    return `<div class="my-2 p-3 bg-black/20 rounded-lg border border-white/5 font-mono text-sm text-white/70">${escaped}<span class="animate-pulse text-cyan-400">|</span></div>`;
  }

  // Otherwise just show as inline text
  return escaped.replace(/\n/g, '<br/>');
}

/**
 * StreamingMarkdown component
 * 
 * Renders markdown content, handling both streaming and final states.
 * During streaming: incrementally parses safe portions, shows pending blocks
 * After streaming: full marked parse with KaTeX, code highlighting, etc.
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  isStreaming = false,
  className = '',
}) {
  const handleMarkdownClick = useCallback(async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copyButton = target.closest('.copy-code-btn');
    if (!copyButton) return;

    event.preventDefault();
    const code = copyButton.getAttribute('data-code');
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      const previousText = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        if (copyButton.isConnected) {
          copyButton.textContent = previousText || 'Copy';
        }
      }, 1500);
    } catch {
      copyButton.textContent = 'Failed';
      setTimeout(() => {
        if (copyButton.isConnected) {
          copyButton.textContent = 'Copy';
        }
      }, 1500);
    }
  }, []);

  const htmlContent = useMemo(() => {
    if (!content) return '';

    if (!isStreaming) {
      // Final render: parse everything
      return parseMarkdown(content, false);
    }

    // Streaming: split into safe + pending
    const { safe, pending } = splitStreamingContent(content);

    let html = '';
    if (safe) {
      html += parseMarkdown(safe, true);
    }
    if (pending) {
      html += formatPending(pending);
    }

    return html;
  }, [content, isStreaming]);

  if (!content) return null;

  return (
    <div
      className={`prose prose-sm prose-invert max-w-none streaming-markdown ${className}`}
      onClick={handleMarkdownClick}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
});

export default StreamingMarkdown;
