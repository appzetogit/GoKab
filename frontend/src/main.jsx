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
import { API_BASE_URL } from './shared/api/runtimeConfig'

installLegacyBackendShim()
installBrowserFcmRegistration()
installNativeFcmBridge()
installHistoryStateProtection()

// The Google Maps key set by the admin (Admin > Map settings) wins over the
// build-time VITE key. It has to be known before the pages load, since they
// read it when they are first imported.
async function boot() {
  try {
    const res = await fetch(`${API_BASE_URL}/common/app-config`)
    window.__GOOGLE_MAPS_KEY__ = (await res.json())?.data?.google_maps_key || ''
  } catch {
    // offline or older backend: fall back to the VITE key
  }
  const { default: App } = await import('./App.jsx')
  createRoot(document.getElementById('root')).render(<App />)
}
boot()

