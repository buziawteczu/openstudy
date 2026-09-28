import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { docxFixture, encryptedPdfFixture, pdfFixture } from "./document-fixtures.js";

vi.mock("../src/import/pdf-runtime.js", () => import("./pdf-test-runtime.js"));

function renderImport() {
  render(<MemoryRouter initialEntries={["/import"]}><App /></MemoryRouter>);
  return screen.getByLabelText("Study material file") as HTMLInputElement;
}
describe("document Import screen", () => {
  it("accepts all four formats and explains PDF/DOC limitations accessibly", () => {
    const input = renderImport();
    expect(input).toHaveAttribute("accept", ".docx,.pdf,.json,.zip");
    expect(input).toHaveAccessibleDescription(/PDF with selectable text.*Scanned PDFs and legacy DOC.*Files are processed on this device/);
  });
  it("announces DOCX structure without claiming to discover questions", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([await docxFixture()], "exam.docx"));
    expect(await screen.findByRole("heading", { name: "Document extracted" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("5 paragraphs extracted");
    expect(screen.getByRole("status")).toHaveTextContent("1 table extracted");
    expect(screen.getByRole("status")).toHaveTextContent("Content ready for review");
    expect(screen.getByRole("status")).toHaveTextContent("No questions have been created");
    expect(screen.queryByText("Ready for mapping")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  });
  it("announces PDF pages and extracted text without false DOCX counts", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([pdfFixture()], "notes.pdf"));
    expect(await screen.findByRole("heading", { name: "Document extracted" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 pages processed");
    expect(screen.getByRole("status")).toHaveTextContent("Selectable text extracted");
    expect(screen.queryByText(/paragraphs extracted/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("reading order may need review");
  });
  it("surfaces blank pages in a mixed PDF", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([pdfFixture([["Useful selectable text"], []])], "mixed.pdf"));
    await screen.findByText("Document extracted");
    expect(screen.getByRole("status")).toHaveTextContent("1 page has no selectable text");
  });
  it("reports scanned-style PDFs with a truthful typed error, not corruption", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([pdfFixture([[]], true)], "scan.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find enough selectable text in this PDF. Scanned PDFs aren't supported yet.");
    expect(screen.queryByText("Document extracted")).not.toBeInTheDocument();
  });
  it("reports password-protected PDF without a password prompt or raw parser error", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([encryptedPdfFixture()], "locked.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("password-protected or encrypted");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it.each(["docx", "pdf"])("reports malformed %s independently of JSON errors", async (format) => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File(["broken"], `broken.${format}`));
    expect(await screen.findByRole("alert")).toHaveTextContent(`This ${format.toUpperCase()} file could not be read`);
    expect(screen.queryByText(/not valid UTF-8 JSON/)).not.toBeInTheDocument();
  });
  it("resets DOCX state/focus and supports the same-file retry followed by JSON", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    const file = new File([await docxFixture()], "exam.docx");
    await user.upload(input, file);
    await screen.findByText("Document extracted");
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(input.value).toBe("");
    expect(screen.queryByText("Document extracted")).not.toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
    await user.upload(input, file);
    await screen.findByText("Document extracted");
    await user.upload(input, new File(['[{"opaque":true}]'], "records.json"));
    await screen.findByText("Ready for mapping");
    expect(screen.getByRole("status")).toHaveTextContent("1 record discovered");
    expect(screen.queryByText("Document extracted")).not.toBeInTheDocument();
  });
  it("allows reset from a scanned-PDF error and then successful PDF selection", async () => {
    const user = userEvent.setup();
    const input = renderImport();
    await user.upload(input, new File([pdfFixture([[]], true)], "scan.pdf"));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.upload(input, new File([pdfFixture()], "notes.pdf"));
    await screen.findByText("Document extracted");
  });
  it("surfaces omitted DOCX sections and media instead of claiming full fidelity", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([await docxFixture('<w:p><w:r><w:drawing/></w:r></w:p>', [["word/header1.xml", "header"]])], "media.docx"));
    await screen.findByText("Document extracted");
    expect(screen.getByRole("status")).toHaveTextContent("contains media that has not been extracted");
    expect(screen.getByRole("status")).toHaveTextContent("Review against the original file");
  });
  it("creates no Library entry after document extraction", async () => {
    const user = userEvent.setup();
    await user.upload(renderImport(), new File([await docxFixture()], "exam.docx"));
    await screen.findByText("Document extracted");
    await user.click(screen.getByRole("link", { name: "Back to library" }));
    expect(screen.getByRole("region", { name: "No study sets yet" })).toBeInTheDocument();
  });
});
