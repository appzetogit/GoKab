import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { mediaService } from '../../../../services/media.service.js';
import { env } from '../../../../config/env.js';
import { ensureThirdPartySettings, getReferralSettings, getReferralTranslationContent } from '../../admin/services/adminService.js';
import { getPublicActivePaymentGateway, resolveConfiguredGatewayCredentials } from '../../services/paymentGatewayService.js';
import { buildPaymentRequestContext, logPaymentDiagnostic } from '../../services/paymentDiagnostics.js';

/**
 * Common controller for shared utilities like file uploads
 */
export const uploadImage = asyncHandler(async (req, res) => {
    const { image, folder = 'general' } = req.body;
    
    if (!image) {
        return res.status(400).json({ success: false, message: 'Image data is required' });
    }

    const uploadResult = await mediaService.uploadMedia(image, folder, '', req);

    return res.json({
        success: true,
        data: {
            url: uploadResult.url,
            secureUrl: uploadResult.url,
            publicId: uploadResult.filename,
            format: uploadResult.mimeType.split('/')[1] || 'webp'
        }
    });
});

export const getReferralTranslation = asyncHandler(async (req, res) => {
    const languageCode = String(req.query?.language || req.query?.lang || '').trim().toLowerCase();
    const data = await getReferralTranslationContent(languageCode);

    return res.json({
        success: true,
        data,
    });
});

export const getReferralSettingsContent = asyncHandler(async (req, res) => {
    const type = String(req.query?.type || '').trim().toLowerCase();
    const data = await getReferralSettings(type || undefined);

    return res.json({
        success: true,
        data,
    });
});

export const getPaymentGatewayConfig = asyncHandler(async (_req, res) => {
    const data = await getPublicActivePaymentGateway();

    return res.json({
        success: true,
        data,
    });
});

// Public client config: the admin-set Google Maps browser key and the Razorpay
// key id (never the secret), so every app uses what the admin saved.
export const getPublicAppConfig = asyncHandler(async (_req, res) => {
    const settings = await ensureThirdPartySettings();
    const maps = settings?.map_apis || {};
    let razorpayKeyId = '';
    try {
        razorpayKeyId = (await resolveConfiguredGatewayCredentials('razor_pay')).keyId || '';
    } catch {
        // gateway disabled or not configured: apps fall back to the key sent with each order
    }

    return res.json({
        success: true,
        data: {
            google_maps_key: maps.google_map_key_for_web_apps || maps.google_map_key_for_distance_matrix || '',
            razorpay_key_id: razorpayKeyId,
        },
    });
});

// What the rider app needs to price and offer carpool.
export const getCarpoolPublicConfig = asyncHandler(async (_req, res) => {
    const { getCarpoolSettings } = await import('../../services/carpoolService.js');
    const cfg = await getCarpoolSettings();
    return res.json({
        success: true,
        data: {
            enabled_airport: cfg.enabledAirport,
            enabled_railway: cfg.enabledRailway,
            seat_fare_percent: cfg.seatFarePercent,
        },
    });
});

// The link a customer without the app gets: a map page and the data it polls.
const TRACK_TOKEN = /^[A-Za-z0-9_-]{6,40}$/;

export const getTrackingPage = asyncHandler(async (req, res) => {
    if (!TRACK_TOKEN.test(req.params.token)) return res.status(404).send('Link not found');
    const { trackingPageHtml } = await import('../../services/networkTripService.js');
    res.set('Cache-Control', 'no-store');
    return res.type('html').send(trackingPageHtml(req.params.token));
});

export const getTrackingData = asyncHandler(async (req, res) => {
    if (!TRACK_TOKEN.test(req.params.token)) return res.json({ success: true, data: null });
    const { getTrackingData: load } = await import('../../services/networkTripService.js');
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: await load(req.params.token) });
});

export const acknowledgePhonePeCallback = asyncHandler(async (req, res) => {
    logPaymentDiagnostic({
        provider: 'phonepe',
        scope: 'callback',
        stage: 'received',
        request: buildPaymentRequestContext(req),
        query: req.query || {},
        body: req.body || {},
    });

    return res.json({
        success: true,
        message: 'Callback received',
    });
});
