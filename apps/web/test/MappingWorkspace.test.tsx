import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { createMappingIdentity, defaultStudySetTitle } from "../src/import/mapping-session.js";
import { zipFixture } from "./zip-fixture.js";

const good = { q: "Which city?", a: ["Lisbon", "Paris", "London"], answer: 1, topic: "Geography", why: "Capital cities.", sourceId: "upstream-8" };
function renderImport() {
  render(<MemoryRouter initialEntries={["/import"]}><App /></MemoryRouter>);
  return screen.getByLabelText("Study material file") as HTMLInputElement;
}
async function upload(value: unknown = [good], filename = "questions.json") {
  const user = userEvent.setup();
  const fileInput = renderImport();
  await user.upload(fileInput, new File([JSON.stringify(value)], filename));
  await screen.findByRole("heading", { name: "Ready for mapping" });
  return { user, fileInput };
}
async function map(user: ReturnType<typeof userEvent.setup>, mode = "Zero-based index") {
  await user.selectOptions(screen.getByLabelText(/^Question \(required\)/), '["q"]');
  await user.selectOptions(screen.getByLabelText(/^Answers \(required\)/), '["a"]');
  await user.selectOptions(screen.getByLabelText(/^Correct answer \(required\)/), '["answer"]');
  await user.click(screen.getByRole("radio", { name: new RegExp("^" + mode) }));
}
function preview() { return screen.getByRole("region", { name: "A first look" }); }
async function validate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Validate all records" }));
}

describe("structured mapping workflow", () => {
  it("preselects a sole collection, never fields or answer semantics", async () => {
    await upload();
    expect(screen.getByLabelText("Record collection")).not.toHaveValue("");
    for (const label of [/^Question \(required\)/, /^Answers \(required\)/, /^Correct answer \(required\)/]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Validate all records" })).toBeDisabled();
    expect(screen.getByLabelText(/^Study set title/)).toHaveValue("questions");
    expect(screen.getByRole("group", { name: /^How is the correct answer stored/ })).toBeInTheDocument();
  });
  it("requires explicit selection when multiple collections exist and clears mappings on change", async () => {
    const { user } = await upload({ questions: [good], metadata: [{ owner: "Someone" }] });
    const selector = screen.getByLabelText("Record collection") as HTMLSelectElement;
    expect(selector).toHaveValue("");
    expect(screen.queryByLabelText(/^Question \(required\)/)).not.toBeInTheDocument();
    const questions = [...selector.options].find((option) => option.text.includes("/questions"))!;
    await user.selectOptions(selector, questions.value);
    await map(user);
    await validate(user);
    expect(screen.getByRole("heading", { name: "Study set ready" })).toBeInTheDocument();
    const metadata = [...selector.options].find((option) => option.text.includes("/metadata"))!;
    await user.selectOptions(selector, metadata.value);
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Question \(required\)/)).toHaveValue("");
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(selector).toHaveFocus();
  });
  it("keeps ZIP sources separate and maps only the selected entry", async () => {
    const user = userEvent.setup();
    const fileInput = renderImport();
    await user.upload(fileInput, new File([await zipFixture([
      ["questions.json", JSON.stringify([good])], ["other.json", JSON.stringify([{ wrong: true }])],
    ])], "archive.zip"));
    await screen.findByRole("heading", { name: "Ready for mapping" });
    const selector = screen.getByLabelText("Record collection") as HTMLSelectElement;
    expect(selector).toHaveValue("");
    const option = [...selector.options].find((entry) => entry.text.includes("questions.json"))!;
    await user.selectOptions(selector, option.value);
    await map(user);
    await validate(user);
    const result = screen.getByRole("region", { name: "Study set ready" });
    expect(result).toHaveTextContent("1 record inspected");
    expect(screen.getByText("Source: questions.json")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Study set title/)).toHaveValue("archive");
  });
  it("renders mapped preview and optional values before full validation without stealing focus", async () => {
    const { user } = await upload();
    await map(user);
    await user.selectOptions(screen.getByLabelText(/^Topic \/ category/), '["topic"]');
    await user.selectOptions(screen.getByLabelText(/^Explanation/), '["why"]');
    expect(within(preview()).getByText("Which city?")).toBeInTheDocument();
    expect(within(preview()).getByText("Correct answer")).toBeInTheDocument();
    expect(within(preview()).getByText("Topic: Geography")).toBeInTheDocument();
    expect(within(preview()).getByText("Capital cities.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Explanation/)).toHaveFocus();
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
  });
  it.each(["One-based index", "Exact answer text"])("uses explicitly selected %s in the preview", async (mode) => {
    const { user } = await upload([{ ...good, answer: mode === "One-based index" ? 2 : "Paris" }]);
    await map(user, mode);
    const correct = within(preview()).getByText("Correct answer").closest("li")!;
    expect(correct).toHaveTextContent("Paris");
    await validate(user);
    expect(screen.getByRole("heading", { name: "Study set ready" })).toBeInTheDocument();
  });
  it("shows an invalid attempted preview instead of hiding the record", async () => {
    const { user } = await upload([{ ...good, q: { text: "Wrong shape" }, answer: 8 }]);
    await map(user);
    expect(preview()).toHaveTextContent("Record 1 · needs attention");
    expect(preview()).toHaveTextContent("Expected text but found an object");
    expect(preview()).toHaveTextContent("Index 8 is outside");
    expect(preview()).toHaveTextContent("Question text unavailable");
  });
  it("creates only an in-memory candidate after every selected record passes", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    try {
      const { user } = await upload([good, good]);
      await map(user);
      await user.selectOptions(screen.getByLabelText(/^Topic \/ category/), '["topic"]');
      await user.selectOptions(screen.getByLabelText(/^Source record ID/), '["sourceId"]');
      await user.clear(screen.getByLabelText(/^Study set title/));
      await user.type(screen.getByLabelText(/^Study set title/), "My revision");
      await user.type(screen.getByLabelText(/^Description/), "For tomorrow");
      await validate(user);
      const heading = screen.getByRole("heading", { name: "Study set ready" });
      await waitFor(() => expect(heading).toHaveFocus());
      const result = screen.getByRole("region", { name: "Study set ready" });
      expect(result).toHaveTextContent("2 records inspected · 2 ready · 0 need attention");
      expect(result).toHaveTextContent("My revision · 2 questions · 1 category");
      expect(result).toHaveTextContent("Leaving or reloading loses it");
      expect(storage).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "Back to library" }));
      expect(screen.getByRole("region", { name: "No study sets yet" })).toBeInTheDocument();
    } finally { storage.mockRestore(); }
  });
  it("checks records beyond the live preview and supports on-demand issue inspection", async () => {
    const { user } = await upload([good, good, good, { ...good, answer: 7 }]);
    await map(user);
    expect(within(preview()).getAllByRole("article")).toHaveLength(3);
    expect(preview()).not.toHaveTextContent("needs attention");
    await validate(user);
    const heading = screen.getByRole("heading", { name: "Final validation: needs attention" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("region", { name: "Final validation: needs attention" })).toHaveTextContent("4 records inspected · 3 ready · 1 needs attention");
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
    const correct = screen.getByLabelText(/^Correct answer \(required\)/);
    expect(correct).toHaveAttribute("aria-invalid", "true");
    expect(correct).toHaveAccessibleDescription(/1 record needs attention/);
    await user.click(screen.getByRole("button", { name: /^Record 4 · Correct answer/ }));
    const inspection = screen.getByRole("region", { name: "Inspect record 4" });
    await waitFor(() => expect(within(inspection).getByRole("heading", { name: "Inspect record 4" })).toHaveFocus());
    expect(inspection).toHaveTextContent("Source values are unchanged");
    expect(within(inspection).getByText("7", { exact: true })).toBeInTheDocument();
    expect(inspection).toHaveTextContent("Transformed preview");
  });
  it("paginates issue navigation instead of rendering the complete dataset", async () => {
    const { user } = await upload(Array.from({ length: 25 }, () => ({ ...good, answer: 99 })));
    await map(user);
    await validate(user);
    const result = screen.getByRole("region", { name: "Final validation: needs attention" });
    expect(within(result).getAllByRole("button", { name: /^Record / })).toHaveLength(10);
    expect(result).toHaveTextContent("Page 1 of 3");
    await user.click(screen.getByRole("button", { name: "Next issues" }));
    expect(result).toHaveTextContent("Page 2 of 3");
    expect(within(result).getAllByRole("button", { name: /^Record / })[0]).toHaveTextContent("Record 11");
  });
  it("invalidates a ready result on any metadata or mapping change", async () => {
    const { user } = await upload();
    await map(user);
    await validate(user);
    await user.type(screen.getByLabelText(/^Study set title/), "!");
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
    await validate(user);
    expect(screen.getByRole("heading", { name: "Study set ready" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /^Exact answer text/ }));
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
    expect(preview()).toHaveTextContent("requires a text value");
  });
  it("links final metadata errors to the labeled input and never produces ready state", async () => {
    const { user } = await upload();
    await map(user);
    const title = screen.getByLabelText(/^Study set title/);
    await user.clear(title);
    await validate(user);
    expect(screen.getByRole("region", { name: "Final validation: needs attention" })).toHaveTextContent("Study set title must be non-blank text");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription(/Study set title must be non-blank text/);
    expect(screen.getByRole("link", { name: "Edit title" })).toHaveAttribute("href", "#study-set-title");
  });
  it("reset clears mapping, validation, candidate, and file input with focus restored", async () => {
    const { user, fileInput } = await upload();
    await map(user);
    await validate(user);
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(screen.queryByRole("region", { name: "Structured mapping" })).not.toBeInTheDocument();
    expect(fileInput).toHaveValue("");
    await waitFor(() => expect(fileInput).toHaveFocus());
    await user.upload(fileInput, new File([JSON.stringify([good])], "questions.json"));
    await screen.findByRole("heading", { name: "Ready for mapping" });
    expect(screen.getByLabelText(/^Question \(required\)/)).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
  });
  it("supports nested fields without interpreting literal dots", async () => {
    const { user } = await upload([{ question: { text: "Nested question?" }, "question.text": "Literal question?", a: ["A", "B"], answer: 0 }]);
    await user.selectOptions(screen.getByLabelText(/^Question \(required\)/), '["question","text"]');
    await user.selectOptions(screen.getByLabelText(/^Answers \(required\)/), '["a"]');
    await user.selectOptions(screen.getByLabelText(/^Correct answer \(required\)/), '["answer"]');
    await user.click(screen.getByRole("radio", { name: /^Zero-based index/ }));
    expect(preview()).toHaveTextContent("Nested question?");
    expect(preview()).not.toHaveTextContent("Literal question?");
  });
  it("explains absent and empty collections", async () => {
    const user = userEvent.setup();
    const fileInput = renderImport();
    await user.upload(fileInput, new File(['{"setting":true}'], "unsupported.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("contains no supported record collections");
    await user.upload(fileInput, new File(["[]"], "empty.json"));
    await screen.findByText("This collection is empty. Choose another collection or file.");
    expect(screen.getByRole("button", { name: "Validate all records" })).toBeDisabled();
  });
  it("fails safely if secure identity generation is unavailable", async () => {
    const crypto = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => { throw new Error("unavailable"); });
    try {
      await upload();
      expect(screen.getByRole("alert")).toHaveTextContent("Secure ID generation is unavailable");
      expect(screen.queryByLabelText(/^Question \(required\)/)).not.toBeInTheDocument();
    } finally { crypto.mockRestore(); }
  });
});

describe("import-session metadata and identity", () => {
  it("derives editable filename defaults without inferring field meanings", () => {
    expect(defaultStudySetTitle("Revision.JSON")).toBe("Revision");
    expect(defaultStudySetTitle("Material.ZIP")).toBe("Material");
    expect(defaultStudySetTitle(".json")).toBe("Untitled study set");
  });
  it("creates different cryptographic namespaces with the canonical utility contract", () => {
    const first = createMappingIdentity()!;
    const second = createMappingIdentity()!;
    expect(first.namespace).toMatch(/^[a-f0-9]{32}$/);
    expect(second.namespace).not.toBe(first.namespace);
  });
});
