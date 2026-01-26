const gitModule = require('simple-git');

async function getGit(rootPath) {
  if (!rootPath) throw new Error('rootPath is required for checkpoints');
  return gitModule({ baseDir: rootPath });
}

async function createCheckpoint(rootPath, name = `checkpoint-${Date.now()}`) {
  const git = await getGit(rootPath);
  await git.add('.');
  const result = await git.stash(['push', '-m', name]);
  return { name, result };
}

async function listCheckpoints(rootPath) {
  const git = await getGit(rootPath);
  const list = await git.stashList();
  return list.all.map((entry) => ({
    id: entry.hash,
    message: entry.message,
    index: entry.index,
  }));
}

async function restoreCheckpoint(rootPath, ref = 'stash@{0}', drop = false) {
  const git = await getGit(rootPath);
  await git.stash(['apply', ref]);
  if (drop) {
    await git.stash(['drop', ref]);
  }
  return { restored: ref, dropped: drop };
}

module.exports = {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
};




