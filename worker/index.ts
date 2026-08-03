/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  JUDICIAL_API_USER?: string;
  JUDICIAL_API_PASSWORD?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    controller: { cron: string; scheduledTime: number },
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const judicialCrons = new Set(["30-59/5 16 * * *", "*/5 17-21 * * *"]);
    if (!judicialCrons.has(controller.cron)) return;
    ctx.waitUntil(
      (async () => {
        const response = await handler.fetch(
          new Request("https://silu-mentor.internal/api/judicial-sync", {
            method: "POST",
            headers: { "content-type": "application/json", "x-scheduled-sync": "1" },
            body: JSON.stringify({ action: "sync", limit: 30 }),
          }),
          env,
          ctx,
        );
        if (!response.ok) {
          console.error("Scheduled judicial sync failed", controller.scheduledTime, response.status, await response.text());
        }
      })(),
    );
  },
};

export default worker;
