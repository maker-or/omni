import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ThemePicker } from "./theme-picker";
import { ThemeProvider } from "@/lib/theme";

describe("theme picker", () => {
  test("renders one radio per option and rings the active preview", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)?.length).toBe(3);
    expect(html).toContain("Light");
    expect(html).toContain("Dark");
    expect(html).toContain("System");
    // Node has no stored preference, so System is the active option.
    expect(html).toContain("border-[#3b82f6]");
  });
});
