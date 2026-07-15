import assert from "node:assert/strict";
import {
  buildStudioTaskDocumentPageUrl,
  buildStudioTaskFileApiUrl,
  describeStudioTaskDocumentError,
  openStudioTaskDocumentInNewTab,
  openStudioTaskRelativeInNewTab,
  resolveTaskRelativeHref,
  studioTaskDocumentIsMeaningful,
} from "../lib/ypi-studio-task-preview.ts";

{
  const resolved = resolveTaskRelativeHref("design.md");
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.path, "design.md");
    assert.equal(resolved.fileName, "design.md");
    assert.equal(resolved.isHtml, false);
  }
}

{
  const resolved = resolveTaskRelativeHref("./docs/ui.html?x=1#top");
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.path, "docs/ui.html");
    assert.equal(resolved.isHtml, true);
  }
}

for (const href of ["https://example.com/a.md", "//evil", "/etc/passwd", "C:\\Windows\\a.md", "../secret.md", "dir/", "a\\b.md", ""]) {
  const resolved = resolveTaskRelativeHref(href);
  assert.equal(resolved.ok, false, `expected reject for ${href}`);
}

{
  const url = buildStudioTaskDocumentPageUrl({
    taskKey: "active:demo task",
    cwd: "/tmp/project space",
    path: "docs/prd.md",
    improvementId: "IMP-001",
    title: "Demo Task",
  });
  assert.ok(url.startsWith("/studio/task-document?"));
  const params = new URL(url, "http://localhost").searchParams;
  assert.equal(params.get("taskKey"), "active:demo task");
  assert.equal(params.get("cwd"), "/tmp/project space");
  assert.equal(params.get("path"), "docs/prd.md");
  assert.equal(params.get("improvementId"), "IMP-001");
  assert.equal(params.get("title"), "Demo Task");
}

{
  const url = buildStudioTaskFileApiUrl({
    taskKey: "archived:2026-07:demo",
    cwd: "/tmp/p",
    path: "proto.html",
    mode: "preview",
    improvementId: "IMP-002",
  });
  const params = new URL(url, "http://localhost").searchParams;
  assert.equal(params.get("mode"), "preview");
  assert.equal(params.get("path"), "proto.html");
  assert.equal(params.get("improvementId"), "IMP-002");
  assert.ok(url.includes("/api/studio/tasks/"));
}

{
  assert.equal(studioTaskDocumentIsMeaningful(""), false);
  assert.equal(studioTaskDocumentIsMeaningful("_TBD by YPI Studio workflow_"), false);
  assert.equal(studioTaskDocumentIsMeaningful("# PRD\n\nReal content"), true);
}

{
  assert.match(
    describeStudioTaskDocumentError(400, "Rejected /tmp/secret/path", { fileName: "prd.md" }),
    /安全规则拒绝/,
  );
  assert.equal(
    describeStudioTaskDocumentError(500, "/Users/me/secret", { shortName: "资料", fileName: "prd.md" }),
    "资料读取失败。",
  );
  assert.equal(
    describeStudioTaskDocumentError(500, "network timeout", { shortName: "资料", fileName: "prd.md" }),
    "network timeout",
  );
  assert.equal(
    describeStudioTaskDocumentError(404, null, { fileName: "design.md" }),
    "找不到 design.md，文件可能尚未创建。",
  );
}

// No window: open helpers must report blocked without inventing a file-viewer fallback.
{
  const result = openStudioTaskDocumentInNewTab({
    taskKey: "active:demo",
    cwd: "/tmp/p",
    path: "prd.md",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "blocked");
}

{
  const html = openStudioTaskRelativeInNewTab({
    taskKey: "active:demo",
    cwd: "/tmp/p",
    href: "proto.html",
  });
  assert.equal(html.ok, false);
  if (!html.ok) assert.equal(html.reason, "blocked");
}

{
  const invalid = openStudioTaskRelativeInNewTab({
    taskKey: "active:demo",
    cwd: "/tmp/p",
    href: "../escape.md",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, "invalid");
}

console.log("test-ypi-studio-task-preview: ok");
