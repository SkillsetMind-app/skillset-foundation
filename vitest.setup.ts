import "@testing-library/jest-dom/vitest";
// Every locale in memory up front, as the app has it once the server sends the
// active dictionary; the lazy path has its own test (i18n-provider-lazy).
import "./src/lib/i18n/dictionaries";
