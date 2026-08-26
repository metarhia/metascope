# metascope

Interactive terminal file viewer for Metarhia — markdown, syntax highlighting, keyboard navigation, live resize.

Style examples: [EXAMPLES.md](EXAMPLES.md)

```bash
metascope EXAMPLES.md
```

---

## Install (Linux)

```bash
cd .MetaTools/metascope
npm run install:local
source ~/.bashrc   # or open a new terminal
```

Installs `~/.local/bin/metascope` and writes `~/.bashrc.d/metascope.sh`:

```bash
export PATH="$HOME/.local/bin:$PATH"
export VIEWER="$HOME/.local/bin/metascope"
```

Then from anywhere (after `source ~/.bashrc` or a new terminal):

```bash
metascope README.md
$VIEWER path/to/file.md     # standard VIEWER
metascope .
```

Midnight Commander: install also sets F3 to `$VIEWER` in `~/.config/mc/mc.ext.ini`
(`View=%var{VIEWER:less} %f`, `use_internal_view=false`). Restart `mc` after install.

Manual (without install script):

```bash
export PATH="$HOME/.local/bin:$PATH"
export VIEWER="$HOME/.local/bin/metascope"
```

Uninstall:

```bash
npm run uninstall:local
```

Alternatives: `npm link` / `npm install -g .`
---

## Quick start (no install)

```bash
cd .MetaTools/metascope
npm install
node bin/metascope.js README.md
```

Non-TTY / pipes: prints rendered output once and exits.

---

## Keyboard

| Key                 | Action                       |
| :------------------ | :--------------------------- |
| `↑` / `k`           | Line up                      |
| `↓` / `j`           | Line down                    |
| `←` / `b` / `PgUp`  | Page up                      |
| `→` / `PgDn`        | Page down                    |
| `Ctrl+U` / `Ctrl+D` | Half page                    |
| `g` / `Home`        | Top                          |
| `G` / `End`         | Bottom                       |
| `Space`             | Toggle status line           |
| `/`                 | Search                       |
| `n` / `N`           | Next / previous match        |
| `l`                 | Toggle line numbers          |
| `w`                 | Toggle soft wrap             |
| `H` / `L`           | Horizontal scroll (wrap off) |
| `r`                 | Reload file                  |
| `?`                 | Help                         |
| `Esc`               | Back to picker / quit        |
| `q`                 | Quit                         |

## Formats

Whole-file view (same soft code band): `md`, `js`, `mjs`, `ts`, `.d.ts`, `txt`, `json`, `csv`, `html`, `css`.

## Stack

Only Metarhia deps: [concolor](https://github.com/metarhia/concolor), [metautil](https://github.com/metarhia/metautil).

Node `>= 18`.
