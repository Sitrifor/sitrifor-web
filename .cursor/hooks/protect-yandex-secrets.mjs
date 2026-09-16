#!/usr/bin/env node
/**
 * Cursor hook: block Yandex OAuth tokens in shell command lines.
 * Also blocks casual reads of encrypted secrets / master key via Read tool.
 *
 * stdin: hook JSON
 * stdout: permission decision
 */
import fs from 'node:fs';

const TOKEN_RE = /y0[_-]{1,2}[A-Za-z0-9_-]{16,}/i;
const SECRET_PATH_RE =
  /(\/root\/\.config\/sitrifor\/secrets\/|yandex-disk-token|yandex-oauth-app\.json|master\.key|YANDEX_DISK_OAUTH_TOKEN=)/i;

function readInput() {
  return fs.readFileSync(0, 'utf8');
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readInput() || '{}');
  } catch {
    payload = {};
  }

  const cmd = String(payload.command || payload.tool_input?.command || '');
  const filePath = String(
    payload.file_path ||
      payload.path ||
      payload.tool_input?.path ||
      payload.tool_input?.filePath ||
      ''
  );
  const tool = String(payload.tool_name || payload.tool || '');

  // Shell: never allow raw tokens in argv (ends up in terminal logs / history)
  if (cmd && TOKEN_RE.test(cmd)) {
    process.stdout.write(
      JSON.stringify({
        permission: 'deny',
        user_message:
          'В команде обнаружен Yandex OAuth token. Вставьте токен через `node seo/scripts/yandex-disk/auth.mjs` (интерактивно), не в чат и не в командную строку.',
        agent_message:
          'Blocked: Yandex OAuth token must not appear in shell command lines. Use auth.mjs interactive/stdin flow and encrypted secrets store.'
      })
    );
    return;
  }

  // Read tool: deny reading secret blobs / master key into model context
  if (/read/i.test(tool) || filePath) {
    if (SECRET_PATH_RE.test(filePath) || /secrets\/.+\.enc$/i.test(filePath)) {
      process.stdout.write(
        JSON.stringify({
          permission: 'deny',
          user_message: 'Чтение секретов Яндекса в контекст агента запрещено.',
          agent_message:
            'Blocked read of Sitrifor Yandex secrets. Use createDiskClient()/auth --check without printing tokens.'
        })
      );
      return;
    }
  }

  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}

main();
