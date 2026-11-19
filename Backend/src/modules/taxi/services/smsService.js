import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';

const SMS_INDIA_HUB_ENDPOINT = 'http://cloud.smsindiahub.in/api/mt/SendSMS';
// Must match the DLT-approved "App Login" template exactly (id 1077104580057767222),
// including the trailing sender tag, or the provider rejects the message.
// Three variables: ##var##1 = app/brand, ##var##2 = "powered by" name, ##var##3 = OTP.
const DLT_TEMPLATE_TEXT =
  'Welcome to ##var##, powered by ##var##. Your OTP for registration ##var##. This OTP is valid for 10 minutes. Please do not share it with anyone.BGADPL';
const DEFAULT_SENDER_ID = 'BGADPL';
const DEFAULT_DLT_TEMPLATE_ID = '1077104580057767222';
const DEFAULT_DLT_ENTITY_ID = '1001164203633432409';
const DEFAULT_BRAND_NAME = 'App';

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const readValue = (...values) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        return trimmedValue;
      }
    }
  }

  return '';
};

const normalizeIndianPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '').trim();

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  if (digits.length === 10) {
    return `91${digits}`;
  }

  return digits;
};

const maskSecret = (value) => {
  const stringValue = String(value || '');

  if (!stringValue) {
    return '';
  }

  if (stringValue.length <= 6) {
    return `${'*'.repeat(Math.max(stringValue.length - 2, 0))}${stringValue.slice(-2)}`;
  }

  return `${stringValue.slice(0, 3)}${'*'.repeat(stringValue.length - 6)}${stringValue.slice(-3)}`;
};

const getSmsIndiaHubConfig = () => {
  const user = readValue(env.sms?.indiaHub?.username, process.env.SMS_INDIA_HUB_USERNAME);
  const password = readValue(env.sms?.indiaHub?.password, process.env.SMS_INDIA_HUB_PASSWORD);
  const apiKey = readValue(
    env.sms?.indiaHub?.apiKeyOverride,
    env.sms?.indiaHub?.apiKey,
    process.env.SMS_INDIA_HUB_API_KEY_OVERRIDE,
    process.env.SMS_INDIA_HUB_API_KEY,
  );
  const senderId = readValue(
    env.sms?.indiaHub?.senderId,
    process.env.SMS_INDIA_HUB_SENDER_ID,
    DEFAULT_SENDER_ID,
  );
  const templateId = readValue(
    env.sms?.indiaHub?.dltTemplateId,
    process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID,
    DEFAULT_DLT_TEMPLATE_ID,
  );
  const entityId = readValue(
    env.sms?.indiaHub?.entityId,
    process.env.SMS_INDIA_HUB_ENTITY_ID,
    DEFAULT_DLT_ENTITY_ID,
  );

  return {
    user,
    password,
    apiKey,
    senderId,
    templateId,
    entityId,
  };
};

const logSmsConfigDebug = (config) => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  console.log('[smsService] resolved SMS auth config =', {
    user: config.user || '',
    passwordPresent: Boolean(config.password),
    passwordMasked: maskSecret(config.password),
    apiKeyPresent: Boolean(config.apiKey),
    apiKeyMasked: maskSecret(config.apiKey),
    senderId: config.senderId || '',
    templateId: config.templateId || '',
    entityId: config.entityId || '',
  });
};

const logSmsPayloadDebug = (payload) => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const debugPayload = {};
  for (const [key, value] of payload.entries()) {
    debugPayload[key] = ['password'].includes(key) ? maskSecret(value) : value;
  }

  console.log('[smsService] final payload before request =', debugPayload);
};

const parseProviderResponse = (responseText) => {
  try {
    return JSON.parse(responseText);
  } catch {
    return null;
  }
};

const getConfiguredBrandName = async () => {
  try {
    const settings = await AdminBusinessSetting.findOne({ scope: 'default' })
      .select('general.app_name')
      .lean();

    return readValue(settings?.general?.app_name, DEFAULT_BRAND_NAME);
  } catch {
    return DEFAULT_BRAND_NAME;
  }
};

const getConfiguredPoweredBy = (brandName) =>
  readValue(env.sms?.poweredBy, process.env.SMS_POWERED_BY) || String(brandName || DEFAULT_BRAND_NAME);

const renderOtpMessage = ({ appName, poweredBy, otp }) =>
  DLT_TEMPLATE_TEXT
    .replace('##var##', String(appName))
    .replace('##var##', String(poweredBy))
    .replace('##var##', String(otp));

const isSuccessfulProviderResponse = (response, responseText) => {
  const parsed = parseProviderResponse(responseText);

  if (parsed && typeof parsed === 'object') {
    return response.ok && String(parsed.ErrorCode || '') === '000';
  }

  return response.ok && !/error|invalid|failed|unauthor|reject|blank/i.test(responseText);
};

const isAuthParsingError = (response, responseText) => {
  const parsed = parseProviderResponse(responseText);
  const errorMessage = String(parsed?.ErrorMessage || responseText || '').toLowerCase();
  const errorCode = String(parsed?.ErrorCode || '');

  return !response.ok || errorCode === '1' || errorCode === '2' || errorMessage.includes('login details cannot be blank');
};

const buildSmsPayload = ({ phone, otp, appName, poweredBy, authMode = 'apiKey' }) => {
  const config = getSmsIndiaHubConfig();

  logSmsConfigDebug(config);

  const useApiKey = authMode === 'apiKey';
  if (useApiKey) {
    if (!config.apiKey) {
      throw new ApiError(500, 'SMS India Hub API key is not configured');
    }
  } else {
    if (!config.user) {
      throw new ApiError(500, 'SMS India Hub user is not configured');
    }

    if (!config.password) {
      throw new ApiError(500, 'SMS India Hub password is not configured');
    }
  }

  if (!config.senderId) {
    throw new ApiError(500, 'SMS sender ID is not configured');
  }

  const normalizedPhone = normalizeIndianPhone(phone);
  if (!/^91\d{10}$/.test(normalizedPhone)) {
    throw new ApiError(400, 'A valid Indian mobile number is required for OTP');
  }

  const payload = new URLSearchParams({
    senderid: config.senderId,
    channel: 'Trans',
    DCS: '0',
    flashsms: '0',
    number: normalizedPhone,
    text: renderOtpMessage({ appName, poweredBy, otp }),
    // SMS India Hub's DLT API reads the template id from `DLTTemplateId`.
    // Sending it as `TemplateId` makes the provider match no template and
    // reject every message with ErrorCode 006 "Invalid template text".
    DLTTemplateId: config.templateId,
  });

  if (config.entityId) {
    payload.set('PEID', config.entityId);
    payload.set('EntityId', config.entityId);
  }

  if (useApiKey) {
    payload.set('APIKey', config.apiKey);
  } else {
    payload.set('user', config.user);
    payload.set('password', config.password);
  }

  logSmsPayloadDebug(payload);

  return payload;
};

/**
 * Sends free text through SMS India Hub. Indian SMS needs the text to match a
 * DLT-approved template, so this works only when SMS_CUSTOMER_TEMPLATE_ID names
 * one that fits; without it nothing is sent (and nothing breaks).
 */
export const sendCustomText = async ({ phone, text }) => {
  const templateId = String(process.env.SMS_CUSTOMER_TEMPLATE_ID || '').trim();
  if (!templateId) return { delivered: false, reason: 'no-template' };
  if (isTruthy(env.sms.useDefaultOtp)) return { delivered: false, reason: 'default-otp-mode' };

  const config = getSmsIndiaHubConfig();
  const normalizedPhone = normalizeIndianPhone(phone);
  if (!/^91\d{10}$/.test(normalizedPhone) || !config.senderId) return { delivered: false, reason: 'not-configured' };

  const payload = new URLSearchParams({
    senderid: config.senderId,
    channel: 'Trans',
    DCS: '0',
    flashsms: '0',
    number: normalizedPhone,
    text,
    DLTTemplateId: templateId,
  });
  if (config.entityId) {
    payload.set('PEID', config.entityId);
    payload.set('EntityId', config.entityId);
  }
  if (config.apiKey) payload.set('APIKey', config.apiKey);
  else {
    payload.set('user', config.user);
    payload.set('password', config.password);
  }
  const response = await fetch(SMS_INDIA_HUB_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });
  const body = (await response.text()).trim();
  return { delivered: isSuccessfulProviderResponse(response, body) };
};

export const sendOtpSms = async ({ phone, otp, purpose = 'otp' }) => {
  // Skipping delivery is only safe when the OTP is the configured static code;
  // otherwise a random OTP would be generated that nobody ever receives.
  if (isTruthy(env.sms.useDefaultOtp) && String(env.sms.staticOtpCode || '').trim()) {
    return {
      mode: 'debug',
      message: 'Default OTP mode enabled',
    };
  }

  const config = getSmsIndiaHubConfig();
  const brandName = await getConfiguredBrandName();
  const poweredBy = getConfiguredPoweredBy(brandName);
  // Only try an auth mode we actually have secrets for. Falling through to
  // 'credentials' when only an API key is set used to throw a misleading
  // "user is not configured" that masked the provider's real rejection.
  const authModes = [];
  if (config.apiKey) authModes.push('apiKey');
  if (config.user && config.password) authModes.push('credentials');
  if (authModes.length === 0) authModes.push('apiKey');
  let finalResponse = null;
  let finalResponseText = '';
  let delivered = false;

  for (const authMode of authModes) {
    const payload = buildSmsPayload({
      phone,
      otp,
      appName: brandName,
      poweredBy,
      authMode,
    });
    const requestBody = payload.toString();
    const queryRequestUrl = `${SMS_INDIA_HUB_ENDPOINT}?${requestBody}`;

    const primaryResponse = await fetch(SMS_INDIA_HUB_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      },
      body: requestBody,
    });
    const primaryResponseText = (await primaryResponse.text()).trim();
    finalResponse = primaryResponse;
    finalResponseText = primaryResponseText;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[smsService] SMS India Hub response (${authMode}, form body) =`, primaryResponseText);
    }

    if (isSuccessfulProviderResponse(primaryResponse, primaryResponseText)) {
      delivered = true;
      break;
    }

    if (isAuthParsingError(primaryResponse, primaryResponseText)) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[smsService] retrying with POST query-string fallback =', queryRequestUrl.replace(/password=[^&]+/, `password=${maskSecret(payload.get('password'))}`));
      }

      const fallbackResponse = await fetch(queryRequestUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        },
      });
      const fallbackResponseText = (await fallbackResponse.text()).trim();

      finalResponse = fallbackResponse;
      finalResponseText = fallbackResponseText;

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[smsService] SMS India Hub response (${authMode}, query fallback) =`, fallbackResponseText);
      }

      if (isSuccessfulProviderResponse(fallbackResponse, fallbackResponseText)) {
        delivered = true;
        break;
      }

      if (isAuthParsingError(fallbackResponse, fallbackResponseText)) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(
            '[smsService] retrying with GET query-string fallback =',
            queryRequestUrl.replace(/password=[^&]+/, `password=${maskSecret(payload.get('password'))}`),
          );
        }

        const getFallbackResponse = await fetch(queryRequestUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
          },
        });
        const getFallbackResponseText = (await getFallbackResponse.text()).trim();

        finalResponse = getFallbackResponse;
        finalResponseText = getFallbackResponseText;

        if (process.env.NODE_ENV !== 'production') {
          console.log(`[smsService] SMS India Hub response (${authMode}, GET fallback) =`, getFallbackResponseText);
        }

        if (isSuccessfulProviderResponse(getFallbackResponse, getFallbackResponseText)) {
          delivered = true;
          break;
        }
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[smsService] SMS India Hub final response =', finalResponseText);
  }

  const parsedFinalResponse = parseProviderResponse(finalResponseText);
  const looksFailed = !delivered || !isSuccessfulProviderResponse(finalResponse, finalResponseText);

  if (looksFailed) {
    throw new ApiError(
      502,
      `SMS India Hub rejected ${purpose} request: ${finalResponseText || finalResponse.statusText}`,
    );
  }

  return {
    mode: 'live',
    message: 'OTP sent successfully',
    providerResponse: finalResponseText,
    jobId: parsedFinalResponse?.JobId || null,
  };
};
