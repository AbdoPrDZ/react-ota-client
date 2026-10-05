import { useOtaContext } from './context';
import type { OtaBundleInfo } from './types';

/** Directory inside the bundle that `bundleAssetUri` resolves against. */
const ASSETS_DIR = 'assets';

/**
 * Builds a `file://` URI for an image that ships inside the active bundle.
 *
 * React Native resolves a `require()`d image through `resources.getIdentifier()`
 * against the APK only, so an OTA bundle can never introduce a new one. Putting
 * images in the archive under `assets/` and addressing them by path is what makes
 * them updatable without shipping a new APK.
 *
 * @param directory the active bundle directory, `OtaBundleInfo['directory']`
 * @param name path relative to the bundle's `assets/` directory, e.g. `Logo.png`
 * @returns the URI, or `null` when no OTA bundle is active. Callers should fall
 *   back to their `require()`d copy in that case, otherwise the image disappears
 *   for users who never received an update.
 */
export function bundleAssetUri(
  directory: string | null | undefined,
  name: string,
): string | null {
  if (!directory) {
    return null;
  }

  const root = directory.replace(/\/+$/, '');
  const relative = name.replace(/^\/+/, '');

  return `file://${root}/${ASSETS_DIR}/${relative}`;
}

/**
 * `bundleAssetUri` bound to the bundle the provider currently reports.
 *
 * ```tsx
 * const logo = require('@/assets/Logo.png');
 * const uri = useBundleAssetUri('Logo.png');
 *
 * <Image source={uri ? { uri } : logo} />
 * ```
 *
 * The fallback matters: it is `null` whenever the embedded APK copy is running.
 */
export function useBundleAssetUri(name: string): string | null {
  const { native } = useOtaContext();

  return bundleAssetUri(native?.bundle?.directory, name);
}

/** Narrows an optional bundle to the fields these helpers read. */
export type BundleDirectorySource = Pick<OtaBundleInfo, 'directory'>;
