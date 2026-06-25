# Integrations and Dependencies

## Primary Runtime Dependencies

See `package.json` for exact versions.

| Dependency | Purpose |
| --- | --- |
| `next`, `react`, `react-dom` | Web application framework/runtime. |
| `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` | In-process pi AgentSession and AI provider integration. |
| `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `katex` | Markdown and math rendering. |
| `react-syntax-highlighter` | Code block highlighting. |
| `mermaid` | Diagram rendering. |
| `mammoth` | DOCX content handling. |
| `@lobehub/icons` | Provider/model icon assets. |

## pi SDK Documentation

When changing pi SDK usage, read the installed package documentation first:

- `node_modules/@earendil-works/pi-coding-agent/README.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/`
- `node_modules/@earendil-works/pi-coding-agent/examples/`

## Auth Providers

Auth-related API routes live under `app/api/auth/`. Provider tokens and API-key status are stored/read through the pi configuration mechanisms; keep provider-specific network calls isolated in `lib/` helpers.

## Skills and Commands

Skill search/install/list routes live under `app/api/skills/`; slash-command discovery lives under `app/api/commands/`. Use `lib/npx.ts` for cross-platform `npx` execution.
