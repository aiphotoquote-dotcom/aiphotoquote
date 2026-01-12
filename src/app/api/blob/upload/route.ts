import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll("files") as File[];

    if (!files?.length) {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION", message: "No files uploaded" } },
        { status: 400 }
      );
    }

    // Basic guardrail: limit file count
    if (files.length > 12) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "VALIDATION", message: "Too many files (max 12)" },
        },
        { status: 400 }
      );
    }

    const uploads = await Promise.all(
      files.map(async (file) => {
        const filename = `${Date.now()}-${file.name}`.replace(/\s+/g, "-");

        const blob = await put(filename, file, {
          access: "public",
          addRandomSuffix: true,
        });

        return {
          url: blob.url,
          pathname: blob.pathname,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        };
      })
    );

    return NextResponse.json({ ok: true, files: uploads });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: { code: "UPLOAD_FAILED", message: e?.message ?? "Upload failed" } },
      { status: 500 }
    );
  }
}
