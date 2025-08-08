import { createCliRenderer, BoxRenderable, TextRenderable } from "@/opentui"
import os from "os"
import { join } from "path"
import { existsSync } from "fs"
import { suffix } from "bun:ffi"

function getPlatformTarget(): string {
  const platform = os.platform()
  const arch = os.arch()
  const platformMap: Record<string, string> = { darwin: "macos", win32: "windows", linux: "linux" }
  const archMap: Record<string, string> = { x64: "x86_64", arm64: "aarch64" }
  return `${archMap[arch] || arch}-${platformMap[platform] || platform}`
}

function expectedNativeLibPath(): string {
  const target = getPlatformTarget()
  const isWindows = os.platform() === "win32"
  const libraryName = isWindows ? "opentui" : "libopentui"
  return join(import.meta.dir, "opentui/src/zig/lib", target, `${libraryName}.${suffix}`)
}

async function main() {
  const target = getPlatformTarget()
  const libPath = expectedNativeLibPath()
  console.log(`[OpenTUI] platform target: ${target}`)
  console.log(`[OpenTUI] expecting native lib at: ${libPath}`)
  console.log(`[OpenTUI] native lib exists: ${existsSync(libPath)}`)

  try {
    const renderer = await createCliRenderer({
      targetFps: 30,
      exitOnCtrlC: true,
      useAlternateScreen: true,
      useConsole: false,
    })

    console.log(`[OpenTUI] terminal: ${renderer.terminalWidth}x${renderer.terminalHeight}`)

    renderer.setBackgroundColor("#101010")

    const header = new BoxRenderable("header", {
      x: 0,
      y: 0,
      width: renderer.terminalWidth,
      height: 3,
      bg: "#202225",
      zIndex: 0,
      border: true,
      borderColor: "#00ff88",
      title: "OpenTUI (local)",
      titleAlignment: "left",
    })

    const hello = new TextRenderable("hello", {
      content: "Hello from OpenTUI",
      x: 2,
      y: 2,
      zIndex: 1,
      fg: "#00ff88",
    })

    renderer.add(header)
    renderer.add(hello)

    renderer.on("resize", (w: number) => {
      header.width = w
      header.height = 3
    })

    renderer.start()
  } catch (err) {
    console.error("Failed to start OpenTUI. If the native lib isn't built, run: bun run opentui:build")
    console.error(err)
    process.exit(1)
  }
}

main() 