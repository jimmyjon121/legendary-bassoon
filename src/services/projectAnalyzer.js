import { api } from '../utils/electronAPI';
import { getGitStatus } from './gitService';

function countFiles(nodes = [], accumulator = { files: 0, directories: 0 }) {
  nodes.forEach((node) => {
    if (node.type === 'file') {
      accumulator.files += 1;
    } else if (node.type === 'dir') {
      accumulator.directories += 1;
      countFiles(node.children || [], accumulator);
    }
  });
  return accumulator;
}

function detectStacks(pkgJson) {
  if (!pkgJson) return [];
  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const stacks = [];
  if (deps.react) stacks.push('React');
  if (deps['@tanstack/react-query']) stacks.push('React Query');
  if (deps.typescript) stacks.push('TypeScript');
  if (deps.tailwindcss) stacks.push('Tailwind');
  if (deps['electron']) stacks.push('Electron');
  if (deps['zustand']) stacks.push('Zustand');
  return stacks;
}

export async function analyzeProjectStructure(rootPath) {
  if (!rootPath) return null;

  await api.grantFsRoot(rootPath, 'project-analyzer-root');

  if (api.analyzeProject) {
    const remote = await api.analyzeProject(rootPath);
    if (remote && !remote.error) {
      return remote;
    }
  }

  const [scanResult, git] = await Promise.all([
    api.scanProject(rootPath, { maxDepth: 4 }),
    getGitStatus(rootPath),
  ]);

  let pkgJson = null;
  try {
    const pkgContent = await api.readFileScoped(`${rootPath}/package.json`, rootPath);
    pkgJson = JSON.parse(pkgContent || '{}');
  } catch (error) {
    // ignore
  }

  const counts = countFiles(scanResult?.tree || []);
  return {
    rootPath,
    branch: git?.branch || 'main',
    gitStatus: git?.files?.length ? 'dirty' : 'clean',
    ahead: git?.ahead ?? 0,
    behind: git?.behind ?? 0,
    fileCount: counts.files,
    directoryCount: counts.directories,
    stacks: detectStacks(pkgJson),
    scripts: Object.keys(pkgJson?.scripts || {}),
    dependencies: Object.keys(pkgJson?.dependencies || {}),
    devDependencies: Object.keys(pkgJson?.devDependencies || {}),
    lastAnalyzed: Date.now(),
  };
}

export default {
  analyzeProjectStructure,
};
