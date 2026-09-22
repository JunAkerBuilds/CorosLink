import { createRoot } from 'react-dom/client';
import { TrainingHubView } from '../../src/training/TrainingHubView';
import { ThemeProvider } from '../../src/theme/ThemeProvider';
import { UnitSystemProvider } from '../../src/units/UnitSystemProvider';
import type { TrainingHubViewProps } from '../../src/training/types';
import '../../src/styles.css';
const noop = () => {};
const props = { api: {}, status: null, email: '', password: '', remember: false, twoFactorEmail: null, twoFactorCode: '', activities: [], upcomingWorkouts: [], snapshot: null, sportTypes: [], activityDetail: null, selectedActivity: null, busy: null,
  onEmailChange: noop, onPasswordChange: noop, onRememberChange: noop, onLogin: noop, onTwoFactorCodeChange: noop, onVerifyTwoFactor: noop, onResendTwoFactor: noop, onCancelTwoFactor: noop, onReconnect: noop, onLogout: noop, onRefresh: noop, onLoadDetail: noop, onExportFile: noop } as TrainingHubViewProps;
createRoot(document.getElementById('root')!).render(<ThemeProvider><UnitSystemProvider><main style={{ padding: 24, height: '100vh', overflow: 'auto' }}><TrainingHubView {...props} /></main></UnitSystemProvider></ThemeProvider>);
