const gitModule = require('simple-git');

async function getGit(rootPath) {
  if (!rootPath) {
    throw new Error('rootPath is required for git operations');
  }
  return gitModule({ baseDir: rootPath });
}

async function status(rootPath) {
  const git = await getGit(rootPath);
  return git.status();
}

async function checkpoint(rootPath, name = `checkpoint-${Date.now()}`) {
  const git = await getGit(rootPath);
  await git.add('.');
  const message = `[checkpoint] ${name}`;
  await git.commit(message);
  return { message };
}

async function commit(rootPath, message) {
  const git = await getGit(rootPath);
  await git.add('.');
  const result = await git.commit(message);
  return result;
}

module.exports = {
  status,
  checkpoint,
  commit,
};




