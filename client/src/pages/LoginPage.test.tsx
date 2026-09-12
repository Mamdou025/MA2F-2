import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

vi.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    login: vi.fn(),
    resetPassword: vi.fn(),
    isLoading: false,
    loginError: "",
    firebaseReady: true,
  }),
}));

describe("LoginPage", () => {
  it("exposes the MA2F brand mark as an accessible image", () => {
    render(<LoginPage />);

    const mark = screen.getByRole("img", { name: "MA2F" });
    expect(mark).toBeInTheDocument();
    expect(mark.querySelector("svg")).toHaveClass("w-14", "h-14");
  });
});