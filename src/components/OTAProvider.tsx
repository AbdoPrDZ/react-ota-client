import type { ReactNode } from 'react';

import { OtaContext } from '../context';
import { useOTAFlow, type UseOTAFlowOptions } from '../internal/useOTAFlow';
import { OTAConfigureScreen, type OTAConfigureScreenProps } from './OTAConfigureScreen';
import { OTASplashScreen } from './OTASplashScreen';
import { OTAUpdateOverlay, type OTAUpdateOverlayProps } from './OTAUpdateOverlay';

export interface OTAProviderProps extends UseOTAFlowOptions {
  children: ReactNode;
  /**
   * Rendered while the native state is read (`status === 'initializing'`).
   * Defaults to `OTASplashScreen`; pass `null` to render children immediately.
   */
  bootFallback?: ReactNode;
  /**
   * Rendered when no API base URL is known (`status === 'unconfigured'`).
   * Defaults to `OTAConfigureScreen`; pass `null` to render children instead.
   */
  unconfiguredFallback?: ReactNode;
  /** Props forwarded to the built-in `OTAConfigureScreen`. */
  configureScreenProps?: Omit<OTAConfigureScreenProps, 'initialValues'>;
  /** Render the blocking update UI automatically. Default `true`. */
  showUpdateOverlay?: boolean;
  /** Props forwarded to the built-in `OTAUpdateOverlay`. */
  updateOverlayProps?: Omit<OTAUpdateOverlayProps, 'visible'>;
  /**
   * Everything renders even on iOS / unlinked builds: the flow short-circuits
   * and children are shown as-is. Set to `false` to render the boot fallback.
   */
  renderChildrenWhenUnsupported?: boolean;
}

/**
 * Drop-in root component.
 *
 * ```tsx
 * <OTAProvider config={{ apiBaseUrl: 'https://updates.example.com', apiKey: KEY }}>
 *   <App />
 * </OTAProvider>
 * ```
 *
 * It reads native state, runs the health + update check, and renders the update
 * UI when the server has something newer. It also confirms a successful launch
 * shortly after mount, which is what lets the engine auto-revert a broken bundle.
 */
export function OTAProvider({
  children,
  bootFallback,
  unconfiguredFallback,
  configureScreenProps,
  showUpdateOverlay = true,
  updateOverlayProps,
  renderChildrenWhenUnsupported = true,
  config,
  ...flowOptions
}: OTAProviderProps) {
  const value = useOTAFlow({ config, ...flowOptions });

  let content: ReactNode = children;

  if (!value.supported && !renderChildrenWhenUnsupported) {
    content = bootFallback ?? <OTASplashScreen />;
  } else if (value.status === 'initializing') {
    content = bootFallback ?? <OTASplashScreen />;
  } else if (value.status === 'unconfigured') {
    content =
      unconfiguredFallback === undefined ? (
        <OTAConfigureScreen
          initialValues={config ?? value.native?.config}
          onConfigured={() => value.retry()}
          {...configureScreenProps}
        />
      ) : (
        unconfiguredFallback
      );
  }

  return (
    <OtaContext.Provider value={value}>
      {content}
      {showUpdateOverlay && value.supported ? <OTAUpdateOverlay {...updateOverlayProps} /> : null}
    </OtaContext.Provider>
  );
}
