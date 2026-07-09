import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import log from 'electron-log/main'

// Window-state persistence (ROADMAP P0-3): remember bounds + maximized across launches. Main-only —
// the renderer never sees this. State lives beside settings.json as userData/window-state.json.
// A saved rect is only restored if it still meaningfully intersects a live display (monitors get
// unplugged); otherwise we silently fall back to defaults. Never throws — window state must never
// block startup.

interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const SAVE_DEBOUNCE_MS = 400

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** True when the rect shows at least a grabbable sliver (not 1px) on some display's work area. */
function onScreen(b: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return w > 60 && h > 40
  })
}

/** Load the saved state, or null when absent/corrupt/off-screen. Call after app ready (uses screen). */
export function loadWindowState(): WindowState | null {
  try {
    if (!existsSync(statePath())) return null
    const raw = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<WindowState>
    const b = raw.bounds
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null
    if (!onScreen(b)) return null
    return { bounds: b, maximized: raw.maximized === true }
  } catch {
    return null
  }
}

/** Persist bounds on resize/move (debounced) and on close. getNormalBounds() keeps the restored
 *  (un-maximized) rect even while maximized, so unmaximize-after-relaunch lands where it should. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const save = (): void => {
    try {
      const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
      writeFileSync(statePath(), JSON.stringify(state))
    } catch (err) {
      log.warn('window-state save failed', err)
    }
  }
  const debounced = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }

  win.on('resize', debounced)
  win.on('move', debounced)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
