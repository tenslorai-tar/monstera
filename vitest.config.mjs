import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 does not exclude build output by default, so without this every
    // test file is collected twice: once from `src` as TypeScript and once from
    // `dist` as its compiled copy. That is worse than slow. The `dist` copy is
    // whatever the last successful build produced, so a test can pass there
    // while the source it was written for no longer compiles — a green result
    // for code that is not the code under test.
    exclude: ['**/node_modules/**', '**/dist/**', '.tools/**', '.probe/**', 'release/**'],
  },
});
