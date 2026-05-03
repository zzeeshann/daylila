/**
 * Audit tier — single reader-facing quality signal derived from
 * `voiceScore`. Rule body in `content/audit-contract.md`; thresholds
 * imported from `./audit-thresholds.ts` (the site-worker mirror).
 */

import { VOICE_PASS_THRESHOLD, TIER_SOLID_FLOOR } from './audit-thresholds';

export type AuditTier = 'polished' | 'solid' | 'rough';

export function auditTier(
  voiceScore: number | null | undefined,
  qualityFlag?: 'low' | null,
): AuditTier {
  if (voiceScore == null) return qualityFlag === 'low' ? 'rough' : 'polished';
  if (voiceScore >= VOICE_PASS_THRESHOLD) return 'polished';
  if (voiceScore >= TIER_SOLID_FLOOR) return 'solid';
  return 'rough';
}

/** Capitalised for display — "Polished", "Solid", "Rough". */
export function auditTierLabel(tier: AuditTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
