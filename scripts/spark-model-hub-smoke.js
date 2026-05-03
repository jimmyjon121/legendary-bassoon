#!/usr/bin/env node
/* eslint-disable no-console */

const { SparkModelHubService } = require('../electron/services/spark-model-hub-service');

(async () => {
  const hub = new SparkModelHubService();
  const dash = await hub.getDashboard();
  console.log(JSON.stringify({
    success: dash.success,
    ollama: dash.ollama.health,
    memory: dash.system.memory,
    installedModels: dash.ollama.installed.map((model) => ({
      name: model.name,
      requiredGiB: model.requiredGiB,
      fit: model.fit,
    })),
    lmstudioModels: dash.lmstudio.models.map((model) => ({
      name: model.name,
      sizeLabel: model.sizeLabel,
      isSharded: model.isSharded,
    })),
    continue: dash.continue,
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
