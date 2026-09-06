import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"


export function runCommand(cmd, args) {
  return execFileSync(
    cmd, args,
    {
      cwd: ".",
      encoding: "utf8",
    }
  )
}

export function ensureWranglerLoggedin() {
  try {
    runCommand("npx", ["wrangler", "auth", "token"])

  } catch {
    runCommand("npx", ["wrangler", "login"])
  }
}