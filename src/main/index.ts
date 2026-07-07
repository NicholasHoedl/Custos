import { app, dialog, shell, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { APP_ID, APP_NAME, DEFAULT_HOTKEY } from '@shared/constants'
import { QUICK_ADD_FOCUS_CHANNEL } from '@shared/ipc-types'
import { getDb, dbHealthCheck, closeDb } from './db'
import { registerIpcHandlers } from './ipc/handlers'
import { warm } from './services/embedding.service'
import icon from '../../resources/icon.png?asset'

app.setName(APP_NAME)
// Persistent main-process log (T2): userData/logs/main.log (1 MiB rotation). Main-only — no
// log.initialize() (that wires renderer bridging; the renderer surfaces errors via toasts instead).
log.transports.file.level = 'info'
log.transports.console.level = is.dev ? 'silly' : false
log.errorHandler.startCatching({ showDialog: false }) // uncaught main exceptions land in the log

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#141210', // charcoal background — matches the theme so there's no flash before paint
    autoHideMenuBar: true,
    // Window/taskbar icon (dev + Linux/Windows runtime). macOS uses the packaged .icns instead.
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showAndFocusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

// Single instance: a second launch (or the global hotkey while another app is focused) surfaces
// the existing window instead of starting a new process.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => showAndFocusMainWindow())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Open + migrate the local database before the UI loads (ADR-004). A failure here used to crash
    // silently before any window existed — now it explains itself and points at the backups (T1).
    try {
      getDb()
      log.info(`database ready — ${dbHealthCheck()} campaigns`)
    } catch (err) {
      log.error('database failed to open or migrate', err)
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Ledger cannot start',
        message: 'Your notes database could not be opened or upgraded.',
        detail:
          'Automatic backups live in the "backups" folder inside your data folder — restore one by ' +
          `replacing ledger.db. Details are in logs\\main.log.\n\n${String(err)}`,
        buttons: ['Open data folder', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (choice === 0) {
        void shell.openPath(app.getPath('userData')).finally(() => app.quit())
      } else {
        app.quit()
      }
      return // no window, no IPC, no hotkey
    }

    registerIpcHandlers(() => mainWindow)
    createWindow()
    warm() // preload the embedding pipeline if the model is already downloaded

    // Global quick-add hotkey. ADR-010: Phase 0 ships the focus-main behavior; the
    // popup-vs-focus decision is made in Phase 1. The hotkey is configurable (Settings).
    const registered = globalShortcut.register(DEFAULT_HOTKEY, () => {
      showAndFocusMainWindow()
      mainWindow?.webContents.send(QUICK_ADD_FOCUS_CHANNEL)
    })
    if (!registered) {
      log.warn(`could not register global hotkey "${DEFAULT_HOTKEY}" (already in use?)`)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    closeDb() // checkpoint + close so we never leave a stale WAL that could revert committed data
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
