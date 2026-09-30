import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OtaClient } from '../OtaClient';
import type { OtaContextValue } from '../context';
import type {
  OtaCheckUpdateResult,
  OtaConfigInput,
  OtaDownloadProgress,
  OtaState,
  OtaStatus,
} from '../types';
import { toError } from './errors';

export interface UseOTAFlowOptions {
  /** Applied once on every (re)run. Pass `null` to keep the native/manifest config. */
  config?: OtaConfigInput | null;
  /** Run the health + update check automatically. Default `true`. */
  autoCheck?: boolean;
  /**
   * Report a successful launch shortly after mount so the engine keeps the
   * bundle. Set to `false` to manage `confirmLaunch()` yourself.
   */
  confirmLaunch?: boolean;
  /** Delay before the automatic launch confirmation, in ms. Default `2000`. */
  confirmDelayMs?: number;
  onUpdateAvailable?(check: OtaCheckUpdateResult): void;
  onStatusChange?(status: OtaStatus, state: OtaState | null): void;
  onError?(error: Error): void;
  /** Server unreachable: the app keeps working, this is your offline hook. */
  onUnreachable?(state: OtaState | null): void;
}

const DEFAULT_CONFIRM_DELAY_MS = 2000;

/**
 * The update state machine behind `OTAProvider`.
 *
 * Kept separate from the component so the same flow can drive a custom UI
 * without re-implementing the transitions.
 */
export function useOTAFlow(options: UseOTAFlowOptions = {}): OtaContextValue {
  const { confirmDelayMs = DEFAULT_CONFIRM_DELAY_MS } = options;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [status, setStatusState] = useState<OtaStatus>('initializing');
  const [native, setNative] = useState<OtaState | null>(null);
  const [check, setCheck] = useState<OtaCheckUpdateResult | null>(null);
  const [progress, setProgress] = useState<OtaDownloadProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const mountedRef = useRef(true);
  const runIdRef = useRef(0);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatus = useCallback((next: OtaStatus, state: OtaState | null) => {
    if (!mountedRef.current) {
      return;
    }

    setStatusState(next);
    optionsRef.current.onStatusChange?.(next, state);
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;

      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    },
    [],
  );

  const markLaunchSucceeded = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }

    OtaClient.markLaunchSucceeded().catch(() => {
      // A failed confirmation only means the next launch reverts one step further
      // back, so it is never worth surfacing to the user.
    });
  }, []);

  const run = useCallback(async () => {
    const runId = ++runIdRef.current;
    const stale = () => runIdRef.current !== runId;
    const opts = optionsRef.current;

    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }

    if (!mountedRef.current) {
      return;
    }

    setError(null);
    setProgress(null);
    setCheck(null);
    setDismissed(false);
    setStatus('initializing', null);

    let state: OtaState | null = null;

    try {
      if (opts.config) {
        await OtaClient.configure(opts.config);

        if (stale()) {
          return;
        }
      }

      state = await OtaClient.getState();

      if (stale()) {
        return;
      }

      if (mountedRef.current) {
        setNative(state);
      }

      if (!state.configured) {
        setStatus('unconfigured', state);
        return;
      }

      if (opts.autoCheck === false) {
        if (opts.confirmLaunch !== false && mountedRef.current) {
          confirmTimerRef.current = setTimeout(markLaunchSucceeded, confirmDelayMs);
        }

        setStatus('ready', state);
        return;
      }

      setStatus('checking', state);

      const healthy = await OtaClient.healthCheck();

      if (stale()) {
        return;
      }

      if (opts.confirmLaunch !== false && mountedRef.current) {
        confirmTimerRef.current = setTimeout(markLaunchSucceeded, confirmDelayMs);
      }

      if (!healthy) {
        // Offline is not fatal: render the app and let the caller decide.
        setStatus('ready', state);
        opts.onUnreachable?.(state);
        return;
      }

      const result = await OtaClient.checkUpdate();

      if (stale()) {
        return;
      }

      if (mountedRef.current) {
        setCheck(result);
      }

      if (result.haveUpdate) {
        opts.onUpdateAvailable?.(result);
        setStatus('update-available', state);
      } else {
        setStatus('ready', state);
      }
    } catch (caught) {
      if (stale()) {
        return;
      }

      const failure = toError(caught);

      if (mountedRef.current) {
        setError(failure);
      }

      setStatus('failed', state);
      opts.onError?.(failure);
    }
  }, [confirmDelayMs, markLaunchSucceeded, setStatus]);

  const configKey = useMemo(() => JSON.stringify(options.config ?? null), [options.config]);

  useEffect(() => {
    run();
    // Re-running is only intentional when the JS-side config changes.
  }, [configKey, run]);

  const downloadAndInstall = useCallback(async () => {
    const runId = ++runIdRef.current;
    const stale = () => runIdRef.current !== runId;
    const opts = optionsRef.current;

    setError(null);
    setDismissed(false);
    setStatus('downloading', null);

    const unsubscribe = OtaClient.addDownloadProgressListener((event) => {
      if (!stale() && mountedRef.current) {
        setProgress(event);
      }
    });

    try {
      await OtaClient.downloadAndInstall();
      // The process is being replaced; the screen stays on "downloading" on purpose.
    } catch (caught) {
      if (stale()) {
        return;
      }

      const failure = toError(caught);

      if (mountedRef.current) {
        setError(failure);
      }

      setStatus('update-available', null);
      opts.onError?.(failure);
    } finally {
      unsubscribe();
    }
  }, [setStatus]);

  const value = useMemo<OtaContextValue>(
    () => ({
      status,
      native,
      check,
      progress,
      error,
      supported: OtaClient.isSupported(),
      dismissed,

      configure: async (next) => {
        const saved = await OtaClient.configure(next);
        await run();
        return saved;
      },

      checkForUpdates: async () => {
        const result = await OtaClient.checkUpdate();

        if (mountedRef.current) {
          setCheck(result);
        }

        return result;
      },

      downloadAndInstall,
      install: (directory) => OtaClient.installBundle({ directory: directory ?? null }),
      dismissUpdate: () => setDismissed(true),

      revertToEmbedded: async () => {
        await OtaClient.revertToEmbeddedBundle();
        await OtaClient.restartApp();
      },

      restart: () => OtaClient.restartApp(),

      openAppUpdate: async () => {
        await OtaClient.openAppUpdate();
        setDismissed(true);
      },

      confirmLaunch: markLaunchSucceeded,
      retry: () => {
        void run();
      },
    }),
    [check, dismissed, downloadAndInstall, error, markLaunchSucceeded, native, progress, run, status],
  );

  return value;
}
