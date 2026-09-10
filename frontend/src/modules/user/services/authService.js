import api from '../../../shared/api/axiosInstance';

const decodeBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padding);
};

const getTokenPayload = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const payload = token.split('.')[1];

    if (!payload) {
      return null;
    }

    return JSON.parse(atob(decodeBase64Url(payload)));
  } catch {
    return null;
  }
};

const readLocalUserToken = () =>
  [
    localStorage.getItem('userToken'),
    localStorage.getItem('token'),
  ].filter(Boolean).find((token) => getTokenPayload(token)?.role === 'user') || '';

export const getLocalUserToken = readLocalUserToken;

export const clearLocalUserSession = () => {
  const token = readLocalUserToken();
  const fallbackToken = localStorage.getItem('token');

  localStorage.removeItem('userToken');
  localStorage.removeItem('userInfo');

  if (token && fallbackToken === token) {
    localStorage.removeItem('token');
  }

  if (String(localStorage.getItem('role') || '').toLowerCase() === 'user') {
    localStorage.removeItem('role');
  }

  if (String(localStorage.getItem('chatRole') || '').toLowerCase() === 'user') {
    localStorage.removeItem('chatRole');
  }
};

export const withUserAuth = (config = {}) => {
  const token = readLocalUserToken();

  if (!token) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

export const userAuthService = {
  signup: (payload) => api.post('/users/signup', payload),
  login: (payload) => api.post('/users/login', payload),
  startOtp: (phone) => api.post('/users/auth/send-otp', { phone }),
  verifyOtp: (phone, otp) => api.post('/users/auth/verify-otp', { phone, otp }),
  verifyOtpLogin: (phone) => api.post('/users/otp-login', { phone }),
  uploadProfileImage: (dataUrl, phone, purpose = 'profile') =>
    api.post('/users/profile-image', { dataUrl, phone, purpose }),
  updateCurrentUser: (payload) => api.patch('/users/me', payload, withUserAuth()),
  getCurrentUser: () => api.get('/users/me', withUserAuth()),
  getSubscriptionPlans: () => api.get('/users/subscriptions/plans', withUserAuth()),
  getMySubscriptions: () => api.get('/users/subscriptions/me', withUserAuth()),
  buySubscription: (planId) => api.post('/users/subscriptions/purchase', { planId }, withUserAuth()),
  getWallet: () => api.get('/users/wallet', withUserAuth()),
  getReferralRedemptions: () => api.get('/users/wallet/referral-redemptions', withUserAuth()),
  requestReferralRedemption: (amount) =>
    api.post('/users/wallet/referral-redemptions', { amount }, withUserAuth()),
  topupWallet: (amount) => api.post('/users/wallet/topup', { amount }, withUserAuth()),
  transferWallet: (phone, amount) => api.post('/users/wallet/transfer', { phone, amount }, withUserAuth()),
  transferWalletToDriver: (phone, amount) => api.post('/users/wallet/transfer/driver', { phone, amount }, withUserAuth()),
  createWalletTopupOrder: (amount) => api.post('/users/wallet/razorpay/order', { amount }, withUserAuth()),
  verifyWalletTopup: (payload) => api.post('/users/wallet/razorpay/verify', payload, withUserAuth()),
  createPhonePeWalletTopupOrder: (amount) => api.post('/users/wallet/phonepe/order', { amount }, withUserAuth()),
  verifyPhonePeWalletTopup: (merchantTransactionId) =>
    api.get(`/users/wallet/phonepe/status/${merchantTransactionId}`, withUserAuth()),
  requestAccountDeletion: (reason) => api.post('/users/me/delete-request', { reason }),
  getNotifications: () => api.get('/users/notifications', withUserAuth()),
  deleteNotification: (id) => api.delete(`/users/notifications/${id}`, withUserAuth()),
  clearAllNotifications: () => api.delete('/users/notifications', withUserAuth()),
  saveFcmToken: (token, platform) => api.post('/users/fcm-token', { token, platform }, withUserAuth()),
  getRideBids: (rideId) => api.get(`/rides/${rideId}/bids`, withUserAuth()),
  acceptRideBid: (rideId, bidId) => api.post(`/rides/${rideId}/bids/${bidId}/accept`, {}, withUserAuth()),
  increaseRideBidCeiling: (rideId, incrementSteps = 1) =>
    api.patch(`/rides/${rideId}/bids/ceiling`, { incrementSteps }, withUserAuth()),
};
