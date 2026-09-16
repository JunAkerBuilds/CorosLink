import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RouteStudio } from "../../src/maps/routes/RouteStudio";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import "../../src/styles.css";
import "leaflet/dist/leaflet.css";

function Fixture() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return <UnitSystemProvider>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 16 }}>
    <p data-test="error">{error}</p><p data-test="message">{message}</p>
    <RouteStudio api={window.corosLink!} onError={setError} onMessage={setMessage} />
    </div>
  </UnitSystemProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
