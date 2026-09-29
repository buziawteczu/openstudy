import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import * as mapping from "@openstudy/mapping";
import { App } from "../src/app/App.js";
import { docxFixture, paragraphXml, pdfFixture } from "./document-fixtures.js";
import { zipFixture } from "./zip-fixture.js";
import * as identityModule from "../src/import/mapping-session.js";

vi.mock("../src/import/pdf-runtime.js", () => import("./pdf-test-runtime.js"));
const body = [paragraphXml("1. Prompt one"), paragraphXml("A. First"), paragraphXml("B. Second"), paragraphXml("Answer: B"),
  paragraphXml("2. Prompt two"), paragraphXml("A. Third"), paragraphXml("B. Fourth"), paragraphXml("3. Incomplete")].join("");
function renderImport() {
  render(<MemoryRouter initialEntries={["/import"]}><App /></MemoryRouter>);
  return screen.getByLabelText("Study material file") as HTMLInputElement;
}
async function start(bodyXml = body) {
  const user = userEvent.setup();
  const input = renderImport();
  await user.upload(input, new File([await docxFixture(bodyXml)], "exam.docx"));
  await screen.findByRole("heading", { name: "What are you uploading?" });
  await user.click(screen.getByRole("radio", { name: /Questions or an existing test/ }));
  await user.click(screen.getByRole("button", { name: "Continue with document" }));
  return { user, input };
}
const confirm = () => screen.getByRole("checkbox", { name: /Confirm this question/ });
describe("document intent and question review", () => {
  it("requires an explicit document intent before grouping", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([await docxFixture(body)], "exam.docx"));
    await screen.findByRole("heading", { name: "What are you uploading?" });
    expect(screen.getByRole("button", { name: "Continue with document" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Document question review" })).not.toBeInTheDocument();
  });
  it("notes path shows extracted content without invoking grouping", async () => {
    const spy = vi.spyOn(mapping, "extractDocumentQuestions");
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([await docxFixture(body)], "notes.docx"));
    await screen.findByRole("heading", { name: "What are you uploading?" });
    await user.click(screen.getByRole("radio", { name: /Study material \/ notes/ }));
    await user.click(screen.getByRole("button", { name: "Continue with document" }));
    expect(screen.getByRole("heading", { name: "Content extracted successfully" })).toBeInTheDocument();
    expect(screen.getByText(/Creating questions from study material will be added later/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Document question review" })).not.toBeInTheDocument();
    await user.click(screen.getByText("Extracted content", { exact: true }));
    expect(screen.getByText("1. Prompt one", { exact: true })).toBeInTheDocument();
    spy.mockRestore();
  });
  it("shows counts, needs-review state and one current question editor", async () => {
    await start();
    expect(screen.getByRole("heading", { name: "Question 1 of 3" })).toBeInTheDocument();
    expect(screen.getByText(/3 candidates · 0 reviewed · 3 included · 0 excluded · 3 unresolved/)).toBeInTheDocument();
    expect(screen.getByText("Needs review", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Question text")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Structured mapping" })).not.toBeInTheDocument();
  });
  it("compares immutable original source with edits without rerunning extraction", async () => {
    const spy = vi.spyOn(mapping, "extractDocumentQuestions");
    const { user } = await start();
    expect(spy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText("Original source", { exact: true }));
    expect(screen.getByText("1. Prompt one", { exact: true })).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Question text"));
    await user.type(screen.getByLabelText("Question text"), "Edited question");
    expect(screen.getByText("1. Prompt one", { exact: true })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it("next/previous move focus to candidate heading and retain edits", async () => {
    const { user } = await start();
    await user.clear(screen.getByLabelText("Question text"));
    await user.type(screen.getByLabelText("Question text"), "Changed");
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Question 2 of 3" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Previous question" }));
    expect(screen.getByLabelText("Question text")).toHaveValue("Changed");
  });
  it("linked missing-answer feedback clears when selecting an answer", async () => {
    const { user } = await start();
    await user.click(screen.getByRole("button", { name: "Next question" }));
    const select = screen.getByLabelText("Correct answer");
    expect(select).toHaveAccessibleDescription(/Correct answer wasn't found/);
    expect(select).toHaveAttribute("aria-invalid", "true");
    await user.selectOptions(select, within(select).getAllByRole("option")[2]!);
    expect(select).not.toHaveAttribute("aria-invalid");
    expect(select).toHaveFocus();
  });
  it("allows editing answers, adding/removing and changes correct selection", async () => {
    const { user } = await start();
    await user.clear(screen.getByLabelText("Answer 1 · source label A"));
    await user.type(screen.getByLabelText("Answer 1 · source label A"), "Correction");
    await user.click(screen.getByRole("button", { name: "Add answer" }));
    expect(screen.getByLabelText("Answer 3")).toHaveValue("");
    await user.type(screen.getByLabelText("Answer 3"), "New answer");
    await user.selectOptions(screen.getByLabelText("Correct answer"), screen.getByRole("option", { name: "Answer 3: New answer" }));
    await user.click(screen.getByRole("button", { name: "Remove answer 3" }));
    expect(screen.getByLabelText("Correct answer")).toHaveValue("");
    expect(screen.queryByLabelText("Answer 3")).not.toBeInTheDocument();
  });
  it("category/explanation are explicit editable secondary metadata", async () => {
    const { user } = await start();
    await user.click(screen.getByText("Category and explanation", { exact: true }));
    await user.type(screen.getByLabelText("Topic / category (optional)"), "Safety");
    await user.type(screen.getByLabelText("Explanation (optional)"), "User correction");
    expect(screen.getByLabelText("Topic / category (optional)")).toHaveValue("Safety");
    expect(screen.getByLabelText("Explanation (optional)")).toHaveValue("User correction");
  });
  it("confirmation changes status without stealing focus; edits require reconfirmation", async () => {
    const { user } = await start();
    await user.click(confirm());
    expect(screen.getByText("Ready", { exact: true })).toBeInTheDocument();
    expect(confirm()).toHaveFocus();
    await user.type(screen.getByLabelText("Question text"), " edited");
    expect(confirm()).not.toBeChecked();
    expect(screen.getByLabelText("Question text")).toHaveFocus();
  });
  it("unresolved questions prevent a final ready claim", async () => {
    const { user } = await start();
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(screen.getByRole("heading", { name: "Study set needs attention" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to next unresolved question" }));
    expect(screen.getByRole("heading", { name: "Question 2 of 3" })).toBeInTheDocument();
  });
  it("corrects, confirms and excludes explicitly to reach ready in memory", async () => {
    const { user } = await start();
    await user.click(confirm());
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.selectOptions(screen.getByLabelText("Correct answer"), screen.getByRole("option", { name: "Answer 1: Third" }));
    await user.click(confirm());
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.click(screen.getByRole("checkbox", { name: "Exclude this question from the study set" }));
    expect(screen.getByText("Excluded", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(screen.getByRole("heading", { name: "Study set ready" })).toBeInTheDocument();
    expect(screen.getAllByText(/3 candidates reviewed · 2 included · 1 excluded · 0 unresolved/)).toHaveLength(1);
    await user.click(screen.getByRole("checkbox", { name: "Exclude this question from the study set" }));
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
  });
  it("all excluded never produces an empty ready set", async () => {
    const { user } = await start(paragraphXml("1. Incomplete"));
    await user.click(screen.getByRole("checkbox", { name: "Exclude this question from the study set" }));
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(screen.getByText("Include at least one complete question.")).toBeInTheDocument();
  });
  it("ungrouped source is visible and needs explicit acknowledgement", async () => {
    const { user } = await start(paragraphXml("Introduction") + body);
    expect(screen.getByRole("heading", { name: /1 source blocks were not grouped/ })).toBeInTheDocument();
    await user.click(screen.getByText("Review ungrouped source content", { exact: true }));
    expect(screen.getByText("Introduction", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(screen.getByText("Review the ungrouped source content and acknowledge that it will not become questions.")).toBeInTheDocument();
  });
  it("PDF source page context and ordering limitation are visible", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([pdfFixture([["1. Prompt", "A. First", "B. Second"]])], "exam.pdf"));
    await screen.findByRole("heading", { name: "What are you uploading?" });
    await user.click(screen.getByRole("radio", { name: /Questions or an existing test/ }));
    await user.click(screen.getByRole("button", { name: "Continue with document" }));
    await user.click(screen.getByText("Original source", { exact: true }));
    expect(screen.getByRole("heading", { name: "Page 1" })).toBeInTheDocument();
    expect(screen.getByText(/PDF text order may differ from the page/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Correct answer"), screen.getByRole("option", { name: "Answer 2: Second" }));
    await user.click(confirm());
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(screen.getByRole("heading", { name: "Study set ready" })).toBeInTheDocument();
  });
  it("reset discards the review and allows same-file selection", async () => {
    const { user, input } = await start();
    await user.click(confirm());
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(screen.queryByRole("region", { name: "Document question review" })).not.toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
    await user.upload(input, new File([await docxFixture(body)], "exam.docx"));
    await screen.findByRole("heading", { name: "What are you uploading?" });
    expect(screen.queryByRole("region", { name: "Document question review" })).not.toBeInTheDocument();
  });
  it("changing intent discards corrections, reuses grouping once and never creates notes questions", async () => {
    const spy = vi.spyOn(mapping, "extractDocumentQuestions");
    const { user } = await start();
    await user.type(screen.getByLabelText("Question text"), " changed");
    await user.click(screen.getByRole("button", { name: "Change document intent (discard this review)" }));
    await user.click(screen.getByRole("radio", { name: /Questions or an existing test/ }));
    await user.click(screen.getByRole("button", { name: "Continue with document" }));
    expect(screen.getByLabelText("Question text")).toHaveValue("Prompt one");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it.each(["json", "zip"])("%s stays on structured mapping without document controls", async (format) => {
    const user = userEvent.setup();
    const records = '[{"prompt":"Q","answers":["a","b"],"correct":0}]';
    const content = format === "json" ? records : await zipFixture([["questions.json", records]]);
    await user.upload(renderImport(), new File([content], "records." + format));
    await screen.findByRole("region", { name: "Structured mapping" });
    expect(screen.queryByRole("heading", { name: "What are you uploading?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Document question review" })).not.toBeInTheDocument();
  });
  it("does not allocate canonical identity during grouping or editing; allocates once on final validation", async () => {
    const spy = vi.spyOn(identityModule, "createMappingIdentity");
    const { user } = await start();
    await user.type(screen.getByLabelText("Question text"), " edited");
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(spy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  it("crypto failure blocks the final boundary rather than using a weak fallback", async () => {
    const spy = vi.spyOn(identityModule, "createMappingIdentity").mockReturnValue(undefined);
    const { user } = await start();
    await user.click(screen.getByRole("button", { name: "Validate reviewed questions" }));
    expect(screen.getByText(/Secure ID generation is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Study set ready" })).not.toBeInTheDocument();
    spy.mockRestore();
  });
  it("table review shows the current original row and headers rather than every candidate row", async () => {
    const row = (texts: string[]) => "<w:tr>" + texts.map((text) => "<w:tc>" + paragraphXml(text) + "</w:tc>").join("") + "</w:tr>";
    const { user } = await start("<w:tbl>" + row(["Question", "A", "B", "Correct"])
      + row(["1. First table prompt", "one", "two", "A"]) + row(["2. Later table prompt", "three", "four", "B"]) + "</w:tbl>");
    await user.click(screen.getByText("Original source", { exact: true }));
    const original = document.querySelector(".document-review-grid > details")!;
    expect(original.textContent).toContain("First table prompt");
    expect(original.textContent).not.toContain("Later table prompt");
    await user.click(screen.getByRole("button", { name: "Next question" }));
    await user.click(screen.getByText("Original source", { exact: true }));
    expect(document.querySelector(".document-review-grid > details")!.textContent).toContain("Later table prompt");
  });
});
