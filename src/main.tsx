import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import './index.css'
import { isLocalHostname } from './utils/localHost'

// Helper para verificar se está em localhost
const isLocalhost = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isLocalHostname(window.location.hostname);
};

// Initialize Sentry apenas se não estiver em localhost
if (import.meta.env.VITE_SENTRY_DSN && !isLocalhost()) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    // Privacy: Don't send PII data to Sentry by default
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    // Tracing
    // Capture 100% of the transactions in production, lower in development
    tracesSampleRate: import.meta.env.PROD ? 1.0 : 0.1,
    // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
    tracePropagationTargets: [
      /^https:\/\/.*\.firebaseapp\.com/,
      /^https:\/\/.*\.firebaseio\.com/,
    ],
    // Environment
    environment: import.meta.env.MODE,
    // Enable logs to be sent to Sentry
    enableLogs: true,
    // Performance monitoring
    beforeSend(event, hint) {
      // Remove potentially sensitive data from event
      if (event.request) {
        // Remove query parameters that might contain sensitive info
        if (event.request.url) {
          try {
            const url = new URL(event.request.url);
            url.search = '';
            event.request.url = url.toString();
          } catch {
            // Ignore URL parsing errors
          }
        }
      }

      // Add more context for "Unexpected token" errors
      if (event.exception) {
        const error = hint.originalException;
        const errorMessage = event.exception.values?.[0]?.value || '';
        
        // Check if it's a chunk loading error
        if (
          errorMessage.includes("Unexpected token '<'") ||
          errorMessage.includes("Unexpected token") ||
          errorMessage.includes("Failed to fetch dynamically imported module") ||
          errorMessage.includes("Loading chunk") ||
          errorMessage.includes("Load chunk")
        ) {
          // Add extra context
          event.extra = {
            ...event.extra,
            isChunkError: true,
            currentUrl: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
          };

          // Try to extract the failed URL from the error
          if (error instanceof Error && error.stack) {
            const urlMatch = error.stack.match(/https?:\/\/[^\s"'<>]+/);
            if (urlMatch) {
              event.extra.failedUrl = urlMatch[0];
            }
          }
        }
      }

      return event;
    },
  });

  // Global error handler for unhandled promise rejections (common with chunk loading)
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const error = event.reason;
    const errorMessage = error instanceof Error ? error.message : String(error || '');
    
    // Check if it's a chunk loading error
    if (
      errorMessage.includes("Unexpected token '<'") ||
      errorMessage.includes("Failed to fetch dynamically imported module") ||
      errorMessage.includes("Loading chunk") ||
      errorMessage.includes("Load chunk")
    ) {
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      const stack = errorObj.stack || '';
      
      Sentry.captureException(errorObj, {
        tags: {
          errorType: 'chunk_loading_error',
        },
        extra: {
          isChunkError: true,
          currentUrl: window.location.href,
          failedUrl: stack.match(/https?:\/\/[^\s"'<>]+/)?.[0],
        },
      });
    }
  });

  // Global error handler for script loading errors
  window.addEventListener('error', (event: ErrorEvent) => {
    const error = event.error;
    const errorMessage = event.message || (error instanceof Error ? error.message : '');
    
    // Check if it's a chunk loading error or script error
    if (
      errorMessage.includes("Unexpected token '<'") ||
      errorMessage.includes("Failed to fetch dynamically imported module") ||
      errorMessage.includes("Loading chunk") ||
      errorMessage.includes("Load chunk") ||
      (event.filename && event.filename.includes('.js') && errorMessage.includes('Script error'))
    ) {
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      
      Sentry.captureException(errorObj, {
        tags: {
          errorType: 'script_loading_error',
        },
        extra: {
          isChunkError: true,
          currentUrl: window.location.href,
          failedScript: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    }
  }, true); // Use capture phase to catch errors early
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        // Service Worker registered
        
        // Check for updates every hour
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      })
      .catch((_error) => {
        // Service Worker registration failed
      });
  });
}

// Console Easter Egg
console.log(
  "%c Tá procurando algo aqui meu filho? \n" +
  "%c" +
  "          .-------.          \n" +
  "        /   _   _   \\        \n" +
  "       |   (O) (O)   |       \n" +
  "       |    '---'    |       \n" +
  "       |   \\     /   |       \n" +
  "        \\   '---'   /        \n" +
  "         '-------'           \n" +
  "       DWIGHT SCHRUTE        \n" +
  "   BEARS. BEETS. BATTLESTAR. ",
  "color: #3b82f6; font-size: 20px; font-weight: bold; text-shadow: 1px 1px 0px rgba(0,0,0,0.1);",
  "color: #4b5563; font-family: monospace; font-weight: bold;"
);

// Export for fast refresh support
export function AppWrapper() {
  // Em localhost, não usar ErrorBoundary do Sentry
  if (isLocalhost()) {
    return <App />;
  }
  
  return (
    <Sentry.ErrorBoundary fallback={<div>Algo deu errado. Por favor, recarregue a página.</div>} showDialog>
      <App />
    </Sentry.ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>,
)

