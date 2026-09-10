import { getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { getLocalDriverToken, saveDriverFcmToken } from '../../modules/driver/services/registrationService';
import { getLocalUserToken, userAuthService } from '../../modules/user/services/authService';

const LAST_BROWSER_FCM_KEY = 'lastBrowserFcmRegistration';
const FIREBASE_CONFIG = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};
const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();

let messagingSupportPromise = null;

const getActiveAppScope = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const pathname = String(window.location.pathname || '').toLowerCase();

  if (pathname.startsWith('/taxi/driver') || pathname.startsWith('/taxi/owner')) {
    return 'driver';
  }

  if (pathname.startsWith('/taxi/user') || pathname === '/user') {
    return 'user';
  }

  return '';
};

const isDriverPendingApprovalScreen = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const pathname = String(window.location.pathname || '').toLowerCase();
  return pathname === '/taxi/driver/registration-status' || pathname === '/taxi/driver/status';
};

const hasFirebaseConfig = () =>
  Object.values(FIREBASE_CONFIG).every((value) => String(value || '').trim());

const hasBrowserSupport = () =>
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof Notification !== 'undefined';

const getStoredRegistration = () => {
  try {
    return JSON.parse(localStorage.getItem(LAST_BROWSER_FCM_KEY) || 'null');
  } catch {
    return null;
  }
};

const persistRegistration = (payload) => {
  localStorage.setItem(LAST_BROWSER_FCM_KEY, JSON.stringify({
    ...payload,
    updatedAt: new Date().toISOString(),
  }));
};

const getFirebaseApp = () => {
  if (!hasFirebaseConfig()) {
    return null;
  }

  return getApps()[0] || initializeApp(FIREBASE_CONFIG);
};

const getMessagingSupport = async () => {
  if (!messagingSupportPromise) {
    messagingSupportPromise = isSupported().catch(() => false);
  }

  return messagingSupportPromise;
};

const getAuthenticatedRoles = () => {
  const activeScope = getActiveAppScope();
  const roles = [];

  if ((!activeScope || activeScope === 'user') && getLocalUserToken()) {
    roles.push('user');
  }

  if ((!activeScope || activeScope === 'driver') && getLocalDriverToken() && !isDriverPendingApprovalScreen()) {
    roles.push('driver');
  }

  return roles;
};

const createServiceWorkerUrl = () => {
  const params = new URLSearchParams({
    apiKey: FIREBASE_CONFIG.apiKey,
    authDomain: FIREBASE_CONFIG.authDomain,
    projectId: FIREBASE_CONFIG.projectId,
    storageBucket: FIREBASE_CONFIG.storageBucket,
    messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
    appId: FIREBASE_CONFIG.appId,
  });

  return `/firebase-messaging-sw.js?${params.toString()}`;
};

const saveTokenForRole = async (role, token) => {
  if (role === 'driver') {
    await saveDriverFcmToken(token, 'web');
    return;
  }

  await userAuthService.saveFcmToken(token, 'web');
};

const shouldSkipRegistration = (role, token) => {
  const stored = getStoredRegistration();
  return stored?.role === role && stored?.token === token;
};

const registerBrowserFcmToken = async ({ interactive = false } = {}) => {
  console.log(`[FCM-DEBUG] Starting registerBrowserFcmToken (interactive=${interactive})...`);

  if (!hasBrowserSupport()) {
    console.warn('[FCM-DEBUG] Browser does not support serviceWorker or Notification API');
    return { ok: false, reason: 'browser-unsupported' };
  }

  if (!hasFirebaseConfig() || !VAPID_KEY) {
    console.warn('[FCM-DEBUG] Firebase config or VAPID key is missing in .env');
    return { ok: false, reason: 'firebase-web-config-missing' };
  }

  const roles = getAuthenticatedRoles();
  console.log('[FCM-DEBUG] Authenticated roles detected:', roles);
  if (roles.length === 0) {
    console.warn('[FCM-DEBUG] No authenticated driver or user token found in localStorage');
    return { ok: false, reason: 'missing-auth' };
  }

  const supported = await getMessagingSupport();
  if (!supported) {
    console.warn('[FCM-DEBUG] Firebase Messaging is unsupported in this browser environment');
    return { ok: false, reason: 'messaging-unsupported' };
  }

  console.log('[FCM-DEBUG] Notification permission status:', Notification.permission);
  if (Notification.permission === 'denied') {
    console.warn('[FCM-DEBUG] Notification permission is DENIED by user in browser settings');
    return { ok: false, reason: 'permission-denied' };
  }

  if (Notification.permission !== 'granted') {
    if (!interactive) {
      console.info('[FCM-DEBUG] Notification permission not granted yet (passive check). Call with { interactive: true } to prompt user.');
      return { ok: false, reason: 'permission-not-granted' };
    }

    console.log('[FCM-DEBUG] Requesting browser notification permission...');
    const permission = await Notification.requestPermission();
    console.log('[FCM-DEBUG] Notification permission response:', permission);
    if (permission !== 'granted') {
      return { ok: false, reason: 'permission-not-granted' };
    }
  }

  const app = getFirebaseApp();
  if (!app) {
    console.warn('[FCM-DEBUG] Firebase App initialization failed');
    return { ok: false, reason: 'firebase-app-missing' };
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.register(createServiceWorkerUrl());
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration,
  });

  console.log("FCM Token:", token);
  if (roles.includes('driver')) {
    console.log("🔑 [DRIVER FCM TOKEN (Browser)]:", token);
  }

  if (!token) {
    return { ok: false, reason: 'missing-token' };
  }

  const rolesToSave = roles.filter((role) => !shouldSkipRegistration(role, token));
  await Promise.all(rolesToSave.map((role) => saveTokenForRole(role, token)));

  roles.forEach((role) => {
    persistRegistration({ role, token, platform: 'web' });
  });

  return {
    ok: true,
    token,
    roles,
    skippedRoles: roles.filter((role) => !rolesToSave.includes(role)),
  };
};

export const installBrowserFcmRegistration = () => {
  window.__registerBrowserFcmToken = (options) => registerBrowserFcmToken(options);
  window.getDriverFcmToken = () => registerBrowserFcmToken({ interactive: true });

  const retryPassiveRegistration = () => {
    registerBrowserFcmToken({ interactive: false }).catch(() => {});
  };

  window.addEventListener('focus', retryPassiveRegistration);
  window.addEventListener('pageshow', retryPassiveRegistration);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      retryPassiveRegistration();
    }
  });

  window.setTimeout(retryPassiveRegistration, 2000);
};
