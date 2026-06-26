import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The Anthropic API key, encrypted at rest via Electron safeStorage (Windows DPAPI). It lives ONLY in
// the main process: `getKey()` is internal (used by claude.service) and is never exposed over IPC.
// The renderer can set it, check existence, validate it, and clear it — but can never read it back.

function keyPath(): string {
  return join(app.getPath('userData'), 'anthropic.key.enc')
}

export function keyExists(): boolean {
  return existsSync(keyPath())
}

export function setKey(plaintext: string): void {
  const key = plaintext.trim()
  if (!key) throw new Error('API key is empty')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system; cannot store the API key safely')
  }
  writeFileSync(keyPath(), safeStorage.encryptString(key))
}

/** Main-process only. Never return this over IPC or log it. */
export function getKey(): string | null {
  if (!keyExists()) return null
  try {
    return safeStorage.decryptString(readFileSync(keyPath()))
  } catch {
    return null
  }
}

export function clearKey(): void {
  try {
    rmSync(keyPath(), { force: true })
  } catch {
    // already gone — nothing to do
  }
}
