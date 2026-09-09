import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ApiError } from "@de-press/api-client";
import { HostProvider } from "@/core/host/HostContext";
import { ThemeProvider } from "@/core/theme";
import { LocaleProvider } from "@/core/i18n/context";
import { ToastProvider } from "@/core/toast";
import "@de-press/theme/tokens.css";
import "./styles/base.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // 4xx не ретраим: повтор для 401/403/404 бессмыслен и шумит в логах.
      retry: (failureCount, error) =>
        !(error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <HostProvider>
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ToastProvider>
          </HostProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>,
);