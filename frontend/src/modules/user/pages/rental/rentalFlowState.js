const toSerializableValue = (value, fallback = null) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
};

const normalizeCoordinates = (value) => {
  if (!value || typeof value !== 'object') return null;

  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

const normalizeSelectedPackage = (value) => {
  if (!value || typeof value !== 'object') return null;

  return {
    id: value.id || value._id || '',
    label: value.label || '',
    durationHours: Number(value.durationHours || 0),
    price: Number(value.price || 0),
    includedKm: Number(value.includedKm || 0),
    extraHourPrice: Number(value.extraHourPrice || 0),
    extraKmPrice: Number(value.extraKmPrice || 0),
  };
};

const normalizeServiceLocation = (value) => {
  if (!value || typeof value !== 'object') return null;

  return {
    id: value.id || value._id || '',
    name: value.name || '',
    pickupLabel: value.pickupLabel || '',
    address: value.address || '',
    city: value.city || value.country || '',
    latitude: Number(value.latitude || 0),
    longitude: Number(value.longitude || 0),
    distanceKm: Number.isFinite(Number(value.distanceKm)) ? Number(value.distanceKm) : null,
    distanceLabel: value.distanceLabel || '',
    storeCount: Number(value.storeCount || 0),
    primaryPoint: normalizeCoordinates(value.primaryPoint),
    pickupPoints: Array.isArray(value.pickupPoints)
      ? value.pickupPoints
          .map((point) => {
            if (!point || typeof point !== 'object') return null;

            return {
              id: point.id || '',
              name: point.name || '',
              address: point.address || '',
              position: normalizeCoordinates(point.position),
            };
          })
          .filter((point) => point?.position)
      : [],
  };
};

export const buildRentalRouteState = (state = {}) =>
  toSerializableValue(
    {
      ...state,
      vehicle: toSerializableValue(state.vehicle, null),
      selectedPackage: normalizeSelectedPackage(state.selectedPackage),
      serviceLocation: normalizeServiceLocation(state.serviceLocation),
      userCoordinates: normalizeCoordinates(state.userCoordinates),
      rentalKyc: state.rentalKyc
        ? {
            completedAt: state.rentalKyc.completedAt || '',
            documents: toSerializableValue(state.rentalKyc.documents, null),
          }
        : null,
      payment: toSerializableValue(state.payment, null),
      bookingRequest: toSerializableValue(state.bookingRequest, null),
    },
    {},
  );

export { toSerializableValue };
