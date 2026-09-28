import fixture from "./fixtures/source-records.json?raw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { zipFixture } from "./zip-fixture.js";

function renderImport() {
  render(<MemoryRouter initialEntries={["/import"]}><App /></MemoryRouter>);
  return screen.getByLabelText("Study material file") as HTMLInputElement;
}

describe("Import screen", () => {
  it("announces JSON success with accurate counts without adding to the Library", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    await user.upload(input, new File([fixture], "questions.json"));
    expect(await screen.findByRole("heading", { name: "Ready for mapping" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 JSON file found");
    expect(screen.getByRole("status")).toHaveTextContent("1 collection discovered");
    expect(screen.getByRole("status")).toHaveTextContent("2 records discovered");
    expect(screen.getByText("questions.json")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back to library" }));
    expect(screen.getByRole("region", { name: "No study sets yet" })).toBeInTheDocument();
  });
  it("reports malformed JSON in an understandable alert", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File(["{"], "broken.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("broken.json is not valid UTF-8 JSON.");
    expect(screen.queryByText("Ready for mapping")).not.toBeInTheDocument();
  });
  it("reports an unsupported file rather than malformed JSON", async () => {
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(renderImport(), new File([fixture], "source.csv"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a DOCX, PDF with selectable text, JSON, or ZIP containing JSON files.");
  });
  it("announces ZIP success with multiple sources and collections", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    const bytes = await zipFixture([["one.json", fixture], ["two.json", '[{"x":1}]']]);
    await user.upload(input, new File([bytes], "material.zip"));
    expect(await screen.findByRole("heading", { name: "Ready for mapping" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 JSON files found");
    expect(screen.getByRole("status")).toHaveTextContent("2 collections discovered");
    expect(screen.getByRole("status")).toHaveTextContent("3 records discovered");
  });
  it("resets success and re-inspects the same file, then another file", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    const source = new File([fixture], "questions.json");
    await user.upload(input, source);
    await screen.findByText("Ready for mapping");
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(input.value).toBe("");
    expect(screen.queryByText("Ready for mapping")).not.toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
    await user.upload(input, source);
    await screen.findByText("Ready for mapping");
    await user.upload(input, new File(["{"], "broken.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("broken.json");
    expect(screen.queryByText("Ready for mapping")).not.toBeInTheDocument();
  });
  it("resets errors without a refresh", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    await user.upload(input, new File(["{"], "broken.json"));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.upload(input, new File([fixture], "valid.json"));
    expect(await screen.findByText("Ready for mapping")).toBeInTheDocument();
  });
  it("is keyboard accessible and includes native supported-format guidance", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription(/Choose a DOCX.*Files are processed on this device/);
  });
  it("announces reading and lets the user cancel without a stale result", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    const spy = vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(() => {});
    try {
      await user.upload(input, new File([fixture], "questions.json"));
      expect(screen.getByRole("status")).toHaveTextContent("Reading and inspecting");
      expect(input).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(input).toBeEnabled();
      await waitFor(() => expect(input).toHaveFocus());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("Ready for mapping")).not.toBeInTheDocument();
    } finally { spy.mockRestore(); }
  });
});
