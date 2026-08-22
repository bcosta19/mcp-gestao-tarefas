import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Replace a file through the same-directory rename to avoid partial files. */
export function writeFileAtomic(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );

  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write/rename error.
    }
    throw error;
  }
}
