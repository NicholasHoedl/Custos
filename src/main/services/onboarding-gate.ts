// Pure derivation of the first-run-tutorial gate (ADR-044 → ADR-059) — electron-free so it unit-tests
// without dragging in the IPC/service graph.

/** Whether the forced first-run tutorial is DONE (i.e. the app should open normally).
 *
 *  - `tutorialCompleted` — the tour finished (persisted flag).
 *  - `skipped` — the e2e escape hatch (LEDGER_SKIP_TUTORIAL, unpackaged builds only).
 *  - campaigns exist AND no `tutorialStep` — GRANDFATHERED: data that predates the tutorial (or a
 *    finished one from before the flag existed). The `tutorialStep === undefined` guard is the ADR-059
 *    fix: the spotlight tour creates a REAL campaign at its first step, so without it a mid-tour
 *    relaunch would silently count as onboarded and strand the rest of the tour forever.
 */
export function deriveTutorialDone(opts: {
  tutorialCompleted: boolean
  skipped: boolean
  campaignCount: number
  tutorialStep: string | undefined
}): boolean {
  return (
    opts.tutorialCompleted ||
    opts.skipped ||
    (opts.campaignCount > 0 && opts.tutorialStep === undefined)
  )
}
