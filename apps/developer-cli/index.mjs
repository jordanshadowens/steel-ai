import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./steel-agent.py', import.meta.url));
const env = { ...process.env };
delete env.STEEL_API_KEY;
delete env.STEEL_PROVIDER_KEY;

const python = process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(python, [script, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
if (result.error) {
  console.error(`Unable to start the Steel CLI. Install Python 3 and ensure ${python} is on PATH.
${result.error.message}`);
}
process.exitCode = result.status ?? 1;
