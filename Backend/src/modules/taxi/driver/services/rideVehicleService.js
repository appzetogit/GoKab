import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { FleetVehicle } from '../../admin/models/FleetVehicle.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { Ride } from '../../user/models/Ride.js';

/**
 * Which vehicle a driver-created ride runs with.
 *
 * The owner picks it when assigning: the driver's own (`driver_default`), one
 * of the organisation's fleet vehicles (`fleet`), or a typed-in one
 * (`custom`). It is stored on the ride (`assignment.vehicle`) as a copy, so
 * the driver's profile is never changed and the ride still shows the right
 * vehicle after the fleet vehicle is edited or deleted.
 */

const VEHICLE_SOURCES = new Set(['driver_default', 'fleet', 'custom']);

// Indian plates: state code, RTO number, series letters, 4-digit number
// (MP09AB1234, DL1CAB1234, MH12A1234), plus the Bharat series (22BH1234AB).
const PLATE_PATTERNS = [/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/, /^\d{2}BH\d{4}[A-Z]{1,2}$/];

/** Spaces, dashes and dots stripped, upper-cased: "mp09 xy-9999" → "MP09XY9999". */
export const normalizePlate = (value) => String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const describeModel = (make, model) => [cleanText(make, 40), cleanText(model, 40)].filter(Boolean).join(' ');

/** The vehicle a driver uses unless told otherwise. */
export const driverDefaultVehicle = (driver) => ({
  source: 'driver_default',
  fleet_vehicle_id: driver?.assignedFleetVehicleId || null,
  number: normalizePlate(driver?.vehicleNumber),
  model: describeModel(driver?.vehicleMake, driver?.vehicleModel),
  type: cleanText(driver?.vehicleType, 30),
  color: cleanText(driver?.vehicleColor, 30),
});

export const EMPTY_RIDE_VEHICLE = Object.freeze({
  source: null,
  fleet_vehicle_id: null,
  number: '',
  model: '',
  type: '',
  color: '',
});

/** The `$set` that stores (or, with null, clears) a ride's vehicle. */
export const rideVehicleSetFields = (vehicle) => ({
  'assignment.vehicle': vehicle ? { ...EMPTY_RIDE_VEHICLE, ...vehicle } : { ...EMPTY_RIDE_VEHICLE },
});

/**
 * The vehicle to show for a ride: the per-ride copy when one was chosen,
 * otherwise the driver's current vehicle. `driver` may be null (unassigned).
 */
export const resolveRideVehicle = (ride, driver = null) => {
  const chosen = ride?.assignment?.vehicle;
  if (chosen?.number) {
    return {
      source: chosen.source || 'custom',
      fleet_vehicle_id: chosen.fleet_vehicle_id ? String(chosen.fleet_vehicle_id) : null,
      number: chosen.number,
      model: chosen.model || '',
      type: chosen.type || '',
      color: chosen.color || '',
    };
  }
  if (!driver) return null;
  const fallback = driverDefaultVehicle(driver);
  return fallback.number || fallback.model
    ? { ...fallback, fleet_vehicle_id: fallback.fleet_vehicle_id ? String(fallback.fleet_vehicle_id) : null }
    : null;
};

/**
 * Overlays the ride's vehicle onto a populated driver object, for payloads
 * that show the driver card (`vehicleNumber`, `vehicleMake`, `vehicleModel`).
 * Returns the driver unchanged when the ride has no vehicle of its own.
 */
export const withRideVehicle = (ride, driver) => {
  const chosen = ride?.assignment?.vehicle;
  // Only a populated driver can carry the overlay; a bare id stays as it is.
  if (!driver || !chosen?.number || driver instanceof mongoose.Types.ObjectId || driver._bsontype) return driver;
  const plain = typeof driver.toObject === 'function' ? driver.toObject() : { ...driver };
  return {
    ...plain,
    vehicleNumber: chosen.number,
    vehicleMake: chosen.model || plain.vehicleMake || '',
    vehicleModel: chosen.model ? '' : plain.vehicleModel || '',
    vehicleColor: chosen.color || plain.vehicleColor || '',
  };
};

/** Pulls the vehicle choice out of a request body, new shape or legacy flat keys. */
const readVehicleInput = (body = {}) => {
  if (body.vehicle && typeof body.vehicle === 'object') return body.vehicle;

  const flatNumber = body.vehicleNumber ?? body.vehicle_number;
  if (flatNumber !== undefined && flatNumber !== null && String(flatNumber).trim() !== '') {
    return {
      source: 'custom',
      number: flatNumber,
      model: body.vehicleModel ?? body.vehicle_model ?? '',
      type: body.vehicleType ?? body.vehicle_type ?? '',
      legacyFlat: true,
    };
  }
  return null;
};

const typeIdOf = async ({ source, assignee, fleetVehicle }) => {
  if (source === 'fleet') return fleetVehicle?.vehicle_type_id ? String(fleetVehicle.vehicle_type_id) : '';
  if (source === 'driver_default') return assignee?.vehicleTypeId ? String(assignee.vehicleTypeId) : '';
  return '';
};

/**
 * Validates the owner's vehicle choice for assigning `ride` to `assignee`.
 *
 * - nothing sent → the assignee's own vehicle, no error (old app builds);
 * - `driver_default` → the assignee must have a vehicle on their profile;
 * - `fleet` → an active, approved vehicle of the creator's own organisation
 *   (only drivers who run a fleet have one);
 * - `custom` → a valid Indian plate, optional model/type.
 *
 * Returns `{ vehicle, warnings }`. Warnings (`TYPE_MISMATCH`, `VEHICLE_BUSY`)
 * never block: the owner decides.
 */
export const resolveVehicleSelection = async ({ body = {}, creatorPermissions, assignee, ride, excludeRideId = null }) => {
  const input = readVehicleInput(body);
  const warnings = [];

  if (!input) {
    return { vehicle: driverDefaultVehicle(assignee), warnings };
  }

  const source = String(input.source || '').trim().toLowerCase();
  if (!VEHICLE_SOURCES.has(source)) {
    throw new ApiError(
      422,
      "vehicle.source must be 'driver_default', 'fleet' or 'custom'",
      { options: [...VEHICLE_SOURCES] },
      'INVALID_VEHICLE_SOURCE',
    );
  }

  let vehicle;
  let fleetVehicle = null;

  if (source === 'driver_default') {
    vehicle = driverDefaultVehicle(assignee);
    if (!vehicle.number) {
      throw new ApiError(422, 'This driver has no vehicle on their profile', null, 'DRIVER_HAS_NO_VEHICLE');
    }
  } else if (source === 'fleet') {
    const fleetVehicleId = input.fleet_vehicle_id ?? input.fleetVehicleId;
    const ownerId = creatorPermissions?.driver?.owner_id;
    if (!creatorPermissions?.can_manage_fleet || !ownerId || !mongoose.isValidObjectId(fleetVehicleId)) {
      throw new ApiError(422, 'Choose one of your own fleet vehicles', null, 'INVALID_FLEET_VEHICLE');
    }
    fleetVehicle = await FleetVehicle.findOne({ _id: fleetVehicleId, owner_id: ownerId, active: true }).lean();
    if (!fleetVehicle) {
      throw new ApiError(422, 'Choose one of your own fleet vehicles', null, 'INVALID_FLEET_VEHICLE');
    }
    if (fleetVehicle.status !== 'approved') {
      throw new ApiError(
        422,
        'This vehicle is not approved yet',
        { status: fleetVehicle.status },
        'VEHICLE_NOT_APPROVED',
      );
    }
    const catalogueType = fleetVehicle.vehicle_type_id
      ? await Vehicle.findById(fleetVehicle.vehicle_type_id).select('name').lean()
      : null;
    vehicle = {
      source: 'fleet',
      fleet_vehicle_id: fleetVehicle._id,
      number: normalizePlate(fleetVehicle.license_plate_number),
      model: describeModel(fleetVehicle.car_brand, fleetVehicle.car_model),
      type: cleanText(input.type || catalogueType?.name || '', 30),
      color: cleanText(fleetVehicle.car_color, 30),
    };
  } else {
    const number = normalizePlate(input.number);
    if (!PLATE_PATTERNS.some((pattern) => pattern.test(number))) {
      throw new ApiError(422, 'Enter a valid vehicle number, e.g. MP09AB1234', null, 'INVALID_VEHICLE_NUMBER');
    }
    // The legacy flat keys repeat the assignee's registered number when the
    // app just echoes the profile: that is their own vehicle, not a custom one.
    if (input.legacyFlat && assignee && number === normalizePlate(assignee.vehicleNumber)) {
      return { vehicle: driverDefaultVehicle(assignee), warnings };
    }
    const model = String(input.model ?? '').trim();
    const type = String(input.type ?? '').trim();
    if (model.length > 60 || type.length > 30) {
      throw new ApiError(
        422,
        'Vehicle model must be at most 60 characters and type at most 30',
        null,
        'INVALID_VEHICLE_DETAILS',
      );
    }
    vehicle = {
      source: 'custom',
      fleet_vehicle_id: null,
      number,
      model: cleanText(model, 60),
      type: cleanText(type, 30),
      color: cleanText(input.color, 30),
    };
  }

  const vehicleTypeId = await typeIdOf({ source, assignee, fleetVehicle });
  if (vehicleTypeId && ride?.vehicleTypeId && vehicleTypeId !== String(ride.vehicleTypeId)) {
    warnings.push('TYPE_MISMATCH');
  }

  if (vehicle.number) {
    const busy = await Ride.exists({
      ...(excludeRideId ? { _id: { $ne: excludeRideId } } : {}),
      'assignment.vehicle.number': vehicle.number,
      status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    });
    if (busy) warnings.push('VEHICLE_BUSY');
  }

  return { vehicle, warnings };
};
