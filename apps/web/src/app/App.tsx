import { Route, Routes } from "react-router";

import { ImportPage } from "../pages/ImportPage.js";
import { AddMaterialPage } from "../pages/AddMaterialPage.js";
import { LibraryPage } from "../pages/LibraryPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { StudySetPage } from "../pages/StudySetPage.js";
import { AppShell } from "./AppShell.js";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LibraryPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="study-sets/:id" element={<StudySetPage />} />
        <Route path="study-sets/:id/add-material" element={<AddMaterialPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
