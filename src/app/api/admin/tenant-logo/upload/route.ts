import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json(
        { ok: false, error: "MISSING_FILE", message: "Expected multipart/form-data with field 'file'." },
        400
      );
    }

    if (!file.type || !file.type.startsWith("image/")) {
      return json({ ok: false, error: "INVALID_TYPE", message: "Logo must be an image file." }, 400);
    }

    if (file.size > MAX_BYTES) {
      return json({ ok: false, error: "TOO_LARGE", message: "Logo must be <= 2MB." }, 400);
    }

    const ext =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "image/svg+xml"
            ? "svg"
            : file.type === "image/jpeg"
              ? "jpg"
              : "img";

    const pathname = `tenant-logos/${gate.tenantId}/${Date.now()}.${ext}`;

    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type,
    });

    return json({
      ok: true,
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType,
      size: file.size,
    });
  } catch (e: any) {
    return json({ ok: false, error: "UPLOAD_FAILED", message: e?.message ?? String(e) }, 500);
  }
}