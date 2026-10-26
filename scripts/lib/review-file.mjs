import fs from 'node:fs';
import path from 'node:path';
import { MAX_REVIEW_BYTES } from '../../public/studio/core/inspection.js';
import { StudioError } from '../../public/studio/core/contract.js';

function safePath(file) {
  for (let current = file; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      throw new StudioError('FILE_UNREADABLE', 'Linked paths are not accepted');
    if (path.dirname(current) === current) break;
  }
}
export function readReviewFile(name) {
  const file = path.resolve(name);
  safePath(file);
  const initial = fs.lstatSync(file);
  if (
    !initial.isFile() ||
    initial.nlink !== 1 ||
    initial.size < 1 ||
    initial.size > MAX_REVIEW_BYTES
  )
    throw new StudioError(
      'FILE_UNREADABLE',
      'Choose one regular unlinked review file, at most 4 MB',
    );
  let fd;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const opened = fs.fstatSync(fd);
    safePath(file);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== initial.ino ||
      opened.dev !== initial.dev ||
      opened.size !== initial.size
    )
      throw new StudioError('FILE_UNREADABLE', 'The review file changed while opening');
    const bytes = Buffer.alloc(opened.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = fs.readSync(fd, bytes, used, bytes.length - used, null);
      if (read === 0) break;
      used += read;
    }
    const after = fs.fstatSync(fd),
      final = fs.lstatSync(file);
    safePath(file);
    if (
      used !== opened.size ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      final.ino !== opened.ino ||
      final.dev !== opened.dev
    )
      throw new StudioError('FILE_UNREADABLE', 'The review file changed while being read');
    return new Uint8Array(bytes.subarray(0, used));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
