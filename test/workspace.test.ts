import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import * as workspacePlugin from '@examharness/plugin-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 工作区测试。盯住四条边界与一条能力：
 *   - **能干活**：写脚本文件 → 跑 python3 → 产物落 out/（agent 的手脚得真好用）；
 *   - **要跑的先落成文件**：`-c` 内联代码一律拒绝（可审计性）；
 *   - **不许出圈**：绝对路径 / `..` / 不在白名单的可执行文件都拒绝；
 *   - **venv 优先**：有 .venv 时 python3 指向它（agent 装的库与系统 python 不互相污染）；
 *   - **超时会被杀掉**，且如实报告 timedOut。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const fibers: Fiber[] = []
const scratch: string[] = []

interface Booted {
  ctx: Context
  dir: string
}

async function boot(options: { venv?: boolean } = {}): Promise<Booted> {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-ws-'))
  scratch.push(dir)
  if (options.venv === true) {
    // 假 venv：只放一个可执行文件，够验证"解析到 venv"这件事
    mkdirSync(join(dir, 'venv', 'bin'), { recursive: true })
    writeFileSync(join(dir, 'venv', 'bin', 'python3'), '#!/bin/sh\necho venv-python\n', { mode: 0o755 })
    writeFileSync(join(dir, 'venv', 'bin', 'pip'), '#!/bin/sh\necho venv-pip "$@"\n', { mode: 0o755 })
  }
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await ctx.plugin(workspacePlugin, {
      dir: join(dir, 'workspaces'),
      venv: options.venv === true ? join(dir, 'venv') : join(dir, '没有这个环境'),
      allow: ['python3', 'python', 'pip', 'cat', 'ls', 'sh'],
      allowInstall: false,
      timeoutMs: 15_000,
      maxOutputBytes: 4_000,
      maxFileBytes: 100_000,
      maxListed: 50,
    }),
  )
  return { ctx, dir }
}

beforeEach(() => {
  fibers.length = 0
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('工作区', () => {
  it('写脚本 → 跑 python3 → 产物落在 out/（agent 的手脚）', async () => {
    const { ctx, dir } = await boot()
    const opened = ctx.workspace.open('kb-1')
    expect(existsSync(join(dir, 'workspaces', 'kb-1', 'in'))).toBe(true)

    const script = 'import json, pathlib\npathlib.Path("out/rows.json").write_text(json.dumps([1, 2, 3]), encoding="utf-8")\nprint("done")\n'
    ctx.workspace.write('kb-1', 'tmp/build.py', script)
    const run = ctx.workspace.run('kb-1', ['python3', 'tmp/build.py'])

    expect(run.timedOut).toBe(false)
    expect(run.code).toBe(0)
    expect(run.out.trim()).toBe('done')
    expect(readFileSync(join(dir, 'workspaces', 'kb-1', 'out', 'rows.json'), 'utf8')).toBe('[1, 2, 3]')

    // 列表里能看到 in/tmp/out 三处的东西，路径是相对工作区的
    expect(ctx.workspace.list('kb-1').map((file) => file.path)).toEqual(['out/rows.json', 'tmp/build.py'])
    expect(opened.path.endsWith(join('workspaces', 'kb-1'))).toBe(true)
  })

  it('不许内联代码：-c 被拒（跑过的东西必须留在目录里能复查）', async () => {
    const { ctx } = await boot()
    ctx.workspace.open('kb-2')
    const run = ctx.workspace.run('kb-2', ['python3', '-c', 'print(1)'])

    expect(run.code).toBeNull()
    expect(run.err).toContain('不许内联代码')
    expect(run.out).toBe('')
  })

  it('不许出圈：工作区之外的路径、白名单外的程序都拒绝', async () => {
    const { ctx } = await boot()
    ctx.workspace.open('kb-3')

    expect(ctx.workspace.run('kb-3', ['cat', '../../data/sessions.json']).err).toContain('工作区之外')
    expect(ctx.workspace.run('kb-3', ['cat', '/etc/passwd']).err).toContain('工作区之外')
    expect(ctx.workspace.run('kb-3', ['rm', '-rf', 'out']).err).toContain('不在允许清单里')

    // 读写也一样：穿越路径读不到、写不进
    expect(ctx.workspace.read('kb-3', '../kb.json')).toBeUndefined()
    expect(ctx.workspace.write('kb-3', '../x.txt', 'x')).toBeUndefined()
    expect(ctx.workspace.dirOf('../etc')).toBeUndefined()
  })

  it('venv 优先，且 pip install 默认被关（装包是人的决定）', async () => {
    const { ctx } = await boot({ venv: true })
    ctx.workspace.open('kb-4')

    expect(ctx.workspace.venvPython()).toBeDefined()
    expect(ctx.workspace.run('kb-4', ['python3', '--version']).out.trim()).toBe('venv-python')

    const install = ctx.workspace.run('kb-4', ['pip', 'install', 'pdfplumber'])
    expect(install.err).toContain('pip install 被关掉了')
    expect(install.err).toContain('pnpm venv:add pdfplumber')

    // 没建 venv 时，python3 仍可用（系统 python），但 pip 会如实说"没有虚拟环境"
    const bare = await boot()
    expect(bare.ctx.workspace.venvPython()).toBeUndefined()
    expect(bare.ctx.workspace.run('kb-4', ['pip', 'install', 'x']).err).toContain('没有虚拟环境')
  })

  it('超时会被杀掉并如实标注；分片读与 seed 都在 in/ 边界内', async () => {
    const { ctx, dir } = await boot()
    ctx.workspace.open('kb-5')
    ctx.workspace.write('kb-5', 'tmp/slow.py', 'import time\ntime.sleep(30)\n')
    const run = ctx.workspace.run('kb-5', ['python3', 'tmp/slow.py'], 300)
    expect(run.timedOut).toBe(true)
    expect(run.err).toContain('超时')

    // seed：把外部原件复制进 in/（原件不动手）
    const source = join(dir, '原件.txt')
    writeFileSync(source, 'x'.repeat(5000), 'utf8')
    expect(ctx.workspace.seed('kb-5', [source])).toBe(1)
    const first = ctx.workspace.read('kb-5', 'in/原件.txt', 0, 2000)
    expect(first?.total).toBe(5000)
    expect(first?.next).toBe(2000)
    expect(ctx.workspace.read('kb-5', 'in/原件.txt', 2000, 2000)?.text).toHaveLength(2000)

    // 名字非法的工作区退回默认目录，不给穿越机会
    expect(ctx.workspace.open('../../etc').name).toBe('default')
  })
})
