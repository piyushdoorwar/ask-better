// Fetch the public user count shown on AskBetter's Chrome Web Store listing.
// This runs only in GitHub Actions and requires no credentials or visitor data.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = join(root, "site/index.html");
const storeUrl =
  "https://chromewebstore.google.com/detail/askbetter/eelecokniegejkbbklgdpnhmhgfkfpif?hl=en";

function parseUserCount(html) {
  const match = html.match(/>([\d,.]+\s*[KMB]?\+?)\s+users</i);
  if (!match) throw new Error("Chrome Web Store page did not contain a user count");

  return match[1].replaceAll(" ", "").toUpperCase();
}

async function main() {
  const response = await fetch(storeUrl, {
    headers: { "User-Agent": "askbetter-site-stats" },
  });
  if (!response.ok) throw new Error(`Chrome Web Store returned HTTP ${response.status}`);

  const users = parseUserCount(await response.text());
  const page = await readFile(outputFile, "utf8");
  const marker = /(<span id="storeUsers">)([^<]+)(<\/span>)/;
  const current = page.match(marker)?.[2];
  if (!current) throw new Error("Site page does not contain the Chrome user-count marker");

  if (current === users) {
    console.log(`Chrome user count is unchanged at ${users}.`);
    return;
  }

  const updatedPage = page.replace(marker, (_match, start, _current, end) => {
    return `${start}${users}${end}`;
  });
  await writeFile(outputFile, updatedPage);
  console.log(`Updated Chrome user count to ${users}.`);
}

main().catch((error) => {
  console.error(`Failed to refresh Chrome user count: ${error.message}`);
  process.exitCode = 1;
});
