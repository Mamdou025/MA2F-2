import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppSidebar from "./AppSidebar";

const setViewportMode = (desktop: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: desktop,
      media: "(min-width: 1024px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
};

vi.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    currentUser: { nom: "Test User", roles: ["admin"] },
    currentSection: "dashboard",
    setCurrentSection: vi.fn(),
    logout: vi.fn(),
    allowedSections: ["dashboard"],
    syncStatus: "synced",
    lastSyncTime: "maintenant",
    syncNow: vi.fn(),
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: undefined }),
}));

vi.mock("@/components/OfflineIndicator", () => ({
  default: () => null,
}));

describe("AppSidebar", () => {
  beforeEach(() => {
    setViewportMode(true);
  });

  it("exposes the MA2F brand mark in the desktop sidebar header", () => {
    render(<AppSidebar />);

    const sidebar = screen.getByRole("complementary");
    expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
    expect(sidebar).not.toHaveAttribute("inert");
    expect(sidebar).toHaveClass("lg:translate-x-0");
    const mark = screen.getByRole("img", { name: "MA2F" });
    expect(mark).toBeInTheDocument();
    expect(mark.querySelector("svg")).toHaveClass("w-6", "h-6");
  });

  it("keeps the MA2F brand mark in the opened mobile sidebar header", () => {
    setViewportMode(false);
    render(<AppSidebar />);

    const sidebar = document.querySelector("#app-sidebar");
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveAttribute("inert");
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    expect(sidebar).toHaveClass("-translate-x-full");
    expect(toggle).toHaveClass("left-4");

    fireEvent.click(toggle);

    expect(sidebar).toHaveAttribute("aria-hidden", "false");
    expect(sidebar).not.toHaveAttribute("inert");
    expect(sidebar).toHaveClass("translate-x-0");
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveClass("left-[13rem]");
    const mark = screen.getByRole("img", { name: "MA2F" });
    expect(mark).toBeInTheDocument();
    expect(mark.querySelector("svg")).toHaveClass("w-6", "h-6");
  });

  it("opens with Enter, exposes its expanded state, and moves focus into navigation", () => {
    setViewportMode(false);
    render(<AppSidebar />);

    const toggle = screen.getByRole("button", { name: "Open navigation" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "app-sidebar");

    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Enter" });

    const closeToggle = screen.getByRole("button", { name: "Close navigation" });
    expect(closeToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Tableau de bord" })).toHaveFocus();
  });

  it("closes with Space and returns focus to the navigation toggle", () => {
    setViewportMode(false);
    render(<AppSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const closeToggle = screen.getByRole("button", { name: "Close navigation" });

    closeToggle.focus();
    fireEvent.keyDown(closeToggle, { key: " " });

    const openToggle = screen.getByRole("button", { name: "Open navigation" });
    expect(openToggle).toHaveAttribute("aria-expanded", "false");
    expect(openToggle).toHaveFocus();
    expect(document.querySelector("#app-sidebar")).toHaveAttribute("inert");
    expect(
      screen.queryByRole("button", { name: "Tableau de bord" }),
    ).not.toBeInTheDocument();
  });
});