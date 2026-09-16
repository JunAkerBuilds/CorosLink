import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WatchfacesView } from "../../src/watchfaces/WatchfacesView";
import "../../src/styles.css";

function VerificationApp() {
  const [request, setRequest] = useState<{ slug: string; requestId: number } | null>(null);
  useEffect(() => {
    const receive = (event: Event) => setRequest((event as CustomEvent).detail);
    window.addEventListener("test:community-open", receive);
    return () => window.removeEventListener("test:community-open", receive);
  }, []);
  return <WatchfacesView api={window.corosLink!} active showDevelopmentTools={false}
    watchStatus={null} communityOpenRequest={request}
    onCommunityOpenRequestHandled={() => setRequest(null)} />;
}

createRoot(document.getElementById("root")!).render(<VerificationApp />);
