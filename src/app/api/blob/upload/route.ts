// src/app/api/blob/upload/route.ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function POST(request: Request) {
  // IMPORTANT:
  // This route is NOT a multipart endpoint anymore.
  // It is a JSON handshake endpoint used by @vercel/blob/client upload().
  const body = (await request.json()) as HandleUploadBody;

  return handleUpload({
    request,
    body,

    // Decide what’s allowed BEFORE issuing an upload token
    onBeforeGenerateToken: async (pathname: string /*, clientPayload */) => {
      // You can add tenant-based rules here later (read tenantSlug from clientPayload if you want).
      return {
        allowedContentTypes: ALLOWED,
        tokenPayload: JSON.stringify({
          pathname,
          // keep room for future tenantSlug, quoteLogId, etc.
        }),
      };
    },

    // Optional: called after upload completes (runs server-side)
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      // You can log / persist blob.url here later if you want.
      // For now, we keep it simple (no DB writes).
      void blob;
      void tokenPayload;
    },
  });
}
