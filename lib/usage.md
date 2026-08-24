# metascope — interactive file viewer

| Command            | Meaning                               |
| ------------------ | ------------------------------------- |
| `metascope [path]` | open file or directory (default: `.`) |
| `$VIEWER [path]`   | when `export VIEWER=metascope`        |

| Path      | Behavior                                             |
| --------- | ---------------------------------------------------- |
| file      | view with syntax highlighting                        |
| directory | `.js` / `.mjs` / `.ts` / `.sh` (and `.md`) as blocks |
| `init.js` | shared js prelude (`init.mjs` / `init.ts` too)       |

| Key     | Action    |
| ------- | --------- |
| ↑ ↓ ← → | navigate  |
| Space   | status    |
| /       | search    |
| ▶       | run block |
| ?       | help      |
| q / Esc | quit      |
