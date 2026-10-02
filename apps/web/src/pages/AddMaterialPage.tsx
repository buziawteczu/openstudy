import { useEffect, useState } from "react";
import type { StudySet } from "@openstudy/schema";
import { Link, useParams } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";
import { ImportPage } from "./ImportPage.js";

type State = { kind: "loading" } | { kind: "ready"; studySet: StudySet } |
  { kind: "missing" | "incompatible" | "error" };

export function AddMaterialPage() {
  const { id } = useParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    if (!id) { setState({ kind: "missing" }); return; }
    void (async () => {
      const result = await studySetStorage.getStudySet(id);
      if (!active) return;
      if (result.success) { setState({ kind: "ready", studySet: result.value }); return; }
      if (result.error !== "not-found") {
        setState({ kind: result.error === "incompatible-study-set" ? "incompatible" : "error" });
        return;
      }
      const summaries = await studySetStorage.listStudySets();
      if (active) setState({ kind: summaries.success && summaries.value.some((entry) => entry.id === id) ? "incompatible" : summaries.success ? "missing" : "error" });
    })();
    return () => { active = false; };
  }, [id]);
  if (state.kind === "ready") return <ImportPage existingStudySet={state.studySet} />;
  return <>
    <title>Add material | OpenStudy</title>
    <p className="eyebrow">Add material</p>
    <h1>{state.kind === "missing" ? "Study set not found" : state.kind === "incompatible" ? "This study set can't be opened" : "Add material"}</h1>
    {state.kind === "loading" && <p role="status" className="mt-5">Opening study set…</p>}
    {state.kind === "missing" && <p className="mt-4 text-muted">It may have been deleted from this device.</p>}
    {state.kind === "incompatible" && <p className="mt-4 text-muted">Its saved data could not be validated. No material was added.</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-danger">OpenStudy couldn't read this study set on this device.</p>}
    {state.kind !== "loading" && <div className="mt-8"><Link className="back-link" to={id ? `/study-sets/${encodeURIComponent(id)}` : "/"}>← Back to study set</Link></div>}
  </>;
}
