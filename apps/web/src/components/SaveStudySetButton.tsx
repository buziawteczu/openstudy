import { useRef, useState } from "react";
import type { StudySet } from "@openstudy/schema";
import { useNavigate } from "react-router";
import { studySetStorage } from "../storage/study-sets.js";

export function SaveStudySetButton({ studySet }: { studySet: StudySet }) {
  const navigate = useNavigate();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(false);
    try {
      const result = await studySetStorage.saveStudySet(studySet);
      if (result.success) navigate(`/study-sets/${encodeURIComponent(studySet.id)}`);
      else setError(true);
    } catch { setError(true); }
    finally { busy.current = false; setSaving(false); }
  }

  return <div className="mt-5">
    <button type="button" className="action" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save to library"}</button>
    {error && <p role="alert" className="mt-3 text-danger">OpenStudy couldn't save this study set on this device. Please try again.</p>}
  </div>;
}
