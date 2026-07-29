import { stat } from "fs/promises";
import { getWebModelCatalogSnapshot } from "@/lib/model-catalog-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/models — offline shared model catalog.
 *
 * Uses the fixed-provider administrative catalog service (epoch + single-flight
 * + short burst cache). Does not create session services, does not load cwd
 * project extensions, and does not call `getAvailable()` (no extra availability
 * scan). Wire fields remain: models, modelList, defaultModel, thinkingLevels,
 * thinkingLevelMaps.
 */
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd") || process.cwd();

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  try {
    const catalog = await getWebModelCatalogSnapshot({ cwd });
    return Response.json(catalog, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Catalog build failures must be non-2xx so shared client last-good is
    // retained. A soft 200 empty body would parse as a successful empty catalog
    // and wipe prior models. Fixed safe code only — no paths/credentials.
    return Response.json(
      {
        error: "model_catalog_unavailable",
        code: "model_catalog_unavailable",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
