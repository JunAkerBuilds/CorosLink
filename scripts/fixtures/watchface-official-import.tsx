import { createRoot } from "react-dom/client";
import { WatchfacesView } from "../../src/watchfaces/WatchfacesView";
import "../../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <div className="app"><div className="app-body"><main className="content">
    <WatchfacesView api={window.corosLink!} active showDevelopmentTools={false}
      watchStatus={null} communityOpenRequest={null} onCommunityOpenRequestHandled={() => undefined} />
  </main></div></div>
);
