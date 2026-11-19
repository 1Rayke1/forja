import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const observerPath = process.env.FORJA_BROWSER_OBSERVER;
if (observerPath) {
  const append = entry => fs.appendFileSync(observerPath, JSON.stringify({ atUtc: new Date().toISOString(), pid: process.pid, ...entry }) + '\n');
  const unsafeFlagsOf = argv => argv.filter(a =>
    /^--(?:disable-web-security|allow-running-insecure-content|disable-site-isolation-trials)(?:=|$)/.test(a) ||
    (a.startsWith('--disable-features=') && /(?:^|,)(?:IsolateOrigins|site-per-process)(?:,|$)/.test(a.split('=')[1] || ''))
  );
  for (const name of ['spawn', 'execFile']) {
    const original = cp[name];
    cp[name] = function (command, args, ...rest) {
      const child = original.call(this, command, args, ...rest);
      if (/(?:chromium|chrome)(?:\b|$)/i.test(String(command))) {
        const argv = Array.isArray(args) ? args : [];
        const scrollEndArgs = argv.filter(a => /ScrollEndEvents/i.test(a));
        const unsafe = unsafeFlagsOf(argv);
        append({ event: 'spawn', method: name, command: String(command), childPid: child?.pid ?? null, scrollEndArgs, unsafe, argv });
        if (child && typeof child.once === 'function') {
          child.once('exit', (exitCode, signal) => append({ event: 'exit', childPid: child?.pid ?? null, exitCode, signal }));
        }
      }
      return child;
    };
  }
  syncBuiltinESMExports();
}
