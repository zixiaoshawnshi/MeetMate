import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'

let pythonProc: ChildProcessWithoutNullStreams | null = null
let stopping = false

function pythonEntryPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python', 'main.py')
  }
  return join(process.cwd(), 'python', 'main.py')
}

function pythonWorkingDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python')
  }
  return join(process.cwd(), 'python')
}

function pythonCandidates(): Array<{ command: string; args: string[] }> {
  if (process.platform === 'win32') {
    return [
      { command: 'python', args: [] },
      { command: 'py', args: ['-3'] }
    ]
  }
  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] }
  ]
}

export function startPythonService(): void {
  if (pythonProc) return

  const entry = pythonEntryPath()
  if (!existsSync(entry)) {
    console.error(`[python-service] Python entry not found: ${entry}`)
    return
  }

  const cwd = pythonWorkingDir()
  const candidates = pythonCandidates()

  const trySpawn = (index: number): void => {
    if (index >= candidates.length) {
      console.error('[python-service] Could not find a Python executable on PATH.')
      return
    }

    const candidate = candidates[index]
    const proc = spawn(candidate.command, [...candidate.args, entry], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true
    })

    let started = false

    proc.once('spawn', () => {
      started = true
      pythonProc = proc
      stopping = false
      console.log(`[python-service] Started with "${candidate.command} ${candidate.args.join(' ')}".`)
    })

    proc.once('error', (err: NodeJS.ErrnoException) => {
      if (!started && err.code === 'ENOENT') {
        trySpawn(index + 1)
        return
      }
      console.error('[python-service] Failed to start:', err.message)
    })

    proc.stdout.on('data', (chunk) => {
      console.log(`[python-service] ${String(chunk).trimEnd()}`)
    })

    proc.stderr.on('data', (chunk) => {
      console.error(`[python-service] ${String(chunk).trimEnd()}`)
    })

    proc.on('exit', (code, signal) => {
      if (pythonProc === proc) pythonProc = null
      console.log(`[python-service] Exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
    })
  }

  trySpawn(0)
}

export async function stopPythonService(): Promise<void> {
  stopping = true

  if (!pythonProc) return
  const proc = pythonProc

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (pythonProc === proc) {
        proc.kill('SIGKILL')
      }
      resolve()
    }, 3_000)

    proc.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })

    proc.kill('SIGTERM')
  })

  if (pythonProc === proc) pythonProc = null
}
