import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { MainLayout } from "../components/MainLayout";
import { AppLayout } from "../components/AppLayout";
import { I18nProvider } from "../shared/i18n/I18nProvider";
import { FaqPage } from "../pages/FaqPage";
import { LandingPage } from "../pages/LandingPage";
import { LoginPage } from "../pages/LoginPage";
import { PricingPage } from "../pages/PricingPage";
import { RegisterPage } from "../pages/RegisterPage";
import { DashboardPage } from "../pages/DashboardPage";
import { BookingsPage } from "../pages/BookingsPage";
import { ServicesPage } from "../pages/ServicesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PublicBookingPage } from "../pages/PublicBookingPage";
import { FaqSettingsPage } from "../pages/FaqSettingsPage";
import { PrivacyPage } from "../pages/PrivacyPage";
import { NotificationsPage } from "../pages/NotificationsPage";
import { ScopeProvider } from "../shared/hooks/useScopeContext";
import { ProtectedAppRoute } from "../components/ProtectedAppRoute";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../pages/ResetPasswordPage";
import { EmailVerificationPage } from "../pages/EmailVerificationPage";
import { StaffPage } from "../pages/StaffPage";
import { SchedulePage } from "../pages/SchedulePage";
import { SuperAdminLoginPage } from "../pages/SuperAdminLoginPage";
import { SuperAdminPage } from "../pages/SuperAdminPage";
import { resolveCurrentTenantSlug } from "../shared/routing/tenant-host";
import { ContactPage } from "../pages/ContactPage";
import { PublicTenantLandingPage } from "../pages/PublicTenantLandingPage";

function RootEntryPage() {
  const tenantSlug = resolveCurrentTenantSlug();
  if (tenantSlug) {
    return <PublicTenantLandingPage />;
  }
  return <LandingPage />;
}

function TenantBookingRedirect() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return <Navigate to={`/t/${tenantSlug ?? ""}#booking`} replace />;
}

export function App() {
  return (
    <I18nProvider>
      <ScopeProvider>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<RootEntryPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/book" element={<PublicBookingPage />} />
            <Route path="/t/:tenantSlug" element={<PublicTenantLandingPage />} />
            <Route path="/t/:tenantSlug/book" element={<TenantBookingRedirect />} />
            <Route path="/booking" element={<Navigate to="/book" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/email-verification" element={<EmailVerificationPage />} />
            <Route path="/auth/login" element={<Navigate to="/login" replace />} />
            <Route path="/auth/register" element={<Navigate to="/register" replace />} />
            <Route path="/auth/forgot-password" element={<Navigate to="/forgot-password" replace />} />
            <Route path="/auth/reset-password" element={<Navigate to="/reset-password" replace />} />
            <Route path="/auth/email-verification" element={<Navigate to="/email-verification" replace />} />
            <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />
            <Route path="/super-admin" element={<SuperAdminPage />} />
          </Route>

          <Route element={<ProtectedAppRoute />}>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/faq" element={<FaqSettingsPage />} />
              <Route path="settings/privacy" element={<PrivacyPage />} />
              <Route path="settings/notifications" element={<NotificationsPage />} />
            </Route>
            <Route path="/t/:tenantSlug/app" element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/faq" element={<FaqSettingsPage />} />
              <Route path="settings/privacy" element={<PrivacyPage />} />
              <Route path="settings/notifications" element={<NotificationsPage />} />
            </Route>
            <Route path="/admin" element={<Navigate to="/app" replace />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ScopeProvider>
    </I18nProvider>
  );
}
