import fs from "node:fs";
import path from "node:path";

// Minimal .env loader so hackathon devs don't need to `source` or export vars.
// Only sets keys that aren't already present in process.env.
export function loadDotEnvFromCwd(fileName = ".env") {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();

    // Strip simple quotes
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

