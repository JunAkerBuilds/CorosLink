import { createRoot } from 'react-dom/client';
import { UpcomingWorkoutsPanel } from '../../src/training/components/UpcomingWorkoutsPanel';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { UnitSystemProvider } from '../../src/units/UnitSystemProvider';
import '../../src/styles.css';
const workouts = Array.from({length: 10}, (_, index) => {
  const day = new Date(); day.setDate(day.getDate() + index);
  return { happenDay: `${day.getFullYear()}${String(day.getMonth()+1).padStart(2,'0')}${String(day.getDate()).padStart(2,'0')}`, name: index % 2 ? 'Gym Leg Strength' : '9km Easy Run', volume: '9.00 km', trainingLoad: 45 };
});
createRoot(document.getElementById('root')!).render(<ThemeProvider><UnitSystemProvider><main style={{padding: 16, display: 'grid', gap: 16, maxWidth: 650}}>
  <UpcomingWorkoutsPanel workouts={workouts} size="mini" />
  <UpcomingWorkoutsPanel workouts={workouts} size="short" />
</main></UnitSystemProvider></ThemeProvider>);
