import fs from "node:fs";

const target = "src/app/admin/quotes/[id]/page.tsx";
const filePath = new URL("../" + target, import.meta.url);
const src0 = fs.readFileSync(filePath, "utf8");

// --- helpers
function bail(msg) {
  console.error(msg);
  process.exit(1);
}

// We’ll do 2 targeted, robust replacements:
//  A) Replace the current "Header" block (the first big header section)
//  B) Enhance the Photos section card rendering (label badge + nicer footer)

let src = src0;

// --------------------
// A) Sticky header/action bar
// --------------------

// Find the header block we expect (from your current file):
// It starts with: {/* Header */}
// and contains: <Link href="/admin/quotes" ...>Back to list</Link>
const headerRe =
  /\{\/\*\s*Header\s*\*\/\}[\s\S]*?<div className="mt-6 grid gap-6 lg:grid-cols-3">/m;

if (!headerRe.test(src)) {
  bail(
    `Couldn't find the Header block in ${target}.\n` +
      `Search for "{/* Header */}" and the grid "<div className=\\"mt-6 grid gap-6 lg:grid-cols-3\\">".`
  );
}

// This block ends right before your grid layout starts.
// We'll replace header with a sticky action bar + compact header summary.
const headerReplacement = String.raw`
      {/* Sticky action bar */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/90 sm:-mx-6 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href="/admin/quotes"
                className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                ← Back
              </Link>

              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className={stageChip(stage)}>Stage: {stageLabel(stage)}</span>
                <span className={renderChip(renderStatus)}>
                  Render: {renderStatus.replaceAll("_", " ")}
                </span>
                {!row.isRead ? (
                  <span
                    className={cn(
                      chipBase(),
                      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
                    )}
                  >
                    Unread
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {lead.phoneDigits ? (
                <>
                  <a
                    className="hidden sm:inline-flex rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                    href={\`tel:\${lead.phoneDigits}\`}
                  >
                    Call
                  </a>
                  <a
                    className="hidden sm:inline-flex rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                    href={\`sms:\${lead.phoneDigits}\`}
                  >
                    Text
                  </a>
                </>
              ) : null}

              {lead.email ? (
                <a
                  className="hidden sm:inline-flex rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                  href={\`mailto:\${lead.email}\`}
                >
                  Email
                </a>
              ) : null}

              <CopyButton text={row.id} label="Copy ID" />
            </div>
          </div>
        </div>
      </div>

      {/* Title */}
      <div className="mt-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">{pageTitle}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
            <span>Submitted: {prettyDate(submittedAt)}</span>
            <span className="text-gray-300 dark:text-gray-700">•</span>
            <span className="font-mono text-xs">{row.id}</span>
          </div>

          {(lead.phone || lead.email) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {lead.phone ? (
                <a
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                  href={\`tel:\${lead.phoneDigits ?? ""}\`}
                >
                  📞 <span className="font-semibold">{lead.phone}</span>
                </a>
              ) : null}

              {lead.email ? (
                <a
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                  href={\`mailto:\${lead.email}\`}
                >
                  ✉️ <span className="font-semibold">{lead.email}</span>
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
`;

src = src.replace(headerRe, headerReplacement);

// --------------------
// B) Photos section: add label badge and footer improvements
// --------------------
const photoCardRe = /<a\s+key=\{`\$\{img\.url\}-\$\{idx\}`\}[\s\S]*?<\/a>\s*\)\}\s*<\/div>/m;

if (!photoCardRe.test(src)) {
  // Not fatal — your photos section might differ, but we want to know.
  console.warn(
    `Warning: Could not find the expected photo card block to enhance in ${target}.\n` +
      `If photos still look plain, paste the Photos section and I'll adapt the script.`
  );
} else {
  const improvedPhotoCard = String.raw`
                  {images.map((img, idx) => (
                    <a
                      key={\`\${img.url}-\${idx}\`}
                      href={img.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950"
                    >
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={\`photo \${idx + 1}\`}
                          className="h-56 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        />

                        <div className="absolute left-3 top-3 inline-flex items-center rounded-full bg-black/80 px-2.5 py-1 text-xs font-semibold text-white">
                          {img.shotType ? \`Label: \${img.shotType}\` : "Photo"}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 p-3">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          Photo {idx + 1}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300">
                          Open →
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
`;
  src = src.replace(photoCardRe, improvedPhotoCard);
}

// write backup + new
fs.writeFileSync(filePath + ".bak", src0, "utf8");
fs.writeFileSync(filePath, src, "utf8");

console.log("Updated:", target);
console.log("Backup :", target + ".bak");
