import fs from "fs";
import path from "path";

const targets = [
  "src/app/admin/quotes/[id]/page.tsx",
  "src/app/admin/quotes/page.tsx",
  "src/app/api/admin/dashboard/metrics/route.ts",
  "src/app/api/admin/pricing/status/route.ts",
  "src/app/api/admin/quotes/[id]/stage/route.ts",
  "src/app/api/tenant/context/route.ts",
  "src/app/api/tenant/list/route.ts",
  "src/app/api/tenant/me-settings/route.ts",
  "src/app/api/tenant/metrics-week/route.ts",
  "src/app/api/tenant/metrics/route.ts",
  "src/lib/auth/tenant.ts",
  "src/lib/http/cookies.ts",
];

function patchFile(rel) {
  const filePath = path.join(process.cwd(), rel);
  if (!fs.existsSync(filePath)) {
    console.error("Missing:", rel);
    return { rel, changed: false, reason: "missing" };
  }

  const src0 = fs.readFileSync(filePath, "utf8");
  let src = src0;

  // 1) const jar = cookies();  -> const jar = cookies() as any;
  //    let c = cookies();      -> let c = cookies() as any;
  src = src.replace(
    /\b(const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*cookies\(\)\s*;\s*/g,
    (_m, kw, name) => `${kw} ${name} = cookies() as any;\n`
  );

  // 2) cookies().get("x") -> (cookies() as any).get("x")
  src = src.replace(/\bcookies\(\)\.get\s*\(/g, "(cookies() as any).get(");

  const changed = src !== src0;
  if (changed) {
    fs.writeFileSync(filePath + ".bak", src0, "utf8");
    fs.writeFileSync(filePath, src, "utf8");
  }
  return { rel, changed, reason: changed ? "patched" : "no-op" };
}

const results = targets.map(patchFile);
const changed = results.filter(r => r.changed);

console.log("\n=== cookies() patch results ===");
for (const r of results) console.log(`${r.changed ? "✅" : "➖"} ${r.rel} (${r.reason})`);

console.log(`\nChanged ${changed.length}/${results.length} files.`);
console.log("Backups created as *.bak next to each changed file.");
