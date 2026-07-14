export type ProviderReadTransitionKind =
  | 'provider_read_failed'
  | 'provider_read_partial'
  | 'provider_read_recovered';

export function isProviderReadTransitionKind(value: unknown): value is ProviderReadTransitionKind {
  return value === 'provider_read_failed'
    || value === 'provider_read_partial'
    || value === 'provider_read_recovered';
}

/**
 * Returns the operator-visible provider-read state identity. Generation,
 * timestamps, and storage fingerprints are deliberately excluded: they do not
 * make an unchanged provider error a new transition. Failed reads also ignore
 * component bookkeeping because no component completed successfully.
 */
export function providerReadStateSignature(
  metadataState: unknown,
  eventState: unknown,
  reason: unknown,
  components: unknown,
): string {
  const state = typeof metadataState === 'string' && metadataState.trim()
    ? metadataState.trim().toLowerCase()
    : typeof eventState === 'string'
      ? eventState.trim().toLowerCase().replace(/^monitoring\//, '')
      : 'unknown';
  const normalizedReason = typeof reason === 'string' && reason.trim()
    ? reason.trim().toLowerCase()
    : state === 'complete' ? 'complete' : 'unavailable';
  const normalizedComponents = state === 'failed'
    ? ''
    : typeof components === 'string'
      ? components.split(',').map(value => value.trim().toLowerCase()).filter(Boolean).sort().join(',')
      : '';
  return JSON.stringify({ state, reason: normalizedReason, components: normalizedComponents });
}
