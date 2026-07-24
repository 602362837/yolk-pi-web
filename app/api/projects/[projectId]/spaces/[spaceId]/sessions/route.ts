import { NextResponse } from "next/server";
import { getProjectSpace, ProjectRegistryError } from "@/lib/project-registry";
import {
  isProjectSpaceSessionListEnabled,
  listSessionsForProjectSpace,
  ProjectSpaceSessionListError,
  PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING,
} from "@/lib/project-space-session-list";
import { listAllSessions } from "@/lib/session-reader";
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

/**
 * GET /api/projects/:projectId/spaces/:spaceId/sessions
 *
 * Default (PSI-05): directed project-space index reader
 * (`listSessionsForProjectSpace`). Success body remains
 * `{ sessions, legacyUnassigned, studioChildrenByParentSessionId }`.
 *
 * Rollback: set `PI_WEB_PROJECT_SPACE_SESSION_LIST=0|false|off|legacy` to use
 * the previous `listAllSessions()` path without deleting that helper.
 *
 * Query:
 * - `includeLegacy=1` — exact-cwd unlinked sessions (never auto-backfilled)
 * - `forceValidate=1` — bypass 5s response snapshot; still validates candidates
 *
 * Recovery over budget with no last-good → 503 `session_index_rebuilding`
 * + `Retry-After: 1`. Never returns a silent partial 200.
 *
 * Timing logs stay content-safe: stage ms + scalar counts + opaque ids only.
 */
export async function GET(req: Request, context: RouteContext) {
  const timing = new SessionListTimingCollector();
  let decodedProjectId = "";
  let decodedSpaceId = "";
  let response: NextResponse | null = null;
  try {
    const { projectId, spaceId } = await context.params;
    decodedProjectId = decodeURIComponent(projectId);
    decodedSpaceId = decodeURIComponent(spaceId);
    const url = new URL(req.url);
    const includeLegacy = url.searchParams.get("includeLegacy") === "1";
    const forceValidate = url.searchParams.get("forceValidate") === "1";

    const useDirectedList = isProjectSpaceSessionListEnabled();
    timing.addCount("directedList", useDirectedList ? 1 : 0);

    let body: {
      sessions: Awaited<ReturnType<typeof listSessionsForProjectSpace>>["sessions"];
      legacyUnassigned: Awaited<ReturnType<typeof listSessionsForProjectSpace>>["legacyUnassigned"];
      studioChildrenByParentSessionId: Awaited<
        ReturnType<typeof listSessionsForProjectSpace>
      >["studioChildrenByParentSessionId"];
    };

    if (useDirectedList) {
      const result = await timing.measureAsync("listSpace", () =>
        listSessionsForProjectSpace(decodedProjectId, decodedSpaceId, {
          includeLegacy,
          forceValidate,
          timing,
        }),
      );
      body = {
        sessions: result.sessions,
        legacyUnassigned: result.legacyUnassigned,
        studioChildrenByParentSessionId: result.studioChildrenByParentSessionId,
      };
      // Content-safe diagnostics only (no paths/titles).
      timing.addCount("inventoryGlobalCalls", result.diagnostics.inventoryGlobalCalls);
      timing.addCount("studioProjectionCalls", result.diagnostics.studioProjectionCalls);
      timing.addCount("uniqueLinkedTasks", result.diagnostics.uniqueLinkedTasks);
      timing.addCount("metadataScans", result.diagnostics.metadataScans);
      timing.addCount("headerReads", result.diagnostics.headerReads);
      if (result.diagnostics.usedLastGood) timing.addCount("usedLastGood", 1);
      if (result.diagnostics.recoveryReason !== "none") timing.addCount("recovery", 1);
    } else {
      // Feature-flag rollback path — preserve prior filter semantics.
      const space = await timing.measureAsync("registry", () =>
        getProjectSpace(decodedProjectId, decodedSpaceId),
      );
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
        if (session.projectId !== decodedProjectId || session.spaceId !== decodedSpaceId) {
          return false;
        }
        return (
          !!session.studioChild.parentSessionId &&
          linkedRootIds.has(session.studioChild.parentSessionId)
        );
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
        ? (
            await Promise.all(
              sessions
                .filter((session) => !session.studioChild && (!session.projectId || !session.spaceId))
                .map(async (session) =>
                  (await sessionCwdMatchesPathKey(session.cwd, space.pathKey)) ? session : null,
                ),
            )
          ).filter((session): session is NonNullable<typeof session> => Boolean(session))
        : [];
      timing.addCount("legacyUnassigned", legacyUnassigned.length);

      const studioChildrenByParentSessionId = studioChildren.reduce<
        Record<string, typeof studioChildren>
      >((acc, session) => {
        const parentId = session.studioChild?.parentSessionId;
        if (!parentId) return acc;
        (acc[parentId] ??= []).push(session);
        return acc;
      }, {});

      body = { sessions: linked, legacyUnassigned, studioChildrenByParentSessionId };
    }

    response = NextResponse.json(body);
    response.headers.set("Cache-Control", "no-store");

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
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    if (error instanceof ProjectSpaceSessionListError) {
      if (error.code === PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING) {
        response = NextResponse.json(
          {
            error: "Session index is rebuilding",
            code: PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING,
          },
          { status: 503 },
        );
        response.headers.set("Retry-After", String(error.retryAfterSec ?? 1));
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
      response = NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    response = NextResponse.json({ error: String(error) }, { status: 500 });
    response.headers.set("Cache-Control", "no-store");
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
