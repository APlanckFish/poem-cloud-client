import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AppFrame, LoadingState, RequireLogin } from './components/Layout'
import { ensureInstallation, setSessionInvalidHandler } from './lib/api'
import { useAppStore } from './store/app'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const CreatePage = lazy(() => import('./pages/CreatePage'))
const CreatingPage = lazy(() => import('./pages/CreatingPage'))
const CommunityPage = lazy(() => import('./pages/CommunityPage'))
const PublicationPage = lazy(() => import('./pages/PublicationPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const SocialPage = lazy(() => import('./pages/SocialPage'))
const PreferencesPage = lazy(() => import('./pages/PreferencesPage'))
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))

function Protected({ children }: { children: React.ReactNode }) {
  return <RequireLogin>{children}</RequireLogin>
}

export default function App() {
  const navigate = useNavigate()
  const restoreSession = useAppStore((state) => state.restoreSession)
  const expireSession = useAppStore((state) => state.expireSession)
  useEffect(() => {
    setSessionInvalidHandler(() => {
      expireSession()
      navigate('/profile', { replace: true })
    })
    void ensureInstallation().catch(() => undefined)
    void restoreSession()
    return () => setSessionInvalidHandler(null)
  }, [expireSession, navigate, restoreSession])

  return (
    <AppFrame>
      <Suspense fallback={<LoadingState label="正在展开诗笺…" />}>
        <Routes>
          <Route path="/" element={<Navigate to="/create" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/creating/:runId" element={<CreatingPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/publication/:id" element={<PublicationPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/works" element={<Protected><LibraryPage mode="works" /></Protected>} />
          <Route path="/works/user/:userId" element={<LibraryPage mode="public" />} />
          <Route path="/drafts" element={<LibraryPage mode="drafts" />} />
          <Route path="/followers" element={<Protected><SocialPage mode="followers" /></Protected>} />
          <Route path="/following" element={<Protected><SocialPage mode="following" /></Protected>} />
          <Route path="/creation-preferences" element={<PreferencesPage questionnaire />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/edit-profile" element={<Protected><EditProfilePage /></Protected>} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/create" replace />} />
        </Routes>
      </Suspense>
    </AppFrame>
  )
}
