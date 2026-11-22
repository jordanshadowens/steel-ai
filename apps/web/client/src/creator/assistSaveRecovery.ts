import type { WorkflowDefinition, WorkflowVersionRow } from '../api/contracts';
import { workflowCheckKey } from './adapter';

export function saveOutcomeUnknown(error: unknown): boolean {
  if (error instanceof Error) return true;
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const { status } = error;
  if (typeof status === 'number') return status >= 500;
  return status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR' || status === 'PARSING_ERROR';
}

function canonicalJson(text: string): string {
  return JSON.stringify(JSON.parse(text), (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

export function findMatchingSave(
  versions: WorkflowVersionRow[],
  expected: WorkflowDefinition,
  baseVersion: number,
): WorkflowVersionRow | undefined {
  const key = canonicalJson(workflowCheckKey(expected));
  return versions
    .filter((row) => row.workflow_id === expected.workflow_id && row.version > baseVersion &&
      row.status === 'draft' && !row.deleted_at)
    .sort((left, right) => right.version - left.version)
    .find((row) => canonicalJson(workflowCheckKey(row.definition)) === key);
}
