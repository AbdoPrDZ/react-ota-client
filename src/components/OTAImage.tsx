import { Image, type ImageProps, type ImageSourcePropType } from 'react-native';

import { useBundleAssetUri } from '../bundleAssets';

export interface OTAImageProps extends Omit<ImageProps, 'source'> {
  /**
   * File name inside the bundle's `assets/` directory, e.g. `Logo.png`.
   *
   * The archive stages that directory next to the bundle, so a release can
   * replace the artwork without shipping a new APK.
   */
  name: string;
  /**
   * The `require()`d copy that ships inside the APK.
   *
   * Used while the embedded bundle is running, which is always the case until the
   * device has installed an update. Without it the image would vanish for every
   * user who has not received one yet.
   */
  source: ImageSourcePropType;
}

/**
 * An `Image` that prefers the copy carried by the active OTA bundle and falls
 * back to the one compiled into the APK.
 *
 * React Native resolves a `require()`d image through
 * `resources.getIdentifier()` against the APK only, so that copy can never change
 * over the air. Addressing `assets/<name>` through a `file://` URI built from the
 * bundle directory is what makes the artwork updatable.
 *
 * ```tsx
 * import Logo from '@/assets/Logo.png';
 *
 * <OTAImage name="Logo.png" source={Logo} style={styles.logo} resizeMode="contain" />
 * ```
 */
export function OTAImage({ name, source, ...props }: OTAImageProps) {
  const uri = useBundleAssetUri(name);

  return <Image source={uri ? { uri } : source} {...props} />;
}
