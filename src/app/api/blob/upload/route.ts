import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(name: string) {
  return (name || "upload")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json(
        { ok: false, error: { message: "Missing BLOB_READ_WRITE_TOKEN (Vercel Blob) env var" } },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const raw = form.getAll("files");
    const files = raw.filter((x): x is File => x instanceof File);

    if (!files.length) {
      return NextResponse.json(
        { ok: false, error: { message: "No files provided (expected form field: files)" } },
        { status: 400 }
      );
    }

    const uploaded: Array<{ url: string; pathname: string; contentType: string; size: number }> = [];

    for (const file of files) {
      const ab = await file.arrayBuffer();
      const buf = Buffer.from(ab);

      const filename = `${Date.now()}-${safeName(file.name)}`;
      const pathname = `quotes/${filename}`;
      const contentType = file.type || "application/octet-stream";

      const res = await put(pathname, buf, {
        access: "public",
        contentType,
        token,
      });

      uploaded.push({
        url: res.url,
        pathname,
        contentType,
        size: file.size,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        urls: uploaded.map((x) => x.url),
        files: uploaded,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: { message: e?.message ?? String(e) } },
      { status: 500 }
    );
  }
}
