import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CRMLayout } from "@/components/layout/CRMLayout";
import { ClerkProvider } from "@/providers/ClerkProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppGate } from "@/components/AppGate";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

const App = () => {
  useEffect(() => {
    // Register service worker for PWA — only in production
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => console.log('Service Worker registered'))
        .catch((err) => console.log('Service Worker registration failed:', err));
    } else if ('serviceWorker' in navigator && !import.meta.env.PROD) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((r) => r.unregister());
      });
    }

    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);

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
              {/* ── Public routes ── */}
              <Route path="/landing" element={<LandingPage />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/seller-auth" element={<SellerAuth />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* ── Private routes — all under AppGate ── */}
              <Route element={<AppGate />}>
                {/* Onboarding (AppGate only allows access when no org) */}
                <Route path="/onboarding" element={<Onboarding />} />

              {/* App routes wrapped in persistent CRMLayout */}
                <Route element={<CRMLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/oportunidades" element={<Oportunidades />} />
                  <Route path="/leads" element={<Leads />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/pipelines" element={<Pipelines />} />
                  <Route path="/tarefas" element={<Tasks />} />
                  <Route path="/prospeccao" element={<Prospeccao />} />
                  <Route path="/automacoes" element={<Automacoes />} />
                  <Route path="/inbox" element={<InboxPage />} />
                  <Route path="/treinar-agente" element={<TreinarAgente />} />
                  <Route path="/admin/debug/automations" element={<AdminDebugAutomations />} />
                  <Route path="/admin/diagnostico" element={<AdminDiagnostico />} />
                </Route>
              </Route>

              {/* ── Catch-all ── */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
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