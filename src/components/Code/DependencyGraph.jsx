import React, { useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { useEditorStore } from '../../stores/editorStore';
import { getIndexedFiles, hasCodeIndex } from '../../services/codeIndexer';

const importPattern = /from ['"](.+?)['"]|require\(['"](.+?)['"]\)/g;

function buildGraph() {
  if (!hasCodeIndex()) return { nodes: [], edges: [] };
  const files = getIndexedFiles();

  const pathToId = (path) => path;

  const nodes = files.map((file, index) => ({
    id: pathToId(file.path),
    data: { label: file.name },
    position: { x: (index % 6) * 180, y: Math.floor(index / 6) * 120 },
  }));

  const pathSet = new Set(files.map((f) => f.path));

  const edges = [];
  files.forEach((file) => {
    const content = file.content || '';
    let match;
    // eslint-disable-next-line no-cond-assign
    while ((match = importPattern.exec(content)) !== null) {
      const raw = match[1] || match[2];
      if (!raw || (!raw.startsWith('.') && !raw.startsWith('/'))) continue;
      const baseDir = file.path.replace(/[\\/][^\\/]+$/, '');
      const targetBase = normalizeImport(baseDir, raw);

      // Try to match by startsWith (ignoring extension differences)
      const targetPath = [...pathSet].find((p) => p.startsWith(targetBase));
      if (targetPath) {
        edges.push({
          id: `${file.path}->${targetPath}-${edges.length}`,
          source: pathToId(file.path),
          target: pathToId(targetPath),
          animated: false,
        });
      }
    }
  });

  return { nodes, edges };
}

function normalizeImport(baseDir, spec) {
  const joined = `${baseDir}/${spec}`.replace(/\\/g, '/');
  const cleaned = joined.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/');
  return cleaned.replace(/\.[^./]+$/, '');
}

export function DependencyGraph() {
  const { rootPath } = useEditorStore((state) => ({
    rootPath: state.rootPath,
  }));

  const graph = useMemo(() => buildGraph(), [rootPath]);

  if (!rootPath) {
    return (
      <div className="border border-dashed border-forge-border rounded-lg p-2 text-[11px] text-text-muted">
        Open a project to see the dependency graph.
      </div>
    );
  }

  if (!graph.nodes.length) {
    return (
      <div className="border border-forge-border rounded-lg p-2 text-[11px] text-text-muted h-48 flex items-center justify-center">
        Dependency graph will appear here after indexing. Use “Map project” to refresh context.
      </div>
    );
  }

  return (
    <div className="border border-forge-border rounded-lg bg-forge-bg/70 h-48 overflow-hidden">
      <ReactFlow nodes={graph.nodes} edges={graph.edges} fitView>
        <Background gap={16} size={0.5} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default DependencyGraph;














