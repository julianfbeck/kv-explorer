#!/usr/bin/env bun
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
await import(join(__dirname, "..", "kv-explorer.ts")) 