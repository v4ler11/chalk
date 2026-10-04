# Releasing Chalk

Everything needed to cut a release, in the order it has to happen, with the
exact commands and the exact things that go wrong. Derived from the 0.1.0
release; the parts that are load-bearing are the *ad-hoc signing step* and the
*`--target main`* on the release command — both were failures first.

## What ships

One artifact: `Chalk_<version>_aarch64.dmg`, built on an Apple Silicon Mac
(`host: aarch64-apple-darwin`). It contains `Chalk.app` and an `Applications`
symlink. Nothing else — no `.pkg`, no updater bundle, no zip.

## Prerequisites

```sh
node -v && npm -v          # for `npm run build` (tsc + vite)
rustc -vV | grep host      # must be aarch64-apple-darwin
rustup target list --installed | grep aarch64-apple-darwin
gh --version
```

The macOS SDK comes with the Xcode command line tools; Tauri needs no more.
`src-tauri/target/` is 12G for a warm debug build — a release build compiles
every dependency again in the `release` profile (about 2 minutes warm).

## 1. Version

`0.1.0` lives in three files and must agree — it is also the dmg's filename:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `version`

The third is not what names the artifact, but it is what the app reports as its
own client version to every MCP server it speaks to, so leaving it behind ships
a 0.1.1 build that calls itself 0.1.0.

## 2. No secrets in the tree

GitHub push protection blocks the push, not the release, so this bites early —
it did: a live `sk-or-v1-…` was hardcoded in `src-tauri/src/settings.rs`
(`defaults()`), and the push was rejected with `GH013`.

`defaults()` must ship `api_key: String::new()`. The app reads the user's key
from `~/.chalk/settings.yaml` (0600), and the Settings window writes it there;
the file is the config, not a cache, so an empty default loses nothing.

```sh
grep -rnE "sk-or-v1-[A-Za-z0-9]{24,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY" \
  --exclude-dir=target --exclude-dir=node_modules --exclude-dir=dist .
```

Test fixtures (`sk-1`, `sk-quoted`, the harness's `sk-or-v1-abcdefghijklmnop`)
are fine. If something does get committed, **amend before pushing** — nothing
has reached the remote yet at that point:

```sh
git commit --amend
git reflog expire --expire=now --all && git gc --prune=now
git grep -E "sk-or-v1-[A-Za-z0-9]{24,}" $(git rev-list --all) --   # must be empty
```

A key that travelled in a rejected pack has been seen by GitHub: rotate it at
the provider regardless.

## 3. Tests

```sh
cd src-tauri && cargo test --no-default-features
```

Expect `41 passed; 0 failed`, plus `mcp_smoke` which is `#[ignore]`d by design
(it spawns real servers and needs `python3`). Run it explicitly with
`--ignored` only when the MCP client changed. Note `cargo test` compiles the
integration tests: a `Server`-shaped struct that gained a field and was not
migrated in `tests/mcp_smoke.rs` fails the whole target, not just its own test.

## 4. Build — and sign ad-hoc

```sh
APPLE_SIGNING_IDENTITY="-" npm run tauri build -- --target aarch64-apple-darwin --bundles dmg
```

### Why the identity

Without it, Tauri leaves only the **linker's** ad-hoc signature on the
executable, and the bundle's signature is therefore invalid:

```
CodeDirectory … flags=0x20002(adhoc,linker-signed)
spctl: code has no resources but signature indicates they must be present
```

macOS shows that as **"Chalk is damaged and can't be opened"** — not the
ordinary unidentified-developer prompt the release notes tell people to expect.
With `APPLE_SIGNING_IDENTITY="-"` the whole bundle is signed:

```
Identifier=com.valerii.chat-ui
CodeDirectory … flags=0x10002(adhoc,runtime)
TeamIdentifier=not set
```

`--bundles dmg` re-runs cargo (seconds when warm), builds the app, signs it,
then makes the dmg — and **removes the standalone `.app` afterwards** (Tauri
logs `Cleaning …/macos/Chalk.app`, and `bundle/macos/` is left empty). So the
verified artifact is the dmg, read through its mounted volume; the default
`--bundles all` is what leaves `bundle/macos/Chalk.app` in place.

An unsigned identity is expected to be rejected by `spctl` — that is the
unnotarized state, and the notes say **right-click → Open**. For notarization
set `APPLE_SIGNING_IDENTITY` to a *Developer ID Application* identity plus
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (or the `APPLE_API_KEY` trio);
Tauri then notarizes and staples, and the right-click note must be dropped from
the notes.

Output:

```
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Chalk_0.1.0_aarch64.dmg
```

A running `tauri dev` does not block the build — it holds the target lock only
while it compiles.

## 5. Verify the artifact

Mount the dmg and verify what a user receives:

```sh
cd src-tauri/target/aarch64-apple-darwin/release/bundle
hdiutil attach -nobrowse -readonly dmg/Chalk_0.1.0_aarch64.dmg     # /Volumes/Chalk
ls -la /Volumes/Chalk/            # Chalk.app, Applications -> /Applications, .VolumeIcon.icns
defaults read /Volumes/Chalk/Chalk.app/Contents/Info.plist CFBundleIdentifier   # com.valerii.chat-ui

file /Volumes/Chalk/Chalk.app/Contents/MacOS/chalk            # Mach-O 64-bit executable arm64
lipo -archs /Volumes/Chalk/Chalk.app/Contents/MacOS/chalk     # arm64 (thin)
codesign -dv --verbose=2 /Volumes/Chalk/Chalk.app 2>&1 | grep -E "Identifier|CodeDirectory|Signature"
codesign --verify --deep --strict --verbose=2 /Volumes/Chalk/Chalk.app   # valid on disk / satisfies its Designated Requirement
spctl -a -vvv /Volumes/Chalk/Chalk.app                        # "rejected" is correct when unnotarized
shasum -a 256 dmg/Chalk_0.1.0_aarch64.dmg
```

The two `codesign` lines are the pass/fail gate. `spctl` rejecting is not a
failure; `codesign --verify` failing is.

## 6. Smoke the bundle

With the dmg still mounted from step 5, run the built app itself — not the dev
server — and read its stdout:

```sh
/Volumes/Chalk/Chalk.app/Contents/MacOS/chalk > /tmp/chalk-release.log 2>&1 & pid=$!
sleep 12; kill $pid; cat /tmp/chalk-release.log
```

Expect:

```
[info] app started; models=[…] provider=https://openrouter.ai/api/v1 endpoint=https://openrouter.ai/api/v1
[info] mcp: 1 server(s) declared, 1 enabled
[info] tools offered: 11 from 1 enabled server(s), 0 unreachable
```

That proves the signature, the settings file, and the MCP client all survived
packaging. Detach afterwards: `hdiutil detach /Volumes/Chalk`.

## 7. Authenticate `gh`

A fresh shell has no `GH_TOKEN`/`GITHUB_TOKEN`, `~/.config/gh/hosts.yml` is
`{}`, and the keychain has no github.com entry — the git remote is SSH, so
having push access does **not** mean the API is authenticated. The device flow
needs one tap from the user, in a pty so the code can be read out:

```sh
gh auth login --hostname github.com --git-protocol ssh --web --skip-ssh-key
```

It prints `First copy your one-time code: XXXX-XXXX`, then waits for Enter
before opening the browser. Send it the Enter, tell the user the code, wait for
the process to exit 0, then confirm:

```sh
gh auth status      # expect: Logged in to github.com account … scopes 'repo'
```

## 8. Release notes

Put them in a file outside the repo (`/tmp/chalk-release-notes.md`) and pass
`--notes-file`. What earns its place, in this order:

1. One line on what the app is, then **platform and commit**.
2. What it does — streaming transcript, tool calls as rows in their message,
   MCP (stdio + http, `lazy`, `autoRun`), SQLite history, settings in
   `~/.chalk/settings.yaml`.
3. Install: drag into Applications, and the **unsigned build caveat**
   (right-click → Open) if it is not notarized.
4. **First run: the app ships with no API key.** Settings window or the file,
   with a YAML snippet — the key is the first thing a new user lacks.
5. `sha256:` of the dmg, appended once the final artifact exists.

## 9. Create the release

```sh
gh release create v0.1.0 --repo v4ler11/chalk --target main \
  --title "Chalk 0.1.0 — Apple Silicon" \
  --notes-file /tmp/chalk-release-notes.md \
  src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Chalk_0.1.0_aarch64.dmg
```

`--target` takes a **branch name**. A short SHA fails with
`HTTP 422: Validation Failed … Release.target_commitish is invalid`; if a tag
must hang off a specific commit, pass the full 40-character SHA.

The dmg is ~6.6 MB and uploads in about a minute; the command backgrounds
itself, so let it finish rather than polling.

## 10. Confirm what was published

```sh
gh release view v0.1.0 --repo v4ler11/chalk --json tagName,name,isDraft,isPrerelease,url,assets
git ls-remote origin refs/tags/v0.1.0 refs/heads/main
```

Checks that matter: `state: uploaded`, and the asset's `digest` equal to the
local `shasum -a 256` — GitHub computing the same hash independently is the
upload's own proof. Confirm the tag points at the same commit as `main`.

## Failure catalogue

| Symptom | Cause | Fix |
|---|---|---|
| `GH013: Repository rule violations … Push cannot contain secrets` | a key in the source (`settings.rs` defaults) | empty the default, amend, expire reflog, gc, push again |
| `spctl: code has no resources but signature indicates they must be present` | built without `APPLE_SIGNING_IDENTITY` → linker-only signature | rebuild with `APPLE_SIGNING_IDENTITY="-"` |
| `HTTP 422 … target_commitish is invalid` | `--target` given a short SHA | use `main` or a full SHA |
| `cargo test` fails to compile `tests/mcp_smoke.rs` | `Server` gained a field, fixture not migrated | add the field to the fixture (`lazy`, `description`) |
| dmg contains an old build | re-bundled without re-running the frontend build | Tauri runs `beforeBuildCommand` itself; just re-run the build |
