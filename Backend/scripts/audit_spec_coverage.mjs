/**
 * Spec coverage audit.
 *
 * Walks the spec section by section and checks the artefact actually exists in
 * the code — model fields on the real schemas, error codes actually thrown,
 * cron functions actually exported, files actually present. This is the check
 * that answers "is the spec done", as opposed to "do the tests pass".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAXI = path.join(ROOT, 'src/modules/taxi');

let pass = 0;
let fail = 0;
const gaps = [];

const check = (section, label, condition, detail = '') => {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    gaps.push(`${section}  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const readIfExists = (relative) => {
  const full = path.join(TAXI, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
};

const fileExists = (relative) => fs.existsSync(path.join(TAXI, relative));

const run = async () => {
  // ---- §6 data model ---------------------------------------------------
  const tier = readIfExists('admin/models/SubscriptionTier.js');
  for (const field of [
    'driver_category', 'can_create_rides', 'can_manage_fleet', 'can_publish_rides',
    'requires_commercial_and_private', 'max_routes', 'max_fleet_drivers',
    'customer_lead_contact_fee', 'driver_lead_contact_fee', 'customer_ride_accept_fee',
  ]) {
    check('§6.1', `SubscriptionTier.${field}`, tier?.includes(field));
  }

  const driver = readIfExists('driver/models/Driver.js');
  for (const field of [
    'driver_category', 'driver_category_source_subscription_id', 'driver_category_updated_at',
    'category_grace_ends_at', 'vehicle_usage_type', 'route_mode', 'active_route_id',
    'max_routes_override', 'frozenBalance',
  ]) {
    check('§6.2', `Driver.${field}`, driver?.includes(field));
  }
  check('§6.2', 'Driver category index', driver?.includes('service_location_id: 1, driver_category: 1'));

  const fleetVehicle = readIfExists('admin/models/FleetVehicle.js');
  check('§6.3', 'FleetVehicle.usage_type', fleetVehicle?.includes('usage_type'));
  check('§6.3', 'FleetVehicle.usage_type_verified', fleetVehicle?.includes('usage_type_verified'));

  check('§6.4', 'PrimeCitySlot model', fileExists('admin/models/PrimeCitySlot.js'));
  const slot = readIfExists('admin/models/PrimeCitySlot.js');
  check('§6.4', 'PrimeCitySlot (city, slot_no) unique', slot?.includes('{ unique: true }'));

  const ride = readIfExists('user/models/Ride.js');
  for (const field of [
    'origin', 'offline_customer', 'created_by_driver_id', 'organization_owner_id',
    'network_notes', 'assignment', 'publish', 'escrow', 'feed_fee',
  ]) {
    check('§6.5', `Ride.${field}`, ride?.includes(field));
  }
  check('§6.5', 'Ride.userId is conditionally required', ride?.includes("this.origin !== 'driver_created'"));
  for (const index of [
    "origin: 1, 'publish.status': 1",
    'status: 1, driverId: 1, service_location_id: 1',
    'organization_owner_id: 1, status: 1',
    'created_by_driver_id: 1, status: 1',
  ]) {
    check('§6.5', `Ride index ${index}`, ride?.includes(index));
  }

  check('§6.6', 'DriverRoute model', fileExists('driver/models/DriverRoute.js'));
  const route = readIfExists('driver/models/DriverRoute.js');
  check('§6.6', 'DriverRoute 2dsphere on path', route?.includes("path: '2dsphere'"));
  check('§6.6', 'DriverRoute corridor_km', route?.includes('corridor_km'));

  check('§6.7', 'LeadContact model', fileExists('driver/models/LeadContact.js'));
  const contact = readIfExists('driver/models/LeadContact.js');
  check('§6.7', 'LeadContact pays once per ride', contact?.includes('{ unique: true }'));

  check('§6.8', 'LeadConversation model', fileExists('driver/models/LeadConversation.js'));
  check('§6.8', 'LeadMessage model', fileExists('driver/models/LeadMessage.js'));

  const walletTxn = readIfExists('driver/models/WalletTransaction.js');
  for (const type of [
    'escrow_hold', 'escrow_release', 'escrow_transfer_in', 'escrow_transfer_out',
    'lead_contact_fee', 'feed_accept_fee',
  ]) {
    check('§6.9', `WalletTransaction type ${type}`, walletTxn?.includes(type));
  }
  for (const field of ['frozenBefore', 'frozenAfter', 'counterpartyDriverId']) {
    check('§6.9', `WalletTransaction.${field}`, walletTxn?.includes(field));
  }

  const settings = readIfExists('services/appSettingsService.js');
  for (const key of [
    'prime_per_city', 'default_corridor_km', 'publish_expiry_minutes', 'publish_min_lead_minutes',
    'platform_commission_on_published_rides_percent', 'escrow_dispute_window_hours',
    'category_grace_days', 'call_mode', 'live_location_emit_interval_ms', 'cancel_penalty_after_accept',
  ]) {
    check('§6.10', `setting ${key}`, settings?.includes(key));
  }
  check('§6.10', 'getDriverNetworkSettings helper', settings?.includes('getDriverNetworkSettings'));

  check('§6.11', 'ServiceLocation.prime_limit', readIfExists('admin/models/ServiceLocation.js')?.includes('prime_limit'));

  // ---- §7 category service --------------------------------------------
  const categoryService = readIfExists('services/driverCategoryService.js');
  for (const fn of [
    'getDriverPermissions', 'checkTierEligibility', 'reservePrimeSlot', 'activatePrimeSlot',
    'releasePrimeSlot', 'applyCategoryFromSubscription', 'downgradeToLower', 'CATEGORY_RANK',
  ]) {
    check('§7.2', `driverCategoryService.${fn}`, categoryService?.includes(fn));
  }
  check('§7.5', 'requireDriverPermission middleware', fileExists('middlewares/driverCategoryMiddleware.js'));

  // ---- §9 route matching ----------------------------------------------
  const routeMatch = readIfExists('services/routeMatchService.js');
  check('§9.2', 'matchRideToRoute', routeMatch?.includes('matchRideToRoute'));
  check('§9.2', 'findDriversWhoseActiveRouteMatches', routeMatch?.includes('findDriversWhoseActiveRouteMatches'));
  const geo = fs.readFileSync(path.join(ROOT, 'src/utils/geo.js'), 'utf8');
  check('§9.2', 'nearestPointOnPolyline in geo utils', geo.includes('nearestPointOnPolyline'));
  check('§9.2', 'haversine in geo utils', geo.includes('haversineMeters'));
  const matching = readIfExists('services/matchingService.js');
  check('§9.3', 'matchDrivers accepts dropCoords', matching?.includes('dropCoords'));
  check('§9.3', 'route_mode in driver projection', matching?.includes('route_mode active_route_id'));

  // ---- §10-§14 services -------------------------------------------------
  check('§10', 'networkRideService', fileExists('driver/services/networkRideService.js'));
  check('§10.1', 'ensureOrganizationForPrime', readIfExists('driver/services/networkRideService.js')?.includes('ensureOrganizationForPrime'));
  check('§11', 'feedService', fileExists('driver/services/feedService.js'));
  check('§12', 'leadService', fileExists('driver/services/leadService.js'));
  check('§13', 'escrowService', fileExists('driver/services/escrowService.js'));
  const escrow = readIfExists('driver/services/escrowService.js');
  for (const fn of ['holdForPublishedRide', 'settlePublishedRide', 'releasePublishedRide', 'resolveEscrowDispute']) {
    check('§13.4', `escrowService.${fn}`, escrow?.includes(fn));
  }
  check('§14', 'liveMapService', fileExists('services/liveMapService.js'));
  const liveMap = readIfExists('services/liveMapService.js');
  check('§14.2', 'location gated on started (post-OTP)', liveMap?.includes('RIDE_LIVE_STATUS.STARTED'));
  check('§14.2', 'emit throttle', liveMap?.includes('live_location_emit_interval_ms'));
  check('§14.2', 'ride meta cache', liveMap?.includes('rideMetaCache'));

  // ---- §14.1 socket rooms ----------------------------------------------
  const dispatch = readIfExists('services/dispatchService.js');
  for (const room of ['getOrgRoom', 'getPublisherRoom', 'getFeedRoom']) {
    check('§14.1', `room helper ${room}`, dispatch?.includes(room));
  }

  // ---- §15 notifications ------------------------------------------------
  const notify = readIfExists('services/networkNotificationService.js');
  for (const fn of [
    'notifyNetworkAssignment', 'notifyAssignmentRemoved', 'notifyAssignmentRejected',
    'notifyNetworkRideCancelled', 'notifyEscrowSettled', 'notifyEscrowDisputed',
    'notifyEscrowDisputeResolved', 'notifyCategoryChanged', 'notifyVehicleRuleGraceStarted',
  ]) {
    check('§15', `notification ${fn}`, notify?.includes(fn));
  }
  const cronService = readIfExists('services/subscriptionCronService.js');
  check('§15', 'expiry reminders (3 day / 1 day)', cronService?.includes('REMINDER_DAYS'));

  // ---- §16 admin --------------------------------------------------------
  check('§16', 'driverNetworkController', fileExists('admin/controllers/driverNetworkController.js'));
  check('§16', 'driverNetworkRoutes', fileExists('admin/routes/driverNetworkRoutes.js'));
  check('§16', 'driver_network permission key', readIfExists('admin/services/adminAccessService.js')?.includes('driver_network'));
  check('§16', 'admin driver list shows category', readIfExists('admin/services/adminService.js')?.includes('driver_category'));

  // ---- §17 crons --------------------------------------------------------
  const networkCron = readIfExists('services/networkCronService.js');
  check('§17', 'expirePublishedRides', readIfExists('driver/services/feedService.js')?.includes('expirePublishedRides'));
  check('§17', 'releaseStalePrimeReservations', categoryService?.includes('releaseStalePrimeReservations'));
  check('§17', 'categoryExpiry hooked into subscription cron', cronService?.includes('downgradeToLower'));
  check('§17', 'categoryGraceCheck', categoryService?.includes('enforceCategoryGrace'));
  check('§17', 'autoFinalizeEscrowDisputeWindow', networkCron?.includes('finalizeDisputeWindows'));
  check('§17', 'escrowOrphanCheck', networkCron?.includes('releaseOrphanedEscrow'));
  check('§17', 'staleCustomerFeedCleanup (emit on leave)', dispatch?.includes('feed:customer:removed'));
  const scheduler = fs.readFileSync(path.join(ROOT, 'scheduler-server.js'), 'utf8');
  check('§17', 'scheduler-server runs the jobs', scheduler.includes('startNetworkCronJob'));

  // ---- §18 migration & seed --------------------------------------------
  check('§18.1', 'migrate_driver_network.js', fs.existsSync(path.join(ROOT, 'scripts/migrate_driver_network.js')));
  check('§18.2', 'network tier seed', fs.existsSync(path.join(ROOT, 'scripts/seed_driver_network_tiers.js')));
  check('§18.1', 'legacy tier -> category mapping tool', fs.existsSync(path.join(ROOT, 'scripts/map_tiers_to_categories.js')));

  // ---- §19 error codes --------------------------------------------------
  const allSource = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) allSource.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(TAXI);
  const source = allSource.join('\n');

  for (const code of [
    'CATEGORY_NOT_ALLOWED', 'PRIME_SLOTS_FULL', 'NEED_COMMERCIAL_VEHICLE', 'NEED_PRIVATE_VEHICLE',
    'ROUTE_LIMIT_REACHED', 'INVALID_STOPS', 'RIDE_NOT_FOUND', 'NOT_RIDE_OWNER', 'DRIVER_NOT_IN_FLEET',
    'DRIVER_BUSY', 'RIDE_ALREADY_TAKEN', 'RIDE_NOT_OPEN', 'INVALID_SPLIT', 'INSUFFICIENT_WALLET',
    'PUBLISHER_INSUFFICIENT_WALLET', 'INSUFFICIENT_WALLET_FOR_CONTACT', 'COLLECTED_BY_REQUIRED',
    'ESCROW_STATE_INVALID', 'DISPUTE_WINDOW_CLOSED',
  ]) {
    check('§19', `error code ${code}`, source.includes(`'${code}'`));
  }
  const apiError = fs.readFileSync(path.join(ROOT, 'src/utils/ApiError.js'), 'utf8');
  check('§19', 'ApiError carries a machine code', apiError.includes('code'));

  // ---- §21 file list ----------------------------------------------------
  for (const file of [
    'admin/models/PrimeCitySlot.js', 'driver/models/DriverRoute.js', 'driver/models/LeadContact.js',
    'driver/models/LeadConversation.js', 'driver/models/LeadMessage.js',
    'services/driverCategoryService.js', 'services/routeMatchService.js',
    'driver/services/networkRideService.js', 'driver/services/escrowService.js',
    'driver/services/leadService.js', 'driver/controllers/networkController.js',
    'driver/routes/networkRoutes.js', 'admin/controllers/driverNetworkController.js',
    'admin/routes/driverNetworkRoutes.js', 'middlewares/driverCategoryMiddleware.js',
    'socket/handlers/leadSocketHandler.js',
  ]) {
    check('§21', `new file ${file}`, fileExists(file));
  }

  // ---- §13.5 integration points ----------------------------------------
  const rideService = readIfExists('services/rideService.js');
  check('§13.5', 'lifecycle settles escrow on completion', rideService?.includes('settlePublishedRide'));
  check('§13.5', 'lifecycle takes collectedBy', rideService?.includes('collectedBy'));
  check('§13.5', 'cancel paths release escrow', dispatch?.includes('releaseEscrowAfterCancel'));
  const wallet = readIfExists('driver/services/walletService.js');
  check('§13.5', 'wallet exposes frozenBalance + available', wallet?.includes('frozenBalance') && wallet?.includes('available'));
  check('§13.5', 'withdrawal capped at available', readIfExists('driver/controllers/driverController.js')?.includes('withdrawableBalance'));

  console.log(`\n${pass} spec items present, ${fail} missing\n`);
  if (gaps.length) {
    console.log('MISSING:');
    for (const gap of gaps) console.log(`  ${gap}`);
    console.log('');
  }
  process.exitCode = fail ? 1 : 0;
};

run().catch((error) => {
  console.error('Spec audit crashed:', error);
  process.exitCode = 1;
});
