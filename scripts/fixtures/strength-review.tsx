import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkoutEditCard } from "../../src/chat/WorkoutEditCard";
import type { StrengthEditPreview } from "../../electron/workoutEditTypes";
import "../../src/styles.css";
function Fixture() {
  const [reviews, setReviews] = useState<StrengthEditPreview[]>([]);
  useEffect(() => { void window.corosLink!.listWorkoutEdits().then(setReviews); }, []);
  return <main style={{maxWidth:740,margin:"auto",padding:24}}><h2>Strength workout review</h2>{reviews.map(p=><WorkoutEditCard key={p.proposalId} preview={p} api={window.corosLink!} />)}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
