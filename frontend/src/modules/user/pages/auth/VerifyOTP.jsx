import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, CheckCircle2, ChevronRight, MessageSquare } from 'lucide-react';
import { userAuthService } from '../../services/authService';
import { useSettings } from '../../../../shared/context/SettingsContext';
import loginIllustration from '../../../../assets/images/login-illustration.png';

const unwrap = (response) => response?.data?.data || response?.data || response;
const PENDING_SIGNUP_PHONE_KEY = 'pendingUserSignupPhone';
const PENDING_OTP_PHONE_KEY = 'pendingUserOtpPhone';
const PENDING_SIGNUP_REFERRAL_CODE_KEY = 'pendingUserSignupReferralCode';
const RESEND_OTP_COOLDOWN_SECONDS = 60;

const syncPushTokens = () => {
  window.__flushNativeFcmToken?.().catch?.(() => {});
  window.__registerBrowserFcmToken?.({ interactive: true }).catch?.(() => {});
};

const VerifyOTP = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const inputs = useRef([]);
  
  const phone = String(
    location.state?.phone ||
    sessionStorage.getItem(PENDING_OTP_PHONE_KEY) ||
    sessionStorage.getItem(PENDING_SIGNUP_PHONE_KEY) ||
    '',
  ).replace(/\D/g, '').slice(-10);
  
  const referralCode = String(
    location.state?.referralCode ||
    sessionStorage.getItem(PENDING_SIGNUP_REFERRAL_CODE_KEY) ||
    '',
  ).trim().toUpperCase();

  const [otp, setOtp] = useState(['', '', '', '']);
  const [timer, setTimer] = useState(RESEND_OTP_COOLDOWN_SECONDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const appName = settings.general?.app_name || 'GoKab';
  const appLogo = settings.general?.logo || settings.customization?.logo || settings.general?.favicon || '';

  useEffect(() => {
    if (!phone) {
      navigate('/taxi/user/signup', { replace: true });
      return;
    }
    sessionStorage.setItem(PENDING_OTP_PHONE_KEY, phone);
  }, [navigate, phone]);

  useEffect(() => {
    let interval = null;
    if (timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      inputs.current[0]?.focus();
    }, 500);
    return () => window.clearTimeout(focusTimer);
  }, []);

  const handleChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    if (value && index < 3) {
      inputs.current[index + 1]?.focus();
    }
    setError('');
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const fullOtp = otp.join('');
    if (fullOtp.length < 4 || loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await userAuthService.verifyOtp(phone, fullOtp);
      const payload = unwrap(response);

      setSuccess(true);

      if (payload.exists) {
        localStorage.setItem('token', payload.token || '');
        localStorage.setItem('userToken', payload.token || '');
        localStorage.setItem('role', 'user');
        localStorage.setItem('userInfo', JSON.stringify(payload.user || {}));
        syncPushTokens();
        sessionStorage.removeItem(PENDING_OTP_PHONE_KEY);
        setTimeout(() => navigate('/taxi/user', { replace: true }), 1000);
        return;
      }

      setTimeout(() => navigate('/taxi/user/signup', { state: { phone, otpVerified: true, referralCode } }), 1000);
    } catch (err) {
      setError(err?.message || 'Invalid code. Please try again.');
      setOtp(['', '', '', '']);
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0 || loading) return;
    setLoading(true);
    setError('');
    try {
      await userAuthService.startOtp(phone);
      setOtp(['', '', '', '']);
      setTimer(RESEND_OTP_COOLDOWN_SECONDS);
      inputs.current[0]?.focus();
    } catch (err) {
      setError(err?.message || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E7F5E8] flex flex-col font-sans select-none overflow-hidden relative">
      {/* Top Background Illustration - Full Cover */}
      <div className="absolute top-0 left-0 right-0 h-[65%] z-0">
        <motion.img 
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          src={loginIllustration} 
          alt="Travel background" 
          className="w-full h-full object-cover object-bottom"
        />
        <div className="absolute inset-0 bg-black/5" />
      </div>

      {/* Top Header Section */}
      <header className="p-6 pt-10 flex items-center justify-between z-20">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 bg-white/10 backdrop-blur-md p-2 pr-4 rounded-full border border-white/20 shadow-xl"
        >
          {appLogo ? (
            <img 
              src={appLogo} 
              alt={appName} 
              className="h-8 w-8 object-contain rounded-full bg-black p-1.5"
            />
          ) : (
            <div className="h-8 w-8 bg-black rounded-full flex items-center justify-center">
               <div className="w-3 h-3 bg-white rounded-sm" />
            </div>
          )}
          <span className="text-lg font-black tracking-tighter text-black uppercase">{appName}</span>
        </motion.div>

        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate(-1)}
          className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-black shadow-xl"
        >
          <ArrowLeft size={20} strokeWidth={3} />
        </motion.button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-end">
        {/* Text and Actions Section */}
        <motion.div 
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 120 }}
          className="bg-white rounded-t-[40px] px-8 pt-10 pb-12 shadow-[0_-20px_60px_rgba(0,0,0,0.1)] z-20 relative"
        >
          <div className="space-y-8">
            <div className="space-y-2 text-center">
               <h2 className="text-[30px] font-black text-slate-900 leading-[1.1] tracking-tight">
                 Verify Number
               </h2>
               <p className="text-slate-400 font-medium text-sm">
                 We've sent a code to <span className="text-slate-900 font-bold">+91 {phone}</span>
               </p>
            </div>

            {/* OTP Inputs */}
            <div className="flex justify-between gap-3">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputs.current[index] = el)}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className={`h-16 w-full rounded-2xl border-2 text-center text-3xl font-black transition-all outline-none ${
                    digit 
                      ? 'border-slate-900 bg-slate-50 text-slate-900 shadow-lg shadow-slate-100' 
                      : 'border-slate-50 bg-slate-50 text-slate-900 focus:border-slate-200 focus:bg-white'
                  }`}
                />
              ))}
            </div>

            <div className="space-y-6">
              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center"
                  >
                    <p className="text-rose-500 text-xs font-bold">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-col items-center gap-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                  Didn't receive the code?
                </p>
                <button
                  onClick={handleResend}
                  disabled={timer > 0 || loading}
                  className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-all ${
                    timer > 0 
                      ? 'text-slate-200' 
                      : 'text-slate-900 hover:opacity-70 underline underline-offset-4 decoration-2'
                  }`}
                >
                  <MessageSquare size={14} />
                  {timer > 0 ? `Retry in ${timer}s` : 'Resend Code'}
                </button>
              </div>
            </div>

            <motion.button 
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleVerify}
              disabled={loading || otp.join('').length !== 4 || success}
              className={`w-full py-5 rounded-2xl text-[16px] font-bold transition-all flex items-center justify-center gap-3 ${
                otp.join('').length === 4 && !success
                  ? 'bg-slate-900 text-white shadow-2xl shadow-slate-900/30'
                  : success
                  ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                  : 'bg-slate-100 text-slate-300 pointer-events-none'
              }`}
            >
              {loading ? (
                <div className="h-6 w-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
              ) : success ? (
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={24} />
                  <span className="uppercase tracking-[0.1em]">Verified</span>
                </div>
              ) : (
                <>
                  <span className="uppercase tracking-[0.2em]">Verify & Continue</span>
                  <ChevronRight size={24} strokeWidth={4} />
                </>
              )}
            </motion.button>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default VerifyOTP;
