import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnswerOption, StudyProgress, StudySessionFrame, StudySetup } from "../src/components/study/StudyPresentation.js";

describe("study presentation", () => {
  it("keeps position text and a named native progress bar together", () => {
    render(<StudyProgress id="position" label="Question" current={3} total={20} />);
    expect(screen.getByText("Question 3 of 20")).toHaveAttribute("id", "position");
    const bar = screen.getByRole("progressbar", { name: "Question position" });
    expect(bar.tagName).toBe("PROGRESS");
    expect(bar).toHaveAttribute("value", "3"); expect(bar).toHaveAttribute("max", "20");
    expect(bar).toHaveAttribute("aria-valuetext", "3 of 20");
  });
  it.each(["Card", "Mistake"] as const)("names %s progress without implying a score", (label) => {
    render(<StudyProgress id="position" label={label} current={1} total={2} />);
    expect(screen.getByRole("progressbar", { name: `${label} position` })).toHaveAttribute("value", "1");
    expect(screen.getByText(`${label} 1 of 2`)).toBeVisible();
  });
  it("marks the focused frame and keeps an accessible exit before its content", () => {
    const { container } = render(<StudySessionFrame mode="Test" title="Cities" exit={<a href="/">Exit session</a>}>
      <h1>Capital of Portugal?</h1>
    </StudySessionFrame>);
    expect(container.querySelector("[data-study-session]")).toContainElement(screen.getByRole("heading"));
    expect(screen.getByRole("link", { name: "Exit session" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Cities")).toBeVisible();
  });
  it("retains Choice.id as the native radio value and excludes display letters from its name", async () => {
    const onChange = vi.fn();
    render(<AnswerOption id="choice.lisbon" text="Lisbon" index={26} name="answer" checked={false} onChange={onChange} />);
    const radio = screen.getByRole("radio", { name: "Lisbon" });
    expect(radio).toHaveAttribute("value", "choice.lisbon");
    expect(screen.getByText("AA")).toHaveAttribute("aria-hidden", "true");
    await userEvent.setup().click(radio); expect(onChange).toHaveBeenCalledOnce();
    expect(screen.queryByText(/correct|incorrect/i)).not.toBeInTheDocument();
  });
  it.each(["wrong", "correct"] as const)("communicates known %s feedback in text", (feedback) => {
    render(<AnswerOption id="choice.one" text="One" index={0} name="answer" checked onChange={() => {}} feedback={feedback} />);
    expect(screen.getByText(feedback === "wrong" ? "Incorrect selection" : "Correct answer")).toBeVisible();
    expect(screen.getByRole("radio")).toBeChecked();
  });
  it("forwards setup focus and native controlled field changes without owning validation", () => {
    const heading = createRef<HTMLHeadingElement>(); const categoryChange = vi.fn(); const countChange = vi.fn();
    render(<StudySetup mode="Test" title="Cities" description="Answer first." headingRef={heading} prefix="test"
      categories={[{ id: "category.europe", label: "Europe" }]} categoryId={null} onCategoryChange={categoryChange}
      count="3" onCountChange={countChange} countInvalid={false} available={3} unit="question" countHelp="Choose 1 to 3.">
      <button>Start test</button>
    </StudySetup>);
    expect(heading.current).toBe(screen.getByRole("heading", { name: "Test “Cities”" }));
    fireEvent.change(screen.getByLabelText("Topic / category"), { target: { value: "category.europe" } });
    fireEvent.change(screen.getByLabelText("Questions"), { target: { value: "2" } });
    expect(categoryChange).toHaveBeenCalledOnce(); expect(countChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Start test" })).toBeVisible();
  });
  it("associates invalid count help and error with the input", () => {
    render(<StudySetup mode="Flashcards" title="Cities" description="Recall." headingRef={createRef()} prefix="flashcard"
      categories={[]} categoryId={null} onCategoryChange={() => {}} count="0" onCountChange={() => {}}
      countInvalid available={2} unit="card" countHelp="Choose 1 to 2." countError="Enter a valid card count to start.">
      <button disabled>Start flashcards</button>
    </StudySetup>);
    expect(screen.getByLabelText("Cards")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Cards")).toHaveAccessibleDescription("Choose 1 to 2. Enter a valid card count to start.");
  });
});
