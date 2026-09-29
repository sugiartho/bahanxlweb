import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
  },
  plugins: [
    {
      name: "html-raw",
      transform(code, id) {
        if (id.endsWith(".html")) {
          return { code: `export default ${JSON.stringify(code)}`, map: null };
        }
      },
    },
  ],
});