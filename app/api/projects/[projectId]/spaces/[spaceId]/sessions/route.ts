import { NextResponse } from "next/server";
import { getProjectSpace, ProjectRegistryError } from "@/lib/project-registry";
import { listAllSessions, scanArchivedCwds } from "@/lib/session-reader";
import { sessionCwdMatchesPathKey } from "@/lib/session-project-link";

interface RouteContext {
  params: Promise<{ projectId: string; spaceId: string }>;
}

// GET /api/projects/:projectId/spaces/:spaceId/sessions
// Sessions are filtered by explicit header link. Optional legacy exact-cwd
// matches are returned separately and are never backfilled into the session file.
export async function GET(req: Request, context: RouteContext) {
  try {
    const { projectId, spaceId } = await context.params;
    const decodedProjectId = decodeURIComponent(projectId);
    const decodedSpaceId = decodeURIComponent(spaceId);
    const space = await getProjectSpace(decodedProjectId, decodedSpaceId);
    const includeLegacy = new URL(req.url).searchParams.get("includeLegacy") === "1";

    const sessions = await listAllSessions();
    const linked = sessions.filter((session) => session.projectId === decodedProjectId && session.spaceId === decodedSpaceId);
    const legacyUnassigned = includeLegacy
      ? (await Promise.all(sessions
        .filter((session) => !session.projectId || !session.spaceId)
        .map(async (session) => (await sessionCwdMatchesPathKey(session.cwd, space.pathKey)) ? session : null)))
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
      : [];

    const archived = scanArchivedCwds();
    const archivedCount = (await Promise.all(Object.entries(archived.counts).map(async ([cwd, count]) => (
      await sessionCwdMatchesPathKey(cwd, space.pathKey) ? count : 0
    )))).reduce((sum, count) => sum + count, 0);
    const archivedCounts = archivedCount > 0 ? { [space.path]: archivedCount } : {};

    return NextResponse.json({ sessions: linked, legacyUnassigned, archivedCounts });
  } catch (error) {
    if (error instanceof ProjectRegistryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
