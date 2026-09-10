// Spoof User Agent for WebView containers to prevent payment gateways (PhonePe/Razorpay)
// from hiding UPI intent options.
try {
  const ua = navigator.userAgent;
  if (/; wv\)/i.test(ua) || /Version\/[\d.]+/i.test(ua)) {
    window.__isRedigoWebView = true;
    const spoofedUa = ua
      .replace(/; wv\)/g, '')
      .replace(/Version\/[\d.]+\s*/g, '');
    
    Object.defineProperty(navigator, 'userAgent', {
      get: function () {
        return spoofedUa;
      },
      configurable: true,
    });
    
    Object.defineProperty(navigator, 'appVersion', {
      get: function () {
        return spoofedUa;
      },
      configurable: true,
    });

    console.info('[UA Spoofing] Successfully removed WebView identifiers to enable UPI apps.');
  }
} catch (e) {
  console.error('[UA Spoofing] Failed to override userAgent property:', e);
}

import { createRoot } from 'react-dom/client'
import './index.css'
import { installLegacyBackendShim } from './shared/api/legacyBackendShim'
import { installBrowserFcmRegistration } from './shared/push/browserFcmRegistration'
import { installNativeFcmBridge } from './shared/push/nativeFcmBridge'
import { installHistoryStateProtection } from './shared/utils/historyState'
import App from './App.jsx'

installLegacyBackendShim()
installBrowserFcmRegistration()
installNativeFcmBridge()
installHistoryStateProtection()

createRoot(document.getElementById('root')).render(
  <App />,
)

