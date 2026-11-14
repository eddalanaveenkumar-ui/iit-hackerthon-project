import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { Spinner } from './components/ui';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Layout = lazy(() => import('./components/Layout'));
const CommandChat = lazy(() => import('./pages/CommandChat'));
const Classrooms = lazy(() => import('./pages/Classrooms'));
const CreateClassroom = lazy(() => import('./pages/CreateClassroom'));
const ClassroomDetail = lazy(() => import('./pages/ClassroomDetail'));
const TutorSession = lazy(() => import('./pages/TutorSession'));
const Practice = lazy(() => import('./pages/Practice'));
const Assessments = lazy(() => import('./pages/Assessments'));
const Progress = lazy(() => import('./pages/Progress'));
const Monitoring = lazy(() => import('./pages/Monitoring'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const ChatPrivacy = lazy(() => import('./pages/ChatPrivacy'));
const Settings = lazy(() => import('./pages/Settings'));
const HistoryPage = lazy(() => import('./pages/History'));
const AIConfig = lazy(() => import('./pages/admin/AIConfig'));
const Lesson = lazy(() => import('./pages/Lesson'));
const Tracs = lazy(() => import('./pages/Tracs'));
const NotFound = lazy(() => import('./pages/NotFound'));

function FullPageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
        <Spinner className="h-6 w-6" />
        Loading LearnMate AI…
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/app" replace />;
  return children;
}

/**
 * The loading state shown while a page chunk is fetched.
 *
 * This used to be a full-page spinner *above* the router, so moving between
 * pages blanked the entire app — the sidebar disappeared and the screen flashed
 * white — every time a lazy chunk was still in flight. Reserving the content
 * area keeps the frame in place, which reads as instant even when it isn't.
 */
function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6" role="status" aria-label="Loading page">
      <div className="mx-auto mb-4 h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="mx-auto mb-2.5 h-20 w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
      <div className="mx-auto h-20 w-3/4 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/app"
          element={
            <RequireAuth>
              <Suspense fallback={<FullPageSpinner />}>
                <Layout />
              </Suspense>
            </RequireAuth>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<PageFallback />}>
                <CommandChat />
              </Suspense>
            }
          />
          {/* /start is a command inside the chat, not a route: keep the old URL working. */}
          <Route path="start" element={<Navigate to="/app" replace />} />

          <Route path="classrooms" element={<Classrooms />} />
          <Route path="classrooms/new" element={<CreateClassroom />} />
          <Route path="classrooms/:classroomId" element={<ClassroomDetail />} />
          <Route path="classrooms/:classroomId/setup" element={<ClassroomDetail />} />
          <Route path="classrooms/:classroomId/monitor" element={<Monitoring />} />
          <Route path="classrooms/:classroomId/profile/:userId" element={<StudentProfile />} />
          <Route path="classrooms/:classroomId/privacy" element={<ChatPrivacy />} />

          <Route path="tutor/:sessionId" element={<TutorSession />} />
          <Route path="lesson" element={<Lesson />} />
          <Route path="lesson/:lessonId" element={<Lesson />} />
          <Route path="tracs" element={<Tracs />} />
          <Route path="tracs/:sessionId" element={<Tracs />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="practice" element={<Practice />} />
          <Route path="practice/:classroomId" element={<Practice />} />
          <Route path="assessments" element={<Assessments />} />
          <Route path="progress" element={<Progress />} />
          <Route path="settings" element={<Settings />} />
          <Route
            path="admin/ai"
            element={
              <RequireAdmin>
                <AIConfig />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
