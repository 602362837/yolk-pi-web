export type ModelsRequestLane = "config" | "catalog" | "detail" | "accounts" | "quota" | "reveal" | "login";

export type ModelsRequestIdentity = Readonly<{
  providerId?: string;
  accountId?: string;
}>;

export type ModelsRequestToken = Readonly<{
  lane: ModelsRequestLane;
  lifecycle: number;
  generation: number;
  identity: ModelsRequestIdentity;
}>;

/**
 * Commit gate for Models async reads. Abort is only resource cleanup: providers
 * and fetch implementations may settle after it, so continuations must also
 * prove that their lifecycle, lane generation, and request identity survive.
 */
export class ModelsRequestLifecycle {
  private active = true;
  private lifecycle = 1;
  private readonly generations = new Map<ModelsRequestLane, number>();

  begin(lane: ModelsRequestLane, identity: ModelsRequestIdentity = {}): ModelsRequestToken {
    const generation = (this.generations.get(lane) ?? 0) + 1;
    this.generations.set(lane, generation);
    return { lane, lifecycle: this.lifecycle, generation, identity: { ...identity } };
  }

  invalidate(lane: ModelsRequestLane): void {
    this.generations.set(lane, (this.generations.get(lane) ?? 0) + 1);
  }

  activate(): void {
    this.active = true;
    this.lifecycle += 1;
  }

  close(): void {
    this.active = false;
    this.lifecycle += 1;
    for (const [lane, generation] of this.generations) {
      this.generations.set(lane, generation + 1);
    }
  }

  isCurrent(token: ModelsRequestToken): boolean {
    return this.active
      && token.lifecycle === this.lifecycle
      && token.generation === this.generations.get(token.lane);
  }
}

export type VerificationState = "valid" | "invalid" | "timeout" | "error" | "superseded";

export type RevisionedVerification = Readonly<{
  basedOnRevision?: string;
  state?: VerificationState;
}>;

export type RevisionedOAuthRow = Readonly<{
  id: string;
  localStateRevision?: string;
  loggedIn?: boolean;
  verification?: RevisionedVerification;
}>;

/** Verification owns only verification/loggedIn; summary remains owner of row identity and local metadata. */
export function mergeRevisionedOAuthVerification<Row extends RevisionedOAuthRow>(
  rows: readonly Row[],
  verifiedRows: readonly Readonly<{ id: string; verification?: RevisionedVerification }>[],
): Row[] {
  const verificationById = new Map(verifiedRows.map((row) => [row.id, row.verification]));
  return rows.map((row) => {
    const verification = verificationById.get(row.id);
    if (!verification || verification.basedOnRevision !== row.localStateRevision) return row;
    return {
      ...row,
      verification,
      loggedIn: verification.state === "valid" ? true : verification.state === "invalid" ? false : row.loggedIn,
    };
  });
}
