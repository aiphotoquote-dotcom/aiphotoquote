import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const json = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
          ],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // optional: log / DB
      },
    });

    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: { message: e?.message ?? "Upload handler failed" } },
      { status: 500 }
    );
  }
}
