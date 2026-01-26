import { api } from '../utils/electronAPI';

const fallbackStatus = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
};

export async function getGitStatus(rootPath) {
  if (!rootPath) return fallbackStatus;
  const status = await api.getGitStatus?.(rootPath);
  return status || fallbackStatus;
}

export async function stageFile(rootPath, filePath) {
  if (!rootPath || !filePath || !api.stageGitFile) return { success: false };
  return api.stageGitFile(rootPath, filePath);
}

export async function commitChanges(rootPath, message) {
  if (!rootPath || !message || !api.commitGitChanges) return { success: false };
  return api.commitGitChanges(rootPath, message);
}

export default {
  getGitStatus,
  stageFile,
  commitChanges,
};













