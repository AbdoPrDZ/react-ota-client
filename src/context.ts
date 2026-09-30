import { createContext, useContext } from 'react';

import type {
  OtaCheckUpdateResult,
  OtaConfigInput,
  OtaDownloadProgress,
  OtaState,
  OtaStatus,
} from './types';

/** Imperative handles exposed through `OTAProvider`. */
export interface OtaActions {
  /** Persists server coordinates. Unset keys keep their current value. */
  configure(config: OtaConfigInput): Promise<OtaServerConfigSnapshot>;
  /** Re-runs the health check and the update check. */
  checkForUpdates(): Promise<OtaCheckUpdateResult | null>;
  /** Downloads the pending bundle and restarts the app into it. */
  downloadAndInstall(): Promise<void>;
  /** Activates an already staged bundle and restarts the app. */
  install(directory?: string | null): Promise<void>;
  /** Hides the update prompt for the rest of this app session. */
  dismissUpdate(): void;
  /** Goes back to the bundle embedded in the APK. */
  revertToEmbedded(): Promise<void>;
  /** Relaunches the app without changing bundles. */
  restart(): Promise<void>;
  /** Opens the APK download URL for a pending app-version update. */
  openAppUpdate(): Promise<void>;
  /**
   * Confirms the running bundle booted fine, so the engine will not revert it on
   * the next launch. `OTAProvider` does this automatically shortly after mount;
   * call it yourself after your own smoke test to move the deadline.
   */
  confirmLaunch(): void;
  /** Clears the error and re-runs the flow. */
  retry(): void;
}

export type OtaServerConfigSnapshot = OtaState['config'];

export interface OtaContextValue extends OtaActions {
  status: OtaStatus;
  native: OtaState | null;
  check: OtaCheckUpdateResult | null;
  progress: OtaDownloadProgress | null;
  error: Error | null;
  /** `true` when the engine is linked; `false` on iOS or an unlinked build. */
  supported: boolean;
  /** `true` once the user chose to skip the pending update for this session. */
  dismissed: boolean;
}

export const OtaContext = createContext<OtaContextValue | null>(null);

/**
 * Reads the value published by `OTAProvider`.
 * Throws when used outside a provider so mistakes surface immediately.
 */
export function useOtaContext(): OtaContextValue {
  const value = useContext(OtaContext);

  if (!value) {
    throw new Error(
      'useOTA() must be called inside <OTAProvider>. Wrap your app root, or use the ' +
        'imperative `OtaClient` API outside React.',
    );
  }

  return value;
}

/** Like `useOtaContext()` but returns `null` instead of throwing. */
export function useOptionalOtaContext(): OtaContextValue | null {
  return useContext(OtaContext);
}
