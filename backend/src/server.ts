import { buildApp } from "./app.js";
import { getConfig, isAgentBriefAiLive } from "./config.js";
import { closePool } from "./db.js";
import { startWorker } from "./worker.js";

const config = getConfig();
const app = await buildApp();
const stopWorker = startWorker();
app.log.info({
  agentBriefMode: config.AGENT_BRIEF_MODE,
  agentBriefAiLive: isAgentBriefAiLive(config),
}, "Route brief interpreter ready");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  stopWorker();
  await app.close();
  await closePool();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  stopWorker();
  await closePool();
  process.exitCode = 1;
}
