import { NextResponse } from "next/server";
import { getProjectSpace, ProjectRegistryError } from "@/lib/project-registry";
import { listAllSessions, scanArchivedCwds } from "@/lib/session-reader";
import { sessionCwdMatchesPathKey } from "@/lib/session-project-link";
import {
  SessionListTimingCollector,
  formatSessionListTimingLog,
  sessionListTimingDebugEnabled,
  shouldLogSessionListTiming,
} from "@/lib/session-list-timing";

interface RouteContext {
  params: Promise<{ projectId: string; spaceId: string }>;
}

// GET /api/projects/:projectId/spaces/:spaceId/sessions
// Sessions are filtered by explicit header link. Optional legacy exact-cwd
// matches are returned separately and are never backfilled into the session file.
//
// PERF-001 (measure phase): a content-safe `SessionListTimingCollector`
// records stage durations and scalar counts for every request. The collector
// only stores scalar milliseconds and integer counts — never session titles,
// messages, tool output, absolute paths, or credentials. A log line is
// emitted only when the request exceeds a slow-request threshold or an
// explicit debug switch is on, so normal requests stay silent. The optional
// JSON-serialization probe is gated behind the debug switch to avoid adding
// a second full serialization on every production request.
export async function GET(req: Request, context: RouteContext) {
  const timing = new SessionListTimingCollector();
  let decodedProjectId = "";
  let decodedSpaceId = "";
  let response: NextResponse | null = null;
  try {
    const { projectId, spaceId } = await context.params;
    decodedProjectId = decodeURIComponent(projectId);
    decodedSpaceId = decodeURIComponent(spaceId);
    const space = await timing.measureAsync("registry", () =>
      getProjectSpace(decodedProjectId, decodedSpaceId),
    );
    const includeLegacy = new URL(req.url).searchParams.get("includeLegacy") === "1";

    // Route-level `listAll` wraps the entire `listAllSessions` call; the reader
    // records finer-grained `inventory` (lightweight scanSessionInventory),
    // `header`, and `studioProjection` sub-stages on the same collector.
    const sessions = await timing.measureAsync("listAll", () =>
      listAllSessions({
        includeStudioChildren: true,
        includeStudioChildDisplay: true,
        timing,
      }),
    );
    timing.addCount("listedActive", sessions.length);

    const linkedRoots = timing.measureSync("filter", () =>
      sessions.filter(
        (session) =>
          !session.studioChild &&
          session.projectId === decodedProjectId &&
          session.spaceId === decodedSpaceId,
      ),
    );
    const linkedRootIds = new Set(linkedRoots.map((session) => session.id));
    const studioChildren = sessions.filter((session) => {
      if (!session.studioChild) return false;
      if (session.projectId !== decodedProjectId || session.spaceId !== decodedSpaceId) return false;
      return !!session.studioChild.parentSessionId && linkedRootIds.has(session.studioChild.parentSessionId);
    });
    timing.addCount("linkedRoots", linkedRoots.length);
    timing.addCount("linkedStudioChildren", studioChildren.length);
    const linked = [
      ...linkedRoots,
      ...studioChildren.map((session) => ({
        ...session,
        parentSessionId: session.parentSessionId ?? session.studioChild?.parentSessionId,
      })),
    ];
    const legacyUnassigned = includeLegacy
      ? (await Promise.all(
          sessions
            .filter((session) => !session.studioChild && (!session.projectId || !session.spaceId))
            .map(async (session) =>
              (await sessionCwdMatchesPathKey(session.cwd, space.pathKey)) ? session : null,
            ),
        )).filter((session): session is NonNullable<typeof session> => Boolean(session))
      : [];
    timing.addCount("legacyUnassigned", legacyUnassigned.length);

    const archived = await timing.measureAsync("archive", () => scanArchivedCwds());
    timing.addCount("archiveCwds", Object.keys(archived.counts).length);
    const archivedCount = (await Promise.all(
      Object.entries(archived.counts).map(async ([cwd, count]) =>
        (await sessionCwdMatchesPathKey(cwd, space.pathKey)) ? count : 0,
      ),
    )).reduce((sum, count) => sum + count, 0);
    const archivedCounts = archivedCount > 0 ? { [space.path]: archivedCount } : {};

    const studioChildrenByParentSessionId = studioChildren.reduce<Record<string, typeof studioChildren>>(
      (acc, session) => {
        const parentId = session.studioChild?.parentSessionId;
        if (!parentId) return acc;
        (acc[parentId] ??= []).push(session);
        return acc;
      },
      {},
    );

    const body = { sessions: linked, legacyUnassigned, archivedCounts, studioChildrenByParentSessionId };
    response = NextResponse.json(body);

    // The serialization probe is gated behind the debug switch so production
    // requests never pay for a second full JSON.stringify. It records only
    // the response byte length as a scalar count, never the content.
    if (sessionListTimingDebugEnabled()) {
      try {
        const serialized = JSON.stringify(body);
        timing.measureSync("serialize", () => serialized);
        timing.addCount("responseBytes", Buffer.byteLength(serialized, "utf8"));
      } catch {
        // best-effort; serialization errors are surfaced by Next normally
      }
    }

    return response;
  } catch (error) {
    if (error instanceof ProjectRegistryError) {
      response = NextResponse.json({ error: error.message }, { status: error.status });
      return response;
    }
    response = NextResponse.json({ error: String(error) }, { status: 500 });
    return response;
  } finally {
    try {
      const snapshot = timing.snapshot();
      if (shouldLogSessionListTiming(snapshot.totalMs)) {
        // Only opaque registry ids are included; never titles/paths/content.
        console.log(
          formatSessionListTimingLog(snapshot, {
            projectId: decodedProjectId,
            spaceId: decodedSpaceId,
          }),
        );
      }
    } catch {
      // Timing/logging must never break the request.
    }
  }
}
