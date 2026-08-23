#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const binSrc = path.join(root, 'bin', 'metascope.js');
const home = os.homedir();
const destDir = process.env.METASCOPE_BIN_DIR
  ? path.resolve(process.env.METASCOPE_BIN_DIR)
  : path.join(home, '.local', 'bin');
const dest = path.join(destDir, 'metascope');

const MARK_BEGIN = '# >>> metascope >>>';
const MARK_END = '# <<< metascope <<<';

const shellBlock =
  `${MARK_BEGIN}
# Prefer metascope as the system text viewer (mc F3 / $VIEWER).
# Do NOT set PAGER — git log/branch and man would open metascope.
export PATH="$HOME/.local/bin:$PATH"
export VIEWER="$HOME/.local/bin/metascope"
# Clear a leftover PAGER=metascope from older installs.
if [ "\${PAGER-}" = "$HOME/.local/bin/metascope" ] || ` +
  `[ "\${PAGER-}" = "metascope" ]; then
  unset PAGER
fi
# Override /etc/profile.d/mc.sh alias so F3 always sees VIEWER.
if [ -f /usr/libexec/mc/mc-wrapper.sh ]; then
  alias mc='VIEWER="$HOME/.local/bin/metascope" ` +
  `PATH="$HOME/.local/bin:$PATH" . /usr/libexec/mc/mc-wrapper.sh'
fi
${MARK_END}
`;

const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status || 1);
};

const stripMarkedBlock = (text) => {
  if (!text.includes(MARK_BEGIN)) return text;
  return text.replace(
    new RegExp(`${MARK_BEGIN}[\\s\\S]*?${MARK_END}\\n?`, 'm'),
    '',
  );
};

const readTextOrEmpty = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

const upsertShellConfig = (filePath) => {
  let text = readTextOrEmpty(filePath);
  text = stripMarkedBlock(text);
  if (text.length && !text.endsWith('\n')) text += '\n';
  text += `\n${shellBlock}`;
  fs.writeFileSync(filePath, text);
  console.log(`metascope: updated ${filePath}`);
};

const removeMarkedBlock = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  try {
    let text = fs.readFileSync(filePath, 'utf8');
    if (!text.includes(MARK_BEGIN)) return;
    text = stripMarkedBlock(text);
    fs.writeFileSync(filePath, text);
    console.log(`metascope: cleaned old block from ${filePath}`);
  } catch (err) {
    console.log(`metascope: skip ${filePath} (${err.message})`);
  }
};

const RUNTIME_DEPS = ['metautil', 'concolor'];

const canRequire = (name) => {
  try {
    require.resolve(name, { paths: [root] });
    return true;
  } catch {
    return false;
  }
};

const lockUsesLocalPaths = () => {
  let lock;
  try {
    lock = JSON.parse(
      fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
    );
  } catch {
    return false;
  }
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    if (key.startsWith('../') || key.startsWith('file:')) return true;
    if (!meta || typeof meta !== 'object') continue;
    if (meta.link === true) return true;
    const resolved = meta.resolved;
    if (typeof resolved !== 'string') continue;
    if (resolved.startsWith('file:') || resolved.startsWith('.')) return true;
  }
  return false;
};

const removeSymlinkedRuntimeDeps = () => {
  for (const name of RUNTIME_DEPS) {
    const depPath = path.join(root, 'node_modules', name);
    try {
      if (fs.lstatSync(depPath).isSymbolicLink()) fs.unlinkSync(depPath);
    } catch {
      // missing
    }
  }
};

const installDepsFromNpm = () => {
  removeSymlinkedRuntimeDeps();
  if (lockUsesLocalPaths()) {
    console.log('metascope: removing local-path lockfile (npm registry only)');
    try {
      fs.unlinkSync(path.join(root, 'package-lock.json'));
    } catch {
      // ignore
    }
  }
  console.log('metascope: installing dependencies from npm…');
  run('npm', ['install', '--omit=dev']);
};

installDepsFromNpm();

if (!RUNTIME_DEPS.every(canRequire)) {
  console.error(
    'metascope: could not install runtime deps from npm:',
    RUNTIME_DEPS.filter((name) => !canRequire(name)).join(', '),
  );
  process.exit(1);
}

fs.chmodSync(binSrc, 0o755);
fs.mkdirSync(destDir, { recursive: true });

try {
  fs.lstatSync(dest);
  fs.unlinkSync(dest);
} catch {
  // dest may not exist
}

try {
  fs.symlinkSync(binSrc, dest);
  console.log(`metascope: linked ${dest} → ${binSrc}`);
} catch (err) {
  // Never writeFile through an existing symlink — it overwrites the target.
  try {
    fs.unlinkSync(dest);
  } catch {
    // ignore
  }
  const wrapper = `#!/usr/bin/env bash
exec node ${JSON.stringify(binSrc)} "$@"
`;
  try {
    // O_NOFOLLOW-like: open only if not a symlink; use wx after unlink
    fs.writeFileSync(dest, wrapper, { mode: 0o755, flag: 'wx' });
    console.log(`metascope: installed wrapper ${dest}`);
    console.log(`(symlink failed: ${err.message}; used wrapper instead)`);
  } catch (err2) {
    console.error(
      `metascope: could not install bin at ${dest}: ${err2.message}`,
    );
    process.exit(1);
  }
}

// Fedora/RHEL: ~/.bashrc sources ~/.bashrc.d/*
const bashrcd = path.join(home, '.bashrc.d');
const dropIn = path.join(bashrcd, 'metascope.sh');
try {
  if (fs.existsSync(bashrcd) || fs.existsSync(path.join(home, '.bashrc'))) {
    fs.mkdirSync(bashrcd, { recursive: true });
    fs.writeFileSync(dropIn, shellBlock, { mode: 0o644 });
    console.log(`metascope: wrote ${dropIn}`);
    removeMarkedBlock(path.join(home, '.bashrc'));
  }
} catch (err) {
  console.log(`metascope: skip shell drop-in (${err.message})`);
}

// systemd user environment (GUI terminals / some launchers)
try {
  const envDir = path.join(home, '.config', 'environment.d');
  fs.mkdirSync(envDir, { recursive: true });
  const envFile = path.join(envDir, 'metascope.conf');
  fs.writeFileSync(envFile, `PATH=${destDir}:$PATH\nVIEWER=${dest}\n`);
  console.log(`metascope: wrote ${envFile}`);
} catch (err) {
  console.log(`metascope: skip environment.d (${err.message})`);
}

for (const rc of [path.join(home, '.zshrc'), path.join(home, '.profile')]) {
  if (!fs.existsSync(rc)) continue;
  try {
    upsertShellConfig(rc);
  } catch (err) {
    console.log(`metascope: skip ${rc} (${err.message})`);
  }
}

// Midnight Commander:
// - use_internal_view=false → F3 uses getenv("VIEWER") from the
//   *mc process* (Ctrl-O subshell env does not count) and caches it;
//   missing → /usr/bin/view (vim).
// - use_internal_view=true → F3 uses mc.ext.ini View= via /bin/sh
//   (reliable).
const MC_VIEW_LINE = `View=${dest} %f`;

const configureMidnightCommander = () => {
  const mcDir = path.join(home, '.config', 'mc');
  const extPath = path.join(mcDir, 'mc.ext.ini');
  const iniPath = path.join(mcDir, 'ini');
  const systemExt = '/etc/mc/mc.ext.ini';

  fs.mkdirSync(mcDir, { recursive: true });

  if (!fs.existsSync(extPath) && fs.existsSync(systemExt)) {
    fs.copyFileSync(systemExt, extPath);
    console.log(`metascope: copied ${systemExt} → ${extPath}`);
  }
  if (!fs.existsSync(extPath)) {
    console.log('metascope: no mc.ext.ini found, skip Midnight Commander');
    return;
  }

  let ext = fs.readFileSync(extPath, 'utf8');
  const setSectionView = (section) => {
    const re = new RegExp(`(\\[${section}\\][^\\[]*?)(^View=.*)`, 'm');
    if (re.test(ext)) {
      ext = ext.replace(re, `$1${MC_VIEW_LINE}`);
      return true;
    }
    const reHead = new RegExp(`(\\[${section}\\]\\n)`);
    if (reHead.test(ext)) {
      ext = ext.replace(reHead, `$1${MC_VIEW_LINE}\n`);
      return true;
    }
    return false;
  };

  let changed = false;
  if (setSectionView('Include/editor')) changed = true;
  if (setSectionView('Default')) changed = true;
  if (setSectionView('JavaScript')) {
    changed = true;
  } else if (/\[JavaScript\]/.test(ext)) {
    ext = ext.replace(
      /(\[JavaScript\]\n(?:Shell=.*\n)?)/,
      `$1${MC_VIEW_LINE}\n`,
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(extPath, ext);
    console.log(`metascope: updated ${extPath} (F3 → ${dest})`);
  }

  if (fs.existsSync(iniPath)) {
    let ini = fs.readFileSync(iniPath, 'utf8');
    // true: F3 uses mc.ext View= (absolute metascope), not getenv
    // cache / vim view
    if (/^use_internal_view=/m.test(ini)) {
      ini = ini.replace(/^use_internal_view=.*/m, 'use_internal_view=true');
    } else {
      ini = `use_internal_view=true\n${ini}`;
    }
    fs.writeFileSync(iniPath, ini);
    console.log(`metascope: set use_internal_view=true in ${iniPath}`);
  }
};

try {
  configureMidnightCommander();
} catch (err) {
  console.log(`metascope: skip Midnight Commander (${err.message})`);
}

const configureTerminator = () => {
  const termCfg = path.join(home, '.config', 'terminator', 'config');
  if (!fs.existsSync(termCfg)) return;

  let text = fs.readFileSync(termCfg, 'utf8');
  // Terminator custom_command=mc starts /usr/bin/mc with NO bashrc → no VIEWER.
  const pathPrefix = `${destDir}:/usr/bin:/bin`;
  const wrapped = `env VIEWER=${dest} PATH=${pathPrefix} /usr/bin/mc`;

  if (/^\s*custom_command\s*=\s*/m.test(text)) {
    text = text.replace(
      /^\s*custom_command\s*=\s*.*$/m,
      `    custom_command = ${wrapped}`,
    );
  } else if (/use_custom_command\s*=\s*True/i.test(text)) {
    text = text.replace(
      /(use_custom_command\s*=\s*True\s*\n)/i,
      `$1    custom_command = ${wrapped}\n`,
    );
  } else {
    return;
  }

  fs.writeFileSync(termCfg, text);
  console.log(`metascope: updated ${termCfg} (custom_command wraps VIEWER)`);
};

try {
  configureTerminator();
} catch (err) {
  console.log(`metascope: skip Terminator (${err.message})`);
}

const check = spawnSync(dest, ['--help'], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error('metascope: install finished but binary failed to run:');
  console.error(check.stderr || check.stdout || check.error);
  process.exit(1);
}

console.log(`
Ready. Apply in this terminal:

  source ~/.bashrc.d/metascope.sh

Normal terminal: type mc, then F3.
Terminator: restart it (custom_command now injects VIEWER).
`);
