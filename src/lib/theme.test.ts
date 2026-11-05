import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  applyColorScheme,
  applyColorSchemeWithTransition,
  persistColorScheme,
  readStoredColorScheme,
} from "./theme";

describe("theme color scheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("theme-flip");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.background = "";
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("theme-flip");
  });

  it("defaults to light", () => {
    expect(readStoredColorScheme()).toBe("light");
  });

  it("persists and reads dark", () => {
    persistColorScheme("dark");
    expect(readStoredColorScheme()).toBe("dark");
  });

  it("applyColorScheme syncs dom, favicon and surface bg", () => {
    const favicon = document.createElement("link");
    favicon.id = "app-favicon";
    favicon.setAttribute("href", "/logo-light.png");
    document.head.appendChild(favicon);

    applyColorScheme("dark");

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.style.background).toMatch(/0a0a0a|10,\s*10,\s*10/i);
    expect(favicon.getAttribute("href")).toBe("/logo-dark.png");

    applyColorScheme("light");

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.background).toMatch(/fafafa|250,\s*250,\s*250/i);
    expect(favicon.getAttribute("href")).toBe("/logo-light.png");
  });

  it("applyColorSchemeWithTransition toggles theme-flip class", async () => {
    applyColorSchemeWithTransition("dark");
    expect(document.documentElement.classList.contains("theme-flip")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    await new Promise((r) => setTimeout(r, 320));
    expect(document.documentElement.classList.contains("theme-flip")).toBe(false);
  });

  it("rapid toggle keeps final theme consistent", () => {
    applyColorSchemeWithTransition("dark");
    applyColorSchemeWithTransition("light");
    applyColorSchemeWithTransition("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.background).toMatch(/0a0a0a|10,\s*10,\s*10/i);
  });
});
