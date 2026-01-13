import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleUpload } from "@vercel/blob/client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Vercel's upload() calls this route with a JSON body.
    const body = await request.json();

    // handleUpload() returns the correct JSON response for the client,
    // including the short-lived clientToken.
    const jsonResponse = await handleUpload({
      request,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Lock uploads down to images and cap size (adjust as you want)
        return {
          addRandomSuffix: true,
          allowedContentTypes: ["image/*"],
          maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
          tokenPayload: clientPayload, // echoes payload back on completion
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Optional: this runs after upload completes (in production).
        // Great place to log/store blob.url in DB.
        console.log("Blob upload completed:", {
          url: blob.url,
          pathname: blob.pathname,
          contentType: blob.contentType,
          size: blob.size,
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
