import React, { useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as Motion from 'framer-motion';
import AuthLayout from '../../components/AuthLayout';
import { User, Mail, Camera, Smartphone, ImagePlus, LifeBuoy, FileText, ShieldCheck } from 'lucide-react';
import { clearLocalUserSession, userAuthService } from '../../services/authService';
import { useSettings } from '../../../../shared/context/SettingsContext';

const fieldShellClassName =
  'rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all flex items-center gap-3 focus-within:border-slate-900 focus-within:ring-4 focus-within:ring-slate-900/5';

const fieldInputClassName =
  'w-full bg-transparent border-none text-[16px] font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none';

const PENDING_SIGNUP_PHONE_KEY = 'pendingUserSignupPhone';
const PENDING_SIGNUP_REFERRAL_CODE_KEY = 'pendingUserSignupReferralCode';
const syncPushTokens = () => {
  window.__flushNativeFcmToken?.().catch?.(() => {});
  window.__registerBrowserFcmToken?.({ interactive: true }).catch?.(() => {});
};

const Signup = () => {
  const location = useLocation();
  const { settings } = useSettings();
  const referralCodeFromQuery = new URLSearchParams(location.search).get('ref') || '';
  const preservedPhone = typeof window !== 'undefined' ? sessionStorage.getItem(PENDING_SIGNUP_PHONE_KEY) || '' : '';
  const preservedReferralCode = typeof window !== 'undefined'
    ? sessionStorage.getItem(PENDING_SIGNUP_REFERRAL_CODE_KEY) || ''
    : '';
  const initialPhone = String(location.state?.phone || preservedPhone || '').replace(/\D/g, '').slice(-10);
  const [formData, setFormData] = useState({
    phone: initialPhone,
    name: '',
    email: '',
    gender: 'prefer-not-to-say',
    profileImage: '',
    governmentIdProof: {
      type: 'other',
      imageUrl: '',
      fileName: '',
      uploadedAt: null,
    },
    referralCode: String(location.state?.referralCode || referralCodeFromQuery || preservedReferralCode || '').trim().toUpperCase(),
  });
  const [loading, setLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [idUploading, setIdUploading] = useState(false);
  const [idError, setIdError] = useState('');
  const [error, setError] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const navigate = useNavigate();
  const appName = settings.general?.app_name || 'App';
  const isValidPhone = /^\d{10}$/.test(formData.phone);
  const hasVerifiedSignupContext = Boolean(location.state?.otpVerified) || Boolean(preservedPhone);
  const [step, setStep] = useState(() => (hasVerifiedSignupContext ? 'profile' : 'phone'));

  useEffect(() => {
    if (step === 'profile' && isValidPhone) {
      sessionStorage.setItem(PENDING_SIGNUP_PHONE_KEY, formData.phone);
    }
  }, [formData.phone, isValidPhone, step]);

  useEffect(() => {
    const normalizedReferralCode = String(formData.referralCode || '').trim().toUpperCase();

    if (normalizedReferralCode) {
      sessionStorage.setItem(PENDING_SIGNUP_REFERRAL_CODE_KEY, normalizedReferralCode);
    } else {
      sessionStorage.removeItem(PENDING_SIGNUP_REFERRAL_CODE_KEY);
    }
  }, [formData.referralCode]);

  useEffect(() => {
    if (location.state?.otpVerified) {
      setStep('profile');
    }
  }, [location.state?.otpVerified]);

  const avatarPreviewUrl = useMemo(() => {
    return formData.profileImage || '';
  }, [formData.profileImage]);

  const idPreviewUrl = useMemo(() => {
    return formData.governmentIdProof?.imageUrl || '';
  }, [formData.governmentIdProof?.imageUrl]);

  const hasGovernmentIdProof = Boolean(formData.governmentIdProof?.type && formData.governmentIdProof?.imageUrl);

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });

  const imageFileToUploadDataUrl = async (file, { maxSize = 1280, quality = 0.82 } = {}) => {
    const dataUrl = await readFileAsDataUrl(file);
    if (!String(dataUrl || '').startsWith('data:image/')) {
      throw new Error('Please choose an image file');
    }

    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to process image'));
      img.src = dataUrl;
    });

    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', quality);
  };

  const extractUploadUrl = (uploadPayload) =>
    uploadPayload?.data?.url ||
    uploadPayload?.data?.secureUrl ||
    uploadPayload?.url ||
    uploadPayload?.secureUrl ||
    '';

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoError('');
    setPhotoUploading(true);

    try {
      const dataUrl = await imageFileToUploadDataUrl(file, { maxSize: 900, quality: 0.84 });
      const uploadPayload = await userAuthService.uploadProfileImage(dataUrl, formData.phone, 'profile');
      const secureUrl = extractUploadUrl(uploadPayload);

      if (!secureUrl) {
        throw new Error('Upload failed');
      }

      setFormData((prev) => ({ ...prev, profileImage: secureUrl }));
    } catch (err) {
      setPhotoError(err?.message || 'Photo upload failed');
      setFormData((prev) => ({ ...prev, profileImage: '' }));
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handleGovernmentIdChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIdError('');
    setIdUploading(true);

    try {
      const dataUrl = await imageFileToUploadDataUrl(file, { maxSize: 1500, quality: 0.86 });
      const uploadPayload = await userAuthService.uploadProfileImage(dataUrl, formData.phone, 'government_id');
      const imageUrl = extractUploadUrl(uploadPayload);

      if (!imageUrl) {
        throw new Error('ID proof upload failed');
      }

      setFormData((prev) => ({
        ...prev,
        governmentIdProof: {
          ...prev.governmentIdProof,
          imageUrl,
          fileName: file.name || `${prev.governmentIdProof.type}-proof`,
          uploadedAt: new Date().toISOString(),
        },
      }));
    } catch (err) {
      setIdError(err?.message || 'ID proof upload failed');
      setFormData((prev) => ({
        ...prev,
        governmentIdProof: {
          ...prev.governmentIdProof,
          imageUrl: '',
          fileName: '',
          uploadedAt: null,
        },
      }));
    } finally {
      setIdUploading(false);
      e.target.value = '';
    }
  };

  const handleStartSignup = async (e) => {
    e.preventDefault();
    if (!isValidPhone) return;

    setOtpSending(true);
    setError('');

    try {
      clearLocalUserSession();
      await userAuthService.startOtp(formData.phone);

      navigate('/taxi/user/verify-otp', {
        state: {
          phone: formData.phone,
          referralCode: formData.referralCode,
        },
      });
    } catch (err) {
      setError(err?.message || 'Unable to send OTP. Please try again.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleSignup = async (e, overrides = {}) => {
    e.preventDefault();
    const finalProfileImage = overrides.profileImage ?? formData.profileImage;
    if (!formData.name || !isValidPhone || !hasGovernmentIdProof || !finalProfileImage) {
      setError('Please fill in all required fields and upload your profile photo.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await userAuthService.signup({
        name: formData.name,
        phone: formData.phone,
        email: formData.email,
        gender: formData.gender,
        profileImage: overrides.profileImage ?? formData.profileImage,
        governmentIdProof: formData.governmentIdProof,
        referralCode: formData.referralCode,
      });
      const payload = response?.data || {};

      localStorage.setItem('token', payload.token || '');
      localStorage.setItem('userToken', payload.token || '');
      localStorage.setItem('role', 'user');
      localStorage.setItem('userInfo', JSON.stringify(payload.user || {}));
      syncPushTokens();
      sessionStorage.removeItem(PENDING_SIGNUP_PHONE_KEY);
      sessionStorage.removeItem(PENDING_SIGNUP_REFERRAL_CODE_KEY);
      navigate('/taxi/user', { replace: true });
    } catch (err) {
      const message = err?.message || 'Signup failed. Please try again.';

      if (message === 'OTP session not found' || message === 'Verify OTP before signup' || message === 'OTP session expired') {
        sessionStorage.removeItem(PENDING_SIGNUP_PHONE_KEY);
        setStep('phone');
        setError('Your verification session expired. Please request a fresh OTP to continue.');
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenderChange = (gender) => {
    setFormData({ ...formData, gender });
  };



  return (
    <AuthLayout
      title={step === 'profile' ? 'Complete your profile' : 'Create your account'}
      subtitle={
        step === 'profile'
          ? `Just a few details to get started with ${appName}`
          : `Start with your mobile number and we will verify it before creating your ${appName} account.`
      }
    >
      {step === 'phone' ? (
        <form onSubmit={handleStartSignup} className="space-y-6">
          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Mobile Number *</label>
            <div className={fieldShellClassName}>
              <Smartphone size={18} className="text-slate-500" />
              <span className="text-[16px] font-bold text-slate-700">+91</span>
              <input
                type="tel"
                maxLength={10}
                placeholder="Enter 10-digit number"
                className={fieldInputClassName}
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }))}
                required
              />
            </div>
            <p className="ml-1 text-sm text-slate-500">We’ll send a 4-digit OTP to this number.</p>
          </div>

          {error && (
            <p className="text-sm font-bold text-red-500 text-center">{error}</p>
          )}

          <Motion.motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={!isValidPhone || otpSending}
            className={`w-full py-4 rounded-xl text-lg font-bold transition-all flex items-center justify-center gap-3 ${
              isValidPhone && !otpSending
                ? 'bg-black text-white shadow-xl shadow-black/10'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
            }`}
          >
            {otpSending ? (
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                <span>Sending OTP...</span>
              </div>
            ) : (
              <span>Continue</span>
            )}
          </Motion.motion.button>

          <div className="space-y-3 text-center">
            <p className="text-sm font-medium text-slate-500">
              Already have an account?{' '}
              <Link
                to="/taxi/user/login"
                state={{ phone: formData.phone }}
                className="font-bold text-black underline underline-offset-4"
              >
                Login
              </Link>
            </p>
            <p className="text-[12px] text-slate-400 font-medium leading-relaxed px-2">
              By continuing, you agree to our
              <Link to="/terms" className="ml-1 text-black underline hover:opacity-70 transition-colors">
                Terms
              </Link>
              {' '}and
              <Link to="/privacy" className="ml-1 text-black underline hover:opacity-70 transition-colors">
                Privacy Policy
              </Link>
            </p>
          </div>
        </form>
      ) : (
      <form onSubmit={handleSignup} className="space-y-6 sm:space-y-8">
        {/* Avatar Placeholder */}
        <div className="flex flex-col items-center">
            <div className="relative group active:scale-95 transition-all">
                <div className="w-24 h-24 rounded-full bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden shadow-sm">
                    {avatarPreviewUrl ? (
                      <img src={avatarPreviewUrl} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User size={40} className="text-slate-400" />
                    )}
                </div>
                <div className="absolute bottom-1 right-1 w-8 h-8 bg-black rounded-full border-2 border-white flex items-center justify-center text-white shadow-md">
                    <Camera size={14} />
                </div>
            </div>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-900 flex items-center gap-1">
              Profile Photo <span className="text-red-500">*</span>
            </p>
            <p className="mt-2 text-xs font-medium text-slate-500">Please upload a clear photo of yourself to complete your profile.</p>
            <div className="mt-4 grid w-full max-w-[280px] grid-cols-2 gap-2">
              <label className={`relative flex h-11 items-center justify-center gap-2 rounded-2xl border text-[11px] font-bold uppercase tracking-wider transition-all ${
                photoUploading
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                  : 'cursor-pointer border-slate-200 bg-white text-slate-700 active:scale-[0.99]'
              }`}>
                <ImagePlus size={14} />
                Gallery
                <input
                  type="file"
                  accept="image/*"
                  disabled={photoUploading}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Upload profile photo from gallery"
                  onChange={handlePhotoChange}
                />
              </label>
              <label className={`relative flex h-11 items-center justify-center gap-2 rounded-2xl border text-[11px] font-bold uppercase tracking-wider transition-all ${
                photoUploading
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                  : 'cursor-pointer border-slate-900 bg-slate-950 text-white active:scale-[0.99]'
              }`}>
                <Camera size={14} />
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  disabled={photoUploading}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Capture profile photo"
                  onChange={handlePhotoChange}
                />
              </label>
            </div>
            {photoUploading && <p className="text-[11px] font-bold text-slate-500 mt-2">Uploading...</p>}
            {photoError && <p className="text-[11px] font-bold text-red-500 mt-2">{photoError}</p>}
        </div>

        <div className="space-y-4 sm:space-y-5">
          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Mobile Number *</label>
            <div className={fieldShellClassName}>
              <Smartphone size={18} className="text-slate-500" />
              <span className="text-[16px] font-bold text-slate-700">+91</span>
              <input
                type="tel"
                maxLength={10}
                placeholder="Enter 10-digit number"
                className={`${fieldInputClassName} text-slate-500`}
                value={formData.phone}
                readOnly
                aria-readonly="true"
                required
              />
            </div>
            <p className="ml-1 text-xs font-medium text-slate-500">Verified number. You can&apos;t edit it here.</p>
          </div>

          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Full Name *</label>
            <div className={fieldShellClassName}>
              <User size={18} className="text-slate-500" />
              <input 
                type="text" 
                placeholder="Enter your name"
                className={fieldInputClassName}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Email Address (Optional)</label>
            <div className={fieldShellClassName}>
              <Mail size={18} className="text-slate-500" />
              <input 
                type="email" 
                placeholder="Enter email address"
                className={fieldInputClassName}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Referral Code (Optional)</label>
            <div className={fieldShellClassName}>
              <User size={18} className="text-slate-500" />
              <input
                type="text"
                placeholder="Enter referral code"
                className={fieldInputClassName}
                value={formData.referralCode}
                onChange={(e) => setFormData((current) => ({
                  ...current,
                  referralCode: e.target.value.trim().toUpperCase(),
                }))}
              />
            </div>
            <p className="ml-1 text-xs font-medium text-slate-500">If someone shared a referral link, the code should already be filled in.</p>
          </div>

          <div className="space-y-3">
            <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Government ID Proof *</label>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="h-32 w-full overflow-hidden rounded-xl bg-slate-50 border border-dashed border-slate-300 sm:w-36 flex items-center justify-center">
                  {idPreviewUrl ? (
                    <img src={idPreviewUrl} alt="Government ID proof" className="h-full w-full object-cover" />
                  ) : (
                    <FileText size={34} className="text-slate-400" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-xs font-bold text-slate-700">Upload a clear photo of your government ID proof.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={`relative flex h-11 items-center justify-center gap-2 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-all ${
                      idUploading
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        : 'cursor-pointer border-slate-200 bg-white text-slate-700 active:scale-[0.99]'
                    }`}>
                      <ImagePlus size={14} />
                      Gallery
                      <input
                        type="file"
                        accept="image/*"
                        disabled={idUploading}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        aria-label="Upload government ID from gallery"
                        onChange={handleGovernmentIdChange}
                      />
                    </label>
                    <label className={`relative flex h-11 items-center justify-center gap-2 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-all ${
                      idUploading
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        : 'cursor-pointer border-slate-900 bg-slate-950 text-white active:scale-[0.99]'
                    }`}>
                      <Camera size={14} />
                      Camera
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={idUploading}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        aria-label="Capture government ID photo"
                        onChange={handleGovernmentIdChange}
                      />
                    </label>
                  </div>
                  {idPreviewUrl && (
                    <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-600">
                      <ShieldCheck size={14} />
                      Government ID proof uploaded
                    </div>
                  )}
                  {idUploading && <p className="text-[11px] font-bold text-slate-500">Uploading ID proof...</p>}
                  {idError && <p className="text-[11px] font-bold text-red-500">{idError}</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
             <label className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-600">Gender</label>
             <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                {['Male', 'Female', 'Other'].map((g) => (
                    <button
                        key={g}
                        type="button"
                        onClick={() => handleGenderChange(g.toLowerCase())}
                        className={`w-full py-3 rounded-xl text-[13px] font-bold border-2 transition-all ${
                            formData.gender === g.toLowerCase() 
                            ? 'border-black bg-black text-white shadow-sm' 
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        {g}
                    </button>
                ))}
             </div>
          </div>

          {error && (
            <p className="text-sm font-bold text-red-500 text-center">{error}</p>
          )}
        </div>

        {/* Missing Fields Checklist */}
        {(!formData.name || !hasGovernmentIdProof || !formData.profileImage) && (
          <div className="rounded-2xl bg-amber-50/50 border border-amber-100 p-4 space-y-2 transition-all duration-300">
            <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1.5">
              <span>Remaining Steps to Complete</span>
            </h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2.5 text-xs font-semibold">
                <span className={`w-2 h-2 rounded-full ${formData.profileImage ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                <span className={formData.profileImage ? 'text-slate-400 line-through font-normal' : 'text-slate-700'}>
                  Upload Profile Photo
                </span>
              </li>
              <li className="flex items-center gap-2.5 text-xs font-semibold">
                <span className={`w-2 h-2 rounded-full ${formData.name.trim() ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                <span className={formData.name.trim() ? 'text-slate-400 line-through font-normal' : 'text-slate-700'}>
                  Enter Full Name
                </span>
              </li>
              <li className="flex items-center gap-2.5 text-xs font-semibold">
                <span className={`w-2 h-2 rounded-full ${hasGovernmentIdProof ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                <span className={hasGovernmentIdProof ? 'text-slate-400 line-through font-normal' : 'text-slate-700'}>
                  Upload Government ID Proof
                </span>
              </li>
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <Motion.motion.button 
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={!formData.name || !isValidPhone || !hasGovernmentIdProof || !formData.profileImage || loading || photoUploading || idUploading}
            className={`w-full py-4 rounded-xl text-lg font-bold shadow-xl transition-all flex items-center justify-center gap-3 mt-4 ${
              formData.name && isValidPhone && hasGovernmentIdProof && formData.profileImage && !loading && !photoUploading && !idUploading
              ? 'bg-black text-white shadow-black/10' 
              : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
            }`}
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <span>Let's Go!</span>
            )}
          </Motion.motion.button>

          <button
            type="button"
            onClick={() => navigate('/taxi/user/support')}
            className="w-full py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 flex items-center justify-center gap-2"
          >
            <LifeBuoy size={16} />
            Need Help?
          </button>
        </div>

        <div className="space-y-3 text-center">
          <p className="text-sm font-medium text-slate-500">
            Already have an account?{' '}
            <Link
              to="/taxi/user/login"
              state={{ phone: formData.phone }}
              className="font-bold text-black underline underline-offset-4"
            >
              Login
            </Link>
          </p>
          <p className="text-[12px] text-slate-400 font-medium leading-relaxed px-1 sm:px-2">
            By creating an account, you agree to our
            <Link to="/terms" className="ml-1 text-black underline hover:opacity-70 transition-colors">
              Terms
            </Link>
            {' '}and
            <Link to="/privacy" className="ml-1 text-black underline hover:opacity-70 transition-colors">
              Privacy Policy
            </Link>
          </p>
        </div>
      </form>
      )}
    </AuthLayout>
  );
};

export default Signup;
