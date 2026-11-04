import api from '../../../shared/api/axiosInstance';

export const userService = {
  getAppModules: async () => {
    const response = await api.get('/users/app-modules');
    return response;
  },
  getIntercityPackages: async () => {
    const response = await api.get('/users/intercity-packages');
    return response;
  },
  getServiceLocations: async () => {
    const response = await api.get('/users/service-locations');
    return response;
  },
  getAvailablePromos: async (params) => {
    const response = await api.get('/promos/available', { params });
    return response;
  },
  validatePromo: async (payload) => {
    const response = await api.post('/promos/validate', payload);
    return response;
  },
  searchPoolingRoutes: async (params) => {
    const response = await api.get('/users/pooling/search', { params });
    return response;
  },
  getPoolingRouteDetails: async (id, params) => {
    const response = await api.get(`/users/pooling/routes/${id}`, { params });
    return response;
  },
  createPoolingBookingOrder: async (payload) => {
    const response = await api.post('/users/pooling/bookings/order', payload);
    return response;
  },
  verifyPoolingBookingPayment: async (payload) => {
    const response = await api.post('/users/pooling/bookings/verify', payload);
    return response;
  },
  createPoolingBooking: async (payload) => {
    const response = await api.post('/users/pooling/bookings', payload);
    return response;
  },
  getMyPoolingBookings: async () => {
    const response = await api.get('/users/pooling/bookings');
    return response;
  },
};
