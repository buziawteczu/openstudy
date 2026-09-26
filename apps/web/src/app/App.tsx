import { Route, Routes } from "react-router";

import { ImportPage } from "../pages/ImportPage.js";
import { LibraryPage } from "../pages/LibraryPage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { AppShell } from "./AppShell.js";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LibraryPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
