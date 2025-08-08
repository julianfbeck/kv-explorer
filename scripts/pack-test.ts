import { chmod } from "fs/promises"
import { existsSync } from "fs"

async function run(cmd: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const p = Bun.spawn(cmd, { cwd: opts.cwd, stdout: opts.quiet ? "pipe" : "inherit", stderr: "inherit" })
  const out = opts.quiet ? await new Response(p.stdout!).text() : ""
  const code = await p.exited
  if (code !== 0) {
    throw new Error(`Command failed (${cmd.join(" ")}) with code ${code}`)
  }
  return out
}

async function main() {
  console.log("[pack-test] Ensuring bin is executable…")
  await chmod("bin/kvx.ts", 0o755)

  console.log("[pack-test] Building OpenTUI native library (if needed)…")
  await run(["bun", "run", "opentui:build"]) // assumes zig installed

  console.log("[pack-test] Packing npm tarball…")
  const out = await run(["npm", "pack", "--silent"], { quiet: true })
  const lines = out.trim().split(/\r?\n/).filter(Boolean)
  const tarball = lines[lines.length - 1]
  if (!tarball || !existsSync(tarball)) {
    throw new Error(`Tarball not found from npm pack output: ${JSON.stringify(lines)}`)
  }
  console.log(`[pack-test] Created: ${tarball}`)

  const absTarball = `${process.cwd()}/${tarball}`

  console.log("[pack-test] Installing tarball globally with npm (to resolve deps)…")
  await run(["npm", "install", "-g", absTarball])

  console.log("[pack-test] Running keyvault-tui (smoke test)…")
  const p = Bun.spawn(["keyvault-tui", "--smoke-test"], { stdout: "inherit", stderr: "inherit", stdin: "inherit" })
  const code = await p.exited

  console.log("[pack-test] Cleaning up global install…")
  try {
    await run(["npm", "uninstall", "-g", "keyvault-tui"])
  } catch (e) {
    console.warn("[pack-test] Cleanup failed:", e)
  }

  if (code !== 0) {
    throw new Error(`keyvault-tui exited with code ${code}`)
  }
}

main().catch((err) => {
  console.error("[pack-test] Error:", err)
  process.exit(1)
}) 