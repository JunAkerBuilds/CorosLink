import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WatchfacesView } from "../../src/watchfaces/WatchfacesView";
import { WatchfaceAutomationSettings } from "../../src/settings/WatchfaceAutomationSettings";
import "../../src/styles.css";

function VerificationApp() {
  const api = window.corosLink!;
  const [opened, setOpened] = useState(false);
  useEffect(() => api.onWatchfaceAutomationActivate(() => setOpened(true)), [api]);
  return <div className="app"><div className="app-body"><main className="content">
    {opened ? <WatchfacesView api={api} active showDevelopmentTools={false} watchStatus={null} communityOpenRequest={null} onCommunityOpenRequestHandled={() => undefined} /> : <WatchfaceAutomationSettings api={api} />}
  </main></div></div>;
}

createRoot(document.getElementById("root")!).render(<VerificationApp />);
