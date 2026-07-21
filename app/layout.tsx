import { access } from "node:fs/promises";
import type { Metadata } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { WORKSPACE_TITLE_FALLBACK } from "@/lib/workspace-title";
import { getAppearanceSkinAssetPathForServer, readAppearanceCatalog } from "@/lib/appearance-store";
import { appearanceBackgroundSize, appearanceVideoObjectFit } from "@/lib/appearance-types";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

// Appearance is per service instance; never allow static rendering to capture build-machine state.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: WORKSPACE_TITLE_FALLBACK,
  description: "WebChat workspace for the pi coding agent",
  icons: {
    icon: "/yolk-pi-logo.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let appearance: {
    id: string;
    kind: "image" | "video";
    assetUrl: string;
    fit: "cover" | "contain" | "stretch" | "original";
    positionX: number;
    positionY: number;
    overlayTone: "auto" | "light" | "dark";
    overlayOpacity: number;
    panelOpacity: number;
  } | null = null;

  try {
    const catalog = await readAppearanceCatalog();
    const skin = !catalog.warnings && catalog.index.activeSkinId
      ? catalog.index.skins.find((item) => item.id === catalog.index.activeSkinId) ?? null
      : null;
    if (skin) {
      // Do not render translucent active-skin tokens for a catalog pointer whose
      // normalized asset disappeared; the route remains the sole path authority.
      // Video full assets are MP4; first paint uses the poster thumbnail only.
      // Client hydrate (VID-04) attaches src on the inert #appearance-bg-video host.
      const bootstrapVariant = skin.kind === "video" ? "thumbnail" : "full";
      const assetPath = getAppearanceSkinAssetPathForServer(skin.id, bootstrapVariant, skin.kind);
      if (assetPath) {
        await access(assetPath);
        appearance = {
          id: skin.id,
          kind: skin.kind,
          assetUrl: `/api/appearance/skins/${skin.id}/asset?variant=${bootstrapVariant}`,
          ...skin.presentation,
        };
      }
    }
  } catch {
    // Corrupt/unavailable appearance data must not prevent the Chat shell rendering.
  }

  // Video skins bootstrap with poster URL only (thumbnail variant). Never embed
  // <video src> in SSR HTML — client hydrate (VID-04) attaches the mp4 when policy allows.
  const appearanceStyle = appearance ? {
    "--appearance-image": `url(${JSON.stringify(appearance.assetUrl)})`,
    "--appearance-size": appearanceBackgroundSize(appearance.fit),
    "--appearance-position-x": `${appearance.positionX}%`,
    "--appearance-position-y": `${appearance.positionY}%`,
    "--appearance-overlay-opacity": String(appearance.overlayOpacity / 100),
    "--appearance-panel-opacity": `${appearance.panelOpacity}%`,
    ...(appearance.kind === "video"
      ? { "--appearance-video-fit": appearanceVideoObjectFit(appearance.fit) }
      : {}),
    ...(appearance.overlayTone === "auto" ? {} : {
      "--appearance-overlay-color": appearance.overlayTone === "light" ? "#ffffff" : "#000000",
    }),
  } as React.CSSProperties : undefined;

  return (
    <html
      lang="en"
      className={notoSansMono.variable}
      {...(appearance ? {
        "data-appearance": "skin",
        "data-appearance-id": appearance.id,
        "data-appearance-kind": appearance.kind,
        // SSR starts video skins in poster mode; playback policy upgrades after hydrate.
        ...(appearance.kind === "video" ? { "data-appearance-playback": "poster" } : {}),
      } : {})}
      style={appearanceStyle}
      suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
      </head>
      <body style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {/*
          Single inert decorative video host for dynamic wallpapers (VID-05).
          No src on SSR; muted/playsInline/loop attrs are fixed for autoplay policy.
          VID-04 attaches/detaches src and toggles data-appearance-playback.
        */}
        <video
          id="appearance-bg-video"
          aria-hidden="true"
          muted
          playsInline
          loop
          disablePictureInPicture
          disableRemotePlayback
          tabIndex={-1}
          preload="none"
        />
        {children}
      </body>
    </html>
  );
}
