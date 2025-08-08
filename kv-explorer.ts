import { createCliRenderer, BoxRenderable, TextRenderable, ContainerElement, SelectElement, SelectElementEvents, InputElement, InputElementEvents } from "@/opentui"
import { BufferedElement } from "@/opentui"
import { getKeyHandler } from "@/opentui/ui/lib/KeyHandler"
import type { ParsedKey } from "@/opentui"
import { renderFontToFrameBuffer, measureText } from "@/opentui/ui/ascii.font"
import { RGBA } from "@/opentui"
import { AzureCliCredential } from "@azure/identity"
import { SecretClient, type SecretProperties } from "@azure/keyvault-secrets"
import { $ } from "bun"

// Enhanced multi-line text element with font support and better formatting
class TextBlockElement extends BufferedElement {
  private text: string = ""
  private useStyledHeader: boolean = false

  constructor(id: string, opts: ConstructorParameters<typeof BufferedElement>[1]) {
    super(id, opts)
  }

  public setText(text: string, styled: boolean = false) {
    this.text = text
    this.useStyledHeader = styled
    // Mark for full refresh so new text renders without requiring a terminal resize
    this.needsRefresh = true
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    if (!this.frameBuffer || !this.text) return
    
    let currentY = contentY
    const lines = this.text.split('\n')
    
    for (let lineIdx = 0; lineIdx < lines.length && currentY < contentY + contentHeight; lineIdx++) {
      const line = lines[lineIdx]
      
      // Check if this is a header line (starts with "Name:" or ends with ":")
      const isHeader = line.match(/^[A-Z][a-zA-Z\s]*:/) || line === "Value:"
      
      if (isHeader && this.useStyledHeader && currentY + 2 < contentY + contentHeight) {
        // Render header with tiny font in a nice color
        const headerText = line.replace(':', '').trim().toUpperCase()
        try {
          renderFontToFrameBuffer(this.frameBuffer, {
            text: headerText,
            x: contentX,
            y: currentY,
            fg: RGBA.fromInts(100, 200, 255, 255), // Light blue
            bg: RGBA.fromInts(20, 30, 40, 255),
            font: "tiny"
          })
          currentY += 2 // Skip 2 lines for tiny font
        } catch {
          // Fallback to regular text if font rendering fails
          this.frameBuffer.drawText(line, contentX, currentY, RGBA.fromInts(100, 200, 255, 255))
          currentY += 1
        }
      } else if (line.trim() === "" || line === "Value:") {
        // Empty line or value separator
        currentY += 1
      } else {
        // Regular content - wrap long lines
        const words = line.split(/\s+/)
        let current = ""
        
        for (const word of words) {
          const testLine = current + (current ? " " : "") + word
          if (testLine.length > contentWidth && current) {
            // Draw current line and start new one
            const color = line.includes("(no value") || line.includes("(empty)") || line.includes("(disabled)") ? 
              RGBA.fromInts(150, 150, 150, 255) : this.getTextColor()
            this.frameBuffer.drawText(current, contentX, currentY, color)
            currentY += 1
            current = word
            if (currentY >= contentY + contentHeight) break
          } else {
            current = testLine
          }
        }
        
        if (current && currentY < contentY + contentHeight) {
          const color = line.includes("(no value") || line.includes("(empty)") || line.includes("(disabled)") ? 
            RGBA.fromInts(150, 150, 150, 255) : this.getTextColor()
          this.frameBuffer.drawText(current, contentX, currentY, color)
          currentY += 1
        }
      }
    }
  }
}

async function getVaultsAllSubscriptions(): Promise<Array<{ name: string; vaultUri: string; id: string; location?: string }>> {
  const accountsCmd = await $`az account list -o json`.quiet()
  if (accountsCmd.exitCode !== 0) throw new Error("Failed to list Azure subscriptions. Run 'az login'.")
  const subs: Array<{ id: string }> = JSON.parse(accountsCmd.stdout.toString() || "[]")
  if (!subs.length) return []

  const listPromises = subs.map((s) => $`az keyvault list --subscription ${s.id} -o json`.quiet())
  const results = await Promise.all(listPromises)
  const all: any[] = []
  for (const r of results) {
    if (r.exitCode === 0) {
      const arr = JSON.parse(r.stdout.toString() || "[]")
      all.push(...arr)
    }
  }
  const mapped = all.map((v) => ({
    name: v.name,
    vaultUri: v.properties?.vaultUri ?? `https://${v.name}.vault.azure.net`,
    id: v.id,
    location: v.location,
  }))
  // Deduplicate by id
  const seen = new Set<string>()
  const dedup = mapped.filter((v) => {
    if (seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })
  // Sort by name
  dedup.sort((a, b) => a.name.localeCompare(b.name))
  return dedup
}

function formatDate(d?: Date): string {
  if (!d) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type ViewState = "selectVault" | "listSecrets" | "moveSelectTarget"

type FocusTarget = "list" | "filter" | "command"

async function main() {
  // Smoke test mode for packaging: start and stop quickly without Azure
  if (process.argv.includes("--smoke-test")) {
    try {
      const renderer = await createCliRenderer({
        targetFps: 1,
        useAlternateScreen: false,
        useConsole: false,
        useMouse: false,
        exitOnCtrlC: false,
      })
      renderer.stop()
      console.log("SMOKE_OK")
      process.exit(0)
    } catch (e) {
      console.error(e)
      process.exit(1)
    }
    return
  }

  const azVersion = await $`az --version`.quiet()
  if (azVersion.exitCode !== 0) {
    console.error("Azure CLI not found. Install it from https://aka.ms/azure-cli and run 'az login'.")
    process.exit(1)
  }

  const renderer = await createCliRenderer({ targetFps: 30, useAlternateScreen: true, useConsole: false, exitOnCtrlC: false })
  renderer.setBackgroundColor("#0e1113")

  // Header
  const header = new BoxRenderable("header", {
    x: 0,
    y: 0,
    width: renderer.terminalWidth,
    height: 3,
    bg: "#14181b",
    zIndex: 0,
    border: true,
    borderColor: "#00d4aa",
    title: "Azure Key Vault Explorer",
    titleAlignment: "left",
  })

  const hints = new TextRenderable("hints", {
    content: "Tab: focus | /: search | Enter: select/open | n: new | e: edit | c: copy | r: rename | m: move | Esc: back | :q: quit",
    x: 2,
    y: 2,
    zIndex: 1,
    fg: "#00d4aa",
  })

  renderer.add(header)
  renderer.add(hints)

  // Framing boxes
  const leftBox = new BoxRenderable("leftBox", {
    x: 0,
    y: 3,
    width: Math.floor(renderer.terminalWidth * 0.4),
    height: renderer.terminalHeight - 3,
    bg: "#0e1113",
    zIndex: 1,
    border: true,
    borderColor: "#2b3036",
    title: "Vaults",
  })
  const rightBox = new BoxRenderable("rightBox", {
    x: leftBox.width,
    y: 3,
    width: renderer.terminalWidth - leftBox.width,
    height: renderer.terminalHeight - 3,
    bg: "#0e1113",
    zIndex: 1,
    border: true,
    borderColor: "#2b3036",
    title: "Details",
  })
  renderer.add(leftBox)
  renderer.add(rightBox)

  // UI elements positioned absolutely inside boxes
  const filter = new InputElement("filter", {
    x: leftBox.x + 1,
    y: leftBox.y + 1,
    zIndex: 2,
    width: 10, // placeholder, updated in layout
    height: 3,
    border: true,
    borderColor: "#2b3036",
    focusedBorderColor: "#00a2ff",
    title: "Filter",
    placeholder: "Type to filter...",
    placeholderColor: "#6b7280",
    textColor: "#e5e7eb",
    cursorColor: "#00a2ff",
  })

  const list = new SelectElement("list", {
    x: leftBox.x + 1,
    y: filter.y + 4,
    zIndex: 2,
    width: 10, // placeholder, updated in layout
    height: 10, // placeholder, updated in layout
    border: false,
    options: [],
    selectedBackgroundColor: "#1f2937",
    selectedTextColor: "#93c5fd",
    descriptionColor: "#9ca3af",
    selectedDescriptionColor: "#e5e7eb",
    showDescription: true,
    wrapSelection: true,
    fastScrollStep: 5,
  })

  // Override list's handleKeyPress to prevent Enter when command bar is active
  const originalListHandleKeyPress = list.handleKeyPress.bind(list)
  list.handleKeyPress = function(key) {
    const keyName = typeof key === "string" ? key : key.name
    if ((keyName === "return" || keyName === "enter") && commandBar.visible) {
      return false
    }
    return originalListHandleKeyPress(key)
  }

  const details = new TextBlockElement("details", {
    x: rightBox.x + 1,
    y: rightBox.y + 1,
    zIndex: 2,
    width: rightBox.width - 2,
    height: rightBox.height - 2,
    border: false,
  })

  // Command bar (vim-like)
  const commandBar = new InputElement("command", {
    x: 0,
    y: 3,
    zIndex: 3,
    width: renderer.terminalWidth,
    height: 3,
    border: true,
    borderColor: "#2b3036",
    focusedBorderColor: "#00a2ff",
    title: "Command",
    placeholder: ":",
    placeholderColor: "#93a3b3",
    textColor: "#e5e7eb",
    cursorColor: "#00a2ff",
    visible: false,
  })

  renderer.add(filter)
  renderer.add(list)
  renderer.add(details)
  renderer.add(commandBar)

  // Layout helper
  function applyLayout(w: number, h: number) {
    const minLeft = 30
    const maxLeft = Math.max(minLeft, Math.min(Math.floor(w * 0.45), w - 50))
    const leftWidth = Math.max(minLeft, maxLeft)
    const topY = 3 + (commandBar.visible ? 3 : 0)
    const leftHeight = h - topY

    header.width = w

    leftBox.x = 0
    leftBox.y = topY
    leftBox.width = leftWidth
    leftBox.height = leftHeight

    rightBox.x = leftWidth
    rightBox.y = topY
    rightBox.width = Math.max(1, w - leftWidth)
    rightBox.height = leftHeight

    // Filter takes one line with border
    filter.x = leftBox.x + 1
    filter.y = leftBox.y + 1
    filter.setWidth(Math.max(1, leftBox.width - 2))
    filter.setHeight(3)

    const listTop = filter.y + 4
    const listHeight = Math.max(3, leftBox.height - (listTop - leftBox.y) - 1)
    list.x = leftBox.x + 1
    list.y = listTop
    list.setWidth(Math.max(1, leftBox.width - 2))
    list.setHeight(listHeight)

    details.x = rightBox.x + 1
    details.y = rightBox.y + 1
    details.setWidth(Math.max(1, rightBox.width - 2))
    details.setHeight(Math.max(1, rightBox.height - 2))

    // Command bar sits directly under the header when visible
    commandBar.x = 0
    commandBar.y = 3
    commandBar.setWidth(w)
    commandBar.setHeight(3)
  }

  applyLayout(renderer.terminalWidth, renderer.terminalHeight)

  // Helper to force immediate redraw
  const forceRender = () => {
    try {
      renderer.intermediateRender()
    } catch {}
  }

  // Clean quit: stop renderer then clear terminal (including scrollback)
  const quitClean = (code: number = 0) => {
    try {
      renderer.stop()
    } catch {}
    setTimeout(() => {
      try {
        // Clear screen and scrollback, move cursor home
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
      } catch {}
      process.exit(code)
    }, 20)
  }

  // State
  let state: ViewState = "selectVault"
  let focus: FocusTarget = "list"
  let allVaults: Awaited<ReturnType<typeof getVaultsAllSubscriptions>> = []
  let filteredVaults: typeof allVaults = []

  let secretClient: SecretClient | null = null
  let currentVault: { name: string; vaultUri: string } | null = null

  const secretCache = new Map<string, string | null>()
  let allSecrets: SecretProperties[] = []
  let filteredSecrets: SecretProperties[] = []
  let atSecretDetail: boolean = false

  type ActionMode = "none" | "editValue" | "rename" | "moveTarget" | "moveNewName" | "createName" | "createValue"
  let actionMode: ActionMode = "none"
  let actionSecret: SecretProperties | null = null
  let moveTargetVault: { name: string; vaultUri: string } | null = null
  let moveSourceSecret: SecretProperties | null = null
  let createNewSecretName: string | null = null

  // Helpers
  function setLeftTitle(title: string) {
    leftBox.title = title
  }

  function setListOptionsFromVaults(items: typeof allVaults) {
    list.setOptions(
      items.map((v) => ({
        name: v.name,
        description: v.location ? `location: ${v.location}` : v.vaultUri,
        value: v,
      })),
    )
  }

  function setListOptionsFromSecrets(items: SecretProperties[]) {
    list.setOptions(
      items.map((s) => ({
        name: s.name,
        description: `${s.enabled === false ? "(disabled) " : ""}${s.contentType ?? ""} ${s.updatedOn ? " · " + formatDate(s.updatedOn) : ""}`.trim(),
        value: s,
      })),
    )
  }

  async function selectVaultAndLoadSecrets(vault: { name: string; vaultUri: string }) {
    currentVault = vault
    setLeftTitle(`Secrets • ${currentVault!.name}`)
    filter.setValue("")
    focusList()
    state = "listSecrets"
    details.setText("Loading secrets...")
    forceRender()

    const credential = new AzureCliCredential()
    secretClient = new SecretClient(currentVault!.vaultUri, credential)

    const secrets: SecretProperties[] = []
    for await (const s of secretClient.listPropertiesOfSecrets()) {
      secrets.push(s)
    }
    allSecrets = secrets
    filteredSecrets = secrets
    setListOptionsFromSecrets(filteredSecrets)
    list.setSelectedIndex(0)
    details.setText("Select a secret to view details. Press Enter on a secret to load its value.")
    atSecretDetail = false
    forceRender()
  }

  async function loadAndShowSecret(sp: SecretProperties) {
    if (!secretClient) return
    if (!secretCache.has(sp.name)) {
      details.setText("Fetching secret value...", false)
      forceRender()
      try {
        const res = await secretClient.getSecret(sp.name)
        secretCache.set(sp.name, res.value ?? null)
      } catch (e) {
        secretCache.set(sp.name, null)
      }
    }
    const value = secretCache.get(sp.name)
    
    // Format with styled headers and better layout
    const secretDetails = []
    
    // Basic metadata
    secretDetails.push(`Name: ${sp.name}`)
    
    if (sp.contentType) {
      secretDetails.push(`Content Type: ${sp.contentType}`)
    }
    
    if (sp.enabled !== undefined) {
      secretDetails.push(`Enabled: ${sp.enabled ? 'Yes' : 'No'}`)
    }
    
    if (sp.updatedOn) {
      secretDetails.push(`Updated: ${formatDate(sp.updatedOn)}`)
    }
    
    if (sp.createdOn) {
      secretDetails.push(`Created: ${formatDate(sp.createdOn)}`)
    }
    
    if (sp.expiresOn) {
      secretDetails.push(`Expires: ${formatDate(sp.expiresOn)}`)
    }
    
    if (sp.tags && Object.keys(sp.tags).length > 0) {
      const tagStr = Object.entries(sp.tags).map(([k, v]) => `${k}=${v}`).join(", ")
      secretDetails.push(`Tags: ${tagStr}`)
    }
    
    // Add separator and value
    secretDetails.push("")
    secretDetails.push("Value:")
    
    const valText = value === null ? "(no value or access denied)" : 
                   value === "" ? "(empty)" : (value || "(empty)")
    
    // Format value with proper line breaks if it's JSON or long text
    if (valText.startsWith('{') || valText.startsWith('[')) {
      try {
        const formatted = JSON.stringify(JSON.parse(valText), null, 2)
        secretDetails.push(formatted)
      } catch {
        secretDetails.push(valText)
      }
    } else {
      secretDetails.push(valText)
    }
    
    details.setText(secretDetails.join('\n'), true)
    rightBox.title = `Details • ${sp.name}`
    atSecretDetail = true
    forceRender()
  }

  async function getSecretValue(sp: SecretProperties): Promise<string | null> {
    if (!secretClient) return null
    if (!secretCache.has(sp.name)) {
      try {
        const res = await secretClient.getSecret(sp.name)
        secretCache.set(sp.name, res.value ?? null)
      } catch {
        secretCache.set(sp.name, null)
      }
    }
    return secretCache.get(sp.name) ?? null
  }

  async function setSecretValue(name: string, value: string): Promise<void> {
    if (!secretClient) return
    await secretClient.setSecret(name, value)
    secretCache.set(name, value)
  }

  function goBackOneLayer() {
    if (actionMode === "moveNewName") {
      // Back from rename prompt to target-vault selection
      actionMode = "moveTarget"
      commandBar.visible = false
      state = "moveSelectTarget"
      setLeftTitle("Target Vault")
      setListOptionsFromVaults(filteredVaults)
      focusList()
      forceRender()
      return
    }
    if (atSecretDetail) {
      atSecretDetail = false
      details.setText("Select a secret to view details. Press Enter on a secret to load its value.")
      rightBox.title = "Details"
      forceRender()
      return
    }
    if (state === "moveSelectTarget") {
      // Return to secrets list
      state = "listSecrets"
      setLeftTitle(`Secrets • ${currentVault?.name ?? ""}`)
      setListOptionsFromSecrets(filteredSecrets)
      list.setSelectedIndex(0)
      focusList()
      forceRender()
      return
    }
    if (state === "listSecrets") {
      state = "selectVault"
      currentVault = null
      secretClient = null
      allSecrets = []
      filteredSecrets = []
      details.setText("")
      setLeftTitle("Vaults")
      // Keep current filteredVaults list and selection
      setListOptionsFromVaults(filteredVaults)
      list.setSelectedIndex(0)
      rightBox.title = "Details"
      focusList()
      forceRender()
      return
    }
  }

  function focusFilter() {
    focus = "filter"
    filter.focus()
    list.blur()
    commandBar.blur()
  }

  function focusList() {
    focus = "list"
    list.focus()
    filter.blur()
    commandBar.blur()
  }

  function openCommandBar() {
    focus = "command"
    commandBar.setTitle("Command")
    commandBar.setValue("")
    commandBar.visible = true
    commandBar.focus()
    applyLayout(renderer.terminalWidth, renderer.terminalHeight)
    forceRender()
  }

  function closeCommandBar() {
    commandBar.visible = false
    commandBar.blur()
    if (state === "selectVault" || state === "listSecrets") {
      if (focus === "filter") focusFilter()
      else focusList()
    }
    applyLayout(renderer.terminalWidth, renderer.terminalHeight)
    forceRender()
  }

  commandBar.on(InputElementEvents.ENTER, (val: string) => {
    const cmd = val
    ;(async () => {
      if (actionMode === "editValue" && actionSecret) {
        const newValue = cmd
        await setSecretValue(actionSecret.name, newValue)
        details.setText("Secret updated.")
        await loadAndShowSecret(actionSecret)
      } else if (actionMode === "rename" && actionSecret) {
        const newName = cmd.trim()
        if (newName && newName !== actionSecret.name) {
          const currentValue = (await getSecretValue(actionSecret)) ?? ""
          await secretClient!.setSecret(newName, currentValue)
          try {
            await secretClient!.beginDeleteSecret(actionSecret.name)
          } catch {}
          details.setText(`Renamed to ${newName}.`)
          await selectVaultAndLoadSecrets(currentVault!)
        }
      } else if (actionMode === "moveTarget" && actionSecret) {
        const targetName = cmd.trim().toLowerCase()
        const targetVault = allVaults.find((v) => v.name.toLowerCase() === targetName)
        if (targetVault) {
          moveTargetVault = targetVault
          actionMode = "moveNewName"
          commandBar.setTitle(`Move • New name for ${actionSecret.name} @ ${targetVault.name}`)
          commandBar.setValue(actionSecret.name)
          commandBar.visible = true
          commandBar.focus()
          return
        } else {
          details.setText(`Vault not found: ${cmd}`)
        }
      } else if (actionMode === "moveNewName" && actionSecret && moveTargetVault) {
        const newName = cmd.trim()
        const value = (await getSecretValue(actionSecret)) ?? ""
        const targetClient = new SecretClient(moveTargetVault.vaultUri, new AzureCliCredential())
        await targetClient.setSecret(newName || actionSecret.name, value)
        details.setText(`Copied to vault ${moveTargetVault.name} as ${newName || actionSecret.name}.`)
        // Do not delete from source
        await selectVaultAndLoadSecrets(currentVault!)
      } else if (actionMode === "createName") {
        const name = cmd.trim()
        if (!name) {
          details.setText("Name cannot be empty.")
        } else {
          createNewSecretName = name
          actionMode = "createValue"
          commandBar.setTitle(`Create • value for ${name}`)
          commandBar.setValue("")
          commandBar.visible = true
          commandBar.focus()
          applyLayout(renderer.terminalWidth, renderer.terminalHeight)
          forceRender()
          return
        }
      } else if (actionMode === "createValue" && createNewSecretName) {
        const value = cmd
        await secretClient!.setSecret(createNewSecretName, value)
        secretCache.set(createNewSecretName, value)
        details.setText(`Created secret ${createNewSecretName}.`)
        const createdName = createNewSecretName
        createNewSecretName = null
        await selectVaultAndLoadSecrets(currentVault!)
        // Select the newly created secret and show details
        const idx = filteredSecrets.findIndex((s) => s.name === createdName)
        if (idx >= 0) {
          list.setSelectedIndex(idx)
          await loadAndShowSecret(filteredSecrets[idx])
        }
      } else {
        const trimmed = cmd.trim()
        if (trimmed === "q" || trimmed === "quit") {
          quitClean(0)
        }
      }
      actionMode = "none"
      actionSecret = null
      closeCommandBar()
      forceRender()
    })()
  })

  filter.on(InputElementEvents.INPUT, (val: string) => {
    if (state === "selectVault") {
      filteredVaults = allVaults.filter((v) => v.name.toLowerCase().includes(val.toLowerCase()))
      setListOptionsFromVaults(filteredVaults)
    } else if (state === "listSecrets") {
      filteredSecrets = allSecrets.filter((s) => s.name.toLowerCase().includes(val.toLowerCase()))
      setListOptionsFromSecrets(filteredSecrets)
    } else if (state === "moveSelectTarget") {
      filteredVaults = allVaults.filter((v) => v.name.toLowerCase().includes(val.toLowerCase()))
      setListOptionsFromVaults(filteredVaults)
    }
  })

  list.on(SelectElementEvents.SELECTION_CHANGED, (_idx: number, selected) => {
    if (focus !== "list") return
    if (state === "listSecrets" && selected?.value) {
      const sp: SecretProperties = selected.value
      const meta = [
        `Name: ${sp.name}`,
        sp.contentType ? `Content Type: ${sp.contentType}` : "",
        sp.enabled !== undefined ? `Enabled: ${sp.enabled ? 'Yes' : 'No'}` : "",
        sp.updatedOn ? `Updated: ${formatDate(sp.updatedOn)}` : "",
        sp.tags ? `Tags: ${Object.entries(sp.tags).map(([k, v]) => `${k}=${v}`).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
      details.setText(meta + "\n\nValue: (press Enter to load)", true)
    }
  })

  list.on(SelectElementEvents.ITEM_SELECTED, async (_idx: number, selected) => {
    if (!selected) return
    if (focus !== "list") return
    if (state === "selectVault") {
      await selectVaultAndLoadSecrets(selected.value)
      focusList()
    } else if (state === "listSecrets") {
      const sp: SecretProperties = selected.value
      await loadAndShowSecret(sp)
      focusList()
    } else if (state === "moveSelectTarget") {
      // Select target vault, then prompt for new name
      const targetVault = selected.value as { name: string; vaultUri: string }
      moveTargetVault = targetVault
      actionMode = "moveNewName"
      commandBar.setTitle(`Move • New name for ${moveSourceSecret?.name ?? ""} @ ${targetVault.name}`)
      commandBar.setValue(moveSourceSecret?.name ?? "")
      commandBar.visible = true
      commandBar.focus()
      applyLayout(renderer.terminalWidth, renderer.terminalHeight)
      forceRender()
    }
  })

  // ENTER from filter acts like opening current selection
  filter.on(InputElementEvents.ENTER, async () => {
    if (commandBar.visible) return
    const current = list.getSelectedOption()
    if (!current) return
    if (state === "selectVault") {
      await selectVaultAndLoadSecrets(current.value)
      focusList()
    } else if (state === "listSecrets") {
      await loadAndShowSecret(current.value)
      focusList()
    } else if (state === "moveSelectTarget") {
      // Same as selecting in list
      const targetVault = current.value as { name: string; vaultUri: string }
      moveTargetVault = targetVault
      actionMode = "moveNewName"
      commandBar.setTitle(`Move • New name for ${moveSourceSecret?.name ?? ""} @ ${targetVault.name}`)
      commandBar.setValue(moveSourceSecret?.name ?? "")
      commandBar.visible = true
      commandBar.focus()
      applyLayout(renderer.terminalWidth, renderer.terminalHeight)
      forceRender()
    }
  })

  // Global key handling
  const keys = getKeyHandler()
  keys.on("keypress", (key: ParsedKey) => {
    const name = key.name

    if (name === "/") {
      focusFilter()
      return
    }

    if (name === ":") {
      openCommandBar()
      return
    }

    if (name === "tab") {
      if (focus === "filter") focusList()
      else focusFilter()
      return
    }

    // No exit on Escape; just close command bar if open
    if (name === "escape") {
      if (commandBar.visible) {
        closeCommandBar()
        return
      }
      if (focus === "filter") {
        // Leave filter, return focus to list instead of navigating up a layer
        focusList()
        return
      }
      else goBackOneLayer()
      return
    }

    // Secret actions when in secrets view
    if (state === "listSecrets" && focus === "list" && atSecretDetail) {
      const selected = list.getSelectedOption()
      const sp: SecretProperties | null = selected?.value ?? null
      if (name === "c" && sp) {
        ;(async () => {
          const val = (await getSecretValue(sp)) ?? ""
          try {
            const p = Bun.spawn(["pbcopy"], { stdin: "pipe" })
            p.stdin!.write(new TextEncoder().encode(val))
            p.stdin!.end()
            details.setText("Secret copied to clipboard.")
          } catch {
            details.setText("Failed to copy to clipboard.")
          }
          forceRender()
        })()
        return
      }
      if (name === "e" && sp) {
        ;(async () => {
          const currentVal = (await getSecretValue(sp)) ?? ""
          actionMode = "editValue"
          actionSecret = sp
          commandBar.setTitle(`Edit value • ${sp.name}`)
          commandBar.setValue(currentVal)
          commandBar.visible = true
          commandBar.focus()
          applyLayout(renderer.terminalWidth, renderer.terminalHeight)
          forceRender()
        })()
        return
      }
      if (name === "r" && sp) {
        actionMode = "rename"
        actionSecret = sp
        commandBar.setTitle(`Rename • ${sp.name} →`)
        commandBar.setValue("")
        commandBar.visible = true
        commandBar.focus()
        applyLayout(renderer.terminalWidth, renderer.terminalHeight)
        forceRender()
        return
      }
      if (name === "m" && sp) {
        // Enter move target selection state; repopulate left list with vaults
        actionMode = "moveTarget"
        actionSecret = sp
        moveSourceSecret = sp
        moveTargetVault = null
        state = "moveSelectTarget"
        setLeftTitle("Target Vault")
        filter.setValue("")
        filteredVaults = allVaults
        setListOptionsFromVaults(filteredVaults)
        list.setSelectedIndex(0)
        focusList()
        details.setText(`Select target vault for ${sp.name}`)
        rightBox.title = `Move • ${sp.name}`
        forceRender()
        return
      }
    }

    // Create new secret in secrets view (does not require being in detail view)
    if (state === "listSecrets" && focus === "list" && name === "n") {
      actionMode = "createName"
      createNewSecretName = null
      commandBar.setTitle("Create • secret name")
      commandBar.setValue("")
      commandBar.visible = true
      commandBar.focus()
      applyLayout(renderer.terminalWidth, renderer.terminalHeight)
      forceRender()
      return
    }

    if (name === "b") {
      goBackOneLayer()
    }
  })

  // Initial data load (all subscriptions)
  details.setText("Loading Key Vaults from Azure CLI across all subscriptions...")
  try {
    allVaults = await getVaultsAllSubscriptions()
    filteredVaults = allVaults
    setListOptionsFromVaults(filteredVaults)
    list.setSelectedIndex(0)
    details.setText("Select a Key Vault on the left, then browse secrets. Use filter to narrow results.")
    forceRender()
  } catch (e: any) {
    details.setText(`Failed to load Key Vaults.\n${e?.message ?? e}`)
    forceRender()
  }

  // Focus defaults
  focusList()

  // Resize handling
  renderer.on("resize", (w: number, h: number) => {
    applyLayout(w, h)
    forceRender()
  })

  renderer.start()

  // Ensure first render uses final terminal dimensions (some terminals report
  // correct size only after alt screen & setup). Do an immediate reflow shortly after start.
  setTimeout(() => {
    applyLayout(renderer.terminalWidth, renderer.terminalHeight)
    forceRender()
  }, 50)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
}) 