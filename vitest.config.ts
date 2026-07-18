import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  test: {
    globals: true,
    // ユニットテストは jsdom 不要だが、コンポーネントテスト用に環境を切替可能にする。
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 統合テストは単一の PostgreSQL を共有する。ファイルを並行実行すると
    // 別ファイルの書込／ロックが並行予約テスト(booking-concurrency)と競合し、
    // 稀に排他制約違反などでフレークする。ここで完全直列に固定する:
    //   - pool: forks + singleFork  … 単一プロセス
    //   - fileParallelism: false    … ファイルも逐次実行（singleFork だけでは並行しうる）
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/domain/**', 'src/server/services/**', 'src/lib/**'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/index.ts'],
    },
  },
});
