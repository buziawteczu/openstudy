import fixture from "../../../packages/schema/test/fixtures/1.0.0/minimal.json";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App.js";
import { DATABASE_NAME, studySetStorage } from "../src/storage/study-sets.js";

function renderAt(path = "/") { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
function removeDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function seed(id = fixture.id, title = fixture.title) {
  expect((await studySetStorage.saveStudySet({ ...fixture, id, title })).success).toBe(true);
}
beforeEach(async () => { await studySetStorage.close(); await removeDatabase(); });
afterEach(async () => { vi.restoreAllMocks(); await studySetStorage.close(); await removeDatabase(); });

describe("saved Library", () => {
  it("shows an empty state", async () => {
    renderAt();
    expect(await screen.findByRole("region", { name: "No study sets yet" })).toBeInTheDocument();
  });
  it("lists multiple summaries, opens an opaque ID, and shows sources", async () => {
    await seed("os:railway.one", "Railway");
    await seed("os:railway.two", "Railway");
    renderAt();
    const links = await screen.findAllByRole("link", { name: /Railway.*1 question/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/study-sets/os%3Arailway.one");
    await userEvent.setup().click(links[0]!);
    expect(await screen.findByRole("heading", { level: 2, name: "Sources" })).toBeInTheDocument();
    expect(screen.getByText("questions.json")).toBeInTheDocument();
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
  });
  it("shows a normal missing state", async () => {
    renderAt("/study-sets/os%3Amissing");
    expect(await screen.findByRole("heading", { name: "Study set not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to library" })).toBeInTheDocument();
  });
  it("allows cancel and then confirmed deletion", async () => {
    await seed();
    const user = userEvent.setup();
    renderAt(`/study-sets/${encodeURIComponent(fixture.id)}`);
    await screen.findByText("Saved on this device");
    await user.click(screen.getByRole("button", { name: "Delete study set" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete study set" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("region", { name: "No study sets yet" })).toBeInTheDocument();
  });
  it("keeps the entry visible when deletion fails", async () => {
    await seed();
    vi.spyOn(studySetStorage, "deleteStudySet").mockResolvedValue({ success: false, error: "delete-failed" });
    const user = userEvent.setup();
    renderAt(`/study-sets/${encodeURIComponent(fixture.id)}`);
    await screen.findByText("Saved on this device");
    await user.click(screen.getByRole("button", { name: "Delete study set" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't delete");
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
  it("offers deletion for incompatible saved data", async () => {
    await seed();
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(DATABASE_NAME); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => { const tx = db.transaction("studySets", "readwrite"); tx.objectStore("studySets").put({ id: fixture.id, schemaVersion: "2.0.0" }); tx.oncomplete = () => resolve(); });
    db.close();
    renderAt(`/study-sets/${encodeURIComponent(fixture.id)}`);
    expect(await screen.findByRole("heading", { name: "This study set can't be opened" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete from this device" })).toBeInTheDocument();
  });
  it("keeps imports reachable if storage is unavailable", async () => {
    vi.spyOn(studySetStorage, "listStudySets").mockResolvedValue({ success: false, error: "storage-unavailable" });
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Library unavailable");
    expect(screen.getByRole("link", { name: "Import study material" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
