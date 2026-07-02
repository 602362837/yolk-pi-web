import { SideBySideDiffView } from "./SideBySideDiffView";
import { UnifiedDiffView } from "./UnifiedDiffView";

export type DiffMode = "side-by-side" | "unified";

interface Props {
  diff: string;
  mode: DiffMode;
}

export function DiffView({ diff, mode }: Props) {
  if (mode === "unified") return <UnifiedDiffView diff={diff} />;
  return <SideBySideDiffView diff={diff} />;
}
