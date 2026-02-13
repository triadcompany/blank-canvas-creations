import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CRMLayout } from "@/components/layout/CRMLayout";
import { ClerkProvider } from "@/providers/ClerkProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Dashboard } from "@/pages/Dashboard";
import { Oportunidades } from "@/pages/Oportunidades";
import { Leads } from "@/pages/Leads";
import { Reports } from "@/pages/Reports";
import { Settings } from "@/pages/Settings";
import { Pipelines } from "@/pages/Pipelines";

import { Auth } from "@/pages/Auth";
import { SellerAuth } from "@/pages/SellerAuth";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";
import Tasks from "./pages/Tasks";
import NotFound from "./pages/NotFound";

import LandingPage from "./pages/LandingPage";
import Prospeccao from "./pages/Prospeccao";
import Automacoes from "./pages/Automacoes";
import Onboarding from "./pages/Onboarding";
import InboxPage from "./pages/Inbox";
import TreinarAgente from "./pages/TreinarAgente";
import AdminDebugAutomations from "./pages/AdminDebugAutomations";
import AdminDiagnostico from "./pages/AdminDiagnostico";
import { TabBar } from "./components/mobile/TabBar";
import { InstallPrompt } from "./components/pwa/InstallPrompt";
import { UpdatePrompt } from "./components/pwa/UpdatePrompt";
import { OfflineIndicator } from "./components/pwa/OfflineIndicator";
import { useEffect } from "react";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => console.log('Service Worker registered'))
        .catch((err) => console.log('Service Worker registration failed:', err));
    }

    // Add manifest link
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);

    // Add viewport meta for mobile
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }
  }, []);

  return (
    <ClerkProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AuthProvider>
          <BrowserRouter>
            <Routes>
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/seller-auth" element={<SellerAuth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Dashboard />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/oportunidades" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Oportunidades />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/leads" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Leads />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/reports" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Reports />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Settings />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/pipelines" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Pipelines />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/tarefas" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Tasks />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/prospeccao" element={
              <ProtectedRoute>
                <CRMLayout>
                  <Prospeccao />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/automacoes" element={
              <ProtectedRoute>
                <Automacoes />
              </ProtectedRoute>
            } />
            <Route path="/inbox" element={
              <ProtectedRoute>
                <CRMLayout>
                  <InboxPage />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/treinar-agente" element={
              <ProtectedRoute>
                <CRMLayout>
                  <TreinarAgente />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/debug/automations" element={
              <ProtectedRoute>
                <CRMLayout>
                  <AdminDebugAutomations />
                </CRMLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/diagnostico" element={
              <ProtectedRoute>
                <CRMLayout>
                  <AdminDiagnostico />
                </CRMLayout>
              </ProtectedRoute>
            } />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <TabBar />
          <InstallPrompt />
          <UpdatePrompt />
          <OfflineIndicator />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
    </ClerkProvider>
  );
};

export default App;
