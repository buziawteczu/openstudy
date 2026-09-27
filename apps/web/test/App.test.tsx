import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { App } from "../src/app/App.js";

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("OpenStudy application shell", () => {
  it("renders the product identity and semantic landmarks", () => {
    renderApp();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenStudy library" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("uses the Library as home with a meaningful page heading and title", () => {
    renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Your study sets" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.title).toBe("Library | OpenStudy");
  });

  it("shows an honest Library empty state and import link", () => {
    renderApp();
    const emptyState = screen.getByRole("region", { name: "No study sets yet" });
    expect(within(emptyState).getByText(/Bring your own study material/)).toBeInTheDocument();
    expect(within(emptyState).getByRole("link", { name: "Import study set" })).toHaveAttribute("href", "/import");
  });

  it("navigates to Import and focuses its heading", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("link", { name: "Import study set" }));
    expect(screen.getByRole("heading", { level: 1, name: "Import study material" })).toHaveFocus();
    expect(document.title).toBe("Import | OpenStudy");
    expect(screen.queryByText("No study sets yet")).not.toBeInTheDocument();
  });

  it("renders a direct Import visit with a labeled local file picker", () => {
    renderApp("/import");
    expect(screen.getByRole("heading", { level: 1, name: "Import study material" })).toBeInTheDocument();
    expect(screen.getByText(/Choose a JSON file or ZIP containing JSON files/)).toBeInTheDocument();
    expect(screen.getByLabelText("Study material file")).toHaveAttribute("accept", ".json,.zip");
    expect(screen.getByText("Files are processed on this device.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("returns to the Library and restores its heading and title", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    await user.click(screen.getByRole("link", { name: "Back to library" }));
    expect(screen.getByRole("heading", { level: 1, name: "Your study sets" })).toHaveFocus();
    expect(document.title).toBe("Library | OpenStudy");
  });

  it("offers a usable fallback and return link on an unknown route", async () => {
    const user = userEvent.setup();
    renderApp("/does-not-exist");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(document.title).toBe("Page not found | OpenStudy");
    await user.click(screen.getByRole("link", { name: "Back to library" }));
    expect(screen.getByRole("heading", { level: 1, name: "Your study sets" })).toBeInTheDocument();
  });

  it("supports keyboard navigation with a skip link and native links", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    await user.tab();
    expect(screen.getByRole("link", { name: "OpenStudy library" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Import study set" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 1, name: "Import study material" })).toHaveFocus();
  });
});
