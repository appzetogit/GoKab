import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, ChevronRight, CheckCircle2, ArrowLeft } from 'lucide-react';
import { getLocalUserToken, userAuthService } from '../../services/authService';
import { useSettings } from '../../../../shared/context/SettingsContext';
import loginIllustration from '../../../../assets/images/login-illustration.png';

const extractLoginErrorMessage = (error) => {
  if (typeof error === 'string') {
    return error;
  }

  return (
    error?.message ||
    error?.error ||
    error?.details?.message ||
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    ''
  );
};

const isBlockedAccountMessage = (message) => {
  const normalizedMessage = String(message || '').trim().toLowerCase();

  return (
    normalizedMessage.includes('not active') ||
    normalizedMessage.includes('blocked') ||
    normalizedMessage.includes('inactive')
  );
};

const getFriendlyLoginError = (message) => {
  const normalizedMessage = String(message || '').trim();
  const loweredMessage = normalizedMessage.toLowerCase();

  if (!normalizedMessage) {
    return 'Unable to send OTP. Please try again.';
  }

  if (
    loweredMessage.includes('not active') ||
    loweredMessage.includes('blocked') ||
    loweredMessage.includes('inactive')
  ) {
    return 'Your account has been blocked. Please contact support for help.';
  }

  return normalizedMessage;
};

const Login = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const phoneInputRef = useRef(null);
  const locationError = extractLoginErrorMessage(location.state?.error);
  
  const [phoneNumber, setPhoneNumber] = useState(() => String(location.state?.phone || '').replace(/\D/g, '').slice(-10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => (
    isBlockedAccountMessage(locationError) ? getFriendlyLoginError(locationError) : ''
  ));
  const [showInput, setShowInput] = useState(false);
  
  const appName = settings.general?.app_name || 'GoKab';
  const appLogo = settings.general?.logo || settings.customization?.logo || settings.general?.favicon || '';
  
  const userHomeRoute = useMemo(
    () => (location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '/user'),
    [location.pathname],
  );

  const isValidPhone = phoneNumber.length === 10 && /^\d+$/.test(phoneNumber);

  useEffect(() => {
    const token = getLocalUserToken();
    if (token) {
      navigate(userHomeRoute, { replace: true });
    }
  }, [navigate, userHomeRoute]);

  useEffect(() => {
    if (!location.state) {
      return;
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!isValidPhone || loading) return;

    setLoading(true);
    setError('');

    try {
      await userAuthService.startOtp(phoneNumber);
      navigate('/taxi/user/verify-otp', {
        state: { phone: phoneNumber },
      });
    } catch (err) {
      setError(getFriendlyLoginError(extractLoginErrorMessage(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E7F5E8] flex flex-col font-sans select-none overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-[65%] z-0">
        <motion.img 
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          src={loginIllustration} 
          alt="Travel background" 
          className="w-full h-full object-cover object-bottom"
        />
        <div className="absolute inset-0 bg-black/5" />
      </div>

      <header className="p-6 pt-10 flex items-center gap-3 z-20">
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
      </header>

      <main className="flex-1 flex flex-col justify-end">
        <motion.div 
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 120 }}
          className="bg-white rounded-t-[40px] px-8 pt-10 pb-12 shadow-[0_-20px_60px_rgba(0,0,0,0.1)] z-20 relative"
        >
          <AnimatePresence mode="wait">
            {!showInput ? (
              <motion.div 
                key="welcome"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                   <h2 className="text-[30px] font-black text-slate-900 leading-[1.1] tracking-tight">
                     Explore new ways to <br/>travel with {appName}
                   </h2>
                   <p className="text-slate-400 font-medium">Experience premium mobility at your fingertips.</p>
                </div>

                <motion.button 
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowInput(true)}
                  className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[16px] font-bold shadow-2xl shadow-slate-900/30 flex items-center justify-center gap-3"
                >
                  Continue with Phone Number
                </motion.button>

                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  By continuing, you agree that you have read and accept our{' '}
                  <Link to="/terms" className="text-slate-600 font-bold hover:underline">T&Cs</Link> and{' '}
                  <Link to="/privacy" className="text-slate-600 font-bold hover:underline">Privacy Policy</Link>
                </p>
              </motion.div>
            ) : (
              <motion.div 
                key="input"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4">
                  <motion.button 
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setShowInput(false)}
                    className="p-2 -ml-2 rounded-full hover:bg-slate-50 transition-colors"
                  >
                    <ArrowLeft size={24} className="text-slate-900" />
                  </motion.button>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Enter Phone</h2>
                </div>

                <div className="space-y-4">
                  <div className={`flex items-center gap-4 p-5 rounded-2xl transition-all border-2 ${error ? 'border-rose-100 bg-rose-50/30' : 'border-slate-50 bg-slate-50 focus-within:border-slate-900 focus-within:bg-white focus-within:shadow-xl'}`}>
                    <div className="flex items-center gap-3 pr-4 border-r border-slate-200">
                      <img src="https://flagcdn.com/w40/in.png" alt="India" className="w-5 h-3.5 object-cover rounded-sm" />
                      <span className="text-slate-400 text-sm font-black">+91</span>
                    </div>
                    <input 
                      ref={phoneInputRef}
                      type="tel" 
                      inputMode="numeric"
                      maxLength={10}
                      autoFocus
                      value={phoneNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setPhoneNumber(val);
                        if (error) setError('');
                      }}
                      placeholder="000 000 0000"
                      className="flex-1 bg-transparent border-none p-0 text-xl font-bold text-slate-900 outline-none focus:ring-0 placeholder:text-slate-200 tracking-widest"
                    />
                  </div>
                  {error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>

                <motion.button 
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleLogin}
                  disabled={loading || !isValidPhone}
                  className={`w-full py-5 rounded-2xl text-[16px] font-bold transition-all flex items-center justify-center gap-3 ${
                    isValidPhone 
                      ? 'bg-slate-900 text-white shadow-2xl shadow-slate-900/30' 
                      : 'bg-slate-100 text-slate-300 pointer-events-none'
                  }`}
                >
                  {loading ? (
                    <div className="h-6 w-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="uppercase tracking-widest">Next Step</span>
                      <ChevronRight size={24} strokeWidth={4} />
                    </>
                  )}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  );
};

export default Login;
