import { defineConfig } from 'vitest/config';

// Tests never touch the real Keychain. The Keychain tests turn it back on
// with a stand-in for `security`.
export default defineConfig({
  test: {
    env: { PAI_KEYCHAIN: '0' },
    // `npm run coverage` fails if any of these drops under 80%.
    coverage: {
      include: ['src/pai.mts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
