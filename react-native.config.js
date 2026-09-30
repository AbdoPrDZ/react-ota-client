/**
 * Autolinking descriptor.
 *
 * React Native's CLI reads this file from every dependency, so the Android module
 * is linked automatically. iOS is explicitly unsupported: the engine is Android-only.
 */
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.otaclient.OtaClientPackage;',
        packageInstance: 'new OtaClientPackage()',
      },
      ios: null,
    },
  },
};
