// scripts/render-worker.ts
/**
 * Local/dev poller that hits the worker endpoint repeatedly.
 *
 * Usage:
 *   APQ_BASE_URL="http://localhost:3000" \
 *   APQ_WORKER_SECRET="..." \
 *   node scripts/render-worker.ts
 *
 * Or on Vercel preview:
 *   APQ_BASE_URL="https://<your-deploy>.vercel.app" \
 *   APQ_WORKER_SECRET="..." \
 *   node scripts/render-worker.ts
 */

const baseUrl = process.env.APQ_BASE_URL || "http://localhost:3000";
const secret = process.env.APQ_WORKER_SECRET || "";

if (!secret) {
  console.error("Missing APQ_WORKER_SECRET");
  process.exit(1);
}

async function tick() {
  const res = await fetch(`${baseUrl}/api/admin/renders/worker`, {
    method: "POST",
    headers: { "x-apq-worker-secret": secret },
  });

  const json = await res.json().catch(() => ({}));
  console.log(new Date().toISOString(), res.status, json);

  // stop if no work
  if (json?.didWork === false) process.exit(0);
}

(async () => {
  // run a few ticks, then exit
  for (let i = 0; i < 20; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.exit(0);
})();