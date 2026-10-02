import fixture from "../../../packages/schema/test/fixtures/1.0.0/minimal.json";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudySetSchema } from "@openstudy/schema";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadyStudySetAction } from "../src/components/ReadyStudySetAction.js";
import { studySetStorage } from "../src/storage/study-sets.js";

const existing = () => StudySetSchema.parse(structuredClone(fixture));
function incoming() {
  const set = existing();
  set.id = "incoming.set";
  set.sources[0]!.id = "incoming.source";
  set.questions[0]!.id = "incoming.question";
  set.questions[0]!.choices[0]!.id = "incoming.choice.a";
  set.questions[0]!.choices[1]!.id = "incoming.choice.b";
  set.questions[0]!.correctChoiceId = "incoming.choice.a";
  set.questions[0]!.provenance = [{ sourceId: "incoming.source" }];
  return set;
}
afterEach(() => vi.restoreAllMocks());

describe("ready StudySet destination", () => {
  it("keeps normal import on Save to library", () => {
    render(<MemoryRouter><ReadyStudySetAction studySet={incoming()} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Save to library" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Update study set" })).not.toBeInTheDocument();
  });

  it("previews exact duplicates without persisting and surfaces a revision conflict", async () => {
    const replace = vi.spyOn(studySetStorage, "replaceStudySet").mockResolvedValue({ success: false, error: "revision-conflict" });
    render(<MemoryRouter><ReadyStudySetAction studySet={incoming()} existingStudySet={existing()} /></MemoryRouter>);
    expect(screen.getByText(/1 question found · 0 new · 1 already exist/)).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Update study set" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This study set changed while you were adding material");
    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0]![0].expectedRevision).toBe(1);
    expect(screen.getByRole("link", { name: /Back to study set/ })).toHaveAttribute("href", `/study-sets/${fixture.id}`);
  });

  it("blocks ambiguous saved matches", () => {
    const saved = existing();
    saved.questions.push({ ...structuredClone(saved.questions[0]!), id: "second.question" });
    render(<MemoryRouter><ReadyStudySetAction studySet={incoming()} existingStudySet={saved} /></MemoryRouter>);
    expect(screen.getByText(/matches more than one question already/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Update study set" })).toBeDisabled();
  });
});
