import { app } from 'electron'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import { UPDATE_STATUS_CHANNEL, type UpdateStatus } from '@shared/ipc-types'

// Auto-update (ROADMAP P2-1, ADR-042) via electron-updater against the repo's PUBLIC GitHub Releases feed
// (`publish:` in electron-builder.yml). PACKAGED-ONLY: in dev / e2e (unpackaged) there is no `latest.yml`
// and electron-updater would throw, so we no-op and report `disabled`. Every failure — most commonly a 404
// before the first release is published — is logged and surfaced as a benign `error` status; nothing here
// ever crashes the app. Status flows to the renderer via UPDATE_STATUS_CHANNEL (mirrors the model-download
// progress channel); the Settings "Check for updates" control drives `check()` / `install()`.

type Send = (channel: string, payload: unknown) => void

let wired = false

/** Wire the updater once and kick off a launch check (background download + native notify on quit).
 *  Packaged-only; a no-op otherwise. Safe to call before the window exists — `send` is lazy. */
export function initAutoUpdater(send: Send): void {
  if (!app.isPackaged || wired) return
  wired = true

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const push = (s: UpdateStatus): void => send(UPDATE_STATUS_CHANNEL, s)

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => push({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => push({ state: 'not-available' }))
  autoUpdater.on('download-progress', (p) =>
    push({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => push({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    log.warn('auto-update failed', err)
    push({ state: 'error', message: friendlyError(err) })
  })

  // The 'error' listener above surfaces failures; swallow the promise rejection so an unpublished feed
  // (or an offline launch) doesn't become an unhandled rejection.
  void autoUpdater.checkForUpdatesAndNotify().catch(() => {})
}

/** Manual check (Settings button). Reports `disabled` in dev/unpackaged; progress arrives via the channel. */
export async function checkForUpdates(send: Send): Promise<void> {
  if (!app.isPackaged) {
    send(UPDATE_STATUS_CHANNEL, {
      state: 'disabled',
      message: 'Updates apply to the installed app.'
    } satisfies UpdateStatus)
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.warn('manual update check failed', err)
    send(UPDATE_STATUS_CHANNEL, {
      state: 'error',
      message: friendlyError(err)
    } satisfies UpdateStatus)
  }
}

/** Quit and install a downloaded update (the "Restart to update" button). No-op unless packaged. */
export function quitAndInstall(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/404|not found|latest\.yml|no published/i.test(msg)) return 'No published release found yet.'
  if (/net::|ENOTFOUND|ECONN|getaddrinfo|network|timeout/i.test(msg))
    return 'Couldn’t reach the update server.'
  return 'Update check failed — see the logs.'
}
