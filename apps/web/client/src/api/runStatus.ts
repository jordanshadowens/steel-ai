export const isTerminalRun = (status: string) =>
  ['sealed', 'failed', 'cancelled', 'local_completed', 'local_failed'].includes(status);

export const isLocalRun = (status: string) => status.startsWith('local_');

export function runStatusLabel(status: string) {
  switch (status) {
    case 'sealed':
    case 'local_completed': return 'Completed';
    case 'local_failed': return 'Failed';
    case 'local_running': return 'Running';
    default: return status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ');
  }
}
