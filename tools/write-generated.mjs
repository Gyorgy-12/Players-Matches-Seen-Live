import fs from 'node:fs';

// Do not reopen an unchanged generated file. On Windows a scanner or editor
// may also briefly hold a recently written file; retry only sharing errors.
export function writeGenerated(target, text) {
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === text) return;
  for (let attempt = 0; ; attempt++) {
    try { fs.writeFileSync(target, text, 'utf8'); return; }
    catch (error) {
      if (attempt >= 5 || !['UNKNOWN', 'EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (attempt + 1));
    }
  }
}
