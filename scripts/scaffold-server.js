import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const name = process.argv[2]

if (!name) {
  console.error("Usage: npm run scaffold:server -- <name>")
  process.exit(1)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const template = path.resolve(
  here,
  "../packages/server/templates/cloudflare"
)

const destination = path.resolve(here, "..", "deployments", name)
if (fs.existsSync(destination)) {
  console.error(`Target directory already exists: ${destination}`)
  process.exit(1)
}

fs.cpSync(template, destination, {
  recursive: true
})

const wranglerConfigPath = path.resolve(destination, "wrangler.jsonc")
let fc = fs.readFileSync(wranglerConfigPath, "utf-8")
fs.writeFileSync(wranglerConfigPath, fc.replaceAll("{{ name }}", name), "utf-8")

const packageJson = path.resolve(destination, "package.json")
fc = fs.readFileSync(packageJson, "utf-8")
fs.writeFileSync(packageJson, fc.replaceAll("{{ name }}", name), "utf-8")


const out = execFileSync(
  "npm",
  ["install", "-w", `${name}-server`],
  {
    cwd: ".",
    encoding: "utf8",
  }
)

console.log(`
  SEPT server created in ${destination}

  Deploy it:
    cd ${destination}
    wrangler d1 create --binding DB --update-config ${name}
    wrangler r2 bucket create --binding STORAGE --update-config ${name}
    wrangler d1 migrations apply ${name} --remote
    wrangler deploy
`)
console.log()

