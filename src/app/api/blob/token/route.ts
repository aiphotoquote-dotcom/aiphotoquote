import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleUpload } from "@vercel/blob/client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const jsonResponse = await handleUpload({
      request,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,

      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        return {
          addRandomSuffix: true,
          allowedContentTypes: ["image/*"],
          maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
          tokenPayload: clientPayload,
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Don't reference blob.size; your SDK type doesn't include it.
        console.log("Blob upload completed:", {
          url: blob.url,
          pathname: blob.pathname,
          contentType: blob.contentType,
          tokenPayload,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err: any) {
    console.error("BLOB_TOKEN_ROUTE_ERROR", err);
    return NextResponse.json(
      {
        ok: false,
        error: "BLOB_TOKEN_ROUTE_ERROR",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
