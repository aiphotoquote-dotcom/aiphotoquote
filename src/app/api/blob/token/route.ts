import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleUpload } from "@vercel/blob/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        console.log("Blob upload completed:", {
          url: blob.url,
          pathname: blob.pathname,
          contentType: blob.contentType,
          tokenPayload,
        });
      },
    });

    // ✅ Must return a Response
    return NextResponse.json(jsonResponse, { status: 200 });
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
