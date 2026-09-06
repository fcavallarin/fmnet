import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { runCommand, ensureWranglerLoggedin } from "./utils.js"

const name = "{{ name }}"

const here = path.dirname(fileURLToPath(import.meta.url))
const template = path.resolve(
  here,
  "../packages/server/templates/cloudflare"
)

const destination = path.resolve(here, "..", "deployments", name)

ensureWranglerLoggedin()

console.log("Creating resources")
console.log()

let out
out = runCommand(
  "npx",
  ["wrangler", "d1", "create", "--binding", "DB", "--update-config", name],
)
console.log(out)
out = runCommand(
  "npx",
  ["wrangler", "d1", "migrations", "apply", name, "--remote"],
)
console.log(out)
out = runCommand(
  "npx",
  ["wrangler", "r2", "bucket", "create", name],
)
console.log(out)
out = runCommand(
  "npx",
  ["wrangler", "deploy"],
)
console.log(out)

