import { useOtaContext } from '../context';
import type { OtaBundleInfo, OtaState } from '../types';

/**
 * Full update state plus the imperative actions, from the nearest `OTAProvider`.
 *
 * ```tsx
 * const { status, check, progress, downloadAndInstall } = useOTA();
 * ```
 */
export function useOTA() {
  return useOtaContext();
}

/** The bundle that is active right now, or `null` before the first state read. */
export function useOTABundleInfo(): OtaBundleInfo | null {
  return useOtaContext().native?.bundle ?? null;
}

/** The whole native snapshot (app info, config, device, runtime compatibility). */
export function useOtaNativeState(): OtaState | null {
  return useOtaContext().native;
}
