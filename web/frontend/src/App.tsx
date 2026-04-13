import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { DashboardPage } from "./pages/DashboardPage";
import { ConfigPage } from "./pages/ConfigPage";
import { EventsPage } from "./pages/EventsPage";
import { SkillsPage } from "./pages/SkillsPage";

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
