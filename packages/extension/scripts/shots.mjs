#!/usr/bin/env node
// Screenshots of preview/ scenarios for PRs. See preview/README.md.
//
//   pnpm shots --list
//   pnpm shots newtab "scanner-history?state=loading" [--dark] [--before origin/main] [--publish]

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const extension = fileURLToPath(new URL("..", import.meta.url));
const git = (args, input) => execFileSync("git", args, { cwd: extension, input, encoding: "utf8" }).trim();
const repo = git(["rev-parse", "--show-toplevel"]);
const extensionInRepo = path.relative(repo, extension);

const { values: options, positionals: scenarios } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: "boolean" },
    dark: { type: "boolean" },
    before: { type: "string" },
    out: { type: "string", default: path.join(extension, ".shots") },
    publish: { type: "boolean" },
    name: { type: "string" },
  },
});

if (!options.list && scenarios.length === 0) {
  console.error("Usage: pnpm shots <scenario[?query]>... [--dark] [--before <ref>] [--publish [--name <name>]] | --list");
  process.exit(1);
}

// Pinned so clocks and "5 min ago" labels match between runs and before/after.
const FIXED_TIME = new Date("2026-10-18T10:30:00");
const themes = options.dark ? ["light", "dark"] : ["light"];
const slug = (value) => value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch()).catch(() => {
  throw new Error("No Chrome found. Install Google Chrome, or run: pnpm exec playwright-core install chromium");
});
const cleanup = [() => browser.close()];

try {
  if (options.list) {
    await withPreview(extension, async (base) => {
      const page = await browser.newPage();
      await page.goto(`${base}/preview/`);
      await page.waitForFunction(() => window.__voltPreview?.scenarios);
      const list = await page.evaluate(() => window.__voltPreview.scenarios);
      for (const [name, description] of Object.entries(list)) console.log(`${name.padEnd(20)} ${description}`);
    });
  } else {
    mkdirSync(options.out, { recursive: true });
    const sides = [{ label: options.before ? "after" : "", root: extension }];
    if (options.before) sides.unshift({ label: "before", root: checkout(options.before) });

    const shots = new Map();
    for (const side of sides) {
      await withPreview(side.root, async (base) => {
        for (const scenario of scenarios) for (const theme of themes) {
          const key = slug(scenario) + (theme === "dark" ? "-dark" : "");
          const file = path.join(options.out, `${key}${side.label ? `-${side.label}` : ""}.png`);
          try {
            await shoot(base, scenario, theme, file);
            shots.set(key, [...(shots.get(key) ?? []), file]);
          } catch (error) {
            console.warn(`✗ ${scenario} (${theme}${side.label ? `, ${side.label}` : ""}): ${error.message}`);
            process.exitCode = 1;
          }
        }
      });
    }

    const files = [];
    for (const [key, pair] of shots) {
      if (pair.length === 2) {
        const file = path.join(options.out, `${key}-compare.png`);
        await sideBySide(pair, file);
        files.push(file);
      }
      files.push(...pair);
    }
    for (const file of files) console.log(file);
    // Never publish a partial set.
    if (options.publish && files.length && !process.exitCode) publish(files);
  }
} finally {
  for (const step of cleanup.reverse()) await step();
}

async function withPreview(root, run) {
  const server = await createServer({
    configFile: path.join(root, "preview/vite.config.ts"),
    server: { port: 0, strictPort: false, open: false },
  });
  await server.listen();
  try {
    await run(server.resolvedUrls.local[0].replace(/\/$/, ""));
  } finally {
    await server.close();
  }
}

async function shoot(base, scenario, colorScheme, file) {
  const [name, query = ""] = scenario.split("?");
  const page = await browser.newPage({ colorScheme, deviceScaleFactor: 2 });
  try {
    await page.clock.setFixedTime(FIXED_TIME);
    const problems = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("response", (response) => { if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`); });
    await page.goto(`${base}/preview/?scenario=${encodeURIComponent(name)}&${query}`);
    const settled = () => document.documentElement.dataset.previewReady || document.documentElement.dataset.previewError;
    await page.waitForFunction(settled, null, { timeout: 20_000 }).catch(() => {
      throw new Error(`never became ready${problems.length ? `: ${problems.join("; ")}` : ""}`);
    });
    const error = await page.evaluate(() => document.documentElement.dataset.previewError);
    if (error) throw new Error(error);
    for (const problem of problems) console.warn(`  ${scenario}: ${problem}`);
    const { viewport, fullPage } = await page.evaluate(() => window.__voltPreview);
    await page.setViewportSize(viewport);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: file, fullPage: !!fullPage, animations: "disabled" });
  } finally {
    await page.close();
  }
}

// A detached worktree at `ref` that shares this checkout's node_modules and
// renders this checkout's scenarios, so only the app code differs.
function checkout(ref) {
  const sha = git(["rev-parse", "--short", ref]);
  // A fresh directory per run, so a registration left by an interrupted run never collides.
  const dir = mkdtempSync(path.join(tmpdir(), `volt-shots-${sha}-`));
  git(["worktree", "add", "--detach", dir, sha]);
  cleanup.push(() => git(["worktree", "remove", "--force", dir]));
  // Untracked but needed: installed packages and WXT's generated tsconfig.
  for (const shared of ["node_modules", path.join(extensionInRepo, "node_modules"), path.join(extensionInRepo, ".wxt")]) {
    symlinkSync(path.join(repo, shared), path.join(dir, shared));
  }
  const root = path.join(dir, extensionInRepo);
  rmSync(path.join(root, "preview"), { recursive: true, force: true });
  cpSync(path.join(extension, "preview"), path.join(root, "preview"), { recursive: true });
  return root;
}

async function sideBySide([before, after], file) {
  const image = (label, src) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${readFileSync(src).toString("base64")}"></figure>`;
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<style>
    body{margin:0;display:flex;gap:24px;padding:20px;background:#f1f5f9;width:max-content;font:600 14px system-ui;color:#475569}
    figure{margin:0}figcaption{margin-bottom:8px}img{display:block;zoom:.5;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
  </style>${image("Before", before)}${image("After", after)}`);
  await page.locator("body").screenshot({ path: file });
  await page.close();
}

// Commits the images to a pr-assets/<name> branch (never merged; keeps them out
// of main) and prints Markdown for the PR description.
function publish(files) {
  const name = options.name ?? slug(git(["branch", "--show-current"]));
  if (!name) throw new Error("No branch checked out; pass --publish --name <name>.");
  const ref = `refs/heads/pr-assets/${name}`;
  const parent = git(["ls-remote", "origin", ref]).split(/\s/)[0];
  if (parent) git(["fetch", "-q", "origin", ref]);
  const tree = git(["mktree"], files.map((file) => `100644 blob ${git(["hash-object", "-w", file])}\t${path.basename(file)}`).join("\n") + "\n");
  const commit = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `Screenshots for ${name}`]);
  git(["push", "-q", "origin", `${commit}:${ref}`]);
  const repoSlug = git(["remote", "get-url", "origin"]).replace(/^.*github\.com[:/]|\.git$/g, "");
  console.log(`\nPushed to pr-assets/${name}. Markdown:\n`);
  for (const file of files) {
    const base = path.basename(file);
    console.log(`![${base.replace(/\.png$/, "")}](https://github.com/${repoSlug}/blob/${commit}/${base}?raw=true)`);
  }
}
